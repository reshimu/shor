# SHOR — Architecture Specification (v0)

**Status:** Locked. Implementation steps reference this document.
**Companion to:** NESHER (irreversibility classifier).
**Scope:** v0 entity-level grounding classifier. Non-LLM. Deterministic. Sub-50ms.

---

## 1. Overview

SHOR is a runtime classifier that answers a single question: *given an agent's output and the context that agent was operating over, are the specific entities cited in the output present in that context?*

It is not a semantic similarity engine. It is not an LLM judge. It does not understand meaning. It extracts named, addressable entities from output text (numbers, identifiers, quoted strings, dates, URLs, proper nouns, citation markers) and checks each one against a normalized representation of the context. The result is a four-level classification plus a per-entity ledger.

The architectural commitment — no LLM in the loop — is non-negotiable. SHOR's value is precisely that it does not share latents with the system it grades.

---

## 2. Public API

### TypeScript

```ts
type EntityType =
  | 'proper_noun'
  | 'identifier'
  | 'number'
  | 'date'
  | 'quoted_string'
  | 'citation'
  | 'url'

type Level = 'GROUNDED' | 'PARTIAL' | 'UNGROUNDED' | 'INDETERMINATE'

interface Entity {
  text: string                // original span as extracted
  normalized: string          // form used for lookup
  type: EntityType
  found: boolean
  locations: [number, number][]   // 0-indexed half-open [start, end) char ranges
                                  //   into the original (pre-normalized) context.
                                  //   Empty array if not found.
}

interface ClassifyOptions {
  strict?: boolean            // default false — see §4.4
  minEntities?: number        // default 1
  entityTypes?: EntityType[] | ['all']   // default ['all']
  stopwords?: string[]        // overrides the built-in stopword list (§3.1)
                              //   if provided, fully replaces — does not extend
}

interface ClassifyResult {
  level: Level
  score: number               // [0, 1], found / total extracted (after filters)
  entities: Entity[]
  explanation: string         // short human-readable summary
  flagForReview: boolean      // true for PARTIAL and UNGROUNDED
}

export function classify(input: {
  output: string
  context: string
  options?: ClassifyOptions
}): ClassifyResult
```

### Python

```py
def classify(
    output: str,
    context: str,
    *,
    strict: bool = False,
    min_entities: int = 1,
    entity_types: list[str] | None = None,
    stopwords: list[str] | None = None,
) -> ClassifyResult: ...
```

Return type is a frozen dataclass with the same fields as the TypeScript interface. Field names use `snake_case` (`flag_for_review`, not `flagForReview`).

Both implementations are pure functions: no I/O, no network, no global state, no module-level mutation.

---

## 3. Entity Extraction Taxonomy

The extractor scans the output text once and emits entities in document order. Extraction rules per type:

**`number`** — A token matching one of:
- Plain integers/decimals with optional sign: `47`, `-3.2`, `0.005`
- Currency: `$4.2M`, `€1,200`, `£500k`. Suffixes `K|k|M|m|B|b|T|t` recognized.
- Percent: `47%`, `3.5%`
- Numbers with explicit units in the next token: `3 days`, `47 customers`. The unit token is captured into the entity span.

**`date`** — Specific points or ranges in time:
- ISO: `2024-01-15`, `2024-Q3`
- Common formats: `January 15, 2024`, `Jan 15`, `15/01/2024`, `Q3 2024`, `Q3`, `FY24`
- Relative durations: `3 days`, `2 weeks ago` *(overlap with `number`: see §4.5)*

**`identifier`** — Code-like tokens. Each match is emitted as a **single entity** preserving the full compound form (no sub-entity emission). Heuristic match patterns:
- Dotted access: `user.email`, `db.query.results`, `Settings.theme.color`
- Snake/camel case names of ≥ 2 segments: `get_user_email`, `getUserEmail`
- Function call form: `foo()`, `bar(args)` — argument span is captured as part of the entity
- Slash-paths: `src/lib/util.ts`, `/api/v1/users`, `./relative/path.py`
- Bracketed access: `arr[0]`, `dict["key"]`, `users[i].email`, `Map<K, V>`, `Array<int>`
- Brace interpolation: `${user.email}`, `{user.email}` (template/f-string forms)
- Mixed compounds combining the above are preserved whole (`src/api/${endpoint}.ts` is one entity)

