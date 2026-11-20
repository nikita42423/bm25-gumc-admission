"""API /api/ask: LLM заменена заглушкой, чтобы тесты не зависели от Ollama и YandexGPT."""
import pytest
from fastapi.testclient import TestClient

from app import llm, rag
from app.main import app

client = TestClient(app)
QUESTION = "Какие документы нужны для поступления?"


@pytest.fixture
def fake_llm(monkeypatch):
    """Заглушка: запоминает, с какими сообщениями и моделями её вызвали."""
    calls = []

    def fake(messages, providers=None):
        calls.append({"messages": messages, "providers": providers})
        if providers == ["yandex"]:
            return "Ответ Яндекса [1].", "yandex"
        return "Нужно подать заявление и документы [1].", "ollama"

    monkeypatch.setattr(llm, "chat_with_provider", fake)
    return calls


def test_answer_with_cited_source(fake_llm):
    r = client.post("/api/ask", json={"question": QUESTION})
    assert r.status_code == 200
    data = r.json()
    assert data["answer"].startswith("Нужно подать")
    assert data["llm"] == "ollama"
    assert len(data["sources"]) == 1                      # только процитированный [1]
    assert data["sources"][0]["title"] and data["sources"][0]["fragment"]
    context = fake_llm[0]["messages"][1]["content"]
    assert "[1]" in context and "Вопрос: Какие документы" in context


@pytest.mark.parametrize("choice, providers", [("auto", None), ("ollama", ["ollama"]), ("yandex", ["yandex"])])
def test_llm_choice_is_passed_to_chain(fake_llm, choice, providers):
    r = client.post("/api/ask", json={"question": QUESTION, "llm": choice})
    assert r.status_code == 200
    assert fake_llm[0]["providers"] == providers


def test_llm_none_returns_fragments_without_llm_call(fake_llm):
    data = client.post("/api/ask", json={"question": QUESTION, "llm": "none"}).json()
    assert data["answer"] == rag.FRAGMENTS_ONLY
    assert data["llm"] is None and len(data["sources"]) == rag.TOP_K
    assert fake_llm == []


def test_unknown_llm_choice_rejected():
    assert client.post("/api/ask", json={"question": QUESTION, "llm": "gpt"}).status_code == 422


def test_no_information_without_llm_call(fake_llm):
    r = client.post("/api/ask", json={"question": "Какая погода в Москве?"})
    assert r.json() == {"answer": rag.NO_INFO, "sources": [], "llm": None}
    assert fake_llm == []                                  # до LLM дело не дошло


def test_llm_refusal_is_passed_to_user():
    result = rag.answer_question(QUESTION, llm_call=lambda m: "В документах нет этой информации.")
    assert result["refused"] and result["sources"] == []


def test_llm_unavailable_returns_fragments():
    def broken(messages):
        raise llm.LLMUnavailable("нет сервера")

    result = rag.answer_question(QUESTION, llm_call=broken)
    assert not result["llm_ok"] and result["sources"]


@pytest.mark.parametrize("question", ["", "x" * 501])
def test_question_length_validation(question):
    assert client.post("/api/ask", json={"question": question}).status_code == 422
