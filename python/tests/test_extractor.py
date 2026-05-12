"""Mirror of the TS extractor tests."""

from __future__ import annotations

from reshimu_shor.extractor import extract
from reshimu_shor.types import EntityType
from reshimu_shor.utils import DEFAULT_STOPWORDS


def _find(text: str, type_: EntityType) -> list[str]:
    return [e.text for e in extract(text, DEFAULT_STOPWORDS) if e.type == type_]


# ─── URL ──────────────────────────────────────────────────────────────


def test_url_http_https() -> None:
    urls = _find("Visit https://example.com or http://api.example.org/v1.", "url")
    assert "https://example.com" in urls
    assert "http://api.example.org/v1" in urls


def test_url_strips_trailing_punct() -> None:
    assert "https://example.com" in _find("See https://example.com.", "url")


def test_url_bare_with_path() -> None:
    urls = _find("Read example.com/docs/index for more.", "url")
    assert any(u.startswith("example.com") for u in urls)


def test_url_known_tld() -> None:
    assert "reshimu.ai" in _find("Open reshimu.ai today.", "url")


def test_url_skips_unknown_tld_sentence_end() -> None:
    assert _find("Sentence.End of next.", "url") == []


# ─── quoted_string ────────────────────────────────────────────────────


def test_quoted_double() -> None:
    assert '"hello world"' in _find('He said "hello world" loudly.', "quoted_string")


def test_quoted_backtick() -> None:
    assert "`npm install`" in _find("Run `npm install` here.", "quoted_string")


def test_quoted_single() -> None:
    assert "'sure'" in _find("She replied 'sure' then left.", "quoted_string")


def test_quoted_apostrophe_in_contraction_ignored() -> None:
    """`I'll` should NOT open a quoted_string — the apostrophe is a contraction."""
    qs = _find("I'll call db.query() with user.email today.", "quoted_string")
    assert qs == []


def test_quoted_skips_empty() -> None:
    assert _find('The result was "" today.', "quoted_string") == []


def test_quoted_unclosed_to_eof() -> None:
    qs = _find('She said "this is unclosed', "quoted_string")
    assert qs[0] == '"this is unclosed'


# ─── citation ─────────────────────────────────────────────────────────


def test_citation_according_to() -> None:
    cs = _find("According to the SEC report, revenue grew.", "citation")
    assert any("sec report" in c.lower() for c in cs)


def test_citation_per_the() -> None:
    assert "meeting minutes" in _find(
        "Per the meeting minutes, the project is on track.", "citation"
    )


def test_citation_ignores_decimal_dot() -> None:
    """A `.` inside `$9.9M` must not stop the citation noun phrase."""
    cs = _find("According to the SEC report, revenue was $9.9M last quarter.", "citation")
    assert any("sec report" in c.lower() for c in cs)


def test_citation_zero_trailing_skipped() -> None:
    assert _find("per the.", "citation") == []


def test_citation_word_boundary() -> None:
    assert _find("Wordsperthephrase.", "citation") == []


# ─── identifier ───────────────────────────────────────────────────────


def test_identifier_dotted() -> None:
    assert "user.email" in _find("Set user.email = something", "identifier")


def test_identifier_function_call() -> None:
    ids = _find('Call db.query("SELECT 1") today.', "identifier")
    assert any(i.startswith("db.query") for i in ids)


def test_identifier_snake() -> None:
    assert "get_user_email" in _find("use get_user_email here", "identifier")


def test_identifier_camel() -> None:
    assert "getUserEmail" in _find("use getUserEmail here", "identifier")


def test_identifier_path() -> None:
    ids = _find("Edit src/lib/util.ts now.", "identifier")
    assert any("src/lib/util.ts" in i for i in ids)


def test_identifier_bracket() -> None:
    assert "arr[0]" in _find("Read arr[0] for the value.", "identifier")


def test_identifier_brace_interp() -> None:
    assert "${user.email}" in _find("use ${user.email} there", "identifier")


def test_identifier_generic() -> None:
    ids = _find("See Map<string, User> below.", "identifier")
    assert any(i.startswith("Map<") for i in ids)


