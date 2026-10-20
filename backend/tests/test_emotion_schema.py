from app.emotion.schema import AssistantReply, Emotion, parse_reply


def test_parse_clean_json():
    r = parse_reply('{"text": "Hi!", "language": "en", "emotion": "happy", "intensity": 0.8, "expression": "smile", "motion": "greeting"}')
    assert r.text == "Hi!" and r.emotion is Emotion.HAPPY and r.intensity == 0.8


def test_parse_fenced_json_with_prose():
    raw = 'Sure!\n```json\n{"text": "嗨嗨", "language": "zh-TW", "emotion": "joyful", "intensity": 2}\n```'
    r = parse_reply(raw)
    assert r.text == "嗨嗨" and r.language == "zh" and r.emotion is Emotion.HAPPY and r.intensity == 1.0


def test_parse_plain_text_fallback():
    r = parse_reply("I am just text", fallback_language="zh")
    assert r.text == "I am just text" and r.emotion is Emotion.NEUTRAL and r.language == "zh"


def test_unknown_emotion_becomes_neutral():
    r = AssistantReply(text="x", emotion="bananas")
    assert r.emotion is Emotion.NEUTRAL


def test_trailing_comma_tolerated():
    r = parse_reply('{"text": "ok", "emotion": "sad",}')
    assert r.text == "ok" and r.emotion is Emotion.SAD
