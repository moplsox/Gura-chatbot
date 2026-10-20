export type Emotion =
  | "neutral" | "happy" | "excited" | "shy" | "sad" | "angry" | "surprised" | "confused" | "thinking";

export const EMOTIONS: Emotion[] = [
  "neutral", "happy", "excited", "shy", "sad", "angry", "surprised", "confused", "thinking",
];

export type Language = "auto" | "en" | "zh";

export interface AssistantReply {
  text: string;
  language: "en" | "zh";
  emotion: Emotion;
  intensity: number;
  expression: string;
  motion: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  reply?: AssistantReply;
  pending?: boolean;
  error?: boolean;
  ts: number;
}

/** Character/app state machine. */
export type AppStatus = "idle" | "listening" | "thinking" | "generating" | "speaking" | "error";

export interface HealthInfo {
  status: string;
  python: string;
  platform: string;
  ffmpeg: boolean;
  providers: Record<string, Record<string, unknown>>;
  live2d_model_url: string;
}

export interface Settings {
  language: Language;
  muted: boolean;
  voiceEnabled: boolean;
  voiceConversion: boolean;
  modelUrl: string;
  sttMode: "server" | "browser";
  subtitles: boolean;
}
