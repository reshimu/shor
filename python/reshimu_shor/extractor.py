"""Entity extraction."""

from __future__ import annotations

import re
from collections.abc import Iterable

from .types import EntityType, RawEntity
from .utils import is_word_char

_PRIORITY: dict[EntityType, int] = {
    "url": 7,
    "quoted_string": 6,
    "citation": 5,
    "identifier": 4,
    "date": 3,
    "number": 2,
    "proper_noun": 1,
}

_CITATION_PHRASES: tuple[str, ...] = (
    "according to",
    "per the",
    "as stated in",
    "from the",
    "the report says",
    "the document mentions",
    "they said",
    "you said",
)

_KNOWN_TLDS: frozenset[str] = frozenset(
    {
        "com", "org", "net", "io", "ai", "dev", "app", "co", "gov", "edu",
        "info", "me", "us", "uk", "de", "fr", "jp", "cn", "ru", "br", "in",
        "tech", "so", "xyz", "site", "cloud", "page",
    }
)


def extract(output: str, stopwords: Iterable[str]) -> list[RawEntity]:
    if not output:
        return []
    sw: frozenset[str] = stopwords if isinstance(stopwords, frozenset) else frozenset(stopwords)

    candidates: list[tuple[RawEntity, int]] = []

    def push(items: Iterable[RawEntity]) -> None:
        for e in items:
            candidates.append((e, _PRIORITY[e.type]))

    push(_scan_urls(output))
    push(_scan_quoted_strings(output))
    push(_scan_citations(output))
    push(_scan_identifiers(output))
    push(_scan_dates(output))
    push(_scan_numbers(output))
    push(_scan_proper_nouns(output, sw))

    _apply_date_number_tiebreaker(candidates, output)
    return _resolve_overlaps(candidates)


# ───────────────────────────────────────────────────────────────────────────
# Scanners
# ───────────────────────────────────────────────────────────────────────────


_TRAILING_PUNCT = re.compile(r"[.,;:!?)\]]")
_PROTO_URL = re.compile(r"https?://[^\s<>\"'`)\]]+", re.IGNORECASE)
_BARE_URL = re.compile(
    r"\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:/[^\s<>\"'`)\]]*)?",
    re.IGNORECASE,
)


def _scan_urls(s: str) -> list[RawEntity]:
    out: list[RawEntity] = []
    for m in _PROTO_URL.finditer(s):
        start, end = m.start(), m.end()
        while end > start and _TRAILING_PUNCT.match(s[end - 1]):
            end -= 1
        out.append(RawEntity(text=s[start:end], type="url", start=start, end=end))

    for m in _BARE_URL.finditer(s):
        start, end = m.start(), m.end()
        while end > start and _TRAILING_PUNCT.match(s[end - 1]):
            end -= 1
        text = s[start:end]
        has_path = "/" in text
        first_segment = text.split("/")[0]
        tld = first_segment.split(".")[-1].lower()
        if not has_path and tld not in _KNOWN_TLDS:
            continue
        if any(u.start <= start and u.end >= end for u in out):
            continue
        out.append(RawEntity(text=text, type="url", start=start, end=end))
    return out


def _scan_quoted_strings(s: str) -> list[RawEntity]:
    out: list[RawEntity] = []
    openers = {'"': '"', "'": "'", "`": "`"}
    i = 0
    while i < len(s):
        c = s[i]
        if c not in openers:
            i += 1
            continue
        # Apostrophe-in-contraction guard for single quotes.
        if c == "'" and i > 0 and is_word_char(s[i - 1]):
            i += 1
            continue
        close = openers[c]
        j = i + 1
        while j < len(s):
            if s[j] == "\\" and j + 1 < len(s):
                j += 2
                continue
            if s[j] == close:
                if (
                    c == "'"
                    and j > 0
                    and j + 1 < len(s)
                    and is_word_char(s[j - 1])
                    and is_word_char(s[j + 1])
                ):
                    j += 1
                    continue
                break
            j += 1
        start = i
        end = j + 1 if j < len(s) else len(s)
        if end - start > 2:
            out.append(RawEntity(text=s[start:end], type="quoted_string", start=start, end=end))
        i = end
    return out


_WS_CHAR_RE = re.compile(r"\s")
_WORD_BEFORE = re.compile(r"\w", re.ASCII)


def _scan_citations(s: str) -> list[RawEntity]:
    out: list[RawEntity] = []
    lower = s.lower()
    for phrase in _CITATION_PHRASES:
        from_idx = 0
        while from_idx < len(lower):
            idx = lower.find(phrase, from_idx)
            if idx == -1:
                break
            before = s[idx - 1] if idx > 0 else ""
            if before and _WORD_BEFORE.match(before):
                from_idx = idx + 1
                continue

            t = idx + len(phrase)
            while t < len(s) and _WS_CHAR_RE.match(s[t]):
                t += 1

            tokens = 0
            in_word = False
            end_idx = t
            while end_idx < len(s):
                if _is_citation_stop(s, end_idx):
                    break
                ch = s[end_idx]
                is_sp = bool(_WS_CHAR_RE.match(ch))
                if not is_sp and not in_word:
                    tokens += 1
                    if tokens > 6:
                        break
                    in_word = True
                elif is_sp and in_word:
                    in_word = False
                end_idx += 1

            while end_idx > t and _WS_CHAR_RE.match(s[end_idx - 1]):
                end_idx -= 1

            if end_idx > t:
                out.append(
                    RawEntity(text=s[t:end_idx], type="citation", start=t, end=end_idx)
                )
            from_idx = idx + len(phrase)
    return out


