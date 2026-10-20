# models/

Large model files live here and are **never committed** (see `.gitignore`).

```
models/
├── live2d/   # (optional) extra Live2D models; the frontend serves models from
│             #  frontend/public/live2d/models/<Name>/ — put your Gura model there
└── svc/      # So-VITS-SVC voice model: G_*.pth + config.json (+ optional kmeans/rmvpe)
```

## Live2D (Gura)

Place the complete model folder in `frontend/public/live2d/models/<Name>/`:

```
<Name>/
├── <Name>.model3.json      ← entry file (set LIVE2D_MODEL_URL or pick it in Settings)
├── <Name>.moc3
├── <Name>.physics3.json    (optional but recommended)
├── <Name>.cdi3.json        (optional, parameter display names)
├── <Name>.2048/texture_00.png …
├── expressions/*.exp3.json (optional — mapped to emotions automatically)
└── motions/*.motion3.json  (optional — Idle group for idle, others for reactions)
```

If you only have `.moc3` + textures and **no `.model3.json`**, the runtime cannot load the model. You
need the `.model3.json` manifest (Cubism Editor exports it; or write one listing Moc, Textures,
Physics, Motions, Expressions). Without `.exp3.json` expressions the app falls back to driving
standard parameters (`ParamBrow*`, `ParamMouthForm`, `ParamEye*Smile`, `ParamCheek`, …) directly.

To customise emotion → expression/motion mapping for a model, add `emotion-map.json` next to the
`.model3.json`:

```json
{
  "expressions": { "happy": "smile", "angry": "mad", "shy": "blush" },
  "emotionMotions": { "happy": { "group": "TapBody", "index": 0 } },
  "motions": { "greeting": { "group": "Wave" } }
}
```

**Licensing.** Hololive/COVER talent models are copyrighted; only use a model you have the right to
use locally, and do not redistribute or deploy it publicly. The development sample (`Haru`) is from
Live2D's official samples under the Live2D Free Material License and is downloaded by
`scripts/setup_live2d.sh` — it is not redistributed by this repository. The Live2D Cubism Core
runtime is proprietary (Live2D Proprietary Software License) and is also downloaded, not committed.

## So-VITS-SVC voice model

Put `G_*.pth` and the matching `config.json` in `models/svc/`, then run
`svc_service/.venv/bin/python scripts/inspect_pth.py models/svc/G_xxx.pth --config models/svc/config.json`
to confirm the checkpoint architecture and required files. See `svc_service/README.md`.
