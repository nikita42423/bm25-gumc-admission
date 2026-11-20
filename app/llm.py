"""Вызов LLM с запасными вариантами.

Порядок провайдеров — LLM_PROVIDERS в .env (по умолчанию «ollama,yandex»):
пробуем первый; если он выключен, сломан или не ответил вовремя — следующий.
Если не ответил никто — LLMUnavailable, и пользователь видит найденные фрагменты без ответа.

  ollama  локальная модель через Ollama (основной вариант)
    OLLAMA_URL        по умолчанию http://localhost:11434
    OLLAMA_MODEL      по умолчанию qwen3.5:4b
    OLLAMA_TIMEOUT    сколько ждать ответа, с (по умолчанию 90)

  yandex  YandexGPT через API Yandex Cloud (запасной вариант)
    YANDEX_API_KEY    секретный ключ API-ключа сервисного аккаунта (роль ai.languageModels.user)
    YANDEX_FOLDER_ID  id каталога Yandex Cloud (b1g…)
    YANDEX_MODEL      по умолчанию yandexgpt/latest (дешевле — yandexgpt-lite/latest)

Ключи — только в .env, в Git не коммитятся.
"""
from __future__ import annotations

import logging
import os
import re

import httpx

log = logging.getLogger("llm")

PROVIDERS = [p.strip().lower() for p in os.environ.get("LLM_PROVIDERS", "ollama,yandex").split(",") if p.strip()]
TEMPERATURE = 0.1
CONNECT_TIMEOUT_S = 3  # выключенный сервис отвечает отказом сразу — долго не ждём

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3.5:4b")
OLLAMA_TIMEOUT_S = float(os.environ.get("OLLAMA_TIMEOUT", "90"))

YANDEX_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
YANDEX_API_KEY = os.environ.get("YANDEX_API_KEY", "")
YANDEX_FOLDER_ID = os.environ.get("YANDEX_FOLDER_ID", "")
YANDEX_MODEL = os.environ.get("YANDEX_MODEL", "yandexgpt/latest")
YANDEX_TIMEOUT_S = 60

class LLMUnavailable(RuntimeError):
    """Ни одна LLM не ответила — показываем пользователю фрагменты без ответа."""


def chat(messages: list[dict], providers: list[str] | None = None) -> str:
    """Отправить сообщения [{role, content}] и получить текст ответа от первой доступной LLM."""
    return chat_with_provider(messages, providers)[0]


def chat_with_provider(messages: list[dict], providers: list[str] | None = None) -> tuple[str, str]:
    """То же, что chat, но возвращает ещё и имя модели, которая ответила.

    providers — порядок попыток для этого запроса; None — порядок из LLM_PROVIDERS.
    """
    errors = []
    for name in (PROVIDERS if providers is None else providers):
        call = _CALLS.get(name)
        if call is None:
            errors.append(f"{name}: неизвестный провайдер")
            continue
        try:
            text = call(messages)
        except LLMUnavailable as e:
            log.warning("LLM %s недоступна: %s", name, e)
            errors.append(f"{name}: {e}")
            continue
        if text:
            log.info("Ответила LLM %s", name)
            return text, name
        errors.append(f"{name}: пустой ответ")
    raise LLMUnavailable("; ".join(errors) or "не выбрана ни одна модель")


def _post(url: str, timeout_s: float, local: bool = False, **kw) -> dict:
    # local: запрос к своему компьютеру — системный прокси (HTTP_PROXY) не используем,
    # иначе прокси отвечает 503 вместо Ollama.
    try:
        resp = httpx.post(url, timeout=httpx.Timeout(timeout_s, connect=CONNECT_TIMEOUT_S),
                          trust_env=not local, **kw)
    except httpx.HTTPError as e:
        raise LLMUnavailable(f"{url} недоступен: {type(e).__name__} {e}") from e
    if resp.status_code != 200:
        raise LLMUnavailable(f"{url} вернул {resp.status_code}: {resp.text[:300]}")
    try:
        return resp.json()
    except ValueError as e:
        raise LLMUnavailable(f"{url} вернул не JSON") from e


def _ollama(messages: list[dict]) -> str:
    data = _post(
        f"{OLLAMA_URL}/api/chat",
        OLLAMA_TIMEOUT_S,
        local=True,
        json={
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "think": False,  # Qwen3.5 иначе сначала долго «рассуждает»
            "options": {"temperature": TEMPERATURE, "num_ctx": 8192, "num_predict": 400},
        },
    )
    content = (data.get("message") or {}).get("content", "")
    return re.sub(r"<think>.*?</think>", "", content, flags=re.S).strip()


def _yandex(messages: list[dict]) -> str:
    if not (YANDEX_API_KEY and YANDEX_FOLDER_ID):
        raise LLMUnavailable("не заданы YANDEX_API_KEY и YANDEX_FOLDER_ID в .env")
    data = _post(
        YANDEX_URL,
        YANDEX_TIMEOUT_S,
        headers={"Authorization": f"Api-Key {YANDEX_API_KEY}", "x-folder-id": YANDEX_FOLDER_ID},
        json={
            "modelUri": f"gpt://{YANDEX_FOLDER_ID}/{YANDEX_MODEL}",
            "completionOptions": {"stream": False, "temperature": TEMPERATURE, "maxTokens": "600"},
            # У YandexGPT поле текста называется text, а не content.
            "messages": [{"role": m["role"], "text": m["content"]} for m in messages],
        },
    )
    try:
        return data["result"]["alternatives"][0]["message"]["text"].strip()
    except (KeyError, IndexError, TypeError) as e:
        raise LLMUnavailable(f"неожиданный ответ YandexGPT: {str(data)[:200]}") from e


_CALLS = {"ollama": _ollama, "yandex": _yandex}
