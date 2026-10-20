from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.emotion.schema import AssistantReply
from app.llm.base import LLMError

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: str | None = None
    language: str = Field("auto", pattern="^(auto|en|zh)$")


class ChatResponse(BaseModel):
    session_id: str
    reply: AssistantReply
    meta: dict


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request) -> ChatResponse:
    services = request.app.state.services
    try:
        sid, reply, meta = await services.chat.chat(req.message, session_id=req.session_id,
                                                    language=req.language)
    except LLMError as e:
        log.warning("LLM error: %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    return ChatResponse(session_id=sid, reply=reply, meta=meta)


@router.delete("/chat/{session_id}")
async def clear_chat(session_id: str, request: Request) -> dict:
    request.app.state.services.chat.clear(session_id)
    return {"ok": True}


@router.get("/chat/{session_id}/history")
async def history(session_id: str, request: Request) -> dict:
    return {"session_id": session_id, "history": request.app.state.services.chat.history(session_id)}
