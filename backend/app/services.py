"""Service container wired at startup (LLM, STT, TTS, voice conversion)."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from app.config.settings import Settings
from app.llm.factory import build_llm_provider
from app.llm.service import ChatService
from app.stt.factory import build_stt
from app.tts.factory import build_tts
from app.voice_conversion.factory import build_vc

log = logging.getLogger(__name__)


@dataclass
class Services:
    chat: ChatService
    settings: Settings
    stt: Any = None
    tts: Any = None
    vc: Any = None

    async def aclose(self) -> None:
        for svc in (self.chat.provider, self.stt, self.tts, self.vc):
            close = getattr(svc, "aclose", None)
            if close:
                try:
                    await close()
                except Exception:
                    log.exception("error closing %s", svc)


def build_services(s: Settings) -> Services:
    provider = build_llm_provider(s)
    log.info("LLM provider: %s", provider.describe())
    tts = build_tts(s)
    stt = build_stt(s)
    vc = build_vc(s)
    log.info("TTS: %s | STT: %s | VC: %s", getattr(tts, 'name', 'disabled'), getattr(stt, 'name', 'disabled'), getattr(vc, 'name', 'disabled'))
    return Services(chat=ChatService(provider, s), settings=s, stt=stt, tts=tts, vc=vc)