def test_identifier_skips_single_char() -> None:
    assert "x" not in _find("let x = 5", "identifier")


def test_identifier_skips_pure_num_slash() -> None:
    ids = _find("write 1/2 cup of flour", "identifier")
    assert all(i != "1/2" for i in ids)


# ─── date ─────────────────────────────────────────────────────────────


def test_date_iso() -> None:
    assert "2024-01-15" in _find("On 2024-01-15 it shipped.", "date")


def test_date_quarter() -> None:
    ds = _find("Q3 2024 was strong, Q4 weak.", "date")
    assert any(d.startswith("Q3") for d in ds)


def test_date_month_day_year() -> None:
    ds = _find("Filed January 15, 2024 for review.", "date")
    assert any(d.lower().startswith("january 15") for d in ds)


def test_date_relative() -> None:
    assert "3 days ago" in _find("Released 3 days ago by ops.", "date")


def test_date_fy() -> None:
    assert "FY24" in _find("Earnings up in FY24", "date")


# ─── number ───────────────────────────────────────────────────────────


def test_number_currency_suffix() -> None:
    assert "$4.2M" in _find("Revenue was $4.2M last quarter.", "number")


def test_number_percent() -> None:
    assert "47%" in _find("Growth of 47% YoY.", "number")


def test_number_with_unit() -> None:
    ns = _find("Only 47 customers signed up.", "number")
    assert any(n.startswith("47") for n in ns)


def test_number_with_commas() -> None:
    ns = _find("Total of 1,234 users today.", "number")
    assert any(n.startswith("1,234") for n in ns)


def test_number_skips_lone_0_1() -> None:
    ns = _find("Set flag to 0 or 1 only.", "number")
    assert "0" not in ns and "1" not in ns


# ─── proper_noun ──────────────────────────────────────────────────────


def test_proper_multi_not_at_sentence_start() -> None:
    pns = _find("I visited New York City last week.", "proper_noun")
    assert "New York City" in pns


def test_proper_multi_at_sentence_start_filtered() -> None:
    pns = _find("New York City is great.", "proper_noun")
    assert "New York City" not in pns


def test_proper_single_repeated() -> None:
    pns = _find("Alice told Bob about it. Then Alice left.", "proper_noun")
    assert pns.count("Alice") == 2


def test_proper_single_once_skipped() -> None:
    pns = _find("I met Charles once.", "proper_noun")
    assert "Charles" not in pns


def test_proper_skips_capitalized_stopwords() -> None:
    pns = _find("The The And And Or Or here today.", "proper_noun")
    assert "The" not in pns and "And" not in pns and "Or" not in pns


# ─── edge cases ───────────────────────────────────────────────────────


def test_extract_empty() -> None:
    assert extract("", DEFAULT_STOPWORDS) == []


def test_extract_whitespace_only() -> None:
    assert extract("   \n\t  ", DEFAULT_STOPWORDS) == []


def test_extract_stopwords_only() -> None:
    assert extract("the the and and or or", DEFAULT_STOPWORDS) == []


def test_extract_document_order() -> None:
    ents = extract("First $1.5M then user.email then https://x.com/path", DEFAULT_STOPWORDS)
    for i in range(1, len(ents)):
        assert ents[i].start > ents[i - 1].start


def test_overlap_url_wins_over_identifier() -> None:
    ents = extract(
        "See https://api.example.com/v1/users for details", DEFAULT_STOPWORDS
    )
    assert any(e.type == "url" for e in ents)
    inner = [e for e in ents if e.type == "identifier" and e.start > 4 and e.end < 60]
    assert inner == []


def test_stopword_override_substitutive() -> None:
    custom = frozenset({"banana"})
    pns = [e for e in extract("Banana Banana hello here", custom) if e.type == "proper_noun"]
    assert pns == []


def test_empty_stopword_override_disables_filter() -> None:
    pns = [
        e
        for e in extract("The The The And And things go.", frozenset())
        if e.type == "proper_noun"
    ]
    assert any(e.text == "The" for e in pns)
