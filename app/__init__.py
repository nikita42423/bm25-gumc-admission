"""Помощник абитуриента ГУИМЦ."""
import os
from pathlib import Path

# Простое чтение .env (KEY=VALUE), чтобы не тянуть лишнюю зависимость.
_env = Path(__file__).resolve().parent.parent / ".env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _key, _value = _line.split("=", 1)
            os.environ.setdefault(_key.strip(), _value.strip())
