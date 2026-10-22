"""Веб-приложение «Помощник абитуриента ГУИМЦ».

Пока /api/ask возвращает заглушку: поиск BM25 и LLM подключим на следующем этапе.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Помощник абитуриента ГУИМЦ")


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class Source(BaseModel):
    title: str
    fragment: str
    url: str


class AskResponse(BaseModel):
    answer: str
    sources: list[Source]


@app.post("/api/ask", response_model=AskResponse)
def ask(req: AskRequest) -> AskResponse:
    # TODO: заменить на поиск BM25 по документам + ответ LLM.
    return AskResponse(
        answer=(
            "Это тестовый ответ. Документы для поступления подаются в приёмную "
            "комиссию лично или через Госуслуги."
        ),
        sources=[
            Source(
                title="Правила приёма ГУИМЦ, раздел 4",
                fragment=(
                    "Поступающий представляет документы для поступления лично "
                    "в приёмную комиссию либо через суперсервис «Госуслуги»."
                ),
                url="#",
            ),
        ],
    )


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
