"""Веб-приложение «Помощник абитуриента ГУИМЦ».

POST /api/ask: вопрос -> поиск BM25 по документам приёмной комиссии -> ответ LLM с источниками.
"""
from pathlib import Path

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .rag import answer_question, source_title
from .search import get_searcher

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


@app.on_event("startup")
def build_index() -> None:
    get_searcher()          # строим индекс BM25 при старте, а не на первом вопросе


@app.post("/api/ask", response_model=AskResponse)
async def ask(req: AskRequest) -> AskResponse:
    result = await run_in_threadpool(answer_question, req.question.strip())
    return AskResponse(
        answer=result["answer"],
        sources=[
            Source(title=source_title(h), fragment=h["text"], url=h["url"] or "#")
            for h in result["sources"]
        ],
    )


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
