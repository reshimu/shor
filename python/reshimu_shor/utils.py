"""Utility primitives — stdlib only."""

from __future__ import annotations

import re

DEFAULT_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the",
        "i", "you", "he", "she", "it", "we", "they",
        "me", "him", "her", "us", "them",
        "my", "your", "his", "our", "their",
        "is", "are", "was", "were", "be",
        "have", "has", "had", "do", "did",
        "and", "or", "but", "not",
        "of", "in", "on", "at", "to", "for", "with", "by", "as",
    }
)

_SMART_QUOTE_MAP: dict[str, str] = {
    "“": '"', "”": '"',
    "‘": "'", "’": "'",
    "«": '"', "»": '"',
    "′": "'", "″": '"',
}

_WS_RE = re.compile(r"\s+")


def replace_smart_quote(c: str) -> str:
    return _SMART_QUOTE_MAP.get(c, c)


def normalize_smart_quotes(s: str) -> str:
    if not any(c in _SMART_QUOTE_MAP for c in s):
        return s
    return "".join(_SMART_QUOTE_MAP.get(c, c) for c in s)


def is_whitespace(c: str) -> bool:
    return c in (" ", "\t", "\n", "\r", "\f", "\v")


def is_letter(c: str) -> bool:
    return ("A" <= c <= "Z") or ("a" <= c <= "z")


def is_digit(c: str) -> bool:
    return "0" <= c <= "9"


def is_upper(c: str) -> bool:
    return "A" <= c <= "Z"


def is_word_char(c: str) -> bool:
    if c == "_" or c == "$":
        return True
    return is_letter(c) or is_digit(c)


def collapse_whitespace(s: str) -> str:
    return _WS_RE.sub(" ", s).strip()
