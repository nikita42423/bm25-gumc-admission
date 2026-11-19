"""Benchmark поиска и ответов.

  python benchmark/run.py             поиск: Recall@5 и MRR@5 по обычным вопросам
  python benchmark/run.py --compare   то же для разных настроек (лемматизация, k1, b)
  python benchmark/run.py --answers   + ответы LLM на все вопросы: Accuracy и Correct Rejection Rate

Результаты: benchmark/results.md (таблицы) и benchmark/results.json (выдача и ответы по каждому вопросу).
Accuracy берётся из ручной разметки benchmark/answer_review.csv (колонки id,correct; correct = 1 или 0).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.search import B, K1, TOP_K, Searcher, load_fragments  # noqa: E402

QUERIES = ROOT / "benchmark" / "queries.json"
REVIEW = ROOT / "benchmark" / "answer_review.csv"
RESULTS_MD = ROOT / "benchmark" / "results.md"
RESULTS_JSON = ROOT / "benchmark" / "results.json"


def unit_ids(unit, all_ids: list[str]) -> set[str]:
    """Релевантная единица -> id фрагментов. Единица — пункт («rules_2_8» + его части «__2»…)
    или список таких пунктов (кусок таблицы на нескольких фрагментах)."""
    prefixes = unit if isinstance(unit, list) else [unit]
    return {i for i in all_ids for p in prefixes if i == p or i.startswith(p + "__")}


def evaluate_search(searcher: Searcher, queries: list[dict], k: int = TOP_K) -> dict:
    all_ids = list(searcher.fragments)
    per_q, recalls, rrs, ceiling = [], [], [], []
    for q in (q for q in queries if q["type"] == "regular"):
        units = [unit_ids(u, all_ids) for u in q["relevant"]]
        missing = [u for u, ids in zip(q["relevant"], units) if not ids]
        if missing:
            raise SystemExit(f"{q['id']}: нет фрагментов для {missing} — пересоберите корпус или поправьте queries.json")
        top = [h["id"] for h in searcher.retrieve(q["question"], k)]
        found = [any(i in ids for i in top) for ids in units]
        rank = next((r for r, i in enumerate(top, 1) if any(i in ids for ids in units)), None)
        recalls.append(sum(found) / len(units))
        ceiling.append(min(k, len(units)) / len(units))
        rrs.append(1 / rank if rank else 0.0)
        per_q.append({"id": q["id"], "question": q["question"], "top": top,
                      "found": f"{sum(found)}/{len(units)}", "rank": rank,
                      "missed": [u for u, f in zip(q["relevant"], found) if not f]})
    n = len(per_q)
    return {"recall": sum(recalls) / n, "mrr": sum(rrs) / n, "n": n,
            "recall_ceiling": sum(ceiling) / n, "per_query": per_q}


VARIANTS = [  # добавляем по одному улучшению
    ("Без лемматизации (слова как есть)", dict(lemmatize=False, titles=False, synonyms=False)),
    ("+ лемматизация", dict(lemmatize=True, titles=False, synonyms=False)),
    ("+ название документа в индексе", dict(lemmatize=True, titles=True, synonyms=False)),
    ("+ синонимы в вопросе (итоговый вариант)", dict(lemmatize=True, titles=True, synonyms=True)),
]


def compare(fragments, queries) -> list[dict]:
    rows = []
    for name, opts in VARIANTS:
        res = evaluate_search(Searcher(fragments, **opts), queries)
        rows.append({"name": name, "k1": K1, "b": B, "recall": res["recall"], "mrr": res["mrr"]})
    for k1 in (1.2, 1.5, 2.0):
        for b in (0.5, 0.75, 0.9):
            res = evaluate_search(Searcher(fragments, k1=k1, b=b), queries)
            rows.append({"name": "итоговый, подбор k1 и b", "k1": k1, "b": b,
                         "recall": res["recall"], "mrr": res["mrr"]})
    return rows


def run_answers(queries) -> list[dict]:
    from app.rag import answer_question
    out = []
    for q in queries:
        t = time.time()
        r = answer_question(q["question"])
        out.append({"id": q["id"], "type": q["type"], "question": q["question"],
                    "reference": q.get("reference", ""), "answer": r["answer"],
                    "refused": r["refused"], "llm_ok": r["llm_ok"],
                    "sources": [h["id"] for h in r["sources"]], "seconds": round(time.time() - t, 1)})
        print(f"  {q['id']} ({out[-1]['seconds']} с): {r['answer'][:80]}")
    return out


def read_review() -> dict[str, bool]:
    if not REVIEW.exists():
        return {}
    with REVIEW.open(encoding="utf-8") as f:
        return {row["id"]: row["correct"].strip() == "1" for row in csv.DictReader(f) if row.get("correct", "").strip()}


def write_report(search: dict, rows: list[dict] | None, answers: list[dict] | None) -> None:
    md = ["# Результаты benchmark", "",
          f"Запуск: `python benchmark/run.py{' --compare' if rows else ''}{' --answers' if answers else ''}`. "
          f"Корпус: {search['corpus']} фрагментов. Параметры поиска: k1 = {K1}, b = {B}, "
          f"лемматизация — да, k = {TOP_K}.", "",
          "## Поиск (обычные вопросы)", "",
          "| Метрика | Значение |", "|---|---|",
          f"| Recall@{TOP_K} | {search['recall']:.3f} |",
          f"| MRR@{TOP_K} | {search['mrr']:.3f} |",
          f"| Вопросов | {search['n']} |",
          f"| Потолок Recall@{TOP_K} | {search['recall_ceiling']:.3f} |", "",
          f"Потолок — максимум Recall@{TOP_K} при идеальном поиске: у многих вопросов больше "
          f"{TOP_K} релевантных пунктов, а в выдаче только {TOP_K} мест.", ""]
    if answers:
        traps = [a for a in answers if a["type"] == "trap"]
        regular = [a for a in answers if a["type"] == "regular"]
        review = read_review()
        marked = [a for a in regular if a["id"] in review]
        crr = (sum(a["refused"] for a in traps) / len(traps)) if traps else None
        acc = (sum(review[a["id"]] for a in marked) / len(marked)) if marked else None
        md += ["## Ответы", "", "| Метрика | Значение |", "|---|---|",
               f"| Accuracy | {acc:.3f} (размечено {len(marked)} из {len(regular)}) |" if acc is not None
               else f"| Accuracy | не размечено — заполните `benchmark/answer_review.csv` |",
               f"| Correct Rejection Rate | {crr:.3f} ({sum(a['refused'] for a in traps)} из {len(traps)}) |" if crr is not None
               else "| Correct Rejection Rate | нет вопросов-ловушек в queries.json |",
               f"| Ложные отказы на обычных вопросах | {sum(a['refused'] for a in regular)} из {len(regular)} |", ""]
    if rows:
        md += ["## Сравнение настроек поиска", "", "Меняем по одной настройке; корпус, вопросы и k те же.", "",
               "| Вариант | k1 | b | Recall@5 | MRR@5 |", "|---|---|---|---|---|"]
        for r in rows:
            mark = " **← используется**" if (r["name"].startswith("итоговый") and r["k1"] == K1 and r["b"] == B) else ""
            md.append(f"| {r['name']} | {r['k1']} | {r['b']} | {r['recall']:.3f} | {r['mrr']:.3f}{mark} |")
        md.append("")
    md += ["## По вопросам", "", "| # | Найдено | Ранг первого | Не найдены |", "|---|---|---|---|"]
    for q in search["per_query"]:
        missed = ", ".join(m if isinstance(m, str) else "/".join(m) for m in q["missed"]) or "—"
        md.append(f"| {q['id']} | {q['found']} | {q['rank'] or '—'} | {missed} |")
    md.append("")
    if answers:
        md += ["## Ответы по вопросам", "", "| # | Тип | Отказ | Ответ системы |", "|---|---|---|---|"]
        for a in answers:
            text = a["answer"].replace("\n", " ").replace("|", "/")
            md.append(f"| {a['id']} | {'ловушка' if a['type'] == 'trap' else 'обычный'} | "
                      f"{'да' if a['refused'] else 'нет'} | {text} |")
        md.append("")
    RESULTS_MD.write_text("\n".join(md), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--compare", action="store_true", help="сравнить настройки поиска")
    ap.add_argument("--answers", action="store_true", help="прогнать ответы LLM")
    args = ap.parse_args()

    queries = json.loads(QUERIES.read_text(encoding="utf-8"))
    fragments = load_fragments()
    search = evaluate_search(Searcher(fragments), queries)
    search["corpus"] = len(fragments)
    print(f"Recall@{TOP_K} = {search['recall']:.3f}   MRR@{TOP_K} = {search['mrr']:.3f}   ({search['n']} вопросов)")

    rows = compare(fragments, queries) if args.compare else None
    answers = None
    if args.answers:
        print("Ответы LLM:")
        answers = run_answers(queries)

    write_report(search, rows, answers)
    RESULTS_JSON.write_text(json.dumps({"search": search, "compare": rows, "answers": answers},
                                       ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Сохранено: {RESULTS_MD.relative_to(ROOT)}, {RESULTS_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
