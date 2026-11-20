"""Цепочка LLM: Ollama → YandexGPT → фрагменты без ответа. Настоящие сервисы не вызываются."""
import httpx
import pytest

from app import llm, rag

MSGS = [{"role": "user", "content": "вопрос"}]


def ok(text):
    return lambda messages: text


def broken(messages):
    raise llm.LLMUnavailable("выключена")


@pytest.fixture
def providers(monkeypatch):
    def set_calls(**calls):
        monkeypatch.setattr(llm, "PROVIDERS", list(calls))
        monkeypatch.setattr(llm, "_CALLS", calls)
    return set_calls


def test_first_provider_answers(providers):
    providers(ollama=ok("ответ ollama"), yandex=ok("ответ yandex"))
    assert llm.chat_with_provider(MSGS) == ("ответ ollama", "ollama")


def test_fallback_to_second_when_first_broken(providers):
    providers(ollama=broken, yandex=ok("ответ yandex"))
    assert llm.chat_with_provider(MSGS) == ("ответ yandex", "yandex")


def test_empty_answer_counts_as_failure(providers):
    providers(ollama=ok(""), yandex=ok("ответ yandex"))
    assert llm.chat(MSGS) == "ответ yandex"


def test_all_broken_raises(providers):
    providers(ollama=broken, yandex=broken)
    with pytest.raises(llm.LLMUnavailable):
        llm.chat(MSGS)


def test_only_chosen_provider_is_tried(providers):
    providers(ollama=broken, yandex=ok("ответ yandex"))
    with pytest.raises(llm.LLMUnavailable):          # выбрали только Ollama — Яндекс не подменяет
        llm.chat(MSGS, ["ollama"])
    assert llm.chat_with_provider(MSGS, ["yandex"]) == ("ответ yandex", "yandex")


def test_chosen_model_broken_shows_fragments(providers):
    providers(ollama=broken, yandex=ok("ответ yandex"))
    result = rag.answer_question("Какие документы нужны для поступления?", llm_choice="ollama")
    assert not result["llm_ok"] and result["sources"] and result["llm"] is None


def test_all_broken_shows_fragments(providers):
    providers(ollama=broken, yandex=broken)
    result = rag.answer_question("Какие документы нужны для поступления?")
    assert not result["llm_ok"] and result["sources"]


def test_ollama_switched_off_is_detected(monkeypatch):
    """Ollama не запущена: соединение отклонено → LLMUnavailable, а не исключение httpx."""
    def refuse(*a, **kw):
        raise httpx.ConnectError("connection refused")
    monkeypatch.setattr(llm.httpx, "post", refuse)
    with pytest.raises(llm.LLMUnavailable):
        llm._ollama(MSGS)


def test_yandex_without_key_is_skipped(monkeypatch):
    monkeypatch.setattr(llm, "YANDEX_API_KEY", "")
    with pytest.raises(llm.LLMUnavailable):
        llm._yandex(MSGS)