**`quoted_string`** — Any span enclosed in matched `"..."`, `'...'`, or backticks `` `...` ``. Captured verbatim including internal punctuation.

**`citation`** — Phrases that *attribute* a claim to a source. Matched against a fixed phrase list grouped into four clusters (covering the bulk of natural-language attribution patterns):

| Cluster | Phrases |
|---|---|
| Source attribution | `according to`, `per the` |
| Locative reference | `as stated in`, `from the` |
| Reportative | `the report says`, `the document mentions` |
| Speaker attribution | `they said`, `you said` |

The entity's `text` is the trailing noun phrase (up to 6 tokens or the next comma/period). Lookup checks whether that trailing phrase exists in the context — *not* whether the cited content does. A citation pointing at a real source whose content is not actually present still resolves as `found: true` for the citation entity; the *content* claims become their own entities and are classified independently. This is the misattribution case noted in the fixtures: a citation where the source exists but the cited fact does not produces `PARTIAL`.

**`url`** — `https?://...` and bare-domain forms (`example.com/path`). Captured verbatim, trailing punctuation trimmed.

**`proper_noun`** — Capitalized multi-word spans not at sentence start. Single capitalized tokens are extracted only if they appear ≥ 2 times in the output (a heuristic to reduce sentence-start noise).

### 3.1 Stopword and skip rules

- Pronouns, articles, common verbs are never extracted as `proper_noun`.
- Number `0` and `1` alone (without units, currency, or percent) are skipped — too noisy.
- Single-character identifiers are skipped (`i`, `x`).
- Citation phrases that resolve to a zero-token trailing span are skipped.

The built-in English stopword list (42 entries, lowercase, applied during `proper_noun` extraction only):

```
a, an, the,
i, you, he, she, it, we, they,
me, him, her, us, them,
my, your, his, our, their,
is, are, was, were, be,
have, has, had, do, did,
and, or, but, not,
of, in, on, at, to, for, with, by, as
```

Callers may fully replace this list via `options.stopwords` — the override is **substitutive, not additive**. Pass an empty array to disable stopword filtering entirely. The list affects `proper_noun` only; other entity types have their own type-specific skip rules (above).

---

## 4. Lookup Algorithm

For each extracted entity, lookup is a normalized substring check against the context.

### 4.1 Context preprocessing

The context is normalized once per `classify()` call:
- Lowercased
- Whitespace runs collapsed to single space
- Smart quotes (`""`, `''`) normalized to ASCII (`"`, `'`)
- A character-offset map is kept so found locations can be reported in original-text coordinates.

### 4.2 Entity normalization (per type)

| Type            | Normalization |
|-----------------|--------------|
| `number`        | Strip currency symbols, commas. Expand suffix multipliers (`4.2M` → `4200000`, `500k` → `500000`). Lookup matches **both** the raw form (`$4.2M`) and the expanded form (`4200000`). |
| `date`          | Generate a small set of canonical forms (ISO, "Month DD, YYYY", "Mon DD"). Lookup succeeds if any form is found. `Q3` matches `Q3` only — does not match `third quarter`. |
| `identifier`    | Lowercase. Exact substring match. `user.email` matches `user.email`, not `user_email` or `userEmail`. |
| `quoted_string` | Internal whitespace collapsed; smart quotes normalized. Lookup is a substring match on the inner content (without enclosing quotes). |
| `citation`      | The trailing noun phrase is normalized like `proper_noun`. |
| `url`           | Lowercased; trailing slash stripped; query string compared whole. |
| `proper_noun`   | Lowercased; multi-token spans matched as a whole phrase. |

### 4.3 Match criterion

