from __future__ import annotations

import logging

from app.config.settings import Settings
from app.llm.base import LLMProvider
from app.llm.mock import MockLLMProvider

log = logging.getLogger(__name__)


def build_llm_provider(s: Settings) -> LLMProvider:
    provider = (s.llm_provider or "mock").lower()
    if provider == "openai_compatible":
        if not s.llm_api_key and not s.llm_base_url.startswith("http://"):
            log.warning("LLM_PROVIDER=openai_compatible but LLM_API_KEY is empty")
        from app.llm.openai_compatible import OpenAICompatibleProvider
        return OpenAICompatibleProvider(s.llm_base_url, s.llm_api_key, s.llm_model)
    if provider == "anthropic":
        key = s.llm_api_key.strip()
        if not key or key == "sk-ant-...":
            log.warning("LLM_PROVIDER=anthropic but LLM_API_KEY is empty → using the offline mock persona. "
                        "Set LLM_API_KEY in .env (https://console.anthropic.com) and restart.")
            return MockLLMProvider()
        from app.llm.anthropic_provider import AnthropicProvider
        return AnthropicProvider(key, s.llm_model, s.llm_base_url)
    if provider != "mock":
        log.warning("Unknown LLM_PROVIDER=%s, falling back to mock", provider)
    return MockLLMProvider()
