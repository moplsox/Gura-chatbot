from __future__ import annotations

import logging

from app.config.settings import Settings
from app.stt.base import STTProvider

log = logging.getLogger(__name__)


def build_stt(s: Settings) -> STTProvider | None:
    p = (s.stt_provider or "disabled").lower()
    if p == "disabled":
        return None
    if p == "faster_whisper":
        from app.stt.faster_whisper_stt import FasterWhisperSTT
        stt = FasterWhisperSTT(s.stt_model, s.stt_device, s.stt_compute_type)
        log.info("STT: %s", stt.status_message)
        return stt
    log.warning("Unknown STT_PROVIDER=%s; STT disabled", p)
    return None
