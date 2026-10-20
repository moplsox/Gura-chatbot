/**
 * Browser-native speech recognition (Web Speech API). Works in Safari (macOS/iOS) and Chrome
 * without any server model — used as a fallback / low-latency option when server STT is unavailable.
 */
type SR = typeof window extends { SpeechRecognition: infer T } ? T : unknown;

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function getCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

export function browserSttSupported(): boolean {
  return typeof window !== "undefined" && getCtor() !== null;
}

export class BrowserSTT {
  private rec: SpeechRecognitionLike | null = null;
  private finalText = "";
  onInterim: ((text: string) => void) | null = null;

  get active(): boolean {
    return this.rec !== null;
  }

  start(lang: "en" | "zh"): void {
    const Ctor = getCtor();
    if (!Ctor) throw new Error("Web Speech API not supported");
    this.stop();
    const rec = new Ctor();
    rec.lang = lang === "zh" ? "zh-TW" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      let finals = "";
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finals += r[0].transcript;
        else interim += r[0].transcript;
      }
      this.finalText = finals;
      this.onInterim?.((finals + " " + interim).trim());
    };
    rec.onerror = (ev) => console.warn("[browser-stt] error", ev.error);
    this.rec = rec;
    rec.start();
  }

  /** Stop and return the final transcript. */
  stop(): Promise<string> {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return Promise.resolve(this.finalText.trim());
    return new Promise<string>((resolve) => {
      const done = () => resolve(this.finalText.trim());
      rec.onend = done;
      try {
        rec.stop();
      } catch {
        done();
      }
      setTimeout(done, 1500); // safety: Safari sometimes never fires onend
    });
  }

  abort(): void {
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }
}
