"""Offline mock provider: lets the whole pipeline (UI, TTS, Live2D emotions) run without an API key."""
from __future__ import annotations

import asyncio
import json
import re

from app.llm.base import ChatMessage, LLMProvider, LLMResult

_ZH = re.compile(r"[一-鿿]")

_RESPONSES_EN = [
    ("Hey hey! You came back! I was totally not waiting for you or anything... okay maybe a little.",
     "happy", 0.8, "smile", "greeting"),
    ("A! That's a big brain question. Let me think... *stares into the ocean*", "thinking", 0.6,
     "thinking", "think"),
    ("WHAT?! No way! Are you serious right now?!", "surprised", 0.9, "surprised", "surprise"),
    ("Eh... I'm not sure what you mean, chum. Can you say that again, but like, simpler?",
     "confused", 0.6, "confused", "shake_head"),
    ("Hehe, you're pretty nice. S-stop it, you're making me blush!", "shy", 0.7, "shy", "shy"),
    ("Sharks are the best. Don't argue with me, I have 300 million years of experience.", "excited",
     0.8, "smile", "jump"),
    ("Grr! That's not fair! Fine, I'll get you next time.", "angry", 0.6, "angry", "pout"),
    ("Aww... that makes me a little sad, but it's okay. I'm here for you.", "sad", 0.5, "sad", "nod"),
]
_RESPONSES_ZH = [
    ("嘿嘿！你回來了！我才沒有在等你……好吧，可能有一點點。", "happy", 0.8, "smile", "greeting"),
    ("啊！這個問題好難，讓我想想……*盯著海面*", "thinking", 0.6, "thinking", "think"),
    ("什麼？！不可能吧！你是認真的嗎？！", "surprised", 0.9, "surprised", "surprise"),
    ("呃……我不太懂你的意思，可以再說一次，簡單一點嗎？", "confused", 0.6, "confused", "shake_head"),
    ("嘿嘿，你人真好。別、別這樣啦，我要害羞了！", "shy", 0.7, "shy", "shy"),
    ("鯊魚最棒了！不要跟我爭，我有三億年的經驗。", "excited", 0.8, "smile", "jump"),
    ("哼！這不公平！好吧，下次我一定會贏你。", "angry", 0.6, "angry", "pout"),
    ("嗚……這讓我有點難過，不過沒關係，我會陪著你。", "sad", 0.5, "sad", "nod"),
]


class MockLLMProvider(LLMProvider):
    name = "mock"

    def __init__(self, delay: float = 0.3) -> None:
        self._delay = delay

    async def complete(self, system: str, messages: list[ChatMessage], *, temperature: float = 0.8,
                       max_tokens: int = 600, timeout: float = 45.0) -> LLMResult:
        await asyncio.sleep(self._delay)
        last_user = next((m.content for m in reversed(messages) if m.role == "user"), "")
        is_zh = bool(_ZH.search(last_user)) or "reply language: zh" in system.lower()
        pool = _RESPONSES_ZH if is_zh else _RESPONSES_EN
        idx = sum(ord(c) for c in last_user) % len(pool) if last_user else 0
        text, emotion, intensity, expression, motion = pool[idx]
        payload = {"text": text, "language": "zh" if is_zh else "en", "emotion": emotion,
                   "intensity": intensity, "expression": expression, "motion": motion}
        return LLMResult(text=json.dumps(payload, ensure_ascii=False), model="mock")

    def describe(self) -> dict:
        return {"provider": self.name, "note": "offline mock; set LLM_PROVIDER to use a real model"}