An entity is `found` if its normalized form appears as a substring of the normalized context at one or more character offsets. All offsets (mapped back to original-text coordinates) are recorded in `locations`. Match is purely substring — no fuzzy matching, no stemming, no edit distance.

### 4.4 Strict vs lenient mode

Strict mode does **not** change which entities are extracted, only how lookups succeed. Three constraints stack:

| Constraint | Lenient (default) | Strict |
|---|---|---|
| Case | Insensitive (context and entity both lowercased) | **Case-sensitive** — lookup uses original casing for both entity and context. Smart-quote and whitespace normalization still apply. |
| Token boundary | Plain substring | Match must begin and end on a token boundary — the characters adjacent to the matched span (or string boundary) must be whitespace or punctuation. Rejects `cat` matching inside `category`. |
| Sentence scope | Match may span sentence boundaries | **Matched span must lie within a single sentence** of the normalized context. Sentence boundaries detected by `.`, `!`, `?`, or newline followed by whitespace + capital. Prevents multi-word entities (quoted strings, proper nouns, citation phrases) from accidentally matching across sentence joins. |

All three constraints apply simultaneously when `strict: true`. There is no per-constraint toggle in v0.

### 4.5 Date/number overlap

A token like `3 days` is extracted as **either** `number` (with unit) **or** `date` (relative duration) — not both. Tiebreaker: if the surrounding sentence contains another date-typed entity within 30 characters, classify as `date`; otherwise `number`. (This rule is deterministic.)

---

## 5. Classification Thresholds

After extraction and lookup, count `n_found` and `n_total` over entities passing the `entityTypes` filter.

| Condition | Level |
|-----------|-------|
| `n_total < minEntities` | `INDETERMINATE` |
| `n_total > 0` and `n_found == n_total` | `GROUNDED` |
| `n_total > 0` and `n_found == 0` | `UNGROUNDED` |
| `n_total > 0` and `0 < n_found / n_total < 1` | `PARTIAL` |

`score = n_found / n_total` (or `0` for `INDETERMINATE`).

`flagForReview = (level === 'PARTIAL' || level === 'UNGROUNDED')`.

**`flagForReview` is explicitly `false` for `INDETERMINATE`.** Rationale: `INDETERMINATE` means SHOR has nothing to assert — the output contained no extractable entities, or the configured filter excluded them all. Flagging this for review would conflate "I checked and found problems" with "I had no way to check," producing noisy review queues. Callers who want to surface uncheckable outputs should branch on `level === 'INDETERMINATE'` directly.

The explanation string names up to three unfound entities by type and text. Example: `"Currency '$4.2M' and quantity '47 customers' not found in context."`

These thresholds are **uniform** in v0 — all entity types weighted equally. Type-weighted scoring is a v0.x candidate but out of scope here.

---

## 6. Edge Cases

| Case | Behavior |
|------|----------|
| Empty output | `INDETERMINATE`, `score: 0`, `entities: []`, explanation: `"Output is empty."` |
| Empty context, output has entities | `UNGROUNDED`, all entities `found: false` |
| Empty context, output has no entities | `INDETERMINATE` |
| Output has only stopwords | `INDETERMINATE` (no extractable entities) |
| Output has entities below `minEntities` | `INDETERMINATE` |
| `entityTypes` filter excludes every extracted entity | `INDETERMINATE` |
| Very long context (≥ 100k chars) | Normalize once, then substring lookup per entity. No precomputed index in v0 — see §7. |
| Identical entity text appearing multiple times in output | Deduplicated by `(type, normalized)`. Counted once. |
| Context is binary or non-UTF8 | Caller's responsibility. SHOR assumes UTF-8 strings. |
| Quoted string spans a newline | Captured fully; newlines normalized to space during lookup. |
| Unclosed quote in output | Closing quote inferred at end of output. Span captured up to EOF. |

---

## 7. Performance Contract

