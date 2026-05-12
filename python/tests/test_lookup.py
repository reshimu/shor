"""Mirror of the TS lookup tests."""

from __future__ import annotations

from reshimu_shor.lookup import LookupConstraints, build_normalized_context, find_all

LENIENT = LookupConstraints(token_boundary=False, single_sentence=False)
STRICT = LookupConstraints(token_boundary=True, single_sentence=True)


def test_collapses_whitespace() -> None:
    ctx = build_normalized_context("hello    world\n\ntest", False)
    assert ctx.normalized == "hello world test"


def test_lowercases_lenient() -> None:
    assert build_normalized_context("Hello World", False).normalized == "hello world"


def test_preserves_case_strict() -> None:
    assert build_normalized_context("Hello World", True).normalized == "Hello World"


def test_normalizes_smart_quotes() -> None:
    ctx = build_normalized_context("She said “hello” today.", False)
    assert '"hello"' in ctx.normalized


def test_offset_map_back_to_original() -> None:
    ctx = build_normalized_context("Hello   World", False)
    assert ctx.offset_map[0] == 0
    assert ctx.offset_map[-1] == 12


def test_sentence_ranges() -> None:
    ctx = build_normalized_context("First sentence. Second sentence! Third? End.", False)
    assert len(ctx.sentence_ranges) >= 4


def test_no_split_on_decimal() -> None:
    ctx = build_normalized_context("Pi is 3.14 approximately. Next.", False)
    assert len(ctx.sentence_ranges) == 2


def test_newline_capital_break() -> None:
    ctx = build_normalized_context("First fragment\nSecond fragment", False)
    assert len(ctx.sentence_ranges) >= 2


def test_empty_input() -> None:
    ctx = build_normalized_context("", False)
    assert ctx.normalized == ""
    assert ctx.sentence_ranges == []


def test_whitespace_only_input() -> None:
    assert build_normalized_context("   \n\t  ", False).normalized == ""


# ─── find_all ─────────────────────────────────────────────────────────


def test_find_present_substring() -> None:
    ctx = build_normalized_context("hello world", False)
    hits = find_all("world", ctx, LENIENT)
    assert hits == [(6, 11)]


def test_find_absent() -> None:
    ctx = build_normalized_context("hello world", False)
    assert find_all("zebra", ctx, LENIENT) == []


def test_find_multiple_occurrences() -> None:
    ctx = build_normalized_context("cat dog cat dog cat", False)
    assert len(find_all("cat", ctx, LENIENT)) == 3


def test_find_empty_needle() -> None:
    ctx = build_normalized_context("hello world", False)
    assert find_all("", ctx, LENIENT) == []


def test_find_needle_longer_than_context() -> None:
    ctx = build_normalized_context("hi", False)
    assert find_all("hello world", ctx, LENIENT) == []


def test_find_through_collapsed_whitespace() -> None:
    ctx = build_normalized_context("Hello   World", False)
    hits = find_all("hello world", ctx, LENIENT)
    assert hits == [(0, 13)]


def test_lenient_case_insensitive_via_lowered_needle() -> None:
    ctx = build_normalized_context("Hello World", False)
    assert len(find_all("hello", ctx, LENIENT)) == 1
    assert find_all("Hello", ctx, LENIENT) == []


def test_strict_case_sensitive() -> None:
    ctx = build_normalized_context("Hello World", True)
    assert len(find_all("Hello", ctx, STRICT)) == 1
    assert find_all("hello", ctx, STRICT) == []


def test_strict_token_boundary_accepts() -> None:
    ctx = build_normalized_context("cat dog", True)
    assert len(find_all("cat", ctx, STRICT)) == 1


def test_strict_token_boundary_rejects_substring() -> None:
    ctx = build_normalized_context("category dog", True)
    assert find_all("cat", ctx, STRICT) == []


def test_lenient_accepts_substring() -> None:
    ctx = build_normalized_context("category dog", False)
    assert len(find_all("cat", ctx, LENIENT)) == 1


def test_strict_punctuation_is_boundary() -> None:
    ctx = build_normalized_context("hello, world", True)
    assert len(find_all("hello", ctx, STRICT)) == 1


def test_strict_rejects_cross_sentence() -> None:
    ctx = build_normalized_context("First sentence. Second sentence.", True)
    assert find_all("sentence. Second", ctx, STRICT) == []


def test_strict_accepts_within_sentence() -> None:
    ctx = build_normalized_context("First sentence here. Second one.", True)
    assert len(find_all("First sentence", ctx, STRICT)) == 1


def test_lenient_accepts_cross_sentence() -> None:
    ctx = build_normalized_context("First sentence. Second sentence.", False)
    assert len(find_all("sentence. second", ctx, LENIENT)) == 1
