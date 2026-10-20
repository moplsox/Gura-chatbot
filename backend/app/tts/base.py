from __future__ import annotations

import abc
from dataclasses import dataclass


@dataclass
class TTSResult:
    audio: bytes
    mime_type: str  # e.g. audio/mpeg, audio/wav
    sample_rate: int | None = None
    voice: str = ""
    engine: str = ""


class TTSError(RuntimeError):
    pass


class TTSProvider(abc.ABC):
    name = "base"
    available = False

    @abc.abstractmethod
    async def synthesize(self, text: str, language: str = "en") -> TTSResult: ...

    async def aclose(self) -> None:
        return None
