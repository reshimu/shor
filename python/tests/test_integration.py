"""Integration tests using the SAME JSON fixtures as the TS suite."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from reshimu_shor import classify

# Fixtures live in the TS test tree — single source of truth.
_FIXTURE_DIR = Path(__file__).resolve().parent.parent.parent / "tests" / "fixtures"


def _build_context(fx: dict[str, Any]) -> str:
    if "context" in fx:
        return fx["context"]
    syn = fx.get("context_synthesize")
    if syn is not None:
        seed = syn["seed"]
        repeat = int(syn["repeat"])
        embed = syn.get("embed")
        noise = seed * repeat
        if embed is None:
            return noise
        mid = len(noise) // 2
        return noise[:mid] + " " + embed + " " + noise[mid:]
    return ""


def _fixture_files() -> list[Path]:
    return sorted(_FIXTURE_DIR.glob("*.json"))


@pytest.mark.parametrize("fx_path", _fixture_files(), ids=lambda p: p.name)
def test_fixture(fx_path: Path) -> None:
    fx = json.loads(fx_path.read_text(encoding="utf-8"))
    context = _build_context(fx)
    options = fx.get("options") or {}

    result = classify(
        output=fx["output"],
        context=context,
        strict=options.get("strict", False),
        min_entities=options.get("minEntities", 1),
        entity_types=options.get("entityTypes"),
        stopwords=options.get("stopwords"),
    )

    expected = fx["expected"]
    assert result.level == expected["level"], (
        f"{fx_path.name}: expected {expected['level']}, got {result.level}\n"
        f"entities: {result.entities}"
    )
    if "minScore" in expected:
        assert result.score >= expected["minScore"]
    if "maxScore" in expected:
        assert result.score <= expected["maxScore"]
    if "flagForReview" in expected:
        assert result.flag_for_review == expected["flagForReview"]


def test_long_context_50k_tokens() -> None:
    seed = (
        "Routine status update with no specific numbers. Team members met as scheduled. "
        "Various items were discussed. "
    )
    noise = (seed * (200_000 // len(seed) + 1))[:200_000]
    half = len(noise) // 2
    context = (
        noise[:half]
        + " The CEO reported Q3 revenue of $4.2M from 47 customers. "
        + noise[half:]
    )
    result = classify(
        output="Q3 revenue was $4.2M from 47 customers.",
        context=context,
    )
    assert result.level == "GROUNDED"
