# Архитектура

Ответственный: Кузнецов Н. В. (зона «Интеграция»)

## Путь запроса
```
Браузер (app/static: HTML/CSS/JS)
   │  POST /api/ask {question}
   ▼
FastAPI (app/main.py)
   ├─ 1. предобработка вопроса         app/search/preprocess.py   (КТ2)
   ├─ 2. поиск BM25, top-5 фрагментов  app/search/bm25.py         (КТ2)
   ├─ 3. ответ LLM по фрагментам       app/llm.py                 (КТ2)
   ▼
JSON {answer, sources} → браузер показывает ответ и источники
```

Сервер отдаёт и API, и статические файлы фронтенда — один процесс, запуск `python -m app`.
Сейчас (КТ1) шаги 1–3 заменены заглушкой: `/api/ask` возвращает тестовый ответ.
Подробности поиска и LLM — в [rag.md](rag.md).

## Модули (план)
| Модуль | Назначение | Зона |
|---|---|---|
| `app/main.py` | API, раздача фронтенда | Интеграция |
| `app/static/` | Интерфейс чата | Продукт и интерфейс |
| `app/search/preprocess.py` | Токенизация, лемматизация, стоп-слова | Интеграция (код поиска) |
| `app/search/bm25.py` | Индекс и ранжирование BM25 (своя реализация) | Интеграция (код поиска) |
| `app/llm.py` | Вызов LLM, промпт | Интеграция |
| `scripts/build_corpus.py` | PDF → текст → фрагменты в `data/corpus/` | Интеграция (код поиска) |
| `data/raw/`, `data/sources.csv` | Документы приёмной комиссии и их ссылки | Корпус и benchmark |
| `benchmark/queries.md`, `benchmark/run.py` | Тестовые вопросы, подсчёт Recall@5 и MRR | Корпус и benchmark (скрипт — Интеграция) |

## API
### `POST /api/ask`
Запрос:
```json
{ "question": "Какие документы нужны для поступления?" }
```
Ответ:
```json
{
  "answer": "Короткий ответ…",
  "sources": [
    { "title": "Правила приёма 2026, п. 4.2", "fragment": "Текст фрагмента…", "url": "https://bmstu.ru/…" }
  ]
}
```
- `question` — от 1 до 500 символов, иначе `422`.
- Пустой `answer` и пустой `sources` — ответ не найден (сценарий С3).
- LLM недоступна — `answer` пустой, `sources` заполнен найденными фрагментами.

## Проверка
- Интерфейс: пройти сценарии из [spec/product/scenarios.md](../product/scenarios.md).
- API: тесты в `tests/` (`pytest`).
- RAG: `python benchmark/run.py` → `benchmark/results.md`.

## Стек
Python 3.11, FastAPI, uvicorn, pymorphy3 (лемматизация). Фронтенд без сборки и фреймворков.
