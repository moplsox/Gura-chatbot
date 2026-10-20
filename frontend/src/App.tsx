import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, fetchSTT, fetchTTS } from "./api/client";
import { audioPlayer } from "./audio/AudioPlayer";
import { BrowserSTT, browserSttSupported } from "./audio/BrowserSTT";
import { micSupported, Recorder } from "./audio/Recorder";
import Bubbles from "./components/Bubbles";
import ChatPanel from "./components/ChatPanel";
import InputBar from "./components/InputBar";
import Live2DStage from "./components/Live2DStage";
import SettingsPanel from "./components/SettingsPanel";
import StatusBadge from "./components/StatusBadge";
import { EmotionMapper } from "./emotion/EmotionMapper";
import { Live2DController } from "./live2d/Live2DController";
import type { ModelCapabilities } from "./live2d/types";
import type { AppStatus, AssistantReply, ChatMessage, Emotion, Settings } from "./types";

const SETTINGS_KEY = "gura.settings.v1";
const DEFAULT_MODEL = (import.meta.env.VITE_LIVE2D_MODEL_URL as string | undefined) ?? "/live2d/models/Haru/Haru.model3.json";
const DEFAULT_SETTINGS: Settings = {
  language: "auto",
  muted: false,
  voiceEnabled: true,
  voiceConversion: true,
  modelUrl: DEFAULT_MODEL,
  sttMode: "server",
  subtitles: true,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

const uid = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AppStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [caps, setCaps] = useState<ModelCapabilities | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  const controller = useMemo(() => new Live2DController(), []);
  const mapperRef = useRef<EmotionMapper | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef(0);
  const recorderRef = useRef<Recorder | null>(null);
  const browserSttRef = useRef<BrowserSTT | null>(null);
  const resetTimer = useRef<number | null>(null);

  const zh = settings.language === "zh";
  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  // ----- persistence / side-effects of settings -----
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    audioPlayer.muted = settings.muted;
  }, [settings.muted]);

  // ----- backend health -----
  useEffect(() => {
    api.health().then(() => setBackendUp(true)).catch(() => setBackendUp(false));
  }, []);

  // ----- Live2D model capabilities → EmotionMapper -----
  useEffect(() => {
    return controller.onState(async (s) => {
      if (s === "ready" && controller.capabilities) {
        const c = controller.capabilities;
        const preset = await EmotionMapper.loadPreset(c.url);
        mapperRef.current = new EmotionMapper(c, preset);
        setCaps(c);
      } else if (s !== "ready") {
        setCaps(null);
        mapperRef.current = null;
      }
    });
  }, [controller]);

  // ----- audio unlock on first gesture (iOS) + mouth sync wiring -----
  useEffect(() => {
    const unlock = () => void audioPlayer.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    const off = audioPlayer.onLevel((lvl) => controller.setMouthLevel(lvl));
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      off();
    };
  }, [controller]);

  useEffect(() => () => controller.destroy(), [controller]);

  // ----- emotion application -----
  const applyEmotion = useCallback(
    (emotion: Emotion, intensity: number, motion?: string, expression?: string, holdMs = 6000) => {
      const mapper = mapperRef.current;
      if (!mapper || !controller.loaded) return;
      const plan = mapper.plan(emotion, intensity, motion, expression);
      console.debug("[emotion]", emotion, plan);
      void controller.setExpression(plan.expression);
      controller.setOverrides(plan.params, plan.weight);
      if (plan.motion) void controller.playMotion(plan.motion.group, plan.motion.index);
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      if (emotion !== "neutral" && holdMs > 0) {
        resetTimer.current = window.setTimeout(() => {
          const neutral = mapper.plan("neutral", 0.5);
          void controller.setExpression(neutral.expression);
          controller.clearOverrides();
        }, holdMs);
      }
    },
    [controller],
  );

  // ----- barge-in / interrupt -----
  const interrupt = useCallback(() => {
    turnRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    audioPlayer.stop();
    controller.setMouthEnabled(false);
    setSubtitle(null);
    setMessages((ms) => ms.filter((m) => !m.pending));
    setStatus("idle");
  }, [controller]);

  // Debug hook for e2e tests / console experiments (dev builds only).
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __gura: unknown }).__gura = { controller, audioPlayer, applyEmotion, interrupt };
    }
  }, [controller, applyEmotion, interrupt]);

  // ----- main chat turn -----
  const sendMessage = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      interrupt();
      const turn = turnRef.current;
      const userMsg: ChatMessage = { id: uid(), role: "user", text: t, ts: Date.now() };
      const pendingId = uid();
      setMessages((ms) => [...ms, userMsg, { id: pendingId, role: "assistant", text: "", pending: true, ts: Date.now() }]);
      setStatus("thinking");
      applyEmotion("thinking", 0.5, "think", undefined, 0);
      const ac = new AbortController();
      abortRef.current = ac;
      let reply: AssistantReply;
      try {
        const res = await api.chat(t, sessionId, settings.language, ac.signal);
        if (turn !== turnRef.current) return;
        setSessionId(res.session_id);
        reply = res.reply;
        setMessages((ms) => ms.map((m) => (m.id === pendingId ? { ...m, text: reply.text, reply, pending: false } : m)));
      } catch (e) {
        if (turn !== turnRef.current) return;
        const msg = e instanceof ApiError ? e.message : (e as Error).message || String(e);
        setMessages((ms) => ms.map((m) => (m.id === pendingId ? { ...m, text: `⚠️ ${msg}`, pending: false, error: true } : m)));
        setStatus("error");
        applyEmotion("confused", 0.6, "shake_head");
        window.setTimeout(() => setStatus((s) => (s === "error" ? "idle" : s)), 2500);
        return;
      }
      applyEmotion(reply.emotion, reply.intensity, reply.motion, reply.expression, 8000);
      if (settings.subtitles) setSubtitle(reply.text);

      if (!settings.voiceEnabled) {
        setStatus("idle");
        window.setTimeout(() => setSubtitle((s) => (s === reply.text ? null : s)), 6000);
        return;
      }
      setStatus("generating");
      try {
        const { audio } = await fetchTTS(reply.text, reply.language, settings.voiceConversion, ac.signal);
        if (turn !== turnRef.current) return;
        setStatus("speaking");
        controller.setMouthEnabled(true);
        await audioPlayer.play(audio);
      } catch (e) {
        if (turn !== turnRef.current) return;
        const msg = e instanceof ApiError ? e.message : (e as Error).message || String(e);
        console.warn("[voice]", msg);
        setMessages((ms) => [...ms, { id: uid(), role: "system", text: `🔇 ${zh ? "語音播放失敗" : "Voice unavailable"}: ${msg}`, ts: Date.now(), error: true }]);
      } finally {
        if (turn === turnRef.current) {
          controller.setMouthEnabled(false);
          setStatus("idle");
          window.setTimeout(() => setSubtitle((s) => (s === reply.text ? null : s)), 1500);
        }
      }
    },
    [applyEmotion, controller, interrupt, sessionId, settings.language, settings.subtitles, settings.voiceConversion, settings.voiceEnabled, zh],
  );

  // ----- microphone -----
  const useBrowserStt = settings.sttMode === "browser" && browserSttSupported();
  const micAvailable = useBrowserStt || micSupported();

  const toggleMic = useCallback(async () => {
    if (recording) {
      setRecording(false);
      setStatus("thinking");
      try {
        let text = "";
        if (browserSttRef.current) {
          text = await browserSttRef.current.stop();
          browserSttRef.current = null;
        } else if (recorderRef.current) {
          const rec = await recorderRef.current.stop();
          recorderRef.current = null;
          if (rec.durationMs < 400) throw new Error(zh ? "錄音太短" : "Recording too short");
          const res = await fetchSTT(rec.blob, settings.language);
          text = res.text;
        }
        setInterim("");
        if (!text.trim()) {
          setStatus("idle");
          setMessages((ms) => [...ms, { id: uid(), role: "system", text: zh ? "（沒有聽到內容）" : "(I didn't catch that)", ts: Date.now() }]);
          return;
        }
        await sendMessage(text);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : (e as Error).message;
        setStatus("idle");
        setInterim("");
        setMessages((ms) => [...ms, { id: uid(), role: "system", text: `🎤 ${msg}`, ts: Date.now(), error: true }]);
      }
      return;
    }
    interrupt();
    await audioPlayer.unlock();
    try {
      if (useBrowserStt) {
        const stt = new BrowserSTT();
        stt.onInterim = setInterim;
        stt.start(settings.language === "zh" ? "zh" : "en");
        browserSttRef.current = stt;
      } else {
        const rec = new Recorder();
        rec.onLevel = () => controller.setMouthLevel(0); // keep mouth closed while listening
        await rec.start();
        recorderRef.current = rec;
      }
      setRecording(true);
      setStatus("listening");
      applyEmotion("thinking", 0.3, undefined, undefined, 0);
    } catch (e) {
      const msg = (e as Error).name === "NotAllowedError" ? (zh ? "麥克風權限被拒絕" : "Microphone permission denied") : (e as Error).message;
      setMessages((ms) => [...ms, { id: uid(), role: "system", text: `🎤 ${msg}`, ts: Date.now(), error: true }]);
    }
  }, [applyEmotion, controller, interrupt, recording, sendMessage, settings.language, useBrowserStt, zh]);

  const clearChat = useCallback(() => {
    interrupt();
    if (sessionId) api.clearChat(sessionId).catch(() => undefined);
    setSessionId(null);
    setMessages([]);
    setShowSettings(false);
    applyEmotion("neutral", 0.5);
  }, [applyEmotion, interrupt, sessionId]);

  const busy = status === "thinking" || status === "generating" || status === "speaking";

  return (
    <div className={`app ${fullscreen ? "fullscreen" : ""}`} data-testid="app">
      <Bubbles />
      <Live2DStage controller={controller} modelUrl={settings.modelUrl} language={settings.language} onTap={() => controller.tap()}>
        <div className="stage-overlay">
          <StatusBadge status={status} language={settings.language} />
          <div className="toolbar">
            <div className="lang-toggle" title={zh ? "回覆語言" : "Reply language"}>
              {(["en", "zh"] as const).map((l) => (
                <button key={l} className={settings.language === l ? "on" : ""} onClick={() => update({ language: settings.language === l ? "auto" : l })} data-testid={`lang-${l}`}>
                  {l === "en" ? "EN" : "中"}
                </button>
              ))}
            </div>
            <button className={`icon-btn ${settings.muted ? "active" : ""}`} onClick={() => update({ muted: !settings.muted })} title={zh ? "靜音" : "Mute"} data-testid="mute">
              {settings.muted ? "🔇" : "🔊"}
            </button>
            <button className="icon-btn" onClick={() => setChatCollapsed((c) => !c)} title={zh ? "收合聊天" : "Toggle chat"} data-testid="toggle-chat">💬</button>
            <button className={`icon-btn ${fullscreen ? "active" : ""}`} onClick={() => setFullscreen((f) => !f)} title={zh ? "角色全螢幕" : "Character fullscreen"} data-testid="fullscreen">⛶</button>
            <button className="icon-btn" onClick={() => setShowSettings(true)} title={zh ? "設定" : "Settings"} data-testid="open-settings">⚙️</button>
          </div>
        </div>
        {(subtitle || interim) && (
          <div className="subtitle" data-testid="subtitle">{recording ? `🎤 ${interim || (zh ? "聆聽中…" : "Listening…")}` : subtitle}</div>
        )}
        {fullscreen && (
          <button className="icon-btn" style={{ position: "absolute", right: 14, bottom: 18, zIndex: 3 }} onClick={() => setFullscreen(false)} title="exit">✕</button>
        )}
      </Live2DStage>

      <header className="header">
        <div className="brand">
          <div className="logo">🦈</div>
          <div>
            <h1>Gura AI Chat</h1>
            <small>{backendUp === false ? (zh ? "後端離線" : "backend offline") : zh ? "Live2D 語音聊天" : "Live2D voice chat"}</small>
          </div>
        </div>
      </header>

      <ChatPanel messages={messages} language={settings.language} collapsed={chatCollapsed} onSuggestion={sendMessage} />

      <InputBar
        disabled={backendUp === false}
        busy={busy}
        recording={recording}
        micAvailable={micAvailable}
        language={settings.language}
        onSend={sendMessage}
        onMicToggle={toggleMic}
        onInterrupt={interrupt}
      />

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onChange={update}
          onClose={() => setShowSettings(false)}
          onClear={clearChat}
          onTestEmotion={(e) => applyEmotion(e, 0.9, undefined, undefined, 6000)}
          caps={caps}
          browserSttSupported={browserSttSupported()}
        />
      )}
    </div>
  );
}
