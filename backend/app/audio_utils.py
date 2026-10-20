"""Audio helpers: decode browser recordings to 16 kHz mono WAV via ffmpeg, and WAV inspection."""
from __future__ import annotations

import asyncio
import io
import shutil

import numpy as np
import soundfile as sf


class AudioDecodeError(RuntimeError):
    pass


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


async def to_wav_16k_mono(data: bytes, timeout: float = 30.0) -> bytes:
    """Convert any ffmpeg-decodable container (webm/opus, mp4/aac, ogg, mp3, wav) to 16k mono PCM WAV."""
    if not data:
        raise AudioDecodeError("empty audio")
    # Fast path: already a WAV soundfile can read.
    try:
        audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
        return _encode_wav(audio.mean(axis=1), sr, 16000)
    except Exception:  # noqa: BLE001 - not a WAV/FLAC/OGG soundfile understands
        pass
    if not ffmpeg_available():
        raise AudioDecodeError("ffmpeg is required to decode browser audio (brew install ffmpeg)")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000",
        "-f", "wav", "pipe:1",
        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(data), timeout=timeout)
    except TimeoutError as e:
        proc.kill()
        raise AudioDecodeError("ffmpeg timed out") from e
    if proc.returncode != 0 or not out:
        raise AudioDecodeError(f"ffmpeg failed: {err.decode(errors='ignore')[:200]}")
    return out


def _encode_wav(mono: np.ndarray, sr: int, target_sr: int) -> bytes:
    if sr != target_sr:
        # Linear resample (good enough for speech → STT); avoids a librosa dependency.
        n = round(len(mono) * target_sr / sr)
        x_old = np.linspace(0, 1, len(mono), endpoint=False)
        x_new = np.linspace(0, 1, n, endpoint=False)
        mono = np.interp(x_new, x_old, mono).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, mono, target_sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def wav_info(data: bytes) -> dict:
    audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    return {"sample_rate": sr, "channels": audio.shape[1], "duration": audio.shape[0] / sr,
            "peak": float(np.abs(audio).max()) if audio.size else 0.0}