def _is_citation_stop(s: str, idx: int) -> bool:
    ch = s[idx]
    if ch in (",", ";", "!", "?", "\n"):
        return True
    if ch == ".":
        prev = s[idx - 1] if idx > 0 else ""
        nxt = s[idx + 1] if idx + 1 < len(s) else ""
        is_decimal = (
            prev != "" and "0" <= prev <= "9" and nxt != "" and "0" <= nxt <= "9"
        )
        return not is_decimal
    return False


_IDENT_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Brace interpolation
    re.compile(r"\$\{[^}]+\}|\{[a-zA-Z_$][\w$.]*\}", re.ASCII),
    # Dotted access (with optional call)
    re.compile(r"\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+(?:\([^)]*\))?", re.ASCII),
    # Generic types
    re.compile(r"\b[A-Z][a-zA-Z0-9_$]*<[^<>]+>", re.ASCII),
    # Bracketed access
    re.compile(
        r"\b[a-zA-Z_$][\w$]*(?:\[[^\]]+\])+(?:\.[a-zA-Z_$][\w$]*)*", re.ASCII
    ),
    # Function call
    re.compile(r"\b[a-zA-Z_$][\w$]*\([^)]*\)", re.ASCII),
    # snake_case
    re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b", re.ASCII),
    # camelCase
    re.compile(r"\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+\b", re.ASCII),
)
_IDENT_PATH = re.compile(
    r"(?:\.{1,2}/|/)[a-zA-Z0-9_\-./]+|\b[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_\-./]+)+",
    re.ASCII,
)
_NUM_SLASH = re.compile(r"^\d+/\d+$")


def _scan_identifiers(s: str) -> list[RawEntity]:
    out: list[RawEntity] = []
    for pat in _IDENT_PATTERNS:
        for m in pat.finditer(s):
            out.append(
                RawEntity(text=m.group(0), type="identifier", start=m.start(), end=m.end())
            )
    for m in _IDENT_PATH.finditer(s):
        text = m.group(0)
        if _NUM_SLASH.match(text):
            continue
        out.append(RawEntity(text=text, type="identifier", start=m.start(), end=m.end()))
    return [e for e in out if e.end - e.start >= 2]


_DATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
    re.compile(r"\b\d{4}-Q[1-4]\b"),
    re.compile(r"\bQ[1-4](?:\s+\d{4})?\b"),
    re.compile(r"\bFY\d{2,4}\b"),
    re.compile(
        r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b"),
    re.compile(
        r"\b\d+\s+(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?)(?:\s+ago)?\b",
        re.IGNORECASE,
    ),
)


def _scan_dates(s: str) -> list[RawEntity]:
    out: list[RawEntity] = []
    for pat in _DATE_PATTERNS:
        for m in pat.finditer(s):
            out.append(RawEntity(text=m.group(0), type="date", start=m.start(), end=m.end()))
    return out


_NUM_CURRENCY = re.compile(r"[$€£¥]\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?[KkMmBbTt]?")
_NUM_PERCENT = re.compile(r"[+-]?\d+(?:\.\d+)?%")
_NUM_SUFFIX = re.compile(r"\b\d+(?:\.\d+)?[KkMmBbTt]\b")
_NUM_WITH_UNIT = re.compile(
    r"[+-]?\d+(?:,\d{3})*(?:\.\d+)?\s+[a-zA-Z]{2,}\b", re.ASCII
)
_NUM_PLAIN = re.compile(r"[+-]?\d+(?:,\d{3})*(?:\.\d+)?")


def _scan_numbers(s: str) -> list[RawEntity]:
    out: list[RawEntity] = []
    for m in _NUM_CURRENCY.finditer(s):
        out.append(RawEntity(text=m.group(0), type="number", start=m.start(), end=m.end()))
    for m in _NUM_PERCENT.finditer(s):
        out.append(RawEntity(text=m.group(0), type="number", start=m.start(), end=m.end()))
    for m in _NUM_SUFFIX.finditer(s):
        out.append(RawEntity(text=m.group(0), type="number", start=m.start(), end=m.end()))
    for m in _NUM_WITH_UNIT.finditer(s):
        out.append(RawEntity(text=m.group(0), type="number", start=m.start(), end=m.end()))
    for m in _NUM_PLAIN.finditer(s):
        text = m.group(0)
        bare = text.lstrip("+-")
        if bare in ("0", "1"):
            continue
        out.append(RawEntity(text=text, type="number", start=m.start(), end=m.end()))
    return out


