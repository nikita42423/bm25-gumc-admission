"""BM25 на примере из занятия 3: три документа, вопрос «Как происходит возврат оплаты?»."""
from math import isclose, log

from app.search.bm25 import BM25Index
from app.search.preprocess import tokenize

DOCS = {
    "A": "Возврат оплаты на карту.",
    "B": "Статус оплаты в приложении.",
    "C": "Возврат билета через кассу.",
}
QUERY = "Как происходит возврат оплаты?"


def make(**kw):
    return BM25Index(DOCS, tokenize, k1=1.2, b=0.75, **kw)


def test_index_stats():
    idx = make()
    assert idx.N == 3
    assert idx.avgdl == 4
    assert idx.index["возврат"] == {"A": 1, "C": 1}
    assert idx.index["оплаты"] == {"A": 1, "B": 1}


def test_idf_matches_formula():
    idx = make()
    assert isclose(idx.idf("возврат"), log(1 + (3 - 2 + 0.5) / (2 + 0.5)), rel_tol=1e-9)
    assert round(idx.idf("возврат"), 3) == 0.470


def test_scores_from_lecture():
    scores = make().scores(QUERY)
    assert round(scores["A"], 3) == 0.940
    assert round(scores["B"], 3) == 0.470
    assert round(scores["C"], 3) == 0.470


def test_ranking_ties_by_id_and_top_k():
    assert [d for d, _ in make().search(QUERY, k=2)] == ["A", "B"]


def test_words_without_match_add_nothing():
    idx = make()
    assert idx.explain(QUERY, "A").keys() == {"возврат", "оплаты"}
    assert idx.scores("погода Москва") == {}


def test_longer_document_scores_lower():
    idx = BM25Index({"short": "возврат оплаты", "long": "возврат оплаты " + "слово " * 20}, tokenize)
    s = idx.scores("возврат")
    assert s["short"] > s["long"]
