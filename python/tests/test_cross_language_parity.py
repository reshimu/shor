"""Cross-language parity: Python output must match TS output for every fixture.

The golden file is generated from the TS implementation by running:

    npx tsx scripts/generate-golden.ts

Both languages load the SAME fixtures and the Python results are asserted
against the TS-produced golden. Compared fields:

  - level (exact)
  - score (within 1e-9)
  - flag_for_review (exact)
  - total entity count (exact)
  - found entity count (exact)
  - per-entity (text, type, found) tuples as a multiset (order-insensitive)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from reshimu_shor import classify

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_FIXTURE_DIR = _REPO_ROOT / "tests" / "fixtures"
_GOLDEN_PATH = _REPO_ROOT / "tests" / "parity_golden.json"


def _build_context(fx: dict[str, Any]) -> str:
    if "context" in fx:
        return fx["context"]
    syn = fx.get("context_synthesize")
    if syn is not None:
        noise = syn["seed"] * int(syn["repeat"])
        embed = syn.get("embed")
        if embed is None:
            return noise
        mid = len(noise) // 2
        return noise[:mid] + " " + embed + " " + noise[mid:]
    return ""


def _load_golden() -> dict[str, dict[str, Any]]:
    if not _GOLDEN_PATH.exists():
        pytest.skip(
            f"Golden file not found at {_GOLDEN_PATH}. "
            "Generate it first: `npx tsx scripts/generate-golden.ts` from the repo root."
        )
    return json.loads(_GOLDEN_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def golden() -> dict[str, dict[str, Any]]:
    return _load_golden()


def _fixture_names() -> list[str]:
    return sorted(p.name for p in _FIXTURE_DIR.glob("*.json"))


@pytest.mark.parametrize("fx_name", _fixture_names())
def test_parity(fx_name: str, golden: dict[str, dict[str, Any]]) -> None:
    if fx_name not in golden:
        pytest.fail(f"Fixture {fx_name} missing from golden — regenerate golden file.")

    expected = golden[fx_name]
    fx = json.loads((_FIXTURE_DIR / fx_name).read_text(encoding="utf-8"))
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

    assert result.level == expected["level"], (
        f"{fx_name}: level diverges — TS={expected['level']} Python={result.level}"
    )
    assert abs(result.score - expected["score"]) < 1e-9, (
        f"{fx_name}: score diverges — TS={expected['score']} Python={result.score}"
    )
    assert result.flag_for_review == expected["flagForReview"], (
        f"{fx_name}: flag_for_review diverges — "
        f"TS={expected['flagForReview']} Python={result.flag_for_review}"
    )
    assert len(result.entities) == expected["entityCount"], (
        f"{fx_name}: entity count diverges — "
        f"TS={expected['entityCount']} Python={len(result.entities)}"
    )
    n_found = sum(1 for e in result.entities if e.found)
    assert n_found == expected["foundCount"], (
        f"{fx_name}: found-count diverges — "
        f"TS={expected['foundCount']} Python={n_found}"
    )

    # Per-entity (text, type, found) parity as a multiset.
    py_set = sorted((e.text, e.type, e.found) for e in result.entities)
    ts_set = sorted(
        (e["text"], e["type"], e["found"]) for e in expected["entities"]
    )
    assert py_set == ts_set, f"{fx_name}: entity list diverges\nTS: {ts_set}\nPy: {py_set}"
