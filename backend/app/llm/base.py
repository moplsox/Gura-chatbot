"""Provider-agnostic LLM interface. Swap providers via LLM_PROVIDER without touching the app."""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Literal

Role = Literal["system", "user", "assistant"]


@dataclass
class ChatMessage:
    role: Role
    content: str


@dataclass
class LLMResult:
    text: str
    model: str = ""
    usage: dict = field(default_factory=dict)


class LLMError(RuntimeError):
    """Raised for provider failures (network, auth, timeout). Message is user-presentable."""


class LLMProvider(abc.ABC):
    name: str = "base"

    @abc.abstractmethod
    async def complete(
        self,
        system: str,
        messages: list[ChatMessage],
        *,
        temperature: float = 0.8,
        max_tokens: int = 600,
        timeout: float = 45.0,
    ) -> LLMResult:
        """Return the assistant's raw text for the given conversation."""

    async def aclose(self) -> None:
        return None

    def describe(self) -> dict:
        return {"provider": self.name}
