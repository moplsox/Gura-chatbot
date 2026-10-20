/**
 * Live2DController — owns the PixiJS app and one Live2D model.
 *
 * Responsibilities: load / reload / fit model, auto blink + idle (provided by the Cubism framework via
 * pixi-live2d-display), expressions, motions, parameter overrides for emotions, and audio-driven
 * mouth animation. The controller never assumes a parameter exists: everything goes through the
 * capability scan (`capabilities`) and silently no-ops for missing parameters.
 */
import * as PIXI from "pixi.js";
import { Live2DModel, MotionPriority } from "pixi-live2d-display-lipsyncpatch/cubism4";
import type { Live2DState, ModelCapabilities, MotionInfo, ParamInfo } from "./types";

// pixi-live2d-display needs a Ticker to drive model updates.
Live2DModel.registerTicker(PIXI.Ticker);
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

declare global {
  interface Window {
    Live2DCubismCore?: unknown;
  }
}

export interface ParamOverride {
  value: number;
  weight: number; // 0..1 blend weight against the motion's value
}

export interface FitOptions {
  /** 1 = model height fills the canvas; >1 zooms in. */
  zoom: number;
  /** Vertical offset as a fraction of the canvas height (positive moves the model down). */
  offsetY: number;
  offsetX: number;
}

type StateListener = (state: Live2DState, message?: string) => void;

interface RawCoreModel {
  parameters: { ids: string[]; minimumValues: Float32Array; maximumValues: Float32Array; defaultValues: Float32Array };
}

export class Live2DController {
  private app: PIXI.Application | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private model: Live2DModel | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private stateListeners = new Set<StateListener>();
  private _state: Live2DState = "idle";
  private _caps: ModelCapabilities | null = null;
  private fit: FitOptions = { zoom: 1.0, offsetY: 0.02, offsetX: 0 };

  // Mouth
  private mouthTarget = 0;
  private mouthCurrent = 0;
  private mouthEnabled = false;
  // Parameter overrides (emotion fallback when no expression matches)
  private overrides = new Map<string, ParamOverride>();
  private overrideCurrent = new Map<string, number>();
  private beforeUpdateHandler: (() => void) | null = null;

  get state(): Live2DState {
    return this._state;
  }

  get capabilities(): ModelCapabilities | null {
    return this._caps;
  }

  get loaded(): boolean {
    return this.model !== null && this._state === "ready";
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    fn(this._state);
    return () => this.stateListeners.delete(fn);
  }

  private setState(s: Live2DState, message?: string): void {
    this._state = s;
    for (const fn of this.stateListeners) fn(s, message);
  }

