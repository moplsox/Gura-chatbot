from __future__ import annotations

import platform
import shutil
import time

from fastapi import APIRouter, Request

from app.config.settings import get_settings

router = APIRouter(tags=["health"])
_STARTED = time.time()


@router.get("/api/health")
async def health(request: Request) -> dict:
    s = get_settings()
    services = getattr(request.app.state, "services", None)
    return {
        "status": "ok",
        "uptime_seconds": round(time.time() - _STARTED, 1),
        "python": platform.python_version(),
        "platform": f"{platform.system()} {platform.machine()}",
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "providers": {
            "llm": {"provider": s.llm_provider, "model": s.llm_model,
                     "active": getattr(getattr(services, "chat", None), "provider", None).name if services else None,
                     "configured": s.llm_provider == "mock" or bool(s.llm_api_key and s.llm_api_key != "sk-ant-...")
                     or s.llm_base_url.startswith("http://")},
            "stt": {"provider": s.stt_provider, "model": s.stt_model,
                     "ready": bool(services and services.stt and services.stt.available)},
            "tts": {"provider": s.tts_provider, "voice_en": s.tts_voice_en,
                     "voice_zh": s.tts_voice_zh,
                     "ready": bool(services and services.tts and services.tts.available)},
            "voice_conversion": {"provider": s.vc_provider, "service_url": s.vc_service_url,
                                 "ready": bool(services and services.vc and services.vc.available)},
        },
        "live2d_model_url": s.live2d_model_url,
    }
