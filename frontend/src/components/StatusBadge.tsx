import type { AppStatus, Language } from "../types";

const LABELS: Record<AppStatus, { en: string; zh: string }> = {
  idle: { en: "Idle", zh: "待機中" },
  listening: { en: "Listening…", zh: "聆聽中…" },
  thinking: { en: "Thinking…", zh: "思考中…" },
  generating: { en: "Generating voice…", zh: "語音生成中…" },
  speaking: { en: "Speaking", zh: "說話中" },
  error: { en: "Error", zh: "錯誤" },
};

export default function StatusBadge({ status, language }: { status: AppStatus; language: Language }) {
  const l = language === "zh" ? "zh" : "en";
  return (
    <div className={`status ${status}`} role="status" aria-live="polite" data-testid="status">
      <span className="dot" />
      {LABELS[status][l]}
    </div>
  );
}
