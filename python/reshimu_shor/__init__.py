"""SHOR — Deterministic, non-LLM grounding & hallucination classifier."""

from .classifier import classify
from .types import (
    ClassifyResult,
    Entity,
    EntityType,
    Level,
)

__version__ = "0.1.1"
__all__ = ["classify", "Entity", "EntityType", "Level", "ClassifyResult"]
