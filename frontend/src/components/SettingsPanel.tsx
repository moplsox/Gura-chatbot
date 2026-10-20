import { useEffect, useState } from "react";
import { api, fetchSpeechStatus, type SpeechStatus } from "../api/client";
import type { ModelCapabilities } from "../live2d/types";
import { EMOTIONS, type Emotion, type HealthInfo, type Settings } from "../types";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  onClear: () => void;
  onTestEmotion: (e: Emotion) => void;
  caps: ModelCapabilities | null;
  browserSttSupported: boolean;
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={onToggle} role="switch" aria-checked={on} />;
}

export default function SettingsPanel({ settings, onChange, onClose, onClear, onTestEmotion, caps, browserSttSupported }: Props) {
  const zh = settings.language === "zh";
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [speech, setSpeech] = useState<SpeechStatus | null>(null);
  const [modelUrl, setModelUrl] = useState(settings.modelUrl);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    fetchSpeechStatus().then(setSpeech).catch(() => setSpeech(null));
  }, []);

  const t = (en: string, z: string) => (zh ? z : en);
  const yesno = (v: boolean | undefined, okText = "ready", badText = "unavailable") => (
    <b className={v ? "ok" : "bad"}>{v ? okText : badText}</b>
  );

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" data-testid="settings">
        <h2>
          {t("Settings", "設定")}
          <button className="icon-btn" onClick={onClose} aria-label="close">✕</button>
        </h2>

        <section>
          <h3>{t("Conversation", "對話")}</h3>
          <div className="row">
            <span>{t("Reply language", "回覆語言")}</span>
            <div className="lang-toggle">
              {(["auto", "en", "zh"] as const).map((l) => (
                <button key={l} className={settings.language === l ? "on" : ""} onClick={() => onChange({ language: l })}>
                  {l === "auto" ? t("Auto", "自動") : l === "en" ? "EN" : "中文"}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span>{t("Show subtitles", "顯示字幕")}</span>
            <Switch on={settings.subtitles} onToggle={() => onChange({ subtitles: !settings.subtitles })} />
          </div>
          <div className="row">
            <span>{t("Clear conversation", "清除對話")}<small>{t("Forgets the chat history", "忘記目前的對話記憶")}</small></span>
            <button className="btn danger" onClick={onClear}>{t("Clear", "清除")}</button>
          </div>
        </section>

        <section>
          <h3>{t("Voice", "語音")}</h3>
          <div className="row">
            <span>{t("Speak replies (TTS)", "朗讀回覆（TTS）")}</span>
            <Switch on={settings.voiceEnabled} onToggle={() => onChange({ voiceEnabled: !settings.voiceEnabled })} />
          </div>
          <div className="row">
            <span>{t("Mute", "靜音")}</span>
            <Switch on={settings.muted} onToggle={() => onChange({ muted: !settings.muted })} />
          </div>
          <div className="row">
            <span>
              {t("Gura voice conversion (So-VITS-SVC)", "Gura 音色轉換（So-VITS-SVC）")}
              <small>
                {speech ? (speech.voice_conversion.enabled ? speech.voice_conversion.status : t("disabled in .env (VC_PROVIDER)", ".env 中未啟用（VC_PROVIDER）")) : "…"}
              </small>
            </span>
            <Switch on={settings.voiceConversion} onToggle={() => onChange({ voiceConversion: !settings.voiceConversion })} />
          </div>
          <div className="row">
            <span>
              {t("Speech recognition", "語音辨識")}
              <small>
                {t("server", "伺服器")}: {speech ? (speech.stt.available ? speech.stt.engine : speech.stt.status || t("unavailable", "無法使用")) : "…"}
                {" · "}{t("browser", "瀏覽器")}: {browserSttSupported ? t("supported", "支援") : t("not supported", "不支援")}
              </small>
            </span>
            <select value={settings.sttMode} onChange={(e) => onChange({ sttMode: e.target.value as Settings["sttMode"] })} style={{ width: 130 }}>
              <option value="server">{t("Server (Whisper)", "伺服器 (Whisper)")}</option>
              <option value="browser" disabled={!browserSttSupported}>{t("Browser", "瀏覽器")}</option>
            </select>
          </div>
        </section>

        <section>
          <h3>Live2D</h3>
          <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span>{t("Model (.model3.json URL)", "模型（.model3.json 路徑）")}</span>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input type="text" value={modelUrl} onChange={(e) => setModelUrl(e.target.value)} spellCheck={false} />
              <button className="btn" onClick={() => onChange({ modelUrl })}>{t("Load", "載入")}</button>
            </div>
            <small style={{ marginTop: 6 }}>
              {t("Put your Gura model in frontend/public/live2d/models/<Name>/ and enter /live2d/models/<Name>/<Name>.model3.json",
                 "把 Gura 模型放到 frontend/public/live2d/models/<Name>/，再輸入 /live2d/models/<Name>/<Name>.model3.json")}
            </small>
          </div>
          {caps && (
            <div className="kv" style={{ marginTop: 8 }}>
              <span>{t("Model", "模型")}</span><b>{caps.name} (Cubism {caps.cubismVersion})</b>
              <span>{t("Parameters", "參數")}</span><b>{caps.parameters.length}</b>
              <span>{t("Expressions", "表情")}</span><b>{caps.expressions.length ? caps.expressions.join(", ") : t("none", "無")}</b>
              <span>{t("Motions", "動作")}</span>
              <b>{Object.entries(caps.motionGroups).map(([g, m]) => `${g}(${m.length})`).join(", ") || t("none", "無")}</b>
              <span>LipSync</span><b>{caps.lipSyncIds.join(", ") || t("none → ParamMouthOpenY fallback", "無 → 退回 ParamMouthOpenY")}</b>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <small style={{ color: "var(--text-dim)" }}>{t("Test emotions", "測試情緒")}</small>
            <div className="emotion-grid" style={{ marginTop: 6 }}>
              {EMOTIONS.map((e) => (
                <button key={e} onClick={() => onTestEmotion(e)} data-testid={`emo-${e}`}>{e}</button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h3>{t("Backend", "後端")}</h3>
          {health ? (
            <div className="kv">
              <span>{t("Status", "狀態")}</span>{yesno(health.status === "ok", "ok", "down")}
              <span>LLM</span><b>{String(health.providers.llm.provider)} / {String(health.providers.llm.model)}</b>
              <span>TTS</span><b>{String(health.providers.tts.provider)}</b>
              <span>STT</span><b>{String(health.providers.stt.provider)} ({String(health.providers.stt.model)})</b>
              <span>ffmpeg</span>{yesno(health.ffmpeg, "found", "missing")}
              <span>{t("Server", "伺服器")}</span><b>{health.platform} · Python {health.python}</b>
            </div>
          ) : (
            <div className="bad">{t("Backend unreachable — start it with scripts/dev.sh start", "無法連線後端 — 請執行 scripts/dev.sh start")}</div>
          )}
        </section>
      </aside>
    </>
  );
}
