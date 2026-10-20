"""Unified emotion system shared by the LLM output, the API and the Live2D frontend."""
from __future__ import annotations

import json
import re
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class Emotion(StrEnum):
    NEUTRAL = "neutral"
    HAPPY = "happy"
    EXCITED = "excited"
    SHY = "shy"
    SAD = "sad"
    ANGRY = "angry"
    SURPRISED = "surprised"
    CONFUSED = "confused"
    THINKING = "thinking"


EMOTIONS: tuple[str, ...] = tuple(e.value for e in Emotion)

# Suggested motion vocabulary. The frontend EmotionMapper maps these onto whatever the loaded
# model actually has; unknown values fall back gracefully.
MOTIONS: tuple[str, ...] = (
    "idle", "greeting", "nod", "shake_head", "laugh", "jump", "wave", "think", "pout", "shy",
    "surprise",
)


class AssistantReply(BaseModel):
    """Structured reply produced by the LLM for every turn."""

    text: str = Field(..., description="What the character says (plain text, no markdown)")
    language: str = Field("en", description="BCP-47-ish language code: en | zh")
    emotion: Emotion = Emotion.NEUTRAL
    intensity: float = Field(0.6, ge=0.0, le=1.0)
    expression: str = Field("", description="Suggested expression name, e.g. smile")
    motion: str = Field("idle", description="Suggested motion name, e.g. greeting")

    @field_validator("language", mode="before")
    @classmethod
    def _norm_lang(cls, v: Any) -> str:
        v = str(v or "en").lower().strip()
        if v.startswith("zh") or v in {"cn", "tw", "chinese", "中文"}:
            return "zh"
        return "en"

    @field_validator("emotion", mode="before")
    @classmethod
    def _norm_emotion(cls, v: Any) -> str:
        v = str(v or "neutral").lower().strip()
        aliases = {
            "joy": "happy", "joyful": "happy", "cheerful": "happy", "glad": "happy",
            "ecstatic": "excited", "hyped": "excited", "energetic": "excited",
            "embarrassed": "shy", "bashful": "shy", "flustered": "shy",
            "upset": "sad", "crying": "sad", "disappointed": "sad", "lonely": "sad",
            "mad": "angry", "annoyed": "angry", "grumpy": "angry", "pouting": "angry",
            "shocked": "surprised", "amazed": "surprised", "startled": "surprised",
            "puzzled": "confused", "unsure": "confused",
            "pondering": "thinking", "curious": "thinking", "calm": "neutral",
        }
        v = aliases.get(v, v)
        return v if v in EMOTIONS else "neutral"

    @field_validator("intensity", mode="before")
    @classmethod
    def _clamp_intensity(cls, v: Any) -> float:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return 0.6
        return max(0.0, min(1.0, f))


_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def parse_reply(raw: str, fallback_language: str = "en") -> AssistantReply:
    """Parse the LLM output into an AssistantReply.

    Accepts a bare JSON object, a fenced ```json block, or JSON embedded in prose.
    If no valid JSON is found the whole text is used as the spoken text with neutral emotion,
    so a misbehaving model never crashes the pipeline.
    """
    raw = (raw or "").strip()
    candidates: list[str] = []
    m = _FENCE.search(raw)
    if m:
        candidates.append(m.group(1))
    m = _JSON_BLOCK.search(raw)
    if m:
        candidates.append(m.group(0))
    for cand in candidates:
        try:
            data = json.loads(cand)
        except json.JSONDecodeError:
            # Some models emit trailing commas; try a light cleanup once.
            try:
                data = json.loads(re.sub(r",\s*([}\]])", r"\1", cand))
            except json.JSONDecodeError:
                continue
        if isinstance(data, dict) and isinstance(data.get("text"), str) and data["text"].strip():
            data.setdefault("language", fallback_language)
            try:
                return AssistantReply(**data)
            except Exception:  # noqa: BLE001 - fall through to next candidate / plain text
                continue
    text = _FENCE.sub("", raw).strip() or "..."
    return AssistantReply(text=text, language=fallback_language)
