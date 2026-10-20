"""OpenAI-compatible chat completions provider.

Works with OpenAI, OpenRouter, DeepSeek, Groq, Together, Ollama (http://localhost:11434/v1),
LM Studio and any server exposing POST {base_url}/chat/completions.
"""
from __future__ import annotations

import logging

import httpx

from app.llm.base import ChatMessage, LLMError, LLMProvider, LLMResult

log = logging.getLogger(__name__)


class OpenAICompatibleProvider(LLMProvider):
    name = "openai_compatible"

    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))

    async def complete(self, system: str, messages: list[ChatMessage], *, temperature: float = 0.8,
                       max_tokens: int = 600, timeout: float = 45.0) -> LLMResult:
        payload = {
            "model": self.model,
            "messages": [{"role": "system", "content": system},
                         *({"role": m.role, "content": m.content} for m in messages)],
            "temperature": temperature,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        url = f"{self.base_url}/chat/completions"
        try:
            resp = await self._client.post(url, json=payload, headers=headers, timeout=timeout)
            if resp.status_code == 400 and "response_format" in resp.text:
                # Server does not support JSON mode: retry without it (the prompt still asks for JSON).
                payload.pop("response_format", None)
                resp = await self._client.post(url, json=payload, headers=headers, timeout=timeout)
        except httpx.TimeoutException as e:
            raise LLMError(f"LLM request timed out after {timeout:.0f}s") from e
        except httpx.HTTPError as e:
            raise LLMError(f"Could not reach LLM endpoint {self.base_url}: {e}") from e
        if resp.status_code == 401:
            raise LLMError("LLM endpoint rejected the API key (401). Check LLM_API_KEY.")
        if resp.status_code == 404:
            raise LLMError(f"LLM endpoint or model not found (404): {self.model} @ {self.base_url}")
        if resp.status_code == 429:
            raise LLMError("LLM rate limit reached (429). Please wait a moment and retry.")
        if resp.status_code >= 400:
            raise LLMError(f"LLM endpoint error {resp.status_code}: {resp.text[:300]}")
        try:
            data = resp.json()
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, ValueError) as e:
            raise LLMError(f"Unexpected LLM response shape: {resp.text[:300]}") from e
        return LLMResult(text=text, model=data.get("model", self.model), usage=data.get("usage") or {})

    async def aclose(self) -> None:
        await self._client.aclose()

    def describe(self) -> dict:
        return {"provider": self.name, "model": self.model, "base_url": self.base_url,
                "api_key_set": bool(self.api_key)}
