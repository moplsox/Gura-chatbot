from __future__ import annotations

import abc
from dataclasses import dataclass


@dataclass
class STTResult:
    text: str
    language: str
    duration_seconds: float = 0.0
    engine: str = ""


class STTError(RuntimeError):
    pass


class STTProvider(abc.ABC):
    name = "base"
    available = False
    status_message = ""

    @abc.abstractmethod
    async def transcribe(self, wav_bytes: bytes, language_hint: str | None = None) -> STTResult: ...
