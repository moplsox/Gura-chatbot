/**
 * EmotionMapper — turns a unified emotion (from the LLM) into something the *loaded* model can
 * actually do: an expression name (if the model has one that fits), a motion, and/or raw
 * parameter overrides on standard Cubism parameter IDs. Nothing here assumes a parameter exists;
 * the controller drops unknown IDs.
 *
 * Resolution order per emotion:
 *   1. per-model preset (built-in for Live2D sample models, or models/<Name>/emotion-map.json)
 *   2. expression-name heuristics (e.g. an expression called "angry"/"smile"/"F03")
 *   3. standard-parameter fallback (ParamMouthForm, ParamBrow*, ParamEye*Smile, ParamCheek…)
 */
import type { Emotion } from "../types";
import type { ModelCapabilities } from "../live2d/types";

export interface EmotionPlan {
  expression: string | null;
  motion: { group: string; index?: number } | null;
  params: Record<string, number>;
  weight: number;
  source: "preset" | "heuristic" | "params" | "none";
}

export interface ModelEmotionPreset {
  expressions?: Partial<Record<Emotion, string | null>>;
  motions?: Partial<Record<string, { group: string; index?: number }>>; // keyed by motion hint
  emotionMotions?: Partial<Record<Emotion, { group: string; index?: number }>>;
  params?: Partial<Record<Emotion, Record<string, number>>>;
}

/** Built-in presets for the official Live2D sample models (names from the .model3.json file). */
export const BUILTIN_PRESETS: Record<string, ModelEmotionPreset> = {
  Haru: {
    // Mapped from the actual exp3.json parameter contents.
    expressions: {
      neutral: "F01", happy: "F05", excited: "F05", shy: "F07", sad: "F04", angry: "F03",
      surprised: "F06", confused: "F08", thinking: "F08",
    },
    emotionMotions: {
      happy: { group: "TapBody", index: 0 }, excited: { group: "TapBody", index: 2 },
      surprised: { group: "TapBody", index: 1 }, angry: { group: "TapBody", index: 3 },
    },
  },
  Mao: {
    expressions: {
      neutral: null, happy: "exp_01", excited: "exp_02", shy: "exp_03", sad: "exp_04", angry: "exp_05",
      surprised: "exp_06", confused: "exp_07", thinking: "exp_08",
    },
  },
};

/** Keyword heuristics for expression names (lower-cased substring match). */
const EXPRESSION_KEYWORDS: Record<Emotion, string[]> = {
  neutral: ["neutral", "normal", "default", "idle"],
  happy: ["happy", "smile", "joy", "glad", "laugh", "fun", "nico", "egao"],
  excited: ["excited", "excite", "star", "sparkle", "wow", "kira", "hype", "laugh"],
  shy: ["shy", "blush", "embarrass", "tere", "love", "heart", "shame"],
  sad: ["sad", "cry", "tear", "sorrow", "down", "naki", "kanashi"],
  angry: ["angry", "anger", "mad", "rage", "grr", "ikari", "pout", "puff"],
  surprised: ["surprise", "shock", "wow", "gasp", "odoroki", "bikkuri", "!"],
  confused: ["confus", "puzzle", "huh", "question", "?", "sweat", "troubl"],
  thinking: ["think", "hmm", "ponder", "consider", "serious", "close", "eyeclose"],
};

/** Motion hint → group-name keywords. */
const MOTION_KEYWORDS: Record<string, string[]> = {
  idle: ["idle"],
  greeting: ["greet", "hello", "hi", "wave", "tap"],
  nod: ["nod", "yes", "agree", "tap"],
  shake_head: ["shake", "no", "deny", "tap"],
  laugh: ["laugh", "happy", "fun", "tap"],
  jump: ["jump", "excite", "hop", "tap"],
  wave: ["wave", "bye", "greet", "tap"],
  think: ["think", "hmm", "tap"],
  pout: ["pout", "angry", "tap"],
  shy: ["shy", "blush", "tap"],
  surprise: ["surprise", "shock", "tap"],
};

/** Standard Cubism parameter fallbacks (values are blended by intensity). */
const PARAM_FALLBACK: Record<Emotion, Record<string, number>> = {
  neutral: {},
  happy: { ParamMouthForm: 1, ParamEyeLSmile: 0.7, ParamEyeRSmile: 0.7, ParamBrowLY: 0.3, ParamBrowRY: 0.3, ParamCheek: 0.4 },
  excited: { ParamMouthForm: 1, ParamMouthOpenY: 0.3, ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2, ParamBrowLY: 0.8, ParamBrowRY: 0.8, ParamCheek: 0.5 },
  shy: { ParamCheek: 1, ParamTere: 1, ParamEyeLOpen: 0.6, ParamEyeROpen: 0.6, ParamBrowLY: -0.3, ParamBrowRY: -0.3, ParamMouthForm: 0.2, ParamAngleZ: 8 },
  sad: { ParamMouthForm: -1, ParamBrowLY: -0.6, ParamBrowRY: -0.6, ParamBrowLForm: -0.6, ParamBrowRForm: -0.6, ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7, ParamAngleY: -8 },
  angry: { ParamMouthForm: -1, ParamBrowLY: -1, ParamBrowRY: -1, ParamBrowLAngle: -1, ParamBrowRAngle: -1, ParamBrowLForm: -1, ParamBrowRForm: -1, ParamEyeLOpen: 0.8, ParamEyeROpen: 0.8 },
  surprised: { ParamEyeLOpen: 1.6, ParamEyeROpen: 1.6, ParamBrowLY: 1, ParamBrowRY: 1, ParamMouthOpenY: 0.6, ParamMouthForm: -0.3, ParamEyeBallForm: -0.5 },
  confused: { ParamBrowLY: -0.4, ParamBrowRY: 0.5, ParamBrowLAngle: -0.5, ParamMouthForm: -0.5, ParamAngleZ: -10, ParamEyeBallX: 0.4 },
  thinking: { ParamEyeLOpen: 0.75, ParamEyeROpen: 0.75, ParamEyeBallX: 0.6, ParamEyeBallY: 0.6, ParamBrowLY: -0.2, ParamBrowRY: -0.2, ParamMouthForm: -0.2, ParamAngleZ: 6 },
};

