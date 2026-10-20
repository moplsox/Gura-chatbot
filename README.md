# Gura AI Live2D Voice Chat

An interactive AI chat website with a **real Live2D character**, LLM conversation, speech input, speech
output, emotion-driven expressions/motions and audio-driven lip sync. Built with React + TypeScript +
PixiJS on the front end and Python FastAPI on the back end. Designed for local use on a Mac and for
iPhone Safari over the local network.

> **Status (what is verified vs. what needs your files)**
>
> | Area | State |
> |---|---|
> | Frontend / backend / health API / chat UI | ✅ running, e2e-tested |
> | Live2D load, blink, idle, expressions, motions, lip sync | ✅ tested with Live2D's official sample model (Haru) |
> | LLM providers (OpenAI-compatible, Anthropic, offline mock) + structured emotion output | ✅ unit-tested; real API needs your key |
> | STT (faster-whisper) | ✅ code + error paths tested; model download needs internet (Hugging Face) |
> | TTS (edge-tts, OpenAI-compatible) | ✅ pipeline tested with fakes; edge-tts needs internet (worked offline-blocked in CI) |
> | So-VITS-SVC voice conversion | 🟡 service + fallback implemented; **your `.pth` + `config.json` were not available**, so inference is unverified |
> | A Gura Live2D model | ❌ not included (copyrighted). Put yours in `frontend/public/live2d/models/<Name>/` |

---

## 1. Quick start (macOS)

Prereqs: Python ≥ 3.11 (`brew install python@3.12`), Node ≥ 20 (`brew install node`), `ffmpeg`
(`brew install ffmpeg`, needed to decode browser microphone audio), optionally `uv` (`brew install uv`).

```bash
git clone <this repo> && cd Gura-chatbot
scripts/setup.sh            # venv + pip, npm install, downloads Live2D Cubism Core + sample model, creates .env
# edit .env → set LLM_PROVIDER / LLM_API_KEY / LLM_MODEL (see §3)
scripts/dev.sh start        # starts backend :8000 and frontend :5173 in the background
open http://localhost:5173
scripts/dev.sh stop         # stop both  (also: status | logs | restart)
```

On an iPhone on the same Wi-Fi: open `http://<your-mac-ip>:5173`. Tap the screen once to unlock audio
(iOS requirement); the mic button asks for permission the first time. Safari on iOS needs HTTPS for the
microphone when **not** on `localhost` — the easy path is to run a tunnel (e.g. `npx localtunnel --port 5173`
or Tailscale) or trust a local HTTPS cert.

## 2. What you need to provide

### 2.1 Gura Live2D model (required for Gura; Haru sample works meanwhile)

Put the complete export folder in `frontend/public/live2d/models/Gura/` and set
`LIVE2D_MODEL_URL=/live2d/models/Gura/Gura.model3.json` (or pick it in **Settings → Live2D → Load**).
Needed files: `*.model3.json`, `*.moc3`, textures, and the `motions/`, `expressions/`, `*.physics3.json`
it references. If you only have `.moc3` + textures, you must obtain or author the `.model3.json`
manifest — the runtime cannot load a model without it. See `models/README.md` for the emotion mapping
override (`emotion-map.json`).

The app scans the loaded model (parameters, expressions, motion groups, LipSync/EyeBlink groups) and
maps emotions onto whatever exists; unknown parameters are ignored, never crash.

### 2.2 Voice model (.pth) for So-VITS-SVC

1. Copy `G_xxxx.pth` **and the matching `config.json`** to `models/svc/`.
2. Create the SVC service venv (Python 3.11) and inspect the checkpoint:
   ```bash
   cd svc_service && uv venv .venv --python 3.11 && uv pip install --python .venv/bin/python -r requirements.txt
   cd .. && svc_service/.venv/bin/python scripts/inspect_pth.py models/svc/G_xxxx.pth --config models/svc/config.json
   ```
   The inspector reports the architecture (so-vits-svc 4.x generator / discriminator / RVC / VITS-TTS /
   unknown), speaker count, encoder dimension (768 = ContentVec vec768l12, 256 = hubert-soft) and
   config mismatches. **Only a so-vits-svc 4.x `G_*.pth` with its `config.json` is runnable here.**
   Missing items are listed explicitly; nothing is faked.
