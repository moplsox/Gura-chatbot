"""Anthropic (Claude) provider using the official `anthropic` SDK (optional dependency)."""
from __future__ import annotations

import logging

from app.llm.base import ChatMessage, LLMError, LLMProvider, LLMResult

log = logging.getLogger(__name__)


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str, base_url: str | None = None) -> None:
        try:
            import anthropic  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise LLMError(
                "LLM_PROVIDER=anthropic requires the SDK: pip install anthropic"
            ) from e
        import anthropic as _anthropic

        self._anthropic = _anthropic
        kwargs: dict = {"api_key": api_key or None, "max_retries": 1}
        if base_url and "anthropic.com" not in base_url:
            kwargs["base_url"] = base_url
        self._client = _anthropic.AsyncAnthropic(**kwargs)
        self.model = model or "claude-opus-5-5"

    async def complete(self, system: str, messages: list[ChatMessage], *, temperature: float = 0.8,
                       max_tokens: int = 600, timeout: float = 45.0) -> LLMResult:
        a = self._anthropic
        msgs = [{"role": m.role, "content": m.content} for m in messages if m.role != "system"]
        try:
            # Current Claude models reason adaptively by default; a chat character wants fast turns,
            # so request low effort. Models that reject `effort` fall back to a plain request.
            try:
                resp = await self._client.with_options(timeout=timeout).messages.create(
                    model=self.model, max_tokens=max_tokens, system=system, messages=msgs,
                    output_config={"effort": "low"},
                )
            except a.BadRequestError as e:
                if "output_config" in str(e) or "effort" in str(e):
                    resp = await self._client.with_options(timeout=timeout).messages.create(
                        model=self.model, max_tokens=max_tokens, system=system, messages=msgs,
                        temperature=temperature,
                    )
                else:
                    raise
        except a.AuthenticationError as e:
            raise LLMError("Anthropic rejected the API key (401). Check LLM_API_KEY.") from e
        except a.NotFoundError as e:
            raise LLMError(f"Anthropic model not found: {self.model}") from e
        except a.RateLimitError as e:
            raise LLMError("Anthropic rate limit reached (429). Please retry shortly.") from e
        except a.APITimeoutError as e:
            raise LLMError(f"LLM request timed out after {timeout:.0f}s") from e
        except a.APIStatusError as e:
            raise LLMError(f"Anthropic API error {e.status_code}: {e.message}") from e
        except a.APIConnectionError as e:
            raise LLMError(f"Could not reach Anthropic API: {e}") from e
        if getattr(resp, "stop_reason", None) == "refusal":
            raise LLMError("The model declined to answer this request.")
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        usage = {}
        if getattr(resp, "usage", None):
            usage = {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}
        return LLMResult(text=text, model=resp.model, usage=usage)

    async def aclose(self) -> None:
        await self._client.close()

    def describe(self) -> dict:
        return {"provider": self.name, "model": self.model}
