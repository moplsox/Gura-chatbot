/**
 * Microphone recorder built on MediaRecorder with Safari/iOS-friendly MIME fallbacks.
 * Produces a Blob (webm/opus on Chrome/Firefox, mp4/aac on Safari) that the backend decodes with ffmpeg.
 */
export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

const CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac", ""];

export function micSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private analyser: AnalyserNode | null = null;
  private ctx: AudioContext | null = null;
  private raf = 0;
  onLevel: ((level: number) => void) | null = null;

  get recording(): boolean {
    return this.rec?.state === "recording";
  }

  async start(): Promise<void> {
    if (!micSupported()) throw new Error("Microphone recording is not supported in this browser");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const mimeType = CANDIDATES.find((m) => m === "" || MediaRecorder.isTypeSupported(m)) ?? "";
    this.rec = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.rec.start(250);
    this.startedAt = performance.now();
    this.startLevelMeter();
  }

  async stop(): Promise<RecordingResult> {
    const rec = this.rec;
    if (!rec) throw new Error("not recording");
    const result = await new Promise<RecordingResult>((resolve) => {
      rec.onstop = () => {
        const mimeType = rec.mimeType || "audio/webm";
        resolve({ blob: new Blob(this.chunks, { type: mimeType }), mimeType, durationMs: performance.now() - this.startedAt });
      };
      if (rec.state !== "inactive") rec.stop();
      else rec.onstop?.(new Event("stop"));
    });
    this.cleanup();
    return result;
  }

  cancel(): void {
    try {
      if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    } catch {
      /* ignore */
    }
    this.cleanup();
  }

  private startLevelMeter(): void {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const src = this.ctx.createMediaStreamSource(this.stream!);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        this.onLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 4));
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* level meter is optional */
    }
  }

  private cleanup(): void {
    cancelAnimationFrame(this.raf);
    this.analyser = null;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.onLevel?.(0);
  }
}
