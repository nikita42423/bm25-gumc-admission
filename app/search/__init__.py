"""Поиск по корпусу документов приёмной комиссии."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .bm25 import BM25Index, make_index
from .preprocess import preprocess
from .synonyms import expand

CORPUS = Path(__file__).resolve().parents[2] / "data" / "corpus" / "fragments.jsonl"

# Параметры подобраны на benchmark (см. benchmark/results.md).
K1, B = 1.5, 0.75
TOP_K = 5


def load_fragments(path: Path = CORPUS) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(f"Нет корпуса {path}. Запустите: python scripts/build_corpus.py")
    return [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]


class Searcher:
    def __init__(self, fragments: list[dict], k1: float = K1, b: float = B,
                 lemmatize: bool = True, synonyms: bool = True, titles: bool = True):
        self.fragments = {f["id"]: f for f in fragments}

        def doc_terms(text: str) -> list[str]:
            return preprocess(text, lemmatize=lemmatize)

        def query_terms(text: str) -> list[str]:
            terms = preprocess(text, lemmatize=lemmatize)
            return expand(terms) if synonyms and lemmatize else terms

        self.index: BM25Index = make_index(fragments, doc_terms, with_titles=titles,
                                           k1=k1, b=b, query_analyzer=query_terms)

    def retrieve(self, question: str, k: int = TOP_K) -> list[dict]:
        """Top-k фрагментов с баллом BM25."""
        return [{**self.fragments[i], "score": round(s, 3)} for i, s in self.index.search(question, k)]


@lru_cache(maxsize=1)
def get_searcher() -> Searcher:
    return Searcher(load_fragments())
