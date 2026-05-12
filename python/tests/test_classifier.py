"""Mirror of the TS classifier tests."""

from __future__ import annotations

import math

from reshimu_shor import classify


def test_grounded_all_present() -> None:
    r = classify(
        output="Revenue was $4.2M.",
        context="Q3 revenue grew to $4.2M according to the filing.",
    )
    assert r.level == "GROUNDED"
    assert r.score == 1
    assert r.flag_for_review is False


def test_ungrounded_no_present() -> None:
    r = classify(
        output="Revenue was $7.7M.",
        context="Unrelated text about cats and dogs.",
    )
    assert r.level == "UNGROUNDED"
    assert r.score == 0
    assert r.flag_for_review is True


def test_partial_some_present() -> None:
    r = classify(
        output="Revenue was $4.2M and $7.7M and $9.9M.",
        context="$4.2M was the figure last quarter.",
    )
    assert r.level == "PARTIAL"
    assert 0 < r.score < 1
    assert r.flag_for_review is True


def test_indeterminate_empty_output() -> None:
    r = classify(output="", context="anything here")
    assert r.level == "INDETERMINATE"
    assert r.score == 0
    assert r.flag_for_review is False
    assert "empty" in r.explanation.lower()


def test_indeterminate_no_entities() -> None:
    r = classify(output="just words here", context="anything")
    assert r.level == "INDETERMINATE"
    assert r.flag_for_review is False


def test_indeterminate_below_min_entities() -> None:
    r = classify(
        output="See $4.2M now.",
        context="unrelated",
        min_entities=5,
    )
    assert r.level == "INDETERMINATE"


def test_indeterminate_filter_excludes_all() -> None:
    r = classify(
        output="Revenue was $4.2M.",
        context="$4.2M was the figure.",
        entity_types=["url"],
    )
    assert r.level == "INDETERMINATE"


def test_score_exact_ratio() -> None:
    r = classify(
        output="$1.1M $2.2M $3.3M",
        context="$1.1M was the only known figure.",
    )
    assert math.isclose(r.score, 1 / 3, rel_tol=1e-5)
    assert r.level == "PARTIAL"


def test_grounded_partial_boundary() -> None:
    grounded = classify(
        output="Check user.email and getUserEmail today.",
        context="The user.email field and getUserEmail function exist.",
    )
    assert grounded.level == "GROUNDED"

    partial = classify(
        output="Check user.email and getUserEmail and fake_function today.",
        context="The user.email field and getUserEmail function exist.",
    )
    assert partial.level == "PARTIAL"


def test_partial_ungrounded_boundary() -> None:
    ungrounded = classify(
        output="$1.1M $2.2M $3.3M revenue.",
        context="Different context with $9.9M total.",
    )
    assert ungrounded.level == "UNGROUNDED"

    partial = classify(
        output="$4.2M $5.5M $6.6M from many customers.",
        context="$4.2M was last quarter only.",
    )
    assert partial.level == "PARTIAL"
    assert partial.flag_for_review is True


def test_entity_types_filter() -> None:
    r = classify(
        output="Revenue was $4.2M and getUserEmail() succeeded.",
        context="$4.2M is known.",
        entity_types=["number"],
    )
    assert all(e.type == "number" for e in r.entities)
    assert r.level == "GROUNDED"


def test_stopwords_substitutive() -> None:
    r = classify(
        output="Banana Banana hello world",
        context="unrelated",
        stopwords=["banana"],
    )
    assert r.level == "INDETERMINATE"


def test_empty_stopwords_disables_filter() -> None:
    r = classify(
        output="The The And And things happen.",
        context="unrelated",
        stopwords=[],
    )
    assert r.level != "INDETERMINATE"


def test_min_entities_forces_indeterminate() -> None:
    r = classify(
        output="See $4.2M today.",
        context="unrelated",
        min_entities=3,
    )
    assert r.level == "INDETERMINATE"


def test_flag_for_review_false_for_indeterminate() -> None:
    assert classify(output="", context="whatever").flag_for_review is False


def test_date_iso_to_written() -> None:
    r = classify(
        output="Filed on 2024-01-15.",
        context="Filed on Jan 15, 2024 by the team.",
    )
    assert r.level == "GROUNDED"


def test_date_written_to_iso() -> None:
    r = classify(
        output="Filed on January 15, 2024.",
        context="Filed on 2024-01-15 by the team.",
    )
    assert r.level == "GROUNDED"


def test_explanation_grounded() -> None:
    r = classify(output="See $4.2M today.", context="$4.2M was reported.")
    assert "verified" in r.explanation.lower()


def test_explanation_ungrounded_names_entity() -> None:
    r = classify(output="See $7.7M today.", context="unrelated text")
    assert "$7.7M" in r.explanation


def test_locations_reported_for_found() -> None:
    r = classify(
        output="Revenue was $4.2M.",
        context="The $4.2M figure was reported",
    )
    found = next((e for e in r.entities if e.found), None)
    assert found is not None
    assert len(found.locations) > 0
    start, end = found.locations[0]
    assert isinstance(start, int) and isinstance(end, int)
    assert end > start


def test_locations_half_open() -> None:
    r = classify(output="See $4.2M today.", context="$4.2M reported.")
    found = next((e for e in r.entities if e.found), None)
    assert found is not None
    start, end = found.locations[0]
    assert end - start == 5
