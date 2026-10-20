from __future__ import annotations

import logging

from app.config.settings import Settings
from app.tts.base import TTSProvider

log = logging.getLogger(__name__)


def build_tts(s: Settings) -> TTSProvider | None:
    p = (s.tts_provider or "disabled").lower()
    if p == "disabled":
        return None
    if p == "edge":
        from app.tts.edge import EdgeTTSProvider
        return EdgeTTSProvider(s.tts_voice_en, s.tts_voice_zh, s.tts_rate, s.tts_pitch)
    if p == "openai_compatible":
        from app.tts.openai_compatible import OpenAICompatibleTTS
        return OpenAICompatibleTTS(s.tts_openai_base_url or s.llm_base_url, s.tts_openai_api_key or s.llm_api_key,
                                   s.tts_openai_model, s.tts_openai_voice_en, s.tts_openai_voice_zh)
    log.warning("Unknown TTS_PROVIDER=%s; TTS disabled", p)
    return None
