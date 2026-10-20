"""OpenAI-compatible speech endpoint (POST {base_url}/audio/speech). Works with OpenAI `tts-1` /
`gpt-4o-mini-tts` and self-hosted servers that mimic the API (e.g. openedai-speech, Kokoro-FastAPI).
Useful as an alternative when edge-tts is unavailable."""
from __future__ import annotations

import httpx

from app.tts.base import TTSError, TTSProvider, TTSResult


class OpenAICompatibleTTS(TTSProvider):
    name = "openai_compatible"

    def __init__(self, base_url: str, api_key: str, model: str, voice_en: str, voice_zh: str,
                 speed: float = 1.0, response_format: str = "mp3") -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key, self.model, self.voice_en, self.voice_zh = api_key, model, voice_en, voice_zh
        self.speed, self.fmt = speed, response_format
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
        self.available = True

    async def synthesize(self, text: str, language: str = "en") -> TTSResult:
        voice = self.voice_zh if language == "zh" else self.voice_en
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            r = await self._client.post(f"{self.base_url}/audio/speech", headers=headers, json={
                "model": self.model, "input": text, "voice": voice, "speed": self.speed, "response_format": self.fmt,
            })
        except httpx.TimeoutException as e:
            raise TTSError("TTS request timed out") from e
        except httpx.HTTPError as e:
            raise TTSError(f"Could not reach TTS endpoint {self.base_url}: {e}") from e
        if r.status_code >= 400:
            raise TTSError(f"TTS endpoint error {r.status_code}: {r.text[:200]}")
        mime = {"mp3": "audio/mpeg", "wav": "audio/wav", "opus": "audio/ogg", "aac": "audio/aac", "flac": "audio/flac"}.get(self.fmt, "application/octet-stream")
        return TTSResult(audio=r.content, mime_type=mime, voice=voice, engine=self.name)

    async def aclose(self) -> None:
        await self._client.aclose()
