import { useEffect, useRef, useState } from "react";
import type { Language } from "../types";

interface Props {
  disabled?: boolean;
  busy?: boolean;
  recording?: boolean;
  micAvailable: boolean;
  language: Language;
  onSend: (text: string) => void;
  onMicToggle: () => void;
  onInterrupt: () => void;
}

export default function InputBar({ disabled, busy, recording, micAvailable, language, onSend, onMicToggle, onInterrupt }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const zh = language === "zh";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="input-bar">
      <button
        className={`round-btn ${recording ? "recording" : ""}`}
        onClick={onMicToggle}
        disabled={!micAvailable}
        title={micAvailable ? (zh ? "按一下開始/停止錄音" : "Tap to start/stop recording") : (zh ? "此瀏覽器不支援麥克風" : "Microphone not available")}
        aria-label="microphone"
        data-testid="mic"
      >
        {recording ? "⏹" : "🎤"}
      </button>
      <textarea
        ref={ref}
        rows={1}
        value={text}
        placeholder={zh ? "跟 Gura 說點什麼…" : "Say something to Gura…"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        data-testid="input"
      />
      {busy ? (
        <button className="round-btn" onClick={onInterrupt} title={zh ? "打斷" : "Interrupt"} aria-label="interrupt" data-testid="interrupt">✋</button>
      ) : (
        <button className="round-btn primary" onClick={submit} disabled={disabled || !text.trim()} aria-label="send" data-testid="send">➤</button>
      )}
    </div>
  );
}
