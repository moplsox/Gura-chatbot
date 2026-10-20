"""ChatService: conversation memory + persona + provider call + structured emotion parsing."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from dataclasses import dataclass, field

from app.config.settings import Settings
from app.emotion.schema import AssistantReply, parse_reply
from app.llm.base import ChatMessage, LLMError, LLMProvider
from app.llm.persona import build_system_prompt

log = logging.getLogger(__name__)


@dataclass
class Conversation:
    session_id: str
    turns: deque[ChatMessage]
    last_active: float = field(default_factory=time.time)


class ChatService:
    def __init__(self, provider: LLMProvider, settings: Settings) -> None:
        self.provider = provider
        self.s = settings
        self._conversations: dict[str, Conversation] = {}
        self._lock = asyncio.Lock()

    # ---- session memory ----
    def _conv(self, session_id: str | None) -> Conversation:
        sid = session_id or uuid.uuid4().hex
        conv = self._conversations.get(sid)
        if conv is None:
            conv = Conversation(sid, deque(maxlen=self.s.llm_max_history_turns * 2))
            self._conversations[sid] = conv
        conv.last_active = time.time()
        self._gc()
        return conv

    def _gc(self, max_idle: float = 3600.0, max_sessions: int = 500) -> None:
        if len(self._conversations) <= max_sessions:
            return
        now = time.time()
        for sid in [k for k, c in self._conversations.items() if now - c.last_active > max_idle]:
            self._conversations.pop(sid, None)

    def clear(self, session_id: str) -> None:
        self._conversations.pop(session_id, None)

    def history(self, session_id: str) -> list[dict]:
        conv = self._conversations.get(session_id)
        return [{"role": m.role, "content": m.content} for m in conv.turns] if conv else []

    # ---- main entry ----
    async def chat(self, user_text: str, *, session_id: str | None, language: str = "auto") -> tuple[str, AssistantReply, dict]:
        user_text = (user_text or "").strip()
        if not user_text:
            raise LLMError("Empty message")
        conv = self._conv(session_id)
        system = build_system_prompt(language)
        messages = [*conv.turns, ChatMessage("user", user_text)]
        t0 = time.perf_counter()
        try:
            result = await asyncio.wait_for(
                self.provider.complete(system, messages, temperature=self.s.llm_temperature,
                                       max_tokens=600, timeout=self.s.llm_timeout_seconds),
                timeout=self.s.llm_timeout_seconds + 5,
            )
        except TimeoutError as e:
            raise LLMError(f"LLM request timed out after {self.s.llm_timeout_seconds:.0f}s") from e
        latency_ms = int((time.perf_counter() - t0) * 1000)
        fallback_lang = "zh" if language == "zh" else "en"
        reply = parse_reply(result.text, fallback_language=fallback_lang)
        # Remember the turn (store the spoken text only, so history stays compact and provider-neutral)
        conv.turns.append(ChatMessage("user", user_text))
        conv.turns.append(ChatMessage("assistant", reply.text))
        meta = {"model": result.model, "latency_ms": latency_ms, "usage": result.usage,
                "provider": self.provider.name}
        log.info("chat sid=%s provider=%s model=%s %dms emotion=%s", conv.session_id,
                 self.provider.name, result.model, latency_ms, reply.emotion.value)
        return conv.session_id, reply, meta
