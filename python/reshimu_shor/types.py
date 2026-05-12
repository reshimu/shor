"""Public types for reshimu_shor."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

EntityType = Literal[
    "proper_noun",
    "identifier",
    "number",
    "date",
    "quoted_string",
    "citation",
    "url",
]

Level = Literal["GROUNDED", "PARTIAL", "UNGROUNDED", "INDETERMINATE"]


@dataclass(frozen=True)
class Entity:
    text: str
    normalized: str
    type: EntityType
    found: bool
    locations: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class ClassifyResult:
    level: Level
    score: float
    entities: tuple[Entity, ...]
    explanation: str
    flag_for_review: bool


# Internal types — not re-exported.


@dataclass(frozen=True)
class RawEntity:
    text: str
    type: EntityType
    start: int
    end: int


@dataclass
class NormalizedContext:
    original: str
    normalized: str
    offset_map: list[int]
    sentence_ranges: list[tuple[int, int]] = field(default_factory=list)
