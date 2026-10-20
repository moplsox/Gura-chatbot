"""Speech pipeline tests with fake providers (no network, no models)."""
import io

import numpy as np
import pytest
import soundfile as sf
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.stt.base import STTProvider, STTResult
from app.tts.base import TTSError, TTSProvider, TTSResult
from app.voice_conversion.base import VCError, VCResult, VoiceConverter


def make_wav(seconds=0.5, sr=16000) -> bytes:
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr, format="WAV")
    return buf.getvalue()


class FakeTTS(TTSProvider):
    name = "fake"
    available = True
    voice_en = "fake-en"
    voice_zh = "fake-zh"

    def __init__(self, fail=False):
        self.fail = fail

    async def synthesize(self, text, language="en"):
        if self.fail:
            raise TTSError("boom")
        return TTSResult(audio=make_wav(), mime_type="audio/wav", sample_rate=16000, voice=language, engine="fake")


class FakeVC(VoiceConverter):
    name = "fakevc"

    def __init__(self, mode="ok"):
        self.mode = mode
        self.available = mode != "down"
        self.status_message = "fake"

    async def refresh(self):
        pass

    async def convert(self, wav_bytes, *, speaker=None, transpose=0):
        if self.mode == "fail":
            raise VCError("svc exploded")
        return VCResult(audio=b"RIFF" + wav_bytes[4:], engine="fakevc", latency_ms=5)


class FakeSTT(STTProvider):
    name = "fakestt"
    available = True

    async def transcribe(self, wav_bytes, language_hint=None):
        info = sf.info(io.BytesIO(wav_bytes))
        assert info.samplerate == 16000 and info.channels == 1
        return STTResult(text="hello gura", language=language_hint or "en", duration_seconds=info.duration, engine="fakestt")


@pytest.fixture
async def client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c


async def test_tts_returns_audio_and_meta(client):
    app.state.services.tts = FakeTTS()
    app.state.services.vc = None
    r = await client.post("/api/tts", json={"text": "hi", "language": "en", "voice_conversion": True})
    assert r.status_code == 200 and r.headers["content-type"].startswith("audio/wav")
    assert len(r.content) > 1000 and "X-Speech-Meta" in r.headers


async def test_tts_with_voice_conversion_applied(client):
    app.state.services.tts = FakeTTS()
    app.state.services.vc = FakeVC("ok")
    r = await client.post("/api/tts", json={"text": "hi", "language": "en"})
    assert r.status_code == 200
    import base64
    assert "'voice_conversion': 'applied'" in base64.b64decode(r.headers["X-Speech-Meta"]).decode()


async def test_tts_voice_conversion_falls_back(client):
    app.state.services.tts = FakeTTS()
    app.state.services.vc = FakeVC("fail")
    r = await client.post("/api/tts", json={"text": "hi", "language": "zh"})
    assert r.status_code == 200
    import base64
    meta = base64.b64decode(r.headers["X-Speech-Meta"]).decode()
    assert "'voice_conversion': 'fallback'" in meta and "svc exploded" in meta


async def test_tts_failure_is_502(client):
    app.state.services.tts = FakeTTS(fail=True)
    r = await client.post("/api/tts", json={"text": "hi", "language": "en"})
    assert r.status_code == 502 and "TTS failed" in r.json()["detail"]


async def test_tts_disabled_is_503(client):
    app.state.services.tts = None
    r = await client.post("/api/tts", json={"text": "hi", "language": "en"})
    assert r.status_code == 503


async def test_stt_decodes_and_transcribes(client):
    app.state.services.stt = FakeSTT()
    wav = make_wav(1.0, sr=44100)  # not 16k → exercised resample path
    r = await client.post("/api/stt", files={"audio": ("rec.wav", wav, "audio/wav")}, data={"language": "en"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["text"] == "hello gura" and body["engine"] == "fakestt"


async def test_stt_rejects_garbage(client):
    app.state.services.stt = FakeSTT()
    r = await client.post("/api/stt", files={"audio": ("rec.webm", b"\x00" * 500, "audio/webm")}, data={"language": "auto"})
    assert r.status_code == 400 and "decode" in r.json()["detail"].lower()


async def test_stt_unavailable_message(client):
    from app.stt.faster_whisper_stt import FasterWhisperSTT
    stt = FasterWhisperSTT("tiny")
    stt.available = False
    stt.status_message = "faster-whisper not installed"
    app.state.services.stt = stt
    r = await client.post("/api/stt", files={"audio": ("rec.wav", make_wav(), "audio/wav")}, data={"language": "auto"})
    assert r.status_code == 503 and "not installed" in r.json()["detail"]


async def test_speech_status(client):
    r = await client.get("/api/speech/status")
    assert r.status_code == 200 and {"tts", "stt", "voice_conversion"} <= set(r.json())
