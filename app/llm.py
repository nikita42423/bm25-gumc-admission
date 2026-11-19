"""Вызов LLM. Два провайдера, выбор — переменной LLM_PROVIDER в .env:

  yandex  YandexGPT через API Yandex Cloud (основной вариант)
    YANDEX_API_KEY    секретный ключ API-ключа сервисного аккаунта (роль ai.languageModels.user)
    YANDEX_FOLDER_ID  id каталога Yandex Cloud (b1g…)
    YANDEX_MODEL      модель, по умолчанию yandexgpt/latest (дешевле — yandexgpt-lite/latest)

  ollama  локальная модель через Ollama (запасной вариант, пока не настроен)
    OLLAMA_URL        по умолчанию http://localhost:11434
    OLLAMA_MODEL      по умолчанию qwen3.5:4b

Ключи — только в .env, в Git не коммитятся.
"""
from __future__ import annotations

import os
import re

import httpx

PROVIDER = os.environ.get("LLM_PROVIDER", "yandex").lower()
TEMPERATURE = 0.1
TIMEOUT_S = float(os.environ.get("LLM_TIMEOUT", "120"))

YANDEX_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
YANDEX_API_KEY = os.environ.get("YANDEX_API_KEY", "")
YANDEX_FOLDER_ID = os.environ.get("YANDEX_FOLDER_ID", "")
YANDEX_MODEL = os.environ.get("YANDEX_MODEL", "yandexgpt/latest")

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3.5:4b")


class LLMUnavailable(RuntimeError):
    """LLM не настроена или сервис не ответил — показываем пользователю фрагменты без ответа."""


def chat(messages: list[dict]) -> str:
    """Отправить сообщения [{role, content}] и получить текст ответа."""
    if PROVIDER == "ollama":
        return _ollama(messages)
    return _yandex(messages)


def _post(url: str, **kw) -> dict:
    try:
        resp = httpx.post(url, timeout=TIMEOUT_S, **kw)
    except httpx.HTTPError as e:
        raise LLMUnavailable(f"{url} недоступен: {e}") from e
    if resp.status_code != 200:
        raise LLMUnavailable(f"{url} вернул {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _yandex(messages: list[dict]) -> str:
    if not (YANDEX_API_KEY and YANDEX_FOLDER_ID):
        raise LLMUnavailable("Не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID в .env")
    data = _post(
        YANDEX_URL,
        headers={"Authorization": f"Api-Key {YANDEX_API_KEY}", "x-folder-id": YANDEX_FOLDER_ID},
        json={
            "modelUri": f"gpt://{YANDEX_FOLDER_ID}/{YANDEX_MODEL}",
            "completionOptions": {"stream": False, "temperature": TEMPERATURE, "maxTokens": "600"},
            # У YandexGPT поле текста называется text, а не content.
            "messages": [{"role": m["role"], "text": m["content"]} for m in messages],
        },
    )
    return data["result"]["alternatives"][0]["message"]["text"].strip()


def _ollama(messages: list[dict]) -> str:
    data = _post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "think": False,  # Qwen3.5 иначе сначала долго «рассуждает»
            "options": {"temperature": TEMPERATURE, "num_ctx": 8192},
        },
    )
    return re.sub(r"<think>.*?</think>", "", data["message"]["content"], flags=re.S).strip()
