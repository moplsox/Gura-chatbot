import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
async def client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and "providers" in body


async def test_chat_roundtrip_and_history(client):
    r = await client.post("/api/chat", json={"message": "hello gura", "language": "en"})
    assert r.status_code == 200, r.text
    body = r.json()
    sid = body["session_id"]
    assert body["reply"]["text"] and body["reply"]["emotion"] in {
        "neutral", "happy", "excited", "shy", "sad", "angry", "surprised", "confused", "thinking"}
    r2 = await client.post("/api/chat", json={"message": "你好", "session_id": sid, "language": "auto"})
    assert r2.status_code == 200 and r2.json()["reply"]["language"] == "zh"
    h = await client.get(f"/api/chat/{sid}/history")
    assert len(h.json()["history"]) == 4
    d = await client.delete(f"/api/chat/{sid}")
    assert d.json()["ok"] is True
    assert (await client.get(f"/api/chat/{sid}/history")).json()["history"] == []


async def test_chat_rejects_empty(client):
    r = await client.post("/api/chat", json={"message": ""})
    assert r.status_code == 422