3. Run the service and enable it:
   ```bash
   cp svc_service/.env.example svc_service/.env   # set SVC_MODEL_PATH / SVC_CONFIG_PATH
   svc_service/run.sh                              # :8100 ; first run downloads the ContentVec checkpoint (~1.2 GB)
   # main .env:  VC_PROVIDER=sovits_http   VC_SERVICE_URL=http://127.0.0.1:8100
   ```
   Test with a short clip (`curl -F audio=@short.wav http://127.0.0.1:8100/convert -o out.wav`) and check
   `X-Latency-Ms`. On Apple Silicon the service uses MPS when available, else CPU. If conversion fails or
   times out the app **falls back to the plain TTS voice** (`VC_FALLBACK_TO_TTS=true`).

### 2.3 LLM API key

See §3. Without a key the backend runs an offline **mock** persona so the whole UI/voice/Live2D flow
can be exercised.

## 3. Configuration (`.env`)

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `openai_compatible` (OpenAI, OpenRouter, DeepSeek, Groq, Ollama, LM Studio…), `anthropic`, or `mock` |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | credentials/endpoint; e.g. Ollama: `http://localhost:11434/v1`, model `llama3.1` |
| `LLM_TIMEOUT_SECONDS`, `LLM_MAX_HISTORY_TURNS`, `LLM_TEMPERATURE` | request timeout, context window (turns), creativity |
| `STT_PROVIDER` / `STT_MODEL` / `STT_DEVICE` / `STT_COMPUTE_TYPE` | `faster_whisper` with `tiny…large-v3`; Mac → `cpu` + `int8` |
| `TTS_PROVIDER` | `edge` (free Microsoft neural voices), `openai_compatible`, `disabled` |
| `TTS_VOICE_EN` / `TTS_VOICE_ZH` | e.g. `en-US-AnaNeural`, `zh-TW-HsiaoYuNeural` (`edge-tts --list-voices`) |
| `VC_PROVIDER`, `VC_SERVICE_URL`, `VC_TIMEOUT_SECONDS`, `VC_FALLBACK_TO_TTS` | So-VITS-SVC service wiring |
| `LIVE2D_MODEL_URL` | default model manifest URL |
| `CORS_ORIGINS` | extra allowed origins (LAN IPs for `localhost`, `127.0.0.1`, `192.168.*`, `10.*` are allowed automatically) |

API keys stay on the server; the frontend never sees them.

## 4. Architecture

```
frontend/ (Vite + React + TS)                      backend/ (FastAPI)
├─ src/live2d/Live2DController.ts  PixiJS 7 + pixi-live2d-display (Cubism 4/5): load/fit/reload,
│                                  blink + idle (Cubism framework), expressions, motions,
│                                  parameter overrides, audio-driven mouth (beforeModelUpdate hook)
├─ src/emotion/EmotionMapper.ts    emotion → expression / motion / standard-parameter fallback,
│                                  per-model presets + optional emotion-map.json
├─ src/audio/AudioPlayer.ts        Web Audio playback + RMS level → lip sync; iOS unlock; barge-in stop
├─ src/audio/Recorder.ts           MediaRecorder (webm/opus, mp4 on Safari)
├─ src/audio/BrowserSTT.ts         Web Speech API fallback (Safari/Chrome, no server model)
├─ src/components/*                Live2DStage, ChatPanel, InputBar, SettingsPanel, StatusBadge
└─ src/App.tsx                     state machine idle/listening/thinking/generating/speaking/error

backend/app/
├─ llm/        base.py (provider interface) · openai_compatible.py · anthropic_provider.py · mock.py
│              persona.py (Gura system prompt + JSON contract) · service.py (history, timeouts, parsing)
├─ emotion/    schema.py — unified emotions (neutral, happy, excited, shy, sad, angry, surprised,
│              confused, thinking), robust JSON parsing with fallbacks
├─ stt/        faster_whisper_stt.py  (lazy model load, ffmpeg decode → 16 kHz mono)
├─ tts/        edge.py · openai_compatible.py
├─ voice_conversion/ sovits_http.py — client for svc_service with health check + fallback
└─ api/        health.py · chat.py (POST /api/chat, DELETE /api/chat/{id}, history) · speech.py (/api/tts, /api/stt, /api/speech/status)

svc_service/   standalone So-VITS-SVC (so-vits-svc-fork) HTTP service, own venv (Python 3.11)
scripts/       setup.sh · dev.sh · setup_live2d.sh · download_live2d_sample.py · inspect_pth.py
```

