from __future__ import annotations

import abc
from dataclasses import dataclass


@dataclass
class VCResult:
    audio: bytes          # WAV bytes
    mime_type: str = "audio/wav"
    engine: str = ""
    latency_ms: int = 0


class VCError(RuntimeError):
    pass


class VoiceConverter(abc.ABC):
    name = "base"
    available = False
    status_message = ""

    @abc.abstractmethod
    async def convert(self, wav_bytes: bytes, *, speaker: str | None = None, transpose: int = 0) -> VCResult: ...

    async def refresh(self) -> None:
        return None

    async def aclose(self) -> None:
        return None
