from __future__ import annotations

import logging

from app.config.settings import Settings
from app.voice_conversion.base import VoiceConverter

log = logging.getLogger(__name__)


def build_vc(s: Settings) -> VoiceConverter | None:
    p = (s.vc_provider or "disabled").lower()
    if p == "disabled":
        return None
    if p == "sovits_http":
        from app.voice_conversion.sovits_http import SoVitsHttpConverter
        return SoVitsHttpConverter(s.vc_service_url, s.vc_timeout_seconds)
    log.warning("Unknown VC_PROVIDER=%s; voice conversion disabled", p)
    return None
