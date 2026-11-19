"""Предобработка текста: одинаковая для фрагментов и для вопросов.

1. нижний регистр, «ё» -> «е»;
2. токенизация: токен — слово или число;
3. лемматизация pymorphy3 («документов» -> «документ»);
4. удаление стоп-слов.
"""
from __future__ import annotations

import re
from functools import lru_cache

import pymorphy3

TOKEN_RE = re.compile(r"[а-яa-z0-9]+")

# Служебные слова и слова, которые есть почти в каждом фрагменте.
STOP_WORDS = frozenset("""
а без более бы был быть в вам вас весь во вот все всё всех вы где да даже для до его ее её если есть еще ещё же за и из или им их к как какой
когда кто ли либо мне может мой мы на над надо наш не него нее неё нет ни них но ну о об однако он она они оно от по под при про с
со так также такой там те тем то того тоже только том тот ту у уже хотя чего чей чем что чтобы эта эти это этот я
нужно можно ли свой который этот весь мочь
""".split())


@lru_cache(maxsize=1)
def _morph() -> pymorphy3.MorphAnalyzer:
    return pymorphy3.MorphAnalyzer()


@lru_cache(maxsize=200_000)
def lemma(word: str) -> str:
    if not word.isalpha():
        return word          # числа оставляем как есть
    return _morph().parse(word)[0].normal_form.replace("ё", "е")


def tokenize(text: str) -> list[str]:
    """Только токенизация, без лемматизации и стоп-слов."""
    return TOKEN_RE.findall(text.lower().replace("ё", "е"))


def preprocess(text: str, lemmatize: bool = True) -> list[str]:
    """Текст -> список термов для индекса и запроса."""
    terms = []
    for tok in tokenize(text):
        term = lemma(tok) if lemmatize else tok
        if term not in STOP_WORDS and tok not in STOP_WORDS:
            terms.append(term)
    return terms