**Guaranteed:**
- `classify()` returns in under 50 ms p99 on inputs with `output` ≤ 4k tokens and `context` ≤ 200k tokens, on a modern laptop (M-series Mac or equivalent x86, single-threaded).
- Zero runtime dependencies — TypeScript build produces a single ESM bundle with no `node_modules` cost beyond stdlib; Python package imports only stdlib.
- Pure function: same input → same output, every time. No clock, no PRNG, no environment reads.

**Not guaranteed:**
- Sublinear performance in context size. Lookup is `O(E × C)` where `E` is entity count and `C` is context length. Acceptable because `E` is bounded by output size (a few hundred at most) and substring search is fast in practice.
- Memory footprint beyond `O(C)` for the normalized context copy.
- Behavior on inputs larger than the documented limits — may still work, but not promised.

Performance is verified by a benchmark test asserting the p99 latency target on a fixture with a 50k-token context.

---

## 8. Non-Goals (v0)

Documented prominently in the README. SHOR will **not**, in v0:

1. **Catch paraphrased hallucinations.** If the agent invents a fact but states it without any specific entities (no numbers, names, or identifiers), SHOR cannot evaluate it.
2. **Catch inferential overreach.** If the output extends a true premise to an unsupported conclusion using only words present in context, SHOR will mark it `GROUNDED`. The entities exist; the inference is wrong. That's a different problem.
3. **Evaluate tone, style, sentiment, or values alignment.**
4. **Detect deceptive alignment, mesa-optimization, or other capability-level risks.**
5. **Resolve coreference.** "He said X" — SHOR does not know who "he" refers to.
6. **Match across languages or transliterations.**
7. **Normalize semantic equivalents.** `Q3` does not match `third quarter`; `$4.2M` does not match `four point two million dollars`.
8. **Match spelled-out numbers against digits.** Number expansion is **digit-only**: `$4.2M` normalizes to both `$4.2M` and `4200000`, but never to `four point two million`. If the agent writes a hallucinated value as words rather than digits, SHOR will likely not catch it. This is a known precision/scope tradeoff and must be documented prominently in the README's "What SHOR does not catch" table.
9. **Replace eval harnesses for batch grading.** SHOR is a runtime gate. Batch evals may still want an LLM judge — see the blog post that ships with the library.

These limits are features. Precise tools that know their scope beat fuzzy tools that pretend to do everything.

---

## 9. Resolved Decisions

All eight items previously parked here have been resolved (2026-05-12) and folded into the body of this spec. Recorded below for traceability.

| # | Decision | Resolution | Spec location |
|---|---|---|---|
| 1 | Stopword list | Fixed 42-word built-in list. `options.stopwords` overrides substitutively (does not extend). | §2, §3.1 |
| 2 | Citation phrases | Eight phrases retained, organized into four clusters: source attribution, locative reference, reportative, speaker attribution. | §3 |
| 3 | `locations` semantics | 0-indexed half-open `[start, end)` character offsets into the original (pre-normalized) context. | §2 |
| 4 | Strict mode scope | Strict = (a) case-sensitive lookup, (b) token-boundary required, (c) match must lie within a single sentence of context. All three stack; no per-constraint toggle. | §4.4 |
| 5 | `flagForReview` for `INDETERMINATE` | `false`, with rationale documented. Callers wanting to surface uncheckable outputs branch on `level` directly. | §5 |
| 6 | Sub-entity emission | One entity per compound identifier. Extension rules cover dotted, snake/camel, function-call, slash-paths, bracketed access (`arr[0]`, `Map<K,V>`), and brace interpolation (`${var}`, `{var}`). | §3 |
| 7 | Number expansion | Digit-only: raw form plus expanded-digit form. Spelled-out equivalents not generated. Gap documented in §8 item 8 for README mirroring. | §4.2, §8 |
| 8 | Type-weighted scoring | Deferred to v0.x. v0 ships flat: every extracted entity contributes equally to `n_found / n_total`. Thresholds: `GROUNDED = 1.0`, `PARTIAL = (0, 1)`, `UNGROUNDED = 0`. | §5 |

No open decisions remain. Step 2 (TypeScript core implementation) is unblocked.

---

*End of SHOR_SPEC.md*
