import { useEffect, useRef } from "react";
import type { ChatMessage, Language } from "../types";

const EMOJI: Record<string, string> = {
  neutral: "🙂", happy: "😄", excited: "🤩", shy: "😳", sad: "😢", angry: "😠", surprised: "😲",
  confused: "😕", thinking: "🤔",
};

interface Props {
  messages: ChatMessage[];
  language: Language;
  collapsed?: boolean;
  onSuggestion: (text: string) => void;
}

const SUGGESTIONS = {
  en: ["Hi Gura!", "Tell me a shark fact", "How was your day?", "Sing something!"],
  zh: ["嗨 Gura！", "說一個鯊魚小知識", "你今天過得怎麼樣？", "唱首歌吧！"],
};

export default function ChatPanel({ messages, language, collapsed, onSuggestion }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);
  const l = language === "zh" ? "zh" : "en";

  return (
    <div className={`chat ${collapsed ? "collapsed" : ""}`} data-testid="chat">
      {messages.length === 0 && (
        <div className="chat-empty">
          {l === "zh" ? "跟 Gura 打個招呼吧！可以打字，或按麥克風說話。" : "Say hi to Gura! Type below or hold the mic to talk."}
          <div className="chips">
            {SUGGESTIONS[l].map((s) => (
              <button key={s} className="chip" onClick={() => onSuggestion(s)}>{s}</button>
            ))}
          </div>
        </div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`} data-testid={`msg-${m.role}`}>
          <div className="bubble-text">
            {m.pending ? (
              <span className="typing"><i /><i /><i /></span>
            ) : (
              m.text
            )}
          </div>
          {m.reply && !m.pending && (
            <div className="meta">
              <span className="emotion-tag">{EMOJI[m.reply.emotion] ?? ""} {m.reply.emotion}</span>
              <span>{m.reply.language.toUpperCase()}</span>
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
