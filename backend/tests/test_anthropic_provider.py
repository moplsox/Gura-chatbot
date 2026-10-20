"""AnthropicProvider tests with the real SDK but a stubbed messages.create (no network)."""
from types import SimpleNamespace

import anthropic
import pytest

from app.config.settings import Settings
from app.llm.anthropic_provider import AnthropicProvider
from app.llm.base import ChatMessage, LLMError
from app.llm.factory import build_llm_provider


def _resp(text, stop_reason="end_turn"):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)], model="claude-opus-5-5",
                           stop_reason=stop_reason, usage=SimpleNamespace(input_tokens=10, output_tokens=5))


class _Messages:
    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        b = self.behaviour
        if isinstance(b, Exception):
            raise b
        return b


def _wire(provider, behaviour):
    msgs = _Messages(behaviour)
    client = SimpleNamespace(messages=msgs)
    provider._client = SimpleNamespace(with_options=lambda **_: client, close=lambda: None)
    return msgs


async def test_complete_returns_text_and_uses_system_and_low_effort():
    p = AnthropicProvider("sk-test", "claude-opus-5-5")
    msgs = _wire(p, _resp('{"text": "hi chum", "emotion": "happy"}'))
    r = await p.complete("SYSTEM", [ChatMessage("user", "hello")], timeout=10)
    assert r.text.startswith('{"text"') and r.model == "claude-opus-5-5" and r.usage["output_tokens"] == 5
    call = msgs.calls[0]
    assert call["system"] == "SYSTEM" and call["messages"] == [{"role": "user", "content": "hello"}]
    assert call["output_config"] == {"effort": "low"} and call["model"] == "claude-opus-5-5"


def _status_error(cls, status):
    req = SimpleNamespace(method="POST", url="https://api.anthropic.com/v1/messages")
    resp = SimpleNamespace(status_code=status, headers={}, request=req)
    return cls("boom", response=resp, body=None)


@pytest.mark.parametrize("exc, needle", [
    (_status_error(anthropic.AuthenticationError, 401), "API key"),
    (_status_error(anthropic.NotFoundError, 404), "not found"),
    (_status_error(anthropic.RateLimitError, 429), "rate limit"),
])
async def test_errors_become_user_facing(exc, needle):
    p = AnthropicProvider("sk-test", "claude-opus-5-5")
    _wire(p, exc)
    with pytest.raises(LLMError, match=needle):
        await p.complete("S", [ChatMessage("user", "x")])


async def test_refusal_is_reported():
    p = AnthropicProvider("sk-test", "claude-opus-5-5")
    _wire(p, _resp("", stop_reason="refusal"))
    with pytest.raises(LLMError, match="declined"):
        await p.complete("S", [ChatMessage("user", "x")])


def test_factory_falls_back_to_mock_without_key():
    s = Settings(llm_provider="anthropic", llm_api_key="")
    assert build_llm_provider(s).name == "mock"
    s2 = Settings(llm_provider="anthropic", llm_api_key="sk-ant-real")
    assert build_llm_provider(s2).name == "anthropic"
