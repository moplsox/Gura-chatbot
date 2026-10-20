import { useEffect, useRef, useState, type ReactNode } from "react";
import { Live2DController } from "../live2d/Live2DController";
import type { Live2DState } from "../live2d/types";
import type { Language } from "../types";

interface Props {
  controller: Live2DController;
  modelUrl: string;
  language: Language;
  onTap?: () => void;
  children?: ReactNode;
}

export default function Live2DStage({ controller, modelUrl, language, onTap, children }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<Live2DState>("idle");
  const [message, setMessage] = useState<string | undefined>();
  const zh = language === "zh";

  useEffect(() => {
    if (!wrapRef.current) return;
    controller.attach(wrapRef.current);
    return controller.onState((s, m) => {
      setState(s);
      setMessage(m);
    });
  }, [controller]);

  useEffect(() => {
    if (!modelUrl) return;
    controller.load(modelUrl).catch((e) => console.warn("[live2d]", (e as Error).message));
  }, [controller, modelUrl]);

  const coreMissing = !Live2DController.coreAvailable();

  return (
    <div className="stage" ref={wrapRef} data-testid="stage" data-live2d-state={state} onPointerDown={(e) => { if ((e.target as HTMLElement).tagName === "CANVAS") onTap?.(); }}>
      {(state === "loading" || state === "error" || coreMissing) && (
        <div className="stage-message">
          <div className="card">
            {coreMissing ? (
              <>
                <div className="err">{zh ? "找不到 Live2D Cubism Core" : "Live2D Cubism Core not found"}</div>
                <div>
                  {zh ? "請在專案根目錄執行 " : "Run "}
                  <code>scripts/setup_live2d.sh</code>
                  {zh ? " 下載 live2dcubismcore.min.js（官方授權檔案，不隨專案發佈）。" : " to download live2dcubismcore.min.js (proprietary runtime, not shipped in this repo)."}
                </div>
              </>
            ) : state === "loading" ? (
              <div>{zh ? "載入 Live2D 模型中…" : "Loading Live2D model…"}</div>
            ) : (
              <>
                <div className="err">{zh ? "Live2D 模型載入失敗" : "Live2D model failed to load"}</div>
                <div style={{ fontSize: 13, marginTop: 8 }}>{message}</div>
                <div style={{ fontSize: 12, marginTop: 10 }}>
                  {zh
                    ? "需要完整的模型資料夾：.model3.json、.moc3、貼圖 PNG，以及它引用的 motion / expression / physics 檔。可在設定面板更換模型路徑。"
                    : "A complete model folder is required: .model3.json, .moc3, texture PNGs and the motion / expression / physics files it references. Change the model path in Settings."}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
