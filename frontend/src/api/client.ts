import type { AssistantReply, HealthInfo, Language } from "../types";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 60_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { ...init, signal: init?.signal ?? ctrl.signal });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, res.status);
    }
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new ApiError("Request timed out", 408);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export interface ChatResult {
  session_id: string;
  reply: AssistantReply;
  meta: Record<string, unknown>;
}

export const api = {
  health: () => request<HealthInfo>("/api/health", undefined, 8000),
  chat: (message: string, sessionId: string | null, language: Language, signal?: AbortSignal) =>
    request<ChatResult>(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, session_id: sessionId, language }),
        signal,
      },
      90_000,
    ),
  clearChat: (sessionId: string) => request<{ ok: boolean }>(`/api/chat/${sessionId}`, { method: "DELETE" }),
};

export interface SpeechMeta {
  [k: string]: unknown;
}

/** Text → audio bytes (TTS, optionally through voice conversion). */
export async function fetchTTS(text: string, language: "en" | "zh", voiceConversion: boolean, signal?: AbortSignal): Promise<{ audio: ArrayBuffer; mime: string }> {
  const res = await fetch(BASE + "/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language, voice_conversion: voiceConversion }),
    signal,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  return { audio: await res.arrayBuffer(), mime: res.headers.get("Content-Type") ?? "audio/mpeg" };
}

export interface STTResult {
  text: string;
  language: string;
  duration_seconds: number;
  engine: string;
  latency_ms: number;
}

/** Audio blob → text (server STT). */
export async function fetchSTT(blob: Blob, language: Language, signal?: AbortSignal): Promise<STTResult> {
  const form = new FormData();
  const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : "webm";
  form.append("audio", blob, `recording.${ext}`);
  form.append("language", language);
  const res = await fetch(BASE + "/api/stt", { method: "POST", body: form, signal });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as STTResult;
}

export interface SpeechStatus {
  tts: { enabled: boolean; engine: string | null; voice_en: string | null; voice_zh: string | null };
  stt: { enabled: boolean; available: boolean; engine: string | null; status: string };
  voice_conversion: { enabled: boolean; available: boolean; status: string; info: Record<string, unknown> };
}

export const fetchSpeechStatus = () => request<SpeechStatus>("/api/speech/status", undefined, 8000);
