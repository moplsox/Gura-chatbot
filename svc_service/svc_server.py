"""So-VITS-SVC inference HTTP service (so-vits-svc-fork backend).

Endpoints:
  GET  /health   → model status, speakers, device, sample rate
  POST /convert  → multipart: audio (wav/any soundfile-readable), transpose (int), speaker (str)
                   returns converted WAV (float→PCM16) at the model's sampling rate

The model is loaded lazily on first request (or eagerly via SVC_EAGER=1). Errors are explicit:
missing files, config mismatch and unsupported checkpoints are reported in /health and /convert.
"""
from __future__ import annotations

import io
import logging
import os
import time
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s svc: %(message)s")
log = logging.getLogger("svc")

ROOT = Path(__file__).resolve().parents[1]


def _p(env: str, default: str = "") -> Path | None:
    v = os.environ.get(env, default).strip()
    if not v:
        return None
    p = Path(v).expanduser()
    return p if p.is_absolute() else ROOT / p


MODEL_PATH = _p("SVC_MODEL_PATH", "models/svc/G_10000.pth")
CONFIG_PATH = _p("SVC_CONFIG_PATH", "models/svc/config.json")
CLUSTER_PATH = _p("SVC_CLUSTER_PATH")
SPEAKER = os.environ.get("SVC_SPEAKER", "").strip() or None
DEVICE = os.environ.get("SVC_DEVICE", "auto")
F0_METHOD = os.environ.get("SVC_F0_METHOD", "dio")
TRANSPOSE = int(os.environ.get("SVC_TRANSPOSE", "0"))
AUTO_F0 = os.environ.get("SVC_AUTO_PREDICT_F0", "false").lower() in ("1", "true", "yes")
NOISE_SCALE = float(os.environ.get("SVC_NOISE_SCALE", "0.4"))
CLUSTER_RATIO = float(os.environ.get("SVC_CLUSTER_RATIO", "0.0"))

app = FastAPI(title="So-VITS-SVC service", version="0.1.0")
_state: dict[str, Any] = {"svc": None, "error": None, "device": None, "speakers": [], "sr": None, "load_ms": None}


def _pick_device() -> str:
    if DEVICE != "auto":
        return DEVICE
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:  # noqa: BLE001
        pass
    return "cpu"


def _preflight() -> list[str]:
    problems = []
    if MODEL_PATH is None or not MODEL_PATH.exists():
        problems.append(f"model file not found: {MODEL_PATH} (set SVC_MODEL_PATH)")
    if CONFIG_PATH is None or not CONFIG_PATH.exists():
        problems.append(f"config.json not found: {CONFIG_PATH} (so-vits-svc needs the training config)")
    if CLUSTER_PATH is not None and not CLUSTER_PATH.exists():
        problems.append(f"cluster model not found: {CLUSTER_PATH}")
    return problems


def load_model() -> None:
    if _state["svc"] is not None or _state["error"]:
        return
    problems = _preflight()
    if problems:
        _state["error"] = "; ".join(problems)
        log.error(_state["error"])
        return
    try:
        from so_vits_svc_fork.inference.core import Svc
    except ImportError as e:
        _state["error"] = f"so-vits-svc-fork is not installed in this venv: {e}"
        log.error(_state["error"])
        return
    device = _pick_device()
    t0 = time.perf_counter()
    try:
        svc = Svc(net_g_path=str(MODEL_PATH), config_path=str(CONFIG_PATH), device=device,
                  cluster_model_path=str(CLUSTER_PATH) if CLUSTER_PATH else None)
    except Exception as e:  # noqa: BLE001
        _state["error"] = f"failed to load model: {e.__class__.__name__}: {e}"
        log.exception("model load failed")
        return
    _state.update(svc=svc, device=device, sr=svc.target_sample, load_ms=int((time.perf_counter() - t0) * 1000),
                  speakers=list(getattr(svc, "spk2id", {}).keys()) or list(svc.hps.spk.keys()))
    log.info("model loaded on %s in %dms, sr=%s speakers=%s", device, _state["load_ms"], _state["sr"], _state["speakers"])


@app.on_event("startup")
async def _startup() -> None:
    if os.environ.get("SVC_EAGER", "0") == "1":
        load_model()


@app.get("/health")
async def health() -> dict:
    problems = _preflight()
    return {
        "status": "ok",
        "model_loaded": _state["svc"] is not None,
        "message": _state["error"] or ("; ".join(problems) if problems else ("ready" if _state["svc"] else "model will load on first request")),
        "model_path": str(MODEL_PATH), "config_path": str(CONFIG_PATH),
        "device": _state["device"] or _pick_device(), "sample_rate": _state["sr"], "speakers": _state["speakers"],
        "f0_method": F0_METHOD, "transpose": TRANSPOSE, "load_ms": _state["load_ms"],
    }


@app.post("/convert")
async def convert(audio: UploadFile = File(...), transpose: int = Form(TRANSPOSE), speaker: str | None = Form(None)) -> Response:
    load_model()
    if _state["svc"] is None:
        raise HTTPException(status_code=503, detail=_state["error"] or "model not loaded")
    svc = _state["svc"]
    raw = await audio.read()
    try:
        wav, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"cannot read audio: {e}") from e
    mono = wav.mean(axis=1)
    if sr != svc.target_sample:
        import librosa

        mono = librosa.resample(mono, orig_sr=sr, target_sr=svc.target_sample)
    spk = speaker or SPEAKER or (_state["speakers"][0] if _state["speakers"] else 0)
    t0 = time.perf_counter()
    try:
        out = svc.infer_silence(
            mono.astype(np.float32), speaker=spk, transpose=transpose, auto_predict_f0=AUTO_F0,
            cluster_infer_ratio=CLUSTER_RATIO, noise_scale=NOISE_SCALE, f0_method=F0_METHOD,
            db_thresh=-40, pad_seconds=0.5, chunk_seconds=0.5, absolute_thresh=False,
        )
    except Exception as e:  # noqa: BLE001
        log.exception("inference failed")
        raise HTTPException(status_code=500, detail=f"inference failed: {e.__class__.__name__}: {e}") from e
    latency = int((time.perf_counter() - t0) * 1000)
    buf = io.BytesIO()
    sf.write(buf, np.asarray(out, dtype=np.float32), svc.target_sample, format="WAV", subtype="PCM_16")
    log.info("converted %.2fs audio in %dms (spk=%s, transpose=%d)", len(mono) / svc.target_sample, latency, spk, transpose)
    return Response(content=buf.getvalue(), media_type="audio/wav",
                    headers={"X-Latency-Ms": str(latency), "X-Sample-Rate": str(svc.target_sample)})