  /**
   * Attach to a container element. The controller creates its own <canvas> so that a destroyed
   * WebGL context (e.g. React StrictMode remount, model reload after a GPU reset) never gets reused.
   */
  attach(container: HTMLElement): void {
    if (this.app) return;
    const canvas = document.createElement("canvas");
    canvas.className = "live2d-canvas";
    container.prepend(canvas);
    this.canvasEl = canvas;
    try {
      this.app = new PIXI.Application({
        view: canvas,
        resizeTo: container,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
    } catch (e) {
      this.app = null;
      canvas.remove();
      this.canvasEl = null;
      const msg = `WebGL is not available in this browser (${(e as Error).message}). Live2D needs WebGL — enable hardware acceleration or try another browser.`;
      console.error("[live2d]", msg, e);
      this.setState("error", msg);
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(container);
  }

  static coreAvailable(): boolean {
    return typeof window !== "undefined" && !!window.Live2DCubismCore;
  }

  /** Human-readable Cubism Core version (e.g. "5.1.0"), or null if the core is missing. */
  static coreVersion(): string | null {
    const core = window.Live2DCubismCore as { Version?: { csmGetVersion(): number } } | undefined;
    if (!core?.Version) return null;
    const v = core.Version.csmGetVersion() >>> 0;
    return `${v >>> 24}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}`;
  }

  /**
   * The Cubism 5 Framework (used by pixi-live2d-display ≥0.5) calls Live2DCubismCore.Memory.initializeAmountOfMemory,
   * which only exists in Core 5.x. If an older Core 4.x is loaded, polyfill it so Cubism 4 models still work.
   */
  private static shimOldCore(): void {
    const core = window.Live2DCubismCore as { Memory?: { initializeAmountOfMemory?: (n: number) => void } } | undefined;
    if (core && (!core.Memory || typeof core.Memory.initializeAmountOfMemory !== "function")) {
      console.warn(`[live2d] Cubism Core ${Live2DController.coreVersion()} is older than the framework expects; applying Memory shim. Prefer the latest Core from https://www.live2d.com/sdk/download/web/ (Cubism 5 models need Core 5).`);
      core.Memory = { ...(core.Memory ?? {}), initializeAmountOfMemory: () => undefined };
    }
  }

  /** Load (or replace) the model from a .model3.json URL. */
  async load(url: string): Promise<ModelCapabilities> {
    if (!this.app) {
      if (this._state === "error") throw new Error("Live2D renderer unavailable");
      throw new Error("Live2DController.attach() must be called first");
    }
    if (!Live2DController.coreAvailable()) {
      const msg = "Live2D Cubism Core is not loaded. Run scripts/setup_live2d.sh to download live2dcubismcore.min.js.";
      this.setState("error", msg);
      throw new Error(msg);
    }
    this.setState("loading");
    this.unload();
    Live2DController.shimOldCore();
    try {
      const model = await Live2DModel.from(url, { autoHitTest: false, autoFocus: false, autoUpdate: true });
      this.model = model;
      model.anchor.set(0.5, 0);
      this.app.stage.addChild(model as unknown as PIXI.DisplayObject);
      this._caps = this.scan(model, url);
      this.installUpdateHook(model);
      this.layout();
      this.setState("ready");
      console.info("[live2d] loaded", this._caps.name, {
        params: this._caps.parameters.length,
        expressions: this._caps.expressions,
        motions: Object.fromEntries(Object.entries(this._caps.motionGroups).map(([k, v]) => [k, v.length])),
        lipSync: this._caps.lipSyncIds,
      });
      return this._caps;
    } catch (e) {
      const err = e as Error;
      let msg = `Failed to load Live2D model from ${url}: ${err.message || err}`;
      if (/404|Not Found|network|fetch/i.test(String(err.message))) {
        msg += ". Check that the .model3.json path is correct and that all referenced .moc3 / texture / motion files exist.";
      }
      this.setState("error", msg);
      throw new Error(msg);
    }
  }

  unload(): void {
    if (this.model) {
      try {
        if (this.beforeUpdateHandler) {
          (this.model.internalModel as unknown as { off: (ev: string, fn: () => void) => void }).off("beforeModelUpdate", this.beforeUpdateHandler);
        }
        this.app?.stage.removeChild(this.model as unknown as PIXI.DisplayObject);
        this.model.destroy({ children: true });
      } catch (e) {
        console.warn("[live2d] destroy failed", e);
      }
    }
    this.model = null;
    this._caps = null;
    this.overrides.clear();
    this.overrideCurrent.clear();
    this.beforeUpdateHandler = null;
  }

  destroy(): void {
    this.unload();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.app?.destroy(false, { children: true });
    this.app = null;
    this.canvasEl?.remove();
    this.canvasEl = null;
    this._state = "idle";
  }

  // ---------------- capability scan ----------------
  private scan(model: Live2DModel, url: string): ModelCapabilities {
    const internal = model.internalModel as unknown as {
      coreModel: {
        getParameterCount(): number;
        getParameterMinimumValue(i: number): number;
        getParameterMaximumValue(i: number): number;
        getParameterDefaultValue(i: number): number;
      };
      motionManager: {
        definitions: Record<string, { File: string }[] | undefined>;
        expressionManager?: { definitions: { Name: string }[] };
        lipSyncIds?: string[];
      };
      eyeBlink?: { _parameterIds?: string[] };
      settings: { json?: { Version?: number; Groups?: { Name: string; Ids: string[] }[]; HitAreas?: { Name: string }[] }; name?: string };
    };
    const core = internal.coreModel;
    const parameters: ParamInfo[] = [];
    // The Cubism Framework's CubismModel wraps the raw core model, which exposes parameter arrays.
    const raw = (core as unknown as { getModel?: () => RawCoreModel; _model?: RawCoreModel }).getModel?.()
      ?? (core as unknown as { _model?: RawCoreModel })._model;
    const count = core.getParameterCount();
    for (let i = 0; i < count; i++) {
      parameters.push({
        id: raw?.parameters.ids[i] ?? `param_${i}`,
        min: raw?.parameters.minimumValues[i] ?? core.getParameterMinimumValue(i),
        max: raw?.parameters.maximumValues[i] ?? core.getParameterMaximumValue(i),
        default: raw?.parameters.defaultValues[i] ?? core.getParameterDefaultValue(i),
      });
    }
    const motionGroups: Record<string, MotionInfo[]> = {};
    for (const [group, defs] of Object.entries(internal.motionManager.definitions ?? {})) {
      motionGroups[group] = (defs ?? []).map((d, index) => ({ group, index, file: d.File }));
    }
    const groups = internal.settings.json?.Groups ?? [];
    const lipSyncIds = internal.motionManager.lipSyncIds ?? groups.find((g) => g.Name === "LipSync")?.Ids ?? [];
    const eyeBlinkIds = groups.find((g) => g.Name === "EyeBlink")?.Ids ?? [];
    const name = decodeURIComponent(url.split("/").pop() ?? "model").replace(/\.model3?\.json$/i, "");
    return {
      name,
      url,
      cubismVersion: `model v${internal.settings.json?.Version ?? "?"} / core ${Live2DController.coreVersion() ?? "?"}`,
      parameters,
      parameterIds: new Set(parameters.map((p) => p.id)),
      expressions: (internal.motionManager.expressionManager?.definitions ?? []).map((e) => e.Name),
      motionGroups,
      lipSyncIds,
      eyeBlinkIds,
      hitAreas: (internal.settings.json?.HitAreas ?? []).map((h) => h.Name),
    };
  }

  // ---------------- per-frame hook ----------------
  private installUpdateHook(model: Live2DModel): void {
    const internal = model.internalModel as unknown as {
      on: (ev: string, fn: () => void) => void;
      coreModel: { setParameterValueById(id: string, v: number, weight?: number): void; getParameterValueById(id: string): number };
      lipSync: boolean;
    };
    // We drive the mouth ourselves (from real audio amplitude), so disable the lib's motion-sound lipsync.
    internal.lipSync = false;
    const caps = this._caps!;
    const mouthIds = caps.lipSyncIds.length ? caps.lipSyncIds : caps.parameterIds.has("ParamMouthOpenY") ? ["ParamMouthOpenY"] : [];
    let last = performance.now();
    this.beforeUpdateHandler = () => {
      // Frame-rate independent easing: k = 1 - exp(-dt / tau).
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0.001, (now - last) / 1000));
      last = now;
      const ease = (tau: number) => 1 - Math.exp(-dt / tau);
      // Mouth: fast attack (~40ms), slower release (~90ms); close when disabled.
      const target = this.mouthEnabled ? this.mouthTarget : 0;
      this.mouthCurrent += (target - this.mouthCurrent) * ease(target > this.mouthCurrent ? 0.04 : 0.09);
      if (Math.abs(this.mouthCurrent) < 0.002) this.mouthCurrent = 0;
      if (this.mouthEnabled || this.mouthCurrent > 0) {
        for (const id of mouthIds) internal.coreModel.setParameterValueById(id, this.mouthCurrent, 1);
      }
      // Emotion parameter overrides: ~250ms ease-in, ~400ms fade-out.
      const kIn = ease(0.25);
      const kOut = ease(0.4);
      for (const [id, ov] of this.overrides) {
        const cur = this.overrideCurrent.get(id) ?? 0;
        const next = cur + (ov.weight - cur) * kIn;
        this.overrideCurrent.set(id, next);
        if (next > 0.001) internal.coreModel.setParameterValueById(id, ov.value, next);
      }
      for (const [id, cur] of this.overrideCurrent) {
        if (!this.overrides.has(id)) {
          const next = cur * (1 - kOut);
          if (next < 0.01) this.overrideCurrent.delete(id);
          else {
            this.overrideCurrent.set(id, next);
            const p = this._caps?.parameters.find((x) => x.id === id);
            if (p) internal.coreModel.setParameterValueById(id, p.default, 0); // no-op write keeps API symmetrical
          }
        }
      }
    };
    internal.on("beforeModelUpdate", this.beforeUpdateHandler);
  }

  // ---------------- layout ----------------
  setFit(fit: Partial<FitOptions>): void {
    this.fit = { ...this.fit, ...fit };
    this.layout();
  }

  layout(): void {
    if (!this.app || !this.model) return;
    const w = this.app.renderer.width / this.app.renderer.resolution;
    const h = this.app.renderer.height / this.app.renderer.resolution;
    const internal = this.model.internalModel as unknown as { originalWidth: number; originalHeight: number };
    const mw = internal.originalWidth || this.model.width || 1;
    const mh = internal.originalHeight || this.model.height || 1;
    // Fill the height on desktop, but never let the width overflow on narrow (phone) screens.
    // On portrait/narrow stages leave room at the top for the toolbar so it never covers the face.
    const narrow = w < 820 || w < h;
    const topPad = narrow ? 0.09 : this.fit.offsetY;
    const scale = Math.min((h * (1 - topPad)) / mh, (w * 1.35) / mw) * this.fit.zoom;
    this.model.scale.set(scale);
    this.model.x = w / 2 + this.fit.offsetX * w;
    this.model.y = topPad * h;
  }

  // ---------------- expressions / motions ----------------
  async setExpression(name: string | null): Promise<boolean> {
    if (!this.model || !this._caps) return false;
    const em = (this.model.internalModel.motionManager as unknown as { expressionManager?: { resetExpression(): void } }).expressionManager;
    if (name === null) {
      em?.resetExpression();
      return true;
    }
    if (!this._caps.expressions.includes(name)) return false;
    try {
      return await this.model.expression(name);
    } catch (e) {
      console.warn("[live2d] expression failed", name, e);
      return false;
    }
  }

  async playMotion(group: string, index?: number, force = false): Promise<boolean> {
    if (!this.model || !this._caps) return false;
    const list = this._caps.motionGroups[group];
    if (!list || list.length === 0) return false;
    const idx = index ?? Math.floor(Math.random() * list.length);
    try {
      return await this.model.motion(group, idx, force ? MotionPriority.FORCE : MotionPriority.NORMAL);
    } catch (e) {
      console.warn("[live2d] motion failed", group, idx, e);
      return false;
    }
  }

  stopMotions(): void {
    this.model?.internalModel.motionManager.stopAllMotions();
  }

  // ---------------- parameter overrides ----------------
  setOverrides(values: Record<string, number>, weight: number): void {
    this.overrides.clear();
    if (!this._caps) return;
    for (const [id, value] of Object.entries(values)) {
      if (!this._caps.parameterIds.has(id)) continue;
      const p = this._caps.parameters.find((x) => x.id === id)!;
      this.overrides.set(id, { value: Math.max(p.min, Math.min(p.max, value)), weight: Math.max(0, Math.min(1, weight)) });
    }
  }

  clearOverrides(): void {
    this.overrides.clear();
  }

  // ---------------- mouth ----------------
  setMouthEnabled(on: boolean): void {
    this.mouthEnabled = on;
    if (!on) this.mouthTarget = 0;
  }

  /** level 0..1 from the audio analyser. */
  setMouthLevel(level: number): void {
    this.mouthTarget = Math.max(0, Math.min(1, level));
  }

  /** Nudge the head (used when the user taps the model). */
  tap(): void {
    const g = this._caps?.motionGroups;
    if (!g) return;
    const group = Object.keys(g).find((k) => /tap/i.test(k)) ?? Object.keys(g).find((k) => !/idle/i.test(k));
    if (group) void this.playMotion(group);
  }
}