**Turn flow:** text or mic → (`/api/stt`) → `/api/chat` → LLM returns
`{text, language, emotion, intensity, expression, motion}` → UI applies expression/motion immediately
→ `/api/tts` (TTS → optional SVC) → Web Audio plays, RMS drives `ParamMouthOpenY` → mouth closes,
state returns to idle. Pressing ✋ or sending a new message interrupts playback and pending requests.

Streaming/segmented synthesis was **not** enabled by default on purpose: measure end-to-end latency on
your Mac first (`X-Speech-Meta` header reports `tts_ms` / `vc_ms`), then decide whether sentence
chunking is worth the extra complexity. The pipeline function `synthesize_pipeline()` is the single
place to add per-sentence chunking.

## 5. Tests

```bash
# backend unit/API tests (fake providers, no network)
cd backend && .venv/bin/python -m pytest -q          # 17 passed
# frontend typecheck + build
cd frontend && npm run typecheck && npm run build
# end-to-end (needs scripts/dev.sh start; uses Playwright Chromium)
cd frontend && npm run test:e2e
```

The e2e run loads the real Live2D model and verifies: capability scan, pixels actually drawn,
auto-blink, emotion → expression mapping (`angry→F03`, `surprised→F06`), parameter-override fallback,
audio-driven lip sync (mouth opens on sound, closes on silence), chat round trip (EN + 中文), status
machine, settings panel, fullscreen, and an iPhone-sized layout (mic/input visible, no overflow).

## 6. Licenses and usage limits

* **Live2D Cubism Core** — proprietary (Live2D Proprietary Software License). Downloaded by
  `scripts/setup_live2d.sh` from Live2D's CDN; not committed. Businesses above ¥10M revenue need a
  Cubism SDK Release License.
* **pixi-live2d-display(-lipsyncpatch)** — MIT. **PixiJS** — MIT.
* **Live2D sample model (Haru)** — Live2D Free Material License, development use; downloaded, not committed.
* **Gawr Gura** character, Live2D model and voice belong to COVER Corp. Use only models/voices you are
  licensed to use, and **do not deploy them publicly**. This project is for personal/local use.
* **So-VITS-SVC / so-vits-svc-fork** — MIT; **ContentVec/HuBERT** checkpoints have their own licenses.
* **edge-tts** uses Microsoft's Edge Read-Aloud service; check its terms for anything beyond personal use.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| "Live2D Cubism Core not found" | run `scripts/setup_live2d.sh` (or copy `live2dcubismcore.min.js` from the Cubism SDK for Web into `frontend/public/live2d/core/`) |
| Model fails to load / 404 | check the `.model3.json` path; all referenced files must exist; look at the browser console |
| No sound on iPhone | tap the page first; check the 🔊 button; iOS blocks audio before a user gesture |
| Mic button disabled | browser lacks MediaRecorder or page is not `localhost`/HTTPS |
| STT 503 "not installed" | `uv pip install -e "backend[stt]"`; first transcription downloads the Whisper model |
| STT "Could not decode audio" | install `ffmpeg` |
| TTS fails | edge-tts needs internet; switch `TTS_PROVIDER=openai_compatible` or check firewall |
| LLM 401/404 | wrong `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` |
| Voice conversion "unreachable" | start `svc_service/run.sh`; check `http://127.0.0.1:8100/health` |
