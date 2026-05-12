"""Classification logic — orchestrates extract → normalize → lookup → classify."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Sequence

from .extractor import extract
from .lookup import LookupConstraints, build_normalized_context, find_all
from .types import (
    ClassifyResult,
    Entity,
    EntityType,
    Level,
    RawEntity,
)
from .utils import DEFAULT_STOPWORDS, collapse_whitespace, normalize_smart_quotes

_VALID_ENTITY_TYPES: frozenset[str] = frozenset(
    {
        "proper_noun",
        "identifier",
        "number",
        "date",
        "quoted_string",
        "citation",
        "url",
    }
)


def classify(
    output: str,
    context: str,
    *,
    strict: bool = False,
    min_entities: int = 1,
    entity_types: Sequence[str] | None = None,
    stopwords: Iterable[str] | None = None,
) -> ClassifyResult:
    type_filter: frozenset[EntityType] | None
    if entity_types is None or list(entity_types) == ["all"]:
        type_filter = None
    else:
        type_filter = frozenset(
            t for t in entity_types if t in _VALID_ENTITY_TYPES
        )  # type: ignore[arg-type]

    sw: frozenset[str]
    if stopwords is not None:
        sw = frozenset(w.lower() for w in stopwords)
    else:
        sw = DEFAULT_STOPWORDS

    if not output:
        return ClassifyResult(
            level="INDETERMINATE",
            score=0.0,
            entities=(),
            explanation="Output is empty.",
            flag_for_review=False,
        )

    raw = extract(output, sw)
    filtered = _filter_by_type(raw, type_filter)
    deduped = _dedupe(filtered)

    if len(deduped) < min_entities:
        if not deduped:
            msg = "No extractable entities in output."
        else:
            msg = (
                f"Only {len(deduped)} extractable entity/entities — "
                f"below min_entities={min_entities}."
            )
        return ClassifyResult(
            level="INDETERMINATE",
            score=0.0,
            entities=tuple(_to_empty_entity(r) for r in deduped),
            explanation=msg,
            flag_for_review=False,
        )

    ctx = build_normalized_context(context, strict)
    constraints = LookupConstraints(token_boundary=strict, single_sentence=strict)

    entities: list[Entity] = []
    for r in deduped:
        forms = _normalize_entity(r, strict)
        locations: tuple[tuple[int, int], ...] = ()
        found_form = ""
        for form in forms:
            if not form:
                continue
            hits = find_all(form, ctx, constraints)
            if hits:
                locations = tuple(hits)
                found_form = form
                break
        normalized = found_form if found_form else (forms[0] if forms else r.text)
        entities.append(
            Entity(
                text=r.text,
                normalized=normalized,
                type=r.type,
                found=bool(locations),
                locations=locations,
            )
        )

    n_total = len(entities)
    n_found = sum(1 for e in entities if e.found)
    score = 0.0 if n_total == 0 else n_found / n_total

    level: Level
    if n_found == n_total:
        level = "GROUNDED"
    elif n_found == 0:
        level = "UNGROUNDED"
    else:
        level = "PARTIAL"

    return ClassifyResult(
        level=level,
        score=score,
        entities=tuple(entities),
        explanation=_build_explanation(entities, level),
        flag_for_review=(level in ("PARTIAL", "UNGROUNDED")),
    )


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────


def _filter_by_type(
    entities: list[RawEntity], type_filter: frozenset[EntityType] | None
) -> list[RawEntity]:
    if type_filter is None:
        return entities
    return [e for e in entities if e.type in type_filter]


def _dedupe(entities: list[RawEntity]) -> list[RawEntity]:
    seen: set[str] = set()
    out: list[RawEntity] = []
    for e in entities:
        key = f"{e.type}:{collapse_whitespace(e.text).lower()}"
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def _to_empty_entity(r: RawEntity) -> Entity:
    return Entity(
        text=r.text,
        normalized="",
        type=r.type,
        found=False,
        locations=(),
    )


_NUM_STRIP = re.compile(r"[$€£¥,\s]")
_NUM_SUFFIX_FORM = re.compile(r"^([+-]?\d+(?:\.\d+)?)([KkMmBbTt])$")
_DATE_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_DATE_WRITTEN = re.compile(
    r"^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+"
    r"(\d{1,2})(?:,?\s+(\d{4}))?$",
    re.IGNORECASE,
)
_IDENT_ARGS = re.compile(r"\([^)]*\)")


def _normalize_entity(r: RawEntity, strict: bool) -> list[str]:
    cased: Callable[[str], str] = (lambda x: x) if strict else (lambda x: x.lower())
    t = r.type

    if t == "number":
        forms: list[str] = [cased(r.text)]
        stripped = _NUM_STRIP.sub("", r.text)
        if stripped != r.text:
            forms.append(cased(stripped))
        m = _NUM_SUFFIX_FORM.match(stripped)
        if m:
            try:
                base = float(m.group(1))
                mult = _suffix_multiplier(m.group(2))
                if mult > 0:
                    forms.append(str(round(base * mult)))
            except ValueError:
                pass
        return _uniq(forms)

    if t == "date":
        forms = [cased(r.text)]
        iso_m = _DATE_ISO.match(r.text)
        if iso_m:
            _add_date_alternates(
                forms,
                int(iso_m.group(1)),
                int(iso_m.group(2)),
                int(iso_m.group(3)),
                cased,
            )
        wm = _DATE_WRITTEN.match(r.text)
        if wm:
            month_idx = _parse_month(wm.group(1))
            day = int(wm.group(2))
            year_str = wm.group(3)
            if month_idx > 0:
                if year_str is not None:
                    _add_date_alternates(forms, int(year_str), month_idx, day, cased)
                else:
                    mon = _month_abbrev(month_idx)
                    if mon:
                        forms.append(cased(f"{mon} {day}"))
        return _uniq(forms)

    if t == "identifier":
        forms = [cased(r.text)]
        stripped_id = _IDENT_ARGS.sub("", r.text)
        if stripped_id != r.text and len(stripped_id) > 1:
            forms.append(cased(stripped_id))
        return _uniq(forms)

    if t == "quoted_string":
        inner = r.text
        if inner:
            first = inner[0]
            last = inner[-1]
            if len(inner) >= 2 and first in ('"', "'", "`") and last == first:
                inner = inner[1:-1]
        inner = normalize_smart_quotes(collapse_whitespace(inner))
        return [cased(inner)]

    if t == "citation":
        return [cased(collapse_whitespace(r.text))]

    if t == "url":
        u = cased(r.text)
        if u.endswith("/"):
            u = u[:-1]
        return [u]

    # proper_noun
    return [cased(collapse_whitespace(r.text))]


def _suffix_multiplier(c: str) -> int:
    cl = c.lower()
    if cl == "k":
        return 1_000
    if cl == "m":
        return 1_000_000
    if cl == "b":
        return 1_000_000_000
    if cl == "t":
        return 1_000_000_000_000
    return 0


_MONTH_ABBREVS = (
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
)
_MONTH_PREFIXES = tuple(m.lower() for m in _MONTH_ABBREVS)


def _month_abbrev(m: int) -> str | None:
    if 1 <= m <= 12:
        return _MONTH_ABBREVS[m - 1]
    return None


def _parse_month(name: str) -> int:
    lower = name.lower()
    for i, p in enumerate(_MONTH_PREFIXES):
        if lower.startswith(p):
            return i + 1
    return 0


def _add_date_alternates(
    forms: list[str],
    year: int,
    month: int,
    day: int,
    cased: Callable[[str], str],
) -> None:
    iso = f"{year}-{month:02d}-{day:02d}"
    forms.append(iso)
    mon = _month_abbrev(month)
    if mon:
        forms.append(cased(f"{mon} {day}, {year}"))
        forms.append(cased(f"{mon} {day} {year}"))
        forms.append(cased(f"{mon} {day}"))


def _uniq(xs: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _build_explanation(entities: list[Entity], level: Level) -> str:
    if level == "GROUNDED":
        return "All extracted entities verified in context."
    if level == "INDETERMINATE":
        return "No extractable entities in output."
    unfound = [e for e in entities if not e.found][:3]
    if not unfound:
        return "Mixed grounding."
    parts = [f"{_type_label(e.type)} '{e.text}'" for e in unfound]
    if len(parts) == 1:
        listed = parts[0]
    elif len(parts) == 2:
        listed = f"{parts[0]} and {parts[1]}"
    else:
        listed = f'{", ".join(parts[:-1])}, and {parts[-1]}'
    return f"{listed} not found in context."


_TYPE_LABELS: dict[EntityType, str] = {
    "number": "number",
    "date": "date",
    "identifier": "identifier",
    "quoted_string": "quoted string",
    "citation": "citation",
    "url": "URL",
    "proper_noun": "name",
}


def _type_label(t: EntityType) -> str:
    return _TYPE_LABELS[t]
