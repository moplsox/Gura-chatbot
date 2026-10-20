export interface ParamInfo {
  id: string;
  min: number;
  max: number;
  default: number;
}

export interface MotionInfo {
  group: string;
  index: number;
  file: string;
}

/** Everything we learned about the loaded model — drives the EmotionMapper. */
export interface ModelCapabilities {
  name: string;
  url: string;
  cubismVersion: string;
  parameters: ParamInfo[];
  parameterIds: Set<string>;
  expressions: string[];
  motionGroups: Record<string, MotionInfo[]>;
  lipSyncIds: string[];
  eyeBlinkIds: string[];
  hitAreas: string[];
}

export type Live2DState = "idle" | "loading" | "ready" | "error";

export interface Live2DEvents {
  state: (state: Live2DState, message?: string) => void;
}
