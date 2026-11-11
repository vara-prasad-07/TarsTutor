import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.lessons import LessonService
from app.main import create_app
from app.models import Classification
from app.provider import GeminiProvider, OpenRouterProvider, ProviderUnavailable, create_provider


def settings(**overrides):
    return Settings(_env_file=None, **{"switch": "openrouter", "openrouter_api": "test-private-key", **overrides})


def test_switch_validation_and_default(monkeypatch):
    monkeypatch.delenv("SWITCH", raising=False)
    assert Settings(_env_file=None).switch == "gemini"
    assert settings(switch=" OpenRouter ").switch == "openrouter"
    with pytest.raises(ValidationError):
        settings(switch="typo")
    monkeypatch.setenv("SWITCH", "openrouter")
    monkeypatch.setenv("OPENROUTER_API", "env-private-key")
    assert Settings(_env_file=None).llm_api_key.get_secret_value() == "env-private-key"


def test_factory_and_classroom_selection():
    config = settings(gemini_api_key="")
    assert isinstance(create_provider(config), OpenRouterProvider)
    assert isinstance(LessonService(config, None, asyncio.Semaphore(1)).configured(), OpenRouterProvider)
    assert isinstance(create_provider(settings(switch="gemini", gemini_api_key="test-key")), GeminiProvider)


def test_health_and_readiness_follow_selected_key(tmp_path):
    for key, status in [("", 503), ("test-private-key", 200)]:
        config = settings(openrouter_api=key, gemini_api_key="unused-key", database_path=str(tmp_path / "test.sqlite3"))
        with TestClient(create_app(config)) as client:
            assert client.get("/ready").status_code == status
            health = client.get("/health").json()
            assert health["llm_configured"] is bool(key)
            assert health["model"] == config.openrouter_model
            assert "private-key" not in str(health)


def test_openrouter_payload_and_multimodal_validation():
    def handle(request):
        assert request.headers["Authorization"] == "Bearer test-private-key"
        assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
        body = json.loads(request.content)
        assert body["model"] == "custom/vision-model"
        assert body["response_format"] == {"type": "json_object"}
        assert "properties" in body["messages"][0]["content"]
        content = body["messages"][1]["content"]
        assert json.loads(content[0]["text"]) == {"question": "Area?"}
        assert content[-1]["image_url"]["url"] == "data:image/png;base64,aW1hZ2U="
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps({"intent": "new_topic", "needs_clarification": False, "clarification": ""})}}]})

    provider = OpenRouterProvider(settings(openrouter_model="custom/vision-model"), transport=httpx.MockTransport(handle))
    result = asyncio.run(provider.generate(Classification, "Teach", {"question": "Area?", "images": [{"mime_type": "image/png", "data": "aW1hZ2U="}]}))
    assert isinstance(result, Classification)


@pytest.mark.parametrize("status,expected,calls", [(503, ProviderUnavailable, 2), (429, ProviderUnavailable, 2), (504, TimeoutError, 1), (401, RuntimeError, 1)])
def test_openrouter_errors_are_bounded_and_sanitized(status, expected, calls):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(status, text="test-private-key private prompt")

    provider = OpenRouterProvider(settings(), transport=httpx.MockTransport(handle))
    with pytest.raises(expected) as error:
        asyncio.run(provider.generate(Classification, "Teach", {}))
    assert len(requests) == calls
    assert "private" not in str(error.value)


def test_openrouter_rejects_invalid_schema():
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json={"choices": [{"message": {"content": '{"intent":"invalid"}'}}]}))
    with pytest.raises(ValidationError):
        asyncio.run(OpenRouterProvider(settings(), transport=transport).generate(Classification, "Teach", {}))
