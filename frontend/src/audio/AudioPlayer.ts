/**
 * Web Audio based player with amplitude analysis for lip sync.
 *
 * - Single shared AudioContext (iOS Safari requires it to be created/resumed in a user gesture:
 *   call `unlock()` from a click/touch handler before the first playback).
 * - `play(buffer)` decodes and plays an encoded audio file (mp3/wav/ogg) and resolves when done.
 * - `onLevel` receives a smoothed 0..1 loudness value every animation frame while playing.
 * - `stop()` interrupts playback immediately (used for barge-in).
 */
export type LevelListener = (level: number) => void;

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private raf = 0;
  private data: Uint8Array<ArrayBuffer> | null = null;
  private levelListeners = new Set<LevelListener>();
  private _muted = false;
  private _playing = false;
  private resolveCurrent: (() => void) | null = null;
  private smoothed = 0;
  private lastTick = 0;

  get playing(): boolean {
    return this._playing;
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(v: boolean) {
    this._muted = v;
    if (this.gain) this.gain.gain.value = v ? 0 : 1;
  }

  /** Create / resume the AudioContext. Must be called from a user gesture on iOS. */
  async unlock(): Promise<boolean> {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return false;
      if (!this.ctx) {
        this.ctx = new Ctx();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = this._muted ? 0 : 1;
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.6;
        this.gain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
        this.data = new Uint8Array(this.analyser.frequencyBinCount);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      // Play a silent buffer so iOS fully unlocks the audio pipeline.
      const buf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.start(0);
      return this.ctx.state === "running";
    } catch (e) {
      console.warn("[audio] unlock failed", e);
      return false;
    }
  }

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  onLevel(fn: LevelListener): () => void {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }

  /** Play encoded audio bytes. Resolves when playback ends or is stopped. */
  async play(encoded: ArrayBuffer): Promise<void> {
    if (!this.ctx || !this.gain) {
      const ok = await this.unlock();
      if (!ok || !this.ctx || !this.gain) throw new Error("AudioContext unavailable (tap the page first on iOS)");
    }
    this.stop();
    const ctx = this.ctx;
    const buffer = await new Promise<AudioBuffer>((res, rej) => {
      // Safari needs the callback form; slice() because decodeAudioData detaches the buffer.
      ctx.decodeAudioData(encoded.slice(0), res, rej);
    });
    return new Promise<void>((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.gain!);
      this.source = src;
      this._playing = true;
      this.resolveCurrent = resolve;
      src.onended = () => {
        if (this.source === src) this.finish();
      };
      src.start(0);
      this.lastTick = performance.now();
      this.tick();
    });
  }

  /** Stop current playback (barge-in). Safe to call when idle. */
  stop(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.finish();
  }

  private finish(): void {
    this.source = null;
    this._playing = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.smoothed = 0;
    for (const fn of this.levelListeners) fn(0);
    const r = this.resolveCurrent;
    this.resolveCurrent = null;
    r?.();
  }

  private tick = (): void => {
    if (!this._playing || !this.analyser || !this.data) return;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);
    // Map RMS (speech ≈ 0.02–0.3) to 0..1 with a soft knee, then smooth (time-based: ~30ms attack, ~80ms release).
    const target = Math.min(1, Math.pow(rms * 4.5, 0.8));
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0.001, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const k = 1 - Math.exp(-dt / (target > this.smoothed ? 0.03 : 0.08));
    this.smoothed += (target - this.smoothed) * k;
    for (const fn of this.levelListeners) fn(this.smoothed);
    this.raf = requestAnimationFrame(this.tick);
  };
}

export const audioPlayer = new AudioPlayer();
