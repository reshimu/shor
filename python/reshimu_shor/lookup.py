"""Context normalization and substring lookup."""

from __future__ import annotations

from dataclasses import dataclass

from .types import NormalizedContext
from .utils import is_upper, is_whitespace, is_word_char, replace_smart_quote


@dataclass(frozen=True)
class LookupConstraints:
    token_boundary: bool
    single_sentence: bool


def build_normalized_context(context: str, strict: bool) -> NormalizedContext:
    chars: list[str] = []
    offset_map: list[int] = []
    newline_collapsed_at: list[int] = []
    last_was_space = False

    for i, raw in enumerate(context):
        c = replace_smart_quote(raw)
        if is_whitespace(c):
            if not last_was_space and chars:
                chars.append(" ")
                offset_map.append(i)
                if c == "\n":
                    newline_collapsed_at.append(len(chars) - 1)
                last_was_space = True
            elif last_was_space and c == "\n":
                newline_collapsed_at.append(len(chars) - 1)
            continue
        last_was_space = False
        if not strict:
            c = c.lower()
        chars.append(c)
        offset_map.append(i)

    if chars and chars[-1] == " ":
        chars.pop()
        offset_map.pop()

    normalized = "".join(chars)
    sentence_ranges = _detect_sentences(normalized, context, offset_map, newline_collapsed_at)
    return NormalizedContext(
        original=context,
        normalized=normalized,
        offset_map=offset_map,
        sentence_ranges=sentence_ranges,
    )


def _detect_sentences(
    s: str,
    original: str,
    offset_map: list[int],
    newline_collapsed_at: list[int],
) -> list[tuple[int, int]]:
    if not s:
        return []
    breaks: set[int] = set()

    for i, c in enumerate(s):
        if c not in (".", "!", "?"):
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
            continue
        if nxt == "" or nxt == " ":
            breaks.add(i)

    for pos in newline_collapsed_at:
        j = pos + 1
        while j < len(s) and s[j] == " ":
            j += 1
        if j >= len(s):
            continue
        if j >= len(offset_map):
            continue
        orig_idx = offset_map[j]
        if orig_idx >= len(original):
            continue
        if is_upper(original[orig_idx]):
            if pos > 0:
                breaks.add(pos - 1)

    ranges: list[tuple[int, int]] = []
    start = 0
    for b in sorted(breaks):
        end = b + 1
        if end > start:
            ranges.append((start, end))
        start = end
        while start < len(s) and s[start] == " ":
            start += 1
    if start < len(s):
        ranges.append((start, len(s)))
    return ranges


def find_all(
    needle: str,
    ctx: NormalizedContext,
    constraints: LookupConstraints,
) -> list[tuple[int, int]]:
    if not needle or len(needle) > len(ctx.normalized):
        return []
    hay = ctx.normalized
    out: list[tuple[int, int]] = []
    from_idx = 0
    while from_idx <= len(hay) - len(needle):
        idx = hay.find(needle, from_idx)
        if idx == -1:
            break
        end_idx = idx + len(needle)

        if constraints.token_boundary:
            before_ok = idx == 0 or not is_word_char(hay[idx - 1])
            after_ok = end_idx >= len(hay) or not is_word_char(hay[end_idx])
            if not before_ok or not after_ok:
                from_idx = idx + 1
                continue

        if constraints.single_sentence:
            fits = any(s <= idx and end_idx <= e for s, e in ctx.sentence_ranges)
            if not fits:
                from_idx = idx + 1
                continue

        orig_start = ctx.offset_map[idx] if idx < len(ctx.offset_map) else 0
        if end_idx - 1 < len(ctx.offset_map):
            orig_end = ctx.offset_map[end_idx - 1] + 1
        else:
            orig_end = orig_start
        out.append((orig_start, orig_end))
        from_idx = end_idx
    return out
