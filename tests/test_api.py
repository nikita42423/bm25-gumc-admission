"""API /api/ask: LLM заменена заглушкой, чтобы тесты не зависели от Ollama."""
import pytest
from fastapi.testclient import TestClient

from app import llm, rag
from app.main import app

client = TestClient(app)


@pytest.fixture
def fake_llm(monkeypatch):
    calls = []

    def fake_chat(messages, model=None):
        calls.append(messages)
        return "Нужно подать заявление и документы [1]."

    monkeypatch.setattr(llm, "chat", fake_chat)
    return calls


def test_answer_with_cited_source(fake_llm):
    r = client.post("/api/ask", json={"question": "Какие документы нужны для поступления?"})
    assert r.status_code == 200
    data = r.json()
    assert data["answer"].startswith("Нужно подать")
    assert len(data["sources"]) == 1                      # только процитированный [1]
    assert data["sources"][0]["title"] and data["sources"][0]["fragment"]
    context = fake_llm[0][1]["content"]
    assert "[1]" in context and "Вопрос: Какие документы" in context


def test_no_information_without_llm_call(fake_llm):
    r = client.post("/api/ask", json={"question": "Какая погода в Москве?"})
    assert r.json() == {"answer": rag.NO_INFO, "sources": []}
    assert fake_llm == []                                  # до LLM дело не дошло


def test_llm_refusal_is_passed_to_user():
    result = rag.answer_question("Какие документы нужны для поступления?",
                                 llm_call=lambda m: "В документах нет этой информации.")
    assert result["refused"] and result["sources"] == []


def test_llm_unavailable_returns_fragments():
    def broken(messages):
        raise llm.LLMUnavailable("нет сервера")

    result = rag.answer_question("Какие документы нужны для поступления?", llm_call=broken)
    assert not result["llm_ok"] and result["sources"]


@pytest.mark.parametrize("question", ["", "x" * 501])
def test_question_length_validation(question):
    assert client.post("/api/ask", json={"question": question}).status_code == 422