const FALLBACK_CHAIN: Record<Emotion, Emotion[]> = {
  neutral: [],
  happy: ["excited", "neutral"],
  excited: ["happy", "surprised"],
  shy: ["happy", "neutral"],
  sad: ["confused", "neutral"],
  angry: ["sad", "confused"],
  surprised: ["excited", "confused"],
  confused: ["thinking", "neutral"],
  thinking: ["confused", "neutral"],
};

export class EmotionMapper {
  private preset: ModelEmotionPreset | null;

  constructor(private caps: ModelCapabilities, preset?: ModelEmotionPreset | null) {
    this.preset = preset ?? BUILTIN_PRESETS[caps.name] ?? null;
  }

  static async loadPreset(modelUrl: string): Promise<ModelEmotionPreset | null> {
    // Optional user override next to the model: <model dir>/emotion-map.json
    const dir = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
    try {
      const res = await fetch(dir + "emotion-map.json", { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()) as ModelEmotionPreset;
    } catch {
      return null;
    }
  }

  plan(emotion: Emotion, intensity: number, motionHint?: string, expressionHint?: string): EmotionPlan {
    const weight = Math.max(0.15, Math.min(1, Number.isFinite(intensity) ? intensity : 0.6));
    const expression = this.resolveExpression(emotion, expressionHint);
    const motion = this.resolveMotion(emotion, motionHint);
    const params = expression.name ? {} : this.resolveParams(emotion);
    const source: EmotionPlan["source"] = expression.name
      ? expression.source
      : Object.keys(params).length
        ? "params"
        : "none";
    return { expression: expression.name, motion, params, weight, source };
  }

  private resolveExpression(emotion: Emotion, hint?: string): { name: string | null; source: "preset" | "heuristic" } {
    const exps = this.caps.expressions;
    if (exps.length === 0) return { name: null, source: "heuristic" };
    const lower = exps.map((e) => e.toLowerCase());
    const find = (keys: string[]) => {
      for (const k of keys) {
        const i = lower.findIndex((e) => e.includes(k));
        if (i >= 0) return exps[i];
      }
      return null;
    };
    for (const em of [emotion, ...FALLBACK_CHAIN[emotion]]) {
      const p = this.preset?.expressions?.[em];
      if (p === null && em === emotion) return { name: null, source: "preset" }; // explicit "no expression"
      if (p && exps.includes(p)) return { name: p, source: "preset" };
    }
    if (hint) {
      const h = find([hint.toLowerCase()]);
      if (h) return { name: h, source: "heuristic" };
    }
    for (const em of [emotion, ...FALLBACK_CHAIN[emotion]]) {
      const h = find(EXPRESSION_KEYWORDS[em]);
      if (h) return { name: h, source: "heuristic" };
    }
    return { name: null, source: "heuristic" };
  }

  private resolveMotion(emotion: Emotion, hint?: string): { group: string; index?: number } | null {
    const groups = Object.keys(this.caps.motionGroups).filter((g) => this.caps.motionGroups[g].length > 0);
    if (groups.length === 0) return null;
    const valid = (m?: { group: string; index?: number } | null) =>
      m && this.caps.motionGroups[m.group] && (m.index === undefined || m.index < this.caps.motionGroups[m.group].length) ? m : null;
    if (hint && valid(this.preset?.motions?.[hint])) return this.preset!.motions![hint]!;
    if (valid(this.preset?.emotionMotions?.[emotion])) return this.preset!.emotionMotions![emotion]!;
    if (hint && hint !== "idle") {
      const keys = MOTION_KEYWORDS[hint] ?? [hint];
      for (const k of keys) {
        const g = groups.find((x) => x.toLowerCase().includes(k) && !/idle/i.test(x));
        if (g) return { group: g };
      }
    }
    if (emotion === "neutral" || emotion === "thinking") return null;
    const nonIdle = groups.filter((g) => !/idle/i.test(g));
    return nonIdle.length ? { group: nonIdle[0] } : null;
  }

  private resolveParams(emotion: Emotion): Record<string, number> {
    const presetParams = this.preset?.params?.[emotion];
    const src = presetParams ?? PARAM_FALLBACK[emotion];
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(src)) if (this.caps.parameterIds.has(id)) out[id] = v;
    return out;
  }
}
