# svc_service — So-VITS-SVC voice conversion microservice

A small FastAPI service that wraps **so-vits-svc-fork** (`so_vits_svc_fork`) inference so the main
backend can convert TTS audio into the Gura voice over HTTP. It runs in its **own virtualenv**
because so-vits-svc needs PyTorch + fairseq/ContentVec and Python ≤ 3.11, which would bloat and
conflict with the main backend.

```
backend (FastAPI, :8000)  ──TTS wav──▶  svc_service (:8100)  ──converted wav──▶  backend ──▶ browser
```

## 1. Check your .pth first

```bash
# From the repo root (needs torch; use this service's venv once created, or any env with torch)
svc_service/.venv/bin/python scripts/inspect_pth.py /path/to/G_xxxx.pth --config /path/to/config.json
```

The script tells you whether the file is a so-vits-svc **4.x Generator** (usable), a Discriminator
`D_*.pth` (not usable), an RVC export, a VITS-TTS model, etc., and which speech encoder it expects
(`enc_p.pre.weight` input dim: 768 → ContentVec/vec768l12, 256 → hubert-soft/vec256l9).

**What you need in `models/svc/`:**

| File | Required | Notes |
|---|---|---|
| `G_*.pth` | ✅ | Generator from the same training run |
| `config.json` | ✅ | From the same run (sampling rate, hop, speaker map, ssl_dim) |
| ContentVec / HuBERT checkpoint | ✅ (auto) | so-vits-svc-fork downloads `checkpoint_best_legacy_500.pt` on first run (~1.2 GB) |
| `kmeans_*.pt` | optional | Cluster model for timbre leakage reduction |
| `rmvpe.pt` | optional | Only if you choose `rmvpe` as F0 method; `dio`/`harvest`/`crepe` need no file |

If only a `.pth` exists **without** `config.json`, inference is not possible: so-vits-svc needs the
training config (sample rate, hop size, speaker names, encoder dimension) to build the network.

## 2. Install (macOS, Apple Silicon or Intel)

```bash
cd svc_service
# so-vits-svc-fork supports Python 3.8–3.11. Install 3.11 if needed: brew install python@3.11
uv venv .venv --python 3.11      # or: python3.11 -m venv .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

Apple Silicon: PyTorch wheels include MPS. so-vits-svc-fork picks `mps` automatically when
available; set `SVC_DEVICE=cpu` if you hit MPS op errors (some F0 methods fall back anyway).

## 3. Run

```bash
cp .env.example .env     # edit model paths
.venv/bin/python -m uvicorn svc_server:app --host 127.0.0.1 --port 8100
# or:  ./run.sh
```

Then in the **main** `.env` set `VC_PROVIDER=sovits_http` and `VC_SERVICE_URL=http://127.0.0.1:8100`.

## 4. Test with a short clip

```bash
curl -s http://127.0.0.1:8100/health | python3 -m json.tool
curl -s -F "audio=@/path/to/short.wav" -F "transpose=0" http://127.0.0.1:8100/convert -o out.wav
```

The health endpoint reports `model_loaded`, the detected speakers, sample rate and the device, and
`/convert` returns `X-Latency-Ms`. Use a 2–4 s clip first: on an M1/M2 CPU expect roughly 1–3 s of
compute per second of audio; MPS is faster. If latency is too high for live chat, keep
`VC_FALLBACK_TO_TTS=true` (default) so the chat continues with the plain TTS voice.

## Licensing / ethics

Only use voice models you trained yourself or have permission to use, and do not deploy a model of a
real person's voice publicly without authorization. This service is for local/personal use.
