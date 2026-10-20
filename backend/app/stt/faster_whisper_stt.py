"""faster-whisper (CTranslate2) speech-to-text. Model loads lazily in a thread on first use.

On Apple Silicon there is no MPS backend for CTranslate2: use STT_DEVICE=cpu with int8 (fast
enough for `small`/`base`). The model is downloaded from Hugging Face on first run.
"""
from __future__ import annotations

import asyncio
import io
import logging
import time

from app.stt.base import STTError, STTProvider, STTResult

log = logging.getLogger(__name__)


class FasterWhisperSTT(STTProvider):
    name = "faster_whisper"

    def __init__(self, model_size: str = "small", device: str = "cpu", compute_type: str = "int8") -> None:
        self.model_size, self.device, self.compute_type = model_size, device, compute_type
        self._model = None
        self._lock = asyncio.Lock()
        try:
            import faster_whisper  # noqa: F401
            self.available = True
            self.status_message = f"faster-whisper {model_size} ({device}/{compute_type}); model loads on first use"
        except ImportError:
            self.available = False
            self.status_message = "faster-whisper not installed: pip install -e 'backend[stt]'"

    async def _ensure_model(self):
        if self._model is not None:
            return self._model
        async with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                t0 = time.perf_counter()
                log.info("Loading faster-whisper model '%s' (%s/%s)…", self.model_size, self.device, self.compute_type)
                try:
                    self._model = await asyncio.to_thread(
                        WhisperModel, self.model_size, device=self.device, compute_type=self.compute_type
                    )
                except Exception as e:
                    self.status_message = f"model load failed: {e}"
                    raise STTError(f"Could not load Whisper model '{self.model_size}': {e}") from e
                log.info("Whisper model ready in %.1fs", time.perf_counter() - t0)
        return self._model

    async def transcribe(self, wav_bytes: bytes, language_hint: str | None = None) -> STTResult:
        if not self.available:
            raise STTError(self.status_message)
        model = await self._ensure_model()
        lang = None if language_hint in (None, "", "auto") else language_hint

        def _run():
            segments, info = model.transcribe(
                io.BytesIO(wav_bytes), language=lang, beam_size=3, vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 400},
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            return text, info.language, float(info.duration or 0.0)

        try:
            text, language, duration = await asyncio.wait_for(asyncio.to_thread(_run), timeout=120)
        except TimeoutError as e:
            raise STTError("Transcription timed out") from e
        return STTResult(text=text, language="zh" if language.startswith("zh") else language,
                         duration_seconds=duration, engine=self.name)
