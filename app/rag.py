"""RAG: вопрос -> поиск BM25 -> контекст -> LLM -> ответ с источниками или отказ."""
from __future__ import annotations

import re
from typing import Callable

from . import llm
from .search import TOP_K, get_searcher

NO_INFO = "В документах нет этой информации."
# Если лучший фрагмент набрал меньше — считаем, что ответа в документах нет.
# Порог низкий намеренно: короткий правильный вопрос («Какие документы нужны для поступления?»)
# набирает ~7.5, а вопросы совсем не по теме (погода, день открытых дверей) — < 5.
# Пограничные случаи (Wi-Fi, деканат) отсекает сама LLM — отвечает NO_INFO.
MIN_SCORE = 5.0

SYSTEM_PROMPT = f"""Ты помощник приёмной комиссии МГТУ им. Н. Э. Баумана. Тебе пишут абитуриенты \
с нарушениями слуха и их родители.
Отвечай ТОЛЬКО по фрагментам документов из сообщения пользователя. Не используй другие знания.
Пиши по-русски, коротко (2–5 предложений), простыми словами.
После каждого утверждения укажи номер фрагмента в квадратных скобках, например [2].
Если во фрагментах нет ответа на вопрос, ответь ровно одной фразой: «{NO_INFO}»
Не придумывай сроки, баллы, адреса и названия документов."""


def build_context(hits: list[dict]) -> str:
    return "\n\n".join(
        f"[{n}] {h['title']}, {h['point']}:\n{h['text']}" for n, h in enumerate(hits, start=1)
    )


def build_messages(question: str, context: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Фрагменты документов:\n\n{context}\n\nВопрос: {question}"},
    ]


def is_refusal(answer: str) -> bool:
    return "нет этой информации" in answer.lower() or "нет информации" in answer.lower()


def source_title(hit: dict) -> str:
    where = hit["point"] if hit["point"] != "текст/таблица" else f"стр. {hit['page']}"
    return f"{hit['title']}, {where}"


# Выбор модели в интерфейсе → порядок попыток. auto — цепочка из .env (LLM_PROVIDERS).
LLM_CHOICES = {"auto": None, "ollama": ["ollama"], "yandex": ["yandex"], "none": []}

UNAVAILABLE = ("Не удалось сформировать ответ: языковая модель сейчас недоступна. "
               "Ниже — фрагменты документов, где, скорее всего, есть ответ.")
FRAGMENTS_ONLY = "Ответ модели выключен. Ниже — фрагменты документов, где, скорее всего, есть ответ."


def answer_question(question: str, k: int = TOP_K,
                    llm_call: Callable[[list[dict]], str] | None = None,
                    llm_choice: str = "auto") -> dict:
    """Ответ для API и benchmark.

    llm_choice — auto / ollama / yandex / none (см. LLM_CHOICES); llm_call — замена LLM в тестах.
    Возвращает: answer, sources (показываются пользователю), hits (все найденные top-k),
    refused (True — система сообщила, что сведений нет), llm_ok (False — LLM недоступна),
    llm (какая модель ответила или None).
    """
    hits = get_searcher().retrieve(question, k)

    def result(answer, sources, refused=False, llm_ok=True, provider=None):
        return {"answer": answer, "sources": sources, "hits": hits,
                "refused": refused, "llm_ok": llm_ok, "llm": provider}

    if not hits or hits[0]["score"] < MIN_SCORE:
        return result(NO_INFO, [], refused=True)

    providers = LLM_CHOICES[llm_choice]
    if providers == []:
        return result(FRAGMENTS_ONLY, hits)

    messages = build_messages(question, build_context(hits))
    try:
        if llm_call:
            reply, provider = llm_call(messages), None
        else:
            reply, provider = llm.chat_with_provider(messages, providers)
    except llm.LLMUnavailable:
        return result(UNAVAILABLE, hits, llm_ok=False)

    if is_refusal(reply):
        return result(NO_INFO, [], refused=True, provider=provider)

    cited = sorted({int(n) for n in re.findall(r"\[(\d+)\]", reply) if 1 <= int(n) <= len(hits)})
    sources = [hits[n - 1] for n in cited] or hits
    return result(reply, sources, provider=provider)
