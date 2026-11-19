"""Предобработка, корпус и связь benchmark с корпусом."""
import json
from pathlib import Path

from app.search import get_searcher, load_fragments
from app.search.preprocess import preprocess
from app.search.synonyms import expand

ROOT = Path(__file__).resolve().parent.parent


def test_preprocess_lemmas_and_stop_words():
    assert preprocess("Какие документы нужны для поступления?") == ["документ", "нужный", "поступление"]
    assert preprocess("Ёлка") == ["елка"]


def test_synonyms_bridge_user_words():
    assert "дистанционный" in expand(preprocess("экзамен из дома"))


def test_corpus_ids_unique_and_key_points_present():
    ids = [f["id"] for f in load_fragments()]
    assert len(ids) == len(set(ids))
    for must in ("rules_2_8", "rules_3_9", "app11_5", "app11_A_2", "schedule_II_1", "app06_note_2"):
        assert must in ids


def test_benchmark_references_exist_in_corpus():
    ids = set(f["id"] for f in load_fragments())
    queries = json.loads((ROOT / "benchmark" / "queries.json").read_text(encoding="utf-8"))
    for q in queries:
        for unit in q["relevant"]:
            prefixes = unit if isinstance(unit, list) else [unit]
            assert any(i == p or i.startswith(p + "__") for p in prefixes for i in ids), (q["id"], unit)


def test_search_finds_ovz_appendix_for_sign_language_question():
    top = [h["id"] for h in get_searcher().retrieve("Будет ли на экзамене сурдопереводчик?")]
    assert any(i.startswith("app11_") for i in top)
