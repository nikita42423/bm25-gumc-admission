"""Запуск: python -m app  ->  http://localhost:8000 (порт можно задать переменной PORT)"""
import os

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, reload=True)
