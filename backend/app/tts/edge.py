"""Microsoft Edge neural TTS via the `edge-tts` package (free, no key, needs internet).

Good English quality (en-US-AnaNeural is a young, bright voice that suits Gura) and solid
Traditional Chinese (zh-TW-HsiaoYuNeural). Output is MP3 24kHz.
"""
from __future__ import annotations

import asyncio
import logging

from app.tts.base import TTSError, TTSProvider, TTSResult

log = logging.getLogger(__name__)


class EdgeTTSProvider(TTSProvider):
    name = "edge"

    def __init__(self, voice_en: str, voice_zh: str, rate: str = "+0%", pitch: str = "+0Hz") -> None:
        try:
            import edge_tts  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise TTSError("edge-tts is not installed") from e
        self.voice_en, self.voice_zh, self.rate, self.pitch = voice_en, voice_zh, rate, pitch
        self.available = True

    def voice_for(self, language: str) -> str:
        return self.voice_zh if language == "zh" else self.voice_en

    async def synthesize(self, text: str, language: str = "en") -> TTSResult:
        import edge_tts

        text = (text or "").strip()
        if not text:
            raise TTSError("Empty text")
        voice = self.voice_for(language)
        try:
            comm = edge_tts.Communicate(text, voice, rate=self.rate, pitch=self.pitch)
            chunks: list[bytes] = []
            async with asyncio.timeout(30):
                async for chunk in comm.stream():
                    if chunk["type"] == "audio":
                        chunks.append(chunk["data"])
        except TimeoutError as e:
            raise TTSError("TTS timed out (edge-tts needs internet access)") from e
        except Exception as e:
            raise TTSError(f"edge-tts failed: {e.__class__.__name__}: {e}") from e
        audio = b"".join(chunks)
        if not audio:
            raise TTSError("edge-tts returned no audio")
        return TTSResult(audio=audio, mime_type="audio/mpeg", sample_rate=24000, voice=voice, engine=self.name)
