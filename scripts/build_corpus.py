"""Сборка корпуса: PDF из data/raw/ -> фрагменты в data/corpus/fragments.jsonl.

Фрагмент = пункт документа («2.8.», «1.13.»). Документы и части без пунктов
(таблицы) режутся на куски по ~150 слов. Длинные пункты тоже делятся на части.

Запуск:  python scripts/build_corpus.py
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "corpus" / "fragments.jsonl"
SOURCES = ROOT / "data" / "sources.csv"

CHUNK_WORDS = 150      # размер куска для длинных пунктов и таблиц
OVERLAP_WORDS = 30     # перекрытие соседних кусков

# Короткие коды документов для id фрагментов.
DOC_CODES = {
    "rules_2026": "rules",
    "app01_min_scores": "app01",
    "app02_spo": "app02",
    "app03_second_degree": "app03",
    "app05_olympiads": "app05",
    "app06_achievements": "app06",
    "app08_1_programs": "app08_1",
    "app08_3_target_quota": "app08_3",
    "app10_exams": "app10",
    "app11_exams_ovz": "app11",
    "app12_dormitory": "app12",
    "exam_schedule": "schedule",
}

POINT_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})\.(?:\s*(\S.*))?$")
# Строки, после которых нумерация пунктов может начаться заново («1.»).
SECTION_RE = {
    re.compile(r"^(I|II|III|IV|V|VI)\.?(\s.*)?$"): lambda m: m.group(1),
    re.compile(r"^Приложение\s+([А-Я])$"): lambda m: {"А": "A", "Б": "B", "В": "V"}.get(m.group(1), m.group(1)),
    re.compile(r"^Вниманию абитуриентов!?$", re.I): lambda m: "note",
}
# Служебные строки шапки и подписи — не нужны в поиске.
SKIP_RE = re.compile(
    r"^(Председатель|Ректор|_{3,}|«\d+»\s|«УТВЕРЖДАЮ»|к «Правилам при[её]ма|"
    r"в МГТУ им\. ?Н\. ?Э\. Баумана в 2026 г\.»|Приложение \d+(\.\d+)?$|"
    r"Заместитель председателя|проректор по|Ответственный секретарь|[А-Я]\.[А-Я]\. [А-Я][а-я]+$)"
)


def plausible_next(prev: tuple[int, ...] | None, new: tuple[int, ...]) -> bool:
    """Номер пункта похож на следующий после prev (а не на дату или код из таблицы)."""
    if prev is None:
        return new in {(1,), (1, 1)}
    if new == prev + (1,):                      # первый подпункт: 2.4 -> 2.4.1
        return True
    for depth in range(1, len(prev) + 1):       # следующий на каком-то уровне: 2.4.3 -> 2.5, 3, 3.1
        base = prev[: depth - 1]
        for step in (1, 2):                     # допускаем один пропущенный номер
            head = base + (prev[depth - 1] + step,)
            for tail in range(0, 3):
                if new == head + (1,) * tail:
                    return True
    return False


def read_lines(pdf: Path) -> list[tuple[int, str]]:
    """Строки документа с номером страницы, без шапки, подписей и номеров страниц."""
    lines = []
    with pymupdf.open(pdf) as doc:
        for page_no, page in enumerate(doc, start=1):
            page_lines = [l.strip() for l in page.get_text().splitlines()]
            page_lines = [l for l in page_lines if l]
            if page_lines and re.fullmatch(r"\d{1,2}", page_lines[0]):  # номер страницы
                page_lines = page_lines[1:]
            lines += [(page_no, l) for l in page_lines if not SKIP_RE.match(l)]
    return lines


def split_points(lines: list[tuple[int, str]]):
    """Делит строки на сегменты: (раздел, номер пункта или None, страница, текст)."""
    segments = []
    section, prev = "", None
    pending_section = None
    cur = {"section": "", "point": None, "page": lines[0][0] if lines else 1, "words": []}

    def flush():
        if cur["words"]:
            segments.append(dict(cur))

    for page, line in lines:
        for rx, name in SECTION_RE.items():
            m = rx.match(line)
            if m:
                pending_section = name(m)
                break
        m = POINT_RE.match(line)
        if m:
            num = tuple(int(x) for x in m.group(1).split("."))
            if pending_section and num == (1,):
                section, prev, pending_section = pending_section, None, None
            if plausible_next(prev, num):
                flush()
                prev, pending_section = num, None
                cur = {"section": section, "point": num, "page": page,
                       "words": (m.group(2) or "").split()}
                continue
        cur["words"] += line.split()
    flush()
    return segments


def windows(words: list[str]) -> list[list[str]]:
    if len(words) <= CHUNK_WORDS + OVERLAP_WORDS:
        return [words]
    out, start = [], 0
    while start < len(words):
        out.append(words[start : start + CHUNK_WORDS])
        if start + CHUNK_WORDS >= len(words):
            break
        start += CHUNK_WORDS - OVERLAP_WORDS
    return out


def build() -> list[dict]:
    sources = {row["file"]: row for row in csv.DictReader(SOURCES.open(encoding="utf-8"))}
    fragments = []
    for pdf in sorted(RAW.glob("*.pdf")):
        code = DOC_CODES.get(pdf.stem, pdf.stem)
        src = sources.get(pdf.name, {"title": pdf.stem, "url": ""})
        text_no = 0
        for seg in split_points(read_lines(pdf)):
            if seg["point"]:
                base = "_".join(filter(None, [code, seg["section"], *map(str, seg["point"])]))
                label = ("разд. " + seg["section"] + ", " if seg["section"] and seg["section"] != "note" else
                         "«Вниманию абитуриентов», " if seg["section"] == "note" else "")
                label += "п. " + ".".join(map(str, seg["point"]))
            for part_no, words in enumerate(windows(seg["words"]), start=1):
                if seg["point"]:
                    frag_id = base if part_no == 1 else f"{base}__{part_no}"
                    point = label
                else:
                    text_no += 1
                    frag_id = f"{code}_t{text_no:02d}"
                    point = "текст/таблица"
                fragments.append({
                    "id": frag_id,
                    "doc": code,
                    "title": src["title"],
                    "point": point,
                    "page": seg["page"],
                    "url": src["url"],
                    "text": " ".join(words),
                })
    return fragments


def main() -> None:
    fragments = build()
    ids = [f["id"] for f in fragments]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"Повторяющиеся id фрагментов: {sorted(dupes)[:10]}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        for frag in fragments:
            f.write(json.dumps(frag, ensure_ascii=False) + "\n")
    by_doc = {}
    for frag in fragments:
        by_doc[frag["doc"]] = by_doc.get(frag["doc"], 0) + 1
    print(f"{OUT.relative_to(ROOT)}: {len(fragments)} фрагментов")
    for doc, n in by_doc.items():
        print(f"  {doc}: {n}")


if __name__ == "__main__":
    main()
