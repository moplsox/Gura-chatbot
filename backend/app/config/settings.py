"""Central configuration. All secrets come from environment variables / .env (never the frontend)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = PROJECT_ROOT / "models"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", PROJECT_ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Server
    backend_host: str = "127.0.0.1"
    backend_port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    log_level: str = "INFO"

    # LLM
    llm_provider: str = "anthropic"  # anthropic | openai_compatible | mock
    llm_api_key: str = ""
    llm_model: str = "claude-opus-5-5"
    llm_base_url: str = "https://api.openai.com/v1"
    llm_timeout_seconds: float = 45.0
    llm_max_history_turns: int = 12
    llm_temperature: float = 0.8

    # STT
    stt_provider: str = "faster_whisper"  # faster_whisper | disabled
    stt_model: str = "small"
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"

    # TTS
    tts_provider: str = "edge"  # edge | disabled
    tts_voice_en: str = "en-US-AnaNeural"
    tts_voice_zh: str = "zh-TW-HsiaoYuNeural"
    tts_rate: str = "+5%"
    tts_pitch: str = "+0Hz"
    # OpenAI-compatible TTS (TTS_PROVIDER=openai_compatible); falls back to the LLM endpoint/key when empty
    tts_openai_base_url: str = ""
    tts_openai_api_key: str = ""
    tts_openai_model: str = "gpt-4o-mini-tts"
    tts_openai_voice_en: str = "coral"
    tts_openai_voice_zh: str = "coral"

    # Voice conversion
    vc_provider: str = "disabled"  # sovits_http | disabled
    vc_service_url: str = "http://127.0.0.1:8100"
    vc_timeout_seconds: float = 60.0
    vc_fallback_to_tts: bool = True

    # Live2D
    live2d_model_url: str = "/live2d/models/Haru/Haru.model3.json"

    models_dir: Path = Field(default=MODELS_DIR)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
