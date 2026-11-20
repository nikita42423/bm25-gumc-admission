"""Поисковый индекс и ранжирование BM25 — своя реализация (методичка НИРС, раздел 2).

IDF(t)   = ln(1 + (N - DF(t) + 0.5) / (DF(t) + 0.5))
BM25(q,d) = sum_{t in q} IDF(t) * TF(t,d)*(k1+1) / (TF(t,d) + k1*(1 - b + b*|d|/avgdl))
"""
from __future__ import annotations

from collections import Counter, defaultdict
from math import log
from typing import Callable, Iterable


class BM25Index:
    def __init__(self, docs: dict[str, str], analyzer: Callable[[str], list[str]],
                 k1: float = 1.5, b: float = 0.75,
                 query_analyzer: Callable[[str], list[str]] | None = None):
        """docs: {id документа: текст}; analyzer: текст -> термы;
        query_analyzer: вопрос -> термы (по умолчанию тот же analyzer)."""
        self.analyzer = query_analyzer or analyzer
        self.k1, self.b = k1, b
        self.index: dict[str, dict[str, int]] = defaultdict(dict)   # терм -> {doc: TF}
        self.lengths: dict[str, int] = {}
        for doc_id, text in docs.items():
            terms = analyzer(text)                                   # документы — без синонимов
            self.lengths[doc_id] = len(terms)
            for term, tf in Counter(terms).items():
                self.index[term][doc_id] = tf
        self.N = len(docs)
        self.avgdl = (sum(self.lengths.values()) / self.N) if self.N else 0.0

    def idf(self, term: str) -> float:
        df = len(self.index.get(term, {}))
        return log(1 + (self.N - df + 0.5) / (df + 0.5))

    def scores(self, query: str) -> dict[str, float]:
        """Баллы BM25 для всех документов, где есть хотя бы один терм запроса."""
        scores: dict[str, float] = defaultdict(float)
        for term in dict.fromkeys(self.analyzer(query)):      # каждый терм один раз
            postings = self.index.get(term, {})
            if not postings:
                continue
            idf = self.idf(term)
            for doc_id, tf in postings.items():
                norm = self.k1 * (1 - self.b + self.b * self.lengths[doc_id] / self.avgdl)
                scores[doc_id] += idf * tf * (self.k1 + 1) / (tf + norm)
        return scores

    def search(self, query: str, k: int = 5) -> list[tuple[str, float]]:
        """Top-k (id, балл) по убыванию балла; равные баллы — по id."""
        scores = self.scores(query)
        ranked = sorted(scores, key=lambda d: (-scores[d], d))
        return [(d, scores[d]) for d in ranked[:k]]

    def explain(self, query: str, doc_id: str) -> dict[str, float]:
        """Вклад каждого терма запроса в балл документа (для разбора ошибок)."""
        out = {}
        for term in dict.fromkeys(self.analyzer(query)):
            tf = self.index.get(term, {}).get(doc_id, 0)
            if tf:
                norm = self.k1 * (1 - self.b + self.b * self.lengths[doc_id] / self.avgdl)
                out[term] = self.idf(term) * tf * (self.k1 + 1) / (tf + norm)
        return out


def make_index(fragments: Iterable[dict], analyzer, with_titles: bool = True, **params) -> BM25Index:
    """Индекс по фрагментам; with_titles — добавить название документа к тексту фрагмента."""
    docs = {f["id"]: (f"{f['title']}. {f['text']}" if with_titles else f["text"]) for f in fragments}
    return BM25Index(docs, analyzer, **params)
