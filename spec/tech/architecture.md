# Архитектура

Ответственный: Кузнецов Н. В. (зона «Интеграция»)

## Путь запроса
```
Браузер (app/static: HTML/CSS/JS)
   │  POST /api/ask {question}
   ▼
FastAPI (app/main.py)
   └─ app/rag.py: answer_question()
        ├─ 1. предобработка вопроса + синонимы  app/search/preprocess.py, synonyms.py
        ├─ 2. поиск BM25, top-5 фрагментов      app/search/bm25.py
        ├─ 3. порог: top-1 < 5.0 → «нет информации»
        └─ 4. ответ LLM по фрагментам           app/llm.py → Ollama, запасная YandexGPT
   ▼
JSON {answer, sources} → браузер показывает ответ и источники
```

Сервер отдаёт и API, и статические файлы фронтенда — один процесс, запуск `python -m app`.
Индекс строится в памяти при старте. Подробности поиска и LLM — в [rag.md](rag.md).

## Модули
| Модуль | Назначение | Зона |
|---|---|---|
| `app/main.py` | API, раздача фронтенда | Интеграция |
| `app/rag.py` | Промпт, порог, вызов LLM, выбор источников | Интеграция |
| `app/llm.py` | Цепочка LLM: Ollama → YandexGPT → без ответа | Интеграция |
| `app/__init__.py` | Чтение `.env` | Интеграция |
| `app/static/` | Интерфейс чата | Продукт и интерфейс |
| `app/search/preprocess.py` | Токенизация, лемматизация, стоп-слова | Интеграция (код поиска) |
| `app/search/synonyms.py` | Синонимы для слов абитуриента | Интеграция (код поиска) |
| `app/search/bm25.py` | Индекс и ранжирование BM25 (своя реализация) | Интеграция (код поиска) |
| `app/search/__init__.py` | Загрузка корпуса, `Searcher` | Интеграция (код поиска) |
| `scripts/build_corpus.py` | PDF → фрагменты `data/corpus/fragments.jsonl` | Интеграция (код поиска) |
| `data/raw/`, `data/sources.csv` | Документы приёмной комиссии и их ссылки | Корпус и benchmark |
| `benchmark/queries.md`, `queries.json` | Тестовые вопросы, разметка, эталоны | Корпус и benchmark |
| `benchmark/run.py` | Подсчёт Recall@5, MRR, Accuracy, CRR | Интеграция |
| `tests/` | Автотесты (`pytest`), LLM заменена заглушкой | Интеграция |

## API
### `POST /api/ask`
Запрос:
```json
{ "question": "Какие документы нужны для поступления?", "llm": "auto" }
```
Ответ:
```json
{
  "answer": "Короткий ответ… [1]",
  "sources": [
    { "title": "Правила приёма 2026, п. 2.8", "fragment": "Текст фрагмента…", "url": "https://api.mirror.bmstu.ru/…" }
  ],
  "llm": "ollama"
}
```
- `question` — от 1 до 500 символов, иначе `422`.
- `llm` — какую модель использовать (выбирается в интерфейсе рядом с кнопкой «Найти»):
  `auto` (по умолчанию: цепочка из `LLM_PROVIDERS`, Ollama → YandexGPT), `ollama`, `yandex`,
  `none` (без модели — только найденные фрагменты). Другое значение — `422`.
  Если выбрана одна модель и она недоступна, запасная не включается — показываются фрагменты.
- В ответе `llm` — какая модель ответила (`ollama`, `yandex`) или `null`, если ответа модели нет.
- Ответа нет (сценарий С3): `answer` = «В документах нет этой информации.», `sources` пустой.
- Не ответила ни одна LLM: `answer` = «Не удалось сформировать ответ…», `sources` — найденные фрагменты.

## Проверка
- Интерфейс: пройти сценарии из [spec/product/scenarios.md](../product/scenarios.md).
- API и поиск: `pytest tests` (без LLM).
- RAG: `python benchmark/run.py` → `benchmark/results.md`.

## Стек
Python 3.11, FastAPI, uvicorn, pymorphy3 (лемматизация), pymupdf (PDF), httpx, Ollama + Qwen 3.5, YandexGPT (запасная).
Фронтенд без сборки и фреймворков.
