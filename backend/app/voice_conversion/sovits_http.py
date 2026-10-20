"""Client for the separate So-VITS-SVC inference service (see svc_service/).

The SVC model runs in its own process/venv because so-vits-svc dependencies (torch, fairseq/
contentvec, Python ≤3.11) conflict with the main backend. We send TTS audio (WAV) and get
converted WAV back. If the service is down or slow we fall back to the untouched TTS audio.
"""
from __future__ import annotations

import logging
import time

import httpx

from app.voice_conversion.base import VCError, VCResult, VoiceConverter

log = logging.getLogger(__name__)


class SoVitsHttpConverter(VoiceConverter):
    name = "sovits_http"

    def __init__(self, base_url: str, timeout: float = 60.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=3.0))
        self.available = False
        self.status_message = "not checked yet"
        self.info: dict = {}

    async def refresh(self) -> None:
        try:
            r = await self._client.get(f"{self.base_url}/health", timeout=3.0)
            r.raise_for_status()
            self.info = r.json()
            self.available = bool(self.info.get("model_loaded"))
            self.status_message = self.info.get("message") or ("ready" if self.available else "service up, model not loaded")
        except Exception as e:  # noqa: BLE001
            self.available = False
            self.status_message = f"SVC service unreachable at {self.base_url}: {e.__class__.__name__}"

    async def convert(self, wav_bytes: bytes, *, speaker: str | None = None, transpose: int = 0) -> VCResult:
        t0 = time.perf_counter()
        data = {"transpose": str(transpose)}
        if speaker:
            data["speaker"] = speaker
        try:
            r = await self._client.post(f"{self.base_url}/convert", files={"audio": ("in.wav", wav_bytes, "audio/wav")},
                                        data=data, timeout=self.timeout)
        except httpx.TimeoutException as e:
            raise VCError(f"voice conversion timed out after {self.timeout:.0f}s") from e
        except httpx.HTTPError as e:
            self.available = False
            raise VCError(f"voice conversion service unreachable: {e}") from e
        if r.status_code >= 400:
            raise VCError(f"voice conversion failed ({r.status_code}): {r.text[:200]}")
        return VCResult(audio=r.content, engine=self.name, latency_ms=int((time.perf_counter() - t0) * 1000))

    async def aclose(self) -> None:
        await self._client.aclose()
