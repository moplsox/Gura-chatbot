"""Speech endpoints: /api/tts (text → audio), /api/stt (audio → text), /api/speech/status."""
from __future__ import annotations

import asyncio
import base64
import logging
import time

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.audio_utils import AudioDecodeError, to_wav_16k_mono
from app.stt.base import STTError
from app.tts.base import TTSError
from app.voice_conversion.base import VCError

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["speech"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    language: str = Field("en", pattern="^(en|zh)$")
    voice_conversion: bool = True


async def synthesize_pipeline(services, text: str, language: str, want_vc: bool) -> tuple[bytes, str, dict]:
    """TTS → (optional) voice conversion with fallback. Returns (audio, mime, meta)."""
    if services.tts is None:
        raise HTTPException(status_code=503, detail="TTS is disabled (TTS_PROVIDER=disabled)")
    t0 = time.perf_counter()
    try:
        tts = await services.tts.synthesize(text, language)
    except TTSError as e:
        raise HTTPException(status_code=502, detail=f"TTS failed: {e}") from e
    meta = {"tts_engine": tts.engine, "voice": tts.voice, "tts_ms": int((time.perf_counter() - t0) * 1000),
            "voice_conversion": "skipped"}
    audio, mime = tts.audio, tts.mime_type
    vc = services.vc
    if want_vc and vc is not None:
        if not vc.available:
            await vc.refresh()
        if vc.available:
            try:
                wav = await to_wav_16k_mono(audio) if mime != "audio/wav" else audio
                # SVC works best at the model's own rate; the service resamples internally.
                res = await vc.convert(wav)
                audio, mime = res.audio, res.mime_type
                meta.update(voice_conversion="applied", vc_ms=res.latency_ms, vc_engine=res.engine)
            except (VCError, AudioDecodeError) as e:
                log.warning("voice conversion failed, falling back to TTS audio: %s", e)
                meta.update(voice_conversion="fallback", vc_error=str(e))
                if not services.settings.vc_fallback_to_tts:
                    raise HTTPException(status_code=502, detail=f"Voice conversion failed: {e}") from e
        else:
            meta.update(voice_conversion="unavailable", vc_status=vc.status_message)
    return audio, mime, meta


@router.post("/tts")
async def tts(req: TTSRequest, request: Request) -> Response:
    services = request.app.state.services
    audio, mime, meta = await synthesize_pipeline(services, req.text, req.language, req.voice_conversion)
    headers = {"X-Speech-Meta": base64.b64encode(str(meta).encode()).decode(), "Cache-Control": "no-store"}
    return Response(content=audio, media_type=mime, headers=headers)


@router.post("/stt")
async def stt(request: Request, audio: UploadFile = File(...), language: str = Form("auto")) -> dict:
    services = request.app.state.services
    if services.stt is None:
        raise HTTPException(status_code=503, detail="Server STT is disabled (STT_PROVIDER=disabled); use browser speech recognition")
    if not services.stt.available:
        raise HTTPException(status_code=503, detail=f"STT unavailable: {services.stt.status_message}")
    raw = await audio.read()
    if len(raw) < 200:
        raise HTTPException(status_code=400, detail="Recording too short")
    t0 = time.perf_counter()
    try:
        wav = await to_wav_16k_mono(raw)
    except AudioDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Could not decode audio: {e}") from e
    try:
        result = await services.stt.transcribe(wav, None if language == "auto" else language)
    except STTError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {"text": result.text, "language": result.language, "duration_seconds": result.duration_seconds,
            "engine": result.engine, "latency_ms": int((time.perf_counter() - t0) * 1000)}


@router.get("/speech/status")
async def speech_status(request: Request) -> dict:
    services = request.app.state.services
    vc = services.vc
    if vc is not None:
        await asyncio.wait_for(vc.refresh(), timeout=5)
    return {
        "tts": {"enabled": services.tts is not None, "engine": getattr(services.tts, "name", None),
                "voice_en": getattr(services.tts, "voice_en", None), "voice_zh": getattr(services.tts, "voice_zh", None)},
        "stt": {"enabled": services.stt is not None, "available": bool(services.stt and services.stt.available),
                "engine": getattr(services.stt, "name", None), "status": getattr(services.stt, "status_message", "")},
        "voice_conversion": {"enabled": vc is not None, "available": bool(vc and vc.available),
                             "status": getattr(vc, "status_message", "disabled"), "info": getattr(vc, "info", {})},
    }