_PROPER_MULTI = re.compile(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b", re.ASCII)
_PROPER_SINGLE = re.compile(r"\b[A-Z][a-z]{2,}\b", re.ASCII)
_SPLIT_WS = re.compile(r"\s+")


def _scan_proper_nouns(s: str, stopwords: frozenset[str]) -> list[RawEntity]:
    out: list[RawEntity] = []

    for m in _PROPER_MULTI.finditer(s):
        text = m.group(0)
        tokens = [t.lower() for t in _SPLIT_WS.split(text)]
        if all(t in stopwords for t in tokens):
            continue
        if _is_at_sentence_start(s, m.start()):
            continue
        out.append(RawEntity(text=text, type="proper_noun", start=m.start(), end=m.end()))

    occurrences: dict[str, list[tuple[int, int]]] = {}
    for m in _PROPER_SINGLE.finditer(s):
        text = m.group(0)
        if text.lower() in stopwords:
            continue
        occurrences.setdefault(text, []).append((m.start(), m.end()))
    for text, hits in occurrences.items():
        if len(hits) < 2:
            continue
        for start, end in hits:
            out.append(RawEntity(text=text, type="proper_noun", start=start, end=end))

    return out


def _is_at_sentence_start(s: str, idx: int) -> bool:
    if idx == 0:
        return True
    j = idx - 1
    while j >= 0 and s[j] in (" ", "\t", "\n", "\r"):
        j -= 1
    if j < 0:
        return True
    return s[j] in (".", "!", "?")


# ───────────────────────────────────────────────────────────────────────────
# Date/number tiebreaker + overlap resolution
# ───────────────────────────────────────────────────────────────────────────

_REL_UNIT = re.compile(
    r"\d+\s+(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?)$",
    re.IGNORECASE,
)


def _apply_date_number_tiebreaker(
    candidates: list[tuple[RawEntity, int]], output: str
) -> None:
    sentences = _split_sentences_original(output)
    to_drop: set[int] = set()

    for i, (a, _) in enumerate(candidates):
        if a.type != "date" or not _REL_UNIT.search(a.text):
            continue
        twin_idx = -1
        for j, (b, _) in enumerate(candidates):
            if b.type == "number" and b.start == a.start and b.end == a.end:
                twin_idx = j
                break
        if twin_idx == -1:
            continue

        sentence = next(
            (sr for sr in sentences if sr[0] <= a.start and a.end <= sr[1]),
            None,
        )
        if sentence is None:
            to_drop.add(i)
            continue

        has_nearby = False
        for j, (other, _) in enumerate(candidates):
            if j == i:
                continue
            if other.type != "date":
                continue
            if other.start < sentence[0] or other.end > sentence[1]:
                continue
            dist = min(abs(other.start - a.end), abs(other.end - a.start))
            if dist <= 30:
                has_nearby = True
                break

        if has_nearby:
            to_drop.add(twin_idx)
        else:
            to_drop.add(i)

    for i in sorted(to_drop, reverse=True):
        del candidates[i]


def _split_sentences_original(s: str) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start = 0
    i = 0
    while i < len(s):
        c = s[i]
        if c not in (".", "!", "?"):
            i += 1
            continue
        prev = s[i - 1] if i > 0 else ""
        nxt = s[i + 1] if i + 1 < len(s) else ""
        is_decimal = (
            c == "."
            and prev != ""
            and "0" <= prev <= "9"
            and nxt != ""
            and "0" <= nxt <= "9"
        )
        if is_decimal:
            i += 1
            continue
        if not nxt or nxt.isspace():
            out.append((start, i + 1))
            j = i + 1
            while j < len(s) and s[j].isspace():
                j += 1
            start = j
            i = j
            continue
        i += 1
    if start < len(s):
        out.append((start, len(s)))
    return out


def _resolve_overlaps(candidates: list[tuple[RawEntity, int]]) -> list[RawEntity]:
    sorted_c = sorted(
        candidates,
        key=lambda ep: (ep[0].start, -(ep[0].end - ep[0].start), -ep[1]),
    )
    accepted: list[RawEntity] = []
    for cand, _prio in sorted_c:
        conflict: RawEntity | None = None
        for a in accepted:
            if not (cand.end <= a.start or cand.start >= a.end):
                conflict = a
                break
        if conflict is None:
            accepted.append(cand)
            continue
        if cand.start >= conflict.start and cand.end <= conflict.end:
            continue
        # Partial overlap → keep the first accepted; drop cand.

    seen: set[str] = set()
    uniq: list[RawEntity] = []
    for cand in accepted:
        key = f"{cand.start}:{cand.end}:{cand.type}"
        if key in seen:
            continue
        seen.add(key)
        uniq.append(cand)
    uniq.sort(key=lambda e: e.start)
    return uniq
