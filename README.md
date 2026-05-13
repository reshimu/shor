
> A deterministic, non-LLM classifier that flags ungrounded entities in agent outputs before they reach a tool call or a user.

[
# SHOR — Grounding & Hallucination Classifier

[![npm version](https://img.shields.io/npm/v/@reshimu/shor.svg)](https://www.npmjs.com/package/@reshimu/shor)
[![PyPI version](https://img.shields.io/pypi/v/reshimu-shor.svg)](https://pypi.org/project/reshimu-shor/)
[![npm downloads](https://img.shields.io/npm/dm/@reshimu/shor.svg)](https://www.npmjs.com/package/@reshimu/shor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

SHOR sits between an agent's stated output and the world it is about to act on. Given the agent's text and the context that agent operated over — tool schemas, retrieved documents, conversation history — SHOR extracts every addressable entity in the output (numbers, identifiers, dates, quoted strings, citations, URLs, proper nouns) and verifies that each one actually appears in the context. The result is a four-level classification you can gate on. Sub-50ms on a 50k-token context, zero runtime dependencies, no LLM in the loop.

---

## Why SHOR

The dominant failure mode in production agent loops is not jailbreaks or refusals — it is grounded-looking fabrication. The agent confidently states "according to the SEC filing, Q3 revenue was $4.2M," and the user, or the next tool call, takes that as the input to a real action. The figure was invented. The model had no reason to know it. The wrapper that just generated the call had no opinion on whether the call was justified by the context it had seen, and it shipped anyway. We wrote about [the structural shape of this problem](https://reshimu.ai/blog/the-irreversible-action-problem.html) — the cost of unverified outputs scales not with the model's accuracy but with the irreversibility of the actions that consume them. The model alignment work doesn't reach that scale; the validator layer has to.

SHOR's wedge is narrow on purpose: deterministic, entity-level grounding. It does not read the output for meaning, does not ask "is this fact true," does not call another model. It pulls out the parts of the output that point at something specific — a dollar figure, a function name, a date, a quoted phrase, a cited source — and checks whether those literal tokens occur in the context the agent was given. When they do not, you have a hard signal: the agent has produced an entity it had no basis for. The broader argument for why this layer needs to exist alongside the model, not inside it, is in [Bearers of the Throne](https://reshimu.ai/depth/bearers-of-the-throne.html).

---

## Install

```bash
npm install @reshimu/shor
```

```bash
pip install reshimu-shor
```

Both packages have **zero runtime dependencies**. The TypeScript build is a single ESM bundle; the Python package is stdlib-only. No model downloads, no service calls, no telemetry.

---

## Quick start

### TypeScript

```ts
import { classify } from '@reshimu/shor'

const result = classify({
  output: 'Q3 revenue was $4.2M from 47 customers.',
  context: 'Q3 numbers: 47 customers signed up, revenue of $4.2M for the quarter.',
})

console.log(result.level)         // 'GROUNDED'
console.log(result.score)         // 1
console.log(result.flagForReview) // false
console.log(result.explanation)   // 'All extracted entities verified in context.'
```

Same output, smaller context — one entity missing:

```ts
const result = classify({
  output: 'Q3 revenue was $4.2M from 47 customers.',
  context: 'Q3 numbers: 47 customers signed up, but revenue was not disclosed.',
})

console.log(result.level)         // 'PARTIAL'
console.log(result.score)         // 0.6666666666666666
console.log(result.flagForReview) // true
console.log(result.explanation)   // "number '$4.2M' not found in context."

for (const entity of result.entities) {
  console.log(`  - "${entity.text}" [${entity.type}] found=${entity.found}`)
}
// - "Q3" [date] found=true
// - "$4.2M" [number] found=false
// - "47 customers" [number] found=true
```

The result is `PARTIAL`, not `UNGROUNDED`. The date and the customer count both appear in context; the dollar figure does not. That is the precision SHOR is built for: tell the caller *which* entities were verified and which were not, not just a global pass/fail.

### Python

```python
from reshimu_shor import classify

result = classify(
    output="Q3 revenue was $4.2M from 47 customers.",
    context="Q3 numbers: 47 customers signed up, revenue of $4.2M for the quarter.",
)

print(result.level)             # 'GROUNDED'
print(result.score)             # 1.0
print(result.flag_for_review)   # False
print(result.explanation)       # 'All extracted entities verified in context.'
```

```python
result = classify(
    output="Q3 revenue was $4.2M from 47 customers.",
    context="Q3 numbers: 47 customers signed up, but revenue was not disclosed.",
)

print(result.level)             # 'PARTIAL'
print(result.score)             # 0.6666666666666666
print(result.flag_for_review)   # True
print(result.explanation)       # "number '$4.2M' not found in context."

for entity in result.entities:
    print(f"  - {entity.text!r} [{entity.type}] found={entity.found}")
# - 'Q3' [date] found=True
# - '$4.2M' [number] found=False
# - '47 customers' [number] found=True
```

The TypeScript and Python implementations are functionally identical. A cross-language parity test runs every fixture through both and asserts the same `level`, `score`, `flag_for_review`, and per-entity `(text, type, found)` triple. If you mix the two — TS in a Node service, Python in a batch eval — you can rely on the same signal.

---

## Performance

Measured on a 200,000-character context (~50k tokens) on a 2024 M-series laptop, single-threaded, Node 20:

| Percentile | Latency |
|---|---|
| p50 | ~20 ms |
| p99 | ~34 ms |

The contract is **<50 ms p99** on inputs of `output ≤ 4k tokens` and `context ≤ 200k tokens`. The benchmark test in `tests/performance.test.ts` enforces this against a synthesized 50k-token context on every `npm test` run. Coverage runs are exempted from the perf assertion because v8 coverage instrumentation adds ~2–3× overhead and would produce misleading numbers.

Algorithmic shape: extraction is `O(N)` in output length over a fixed set of regexes; lookup is `O(E × C)` where `E` is the extracted entity count (bounded by output length, typically a few dozen) and `C` is context length. The constant factor is small because we normalize the context once and use the host language's native substring search. No precomputed index is built; for inputs under 200k characters, a single pass of `indexOf` per entity is faster than maintaining a suffix structure.

Throughput translates directly. At p99 = 34 ms, a single thread evaluates ~30 traces/second on the worst case. For batch evals over 50k–100k traces, that's a few minutes of wall time, not a job that needs distribution. For runtime gating, it's safely under the latency budget of any tool call that involves a real action.

---

## Classification levels

| Level | When | Recommended action |
|---|---|---|
| `GROUNDED` | Every extracted entity verified in context. | Proceed. |
| `PARTIAL` | Some entities verified, others not. | Block the action, surface the unverified entities to a human, or have the agent retry with explicit citations. |
| `UNGROUNDED` | No extracted entities verified. | Block. The output as a whole is unsupported. |
| `INDETERMINATE` | Output had no extractable entities (or fewer than `minEntities`). | SHOR has nothing to assert. Route based on your own policy. Common pattern: allow if the output is paraphrase / summary, escalate if the action is irreversible. |

`flagForReview` is `true` for `PARTIAL` and `UNGROUNDED` and `false` for `GROUNDED` and `INDETERMINATE`. The reason `INDETERMINATE` is **not** flagged: it means *SHOR could not check*, which is different from *SHOR checked and found problems*. Conflating the two produces noisy review queues. If you want to gate uncheckable outputs, branch on `level === 'INDETERMINATE'` directly.

`score` is `n_found / n_total` over the extracted entities — uniform weighting across types in v0. Boundary cases are exact: `GROUNDED` requires `score === 1`, `UNGROUNDED` requires `score === 0`, and any value strictly between is `PARTIAL`.

---

## What SHOR catches / What it does not

These limits are features. Precise tools that know their scope beat fuzzy tools that pretend to do everything.

| SHOR catches | SHOR does not catch |
|---|---|
| Fabricated specific values — dollar figures, percentages, counts, dates that do not appear in context. | Paraphrased hallucinations — the output rephrases a fabrication so no specific entity is matchable. |
| Invented function and method names — `db.fetchAll()` when the tool schema only defines `db.query()`. | Inferential overreach — the output extends a true premise to an unsupported conclusion using only words that exist in context. |
| Misquoted strings — quoted text that does not appear verbatim in any source. | Tone, style, sentiment, or values issues. |
| Misattributed citations — "according to X" where X exists in context but says nothing of the kind. (The citation entity resolves true; the cited *content* becomes its own entities and is graded independently.) | Coreference — "he said the deal closed at $X" without resolving who "he" is. |
| Referenced objects, files, or paths that were never in context — `src/lib/util.ts` when no such file appears anywhere upstream. | Mesa-optimization, deceptive alignment, or other capability-level risks. |
| Hallucinated proper nouns — invented names of people, products, places that appear in the output but not the context. | Cross-language matching — an English claim against a Spanish source. |
| | Semantic equivalents — `Q3` does not match `third quarter`; `$4.2M` does not match `four point two million dollars`. The number-expansion path is digit-only by design. |
| | A replacement for eval harnesses or red-teaming. SHOR is a runtime gate, not an alignment evaluation. |

The "does not catch" column matters because precision without honesty about scope makes the tool worse, not better. If you ship SHOR thinking it catches paraphrased fabrication, you will get bitten. It catches the things it can catch with high precision and ignores the rest.

---

## How each entity type behaves

The seven entity types have different extraction rules and different normalization rules. Knowing the specifics makes it much easier to predict what SHOR will and won't catch in your data.

### `number`

Catches: integers, decimals, currency, percentages, numbers with explicit units.

```ts
classify({
  output: 'Revenue was $4.2M, growth of 47%, from 1,234 customers.',
  context: 'Q3 had $4.2M in revenue, 47% growth, 1,234 customers signed up.',
}).level  // 'GROUNDED'
```

Normalization generates multiple forms — `$4.2M` is checked as both the literal `$4.2M` and the expanded digit form `4200000`. A context that says `Revenue: 4200000` will match an output that says `$4.2M`, and vice versa. Spelled-out numbers (`four point two million`) are **not** generated; this is documented as a known gap. Lone `0` and `1` are skipped to reduce noise from boolean flags and loop indices.

### `date`

Catches: ISO dates, named months, quarters, fiscal years, relative durations.

```ts
classify({
  output: 'Filed on January 15, 2024.',
  context: 'The 2024-01-15 filing was completed.',
}).level  // 'GROUNDED'
```

Normalization is bidirectional between ISO (`2024-01-15`) and written forms (`Jan 15, 2024`, `Jan 15 2024`, `Jan 15`). Quarter forms (`Q3`, `Q3 2024`) match themselves only; `Q3` does **not** match `third quarter`. Relative durations (`3 days ago`, `2 weeks ago`) match themselves and overlap with `number`; the tiebreaker prefers `date` when another date-typed entity sits within 30 characters in the same sentence, otherwise `number`.

### `identifier`

Catches: dotted access, function calls, snake_case, camelCase, paths, bracket access, generic syntax, template interpolation.

```ts
classify({
  output: 'Set user.email = db.query("SELECT id").id',
  context: 'Available fields: user.id, user.email. Available methods: db.query(sql).',
}).level  // 'GROUNDED'
```

Function-call forms are doubly normalized: `db.query()` checks against both the literal `db.query()` and the args-stripped form `db.query`. This is critical because the output and context often disagree on the argument list — the agent says it'll call `db.query()` (no args, abstract reference), the schema says `db.query(sql)` (with arg type). Stripping args makes those match. Identifiers must be at least 2 characters; single-char names like `i` and `x` are skipped.

### `quoted_string`

Catches: anything inside matched `"..."`, `'...'`, or `` `...` ``.

```ts
classify({
  output: 'The CEO said "we are going to win this quarter".',
  context: 'In the meeting the CEO said "we are going to win this quarter".',
}).level  // 'GROUNDED'
```

Apostrophes inside contractions (`I'll`, `don't`, `it's`) are **not** treated as single-quote openers. Without this guard, almost any natural English sentence would emit a spurious quoted_string spanning to the end of the output. Empty quotes (`""`) are skipped. Unclosed quotes capture to EOF. Internal whitespace is collapsed and smart quotes are ASCII-normalized before lookup.

### `citation`

Catches: 8 phrases (`according to`, `per the`, `as stated in`, `from the`, `the report says`, `the document mentions`, `they said`, `you said`), each followed by a trailing noun phrase of up to 6 tokens.

```ts
classify({
  output: 'According to the SEC filing, revenue was $4.2M.',
  context: 'The SEC filing covered Q3 results.',
}).level  // 'PARTIAL'  — citation found, $4.2M not found
```

The citation entity is the *trailing source* (`the SEC filing`), not the cited content. The cited content (`revenue was $4.2M`) becomes its own entities and is graded independently. This is the misattribution case: a real source can be cited as the basis for a fabricated claim, and SHOR will resolve the citation as `found: true` while the fabricated entity resolves as `found: false` — producing `PARTIAL`. Trailing phrases are bounded by comma, semicolon, sentence-ending punctuation (decimals like `$9.9M` excluded), or 6 tokens, whichever comes first.

### `url`

Catches: protocol URLs (`http://`, `https://`) and bare-domain forms with either a path or a known TLD.

```ts
classify({
  output: 'See https://example.com/docs for the API spec.',
  context: 'The docs live at https://example.com/docs.',
}).level  // 'GROUNDED'
```

Bare domains (no `http://`) require either a path component (`example.com/docs`) or one of a fixed set of ~25 known TLDs (`com`, `org`, `ai`, `io`, …). This avoids treating sentence-ending phrases like `End.Of.Day` as a URL. Trailing punctuation is stripped, query strings are preserved, and the lookup is lowercased with the trailing slash stripped — `https://example.com/` matches `https://example.com` and vice versa.

### `proper_noun`

Catches: multi-word capitalized phrases not at sentence start, plus single capitalized words that appear ≥ 2 times in the output.

```ts
classify({
  output: 'I met New York City visitors last week. Alice and Bob were there. Alice was on time.',
  context: 'New York City delegates met with Alice and Bob.',
}).level  // 'GROUNDED'
```

Multi-word names (`New York City`) are recognized as one entity. Single capitalized words are subject to a 2+ occurrence rule because a single capitalized word at sentence start is usually just a sentence-starter, not a name; requiring repetition reduces false positives without missing actual named entities, which tend to recur in the same output. Capitalized stopwords (`The`, `And`, `It`) are filtered. You can replace the stopword list via `options.stopwords`.

---

## The no-LLM principle

The dominant pattern in production agent safety today is using one LLM to grade another LLM's output. Often it's the same model grading itself. This pattern is structurally broken. The model that produced the output is the worst possible evaluator of whether that output is grounded — it has access to the same latents, the same training distribution, the same priors that produced the fabrication in the first place. It is biased toward justifying what it just said. Self-evaluation studies consistently show models grade their own work generously. And when the grader is a *different* model from the same family, the correlation in errors is high enough that the signal degrades sharply on exactly the inputs where you need it most.

SHOR refuses this pattern. It is deterministic. It does not call a model. It extracts named, addressable entities — numbers, identifiers, dates, quoted strings, citations, URLs, proper nouns — using a fixed set of regexes and an overlap-resolution rule. It normalizes each entity (lowercased substring in lenient mode; case-sensitive with token boundaries in strict mode) and checks whether the normalized form occurs in the normalized context. That's it. The classifier is dumb. That's the point. A dumb classifier is auditable: you can read the source, you know exactly what it catches, you can adversarially construct outputs that fool it and outputs that don't. A dumb classifier is deterministic: same input, same output, every time. A dumb classifier shares no latents with the system it grades, so its errors are uncorrelated with the system's errors — which is the entire reason to have a validator layer at all.

The price is scope. SHOR cannot catch paraphrased hallucinations. It cannot catch inference errors. It cannot read between lines. We accept this and document it (see the table above). For runtime gating, where you need a sub-50ms verdict on whether to let an action proceed, the determinism is the feature. For batch evaluation, where latency does not matter and you have a held-out judge, an LLM grader can be appropriate — provided it is a *different* family of model with a *different* training distribution. The argument is laid out fully in [Why we don't trust LLMs to classify the call they're about to make](https://reshimu.ai/blog/why-we-dont-trust-llms-to-classify.html).

---

## API reference

### TypeScript

```ts
import { classify } from '@reshimu/shor'

function classify(input: ClassifyInput): ClassifyResult

interface ClassifyInput {
  output: string
  context: string
  options?: ClassifyOptions
}

interface ClassifyOptions {
  /** strict mode adds case-sensitivity, token-boundary matching, and a
   *  single-sentence constraint to lookups. Default: false. */
  strict?: boolean

  /** Below this many extractable entities the result is INDETERMINATE.
   *  Default: 1. */
  minEntities?: number

  /** Restrict which entity types are extracted and counted. Default: ['all']. */
  entityTypes?: EntityType[] | ['all']

  /** Override the built-in 42-word English stopword list. Substitutive —
   *  pass [] to disable stopword filtering entirely. */
  stopwords?: string[]
}

interface ClassifyResult {
  level: 'GROUNDED' | 'PARTIAL' | 'UNGROUNDED' | 'INDETERMINATE'
  score: number                     // [0, 1]
  entities: Entity[]
  explanation: string               // short human-readable summary
  flagForReview: boolean            // true for PARTIAL and UNGROUNDED
}

interface Entity {
  text: string                      // original span as extracted from output
  normalized: string                // form used for lookup
  type: EntityType
  found: boolean
  locations: Array<[number, number]> // 0-indexed half-open char ranges into
                                     // the original context. Empty if not found.
}

type EntityType =
  | 'proper_noun'
  | 'identifier'
  | 'number'
  | 'date'
  | 'quoted_string'
  | 'citation'
  | 'url'
```

### Python

```python
from reshimu_shor import classify

def classify(
    output: str,
    context: str,
    *,
    strict: bool = False,
    min_entities: int = 1,
    entity_types: list[str] | None = None,
    stopwords: list[str] | None = None,
) -> ClassifyResult: ...

@dataclass(frozen=True)
class ClassifyResult:
    level: Level                    # 'GROUNDED' | 'PARTIAL' | 'UNGROUNDED' | 'INDETERMINATE'
    score: float                    # [0, 1]
    entities: tuple[Entity, ...]
    explanation: str
    flag_for_review: bool

@dataclass(frozen=True)
class Entity:
    text: str
    normalized: str
    type: EntityType
    found: bool
    locations: tuple[tuple[int, int], ...]
```

### Options in detail

**`strict`** — When `false` (the default), lookup is a lenient substring match: both context and entity are lowercased, smart quotes are normalized, and the entity is found if its normalized form appears anywhere in the normalized context. When `true`, three constraints stack:

1. **Case-sensitive** — lookup uses original casing. `Foo` does not match `foo`.
2. **Token-boundary** — the matched span must begin and end on a token boundary (whitespace, punctuation, or string boundary). `cat` does not match inside `category`.
3. **Single-sentence** — the matched span must lie within one sentence of the context. Prevents multi-word entities from accidentally matching across sentence joins.

There is no per-constraint toggle in v0; all three apply when `strict: true`.

**`minEntities`** — If the output produces fewer than this many extractable entities (after the `entityTypes` filter), the result is `INDETERMINATE` rather than `GROUNDED` or `UNGROUNDED`. Default is `1`. Raise this if you want stronger evidence — e.g., `minEntities: 3` means "only classify outputs that make at least three checkable claims."

**`entityTypes`** — A filter applied after extraction. `['all']` (the default) keeps every type. Pass a subset like `['number', 'date']` to count only those types toward the verdict. Useful when you only care about, say, fabricated financial figures and not invented proper nouns.

**`stopwords`** — Substitutive override of the built-in 42-word English stopword list (`a, an, the, i, you, he, she, it, we, they, ...`). Affects `proper_noun` extraction only. Pass `[]` to disable filtering entirely; pass a custom list to replace the built-in. Not additive — what you pass *is* the list.

### Return-value fields

**`level`** — One of the four classification levels documented above. The only field most callers should branch on.

**`score`** — Exact float `n_found / n_total` over entities that passed the `entityTypes` filter and dedup. `0` for `INDETERMINATE`. Use this if you want to compare across many calls or trend over time; do not threshold it for a binary gate (use `level` for that).

**`entities`** — The full per-entity ledger. Each entry tells you:
- `text` — the literal span as it appeared in the output
- `normalized` — the form actually used for lookup (lowercased, whitespace-collapsed, etc.)
- `type` — which entity type the extractor assigned
- `found` — boolean
- `locations` — half-open `[start, end)` character ranges in the original context where the entity was matched. Empty when `found` is `false`.

Use this when you want to surface the specific unverified claims to a human or to the agent itself for a retry.

**`explanation`** — A short human-readable summary, e.g. `"number '$4.2M' not found in context."` Names up to three unfound entities by type and text. Suitable for logs or surfacing in UI.

**`flagForReview`** — Convenience boolean. `true` exactly when `level` is `PARTIAL` or `UNGROUNDED`. Use this for the boolean gate; it expresses the intent more clearly than checking the level enum.

---

## Integration examples

### 1. Insert SHOR between a planning agent and a tool call

A common shape: a planning agent emits text describing the tool call it wants to make, then a runner parses the text into structured arguments and executes. The text is the unstructured surface; the structured call is what actually runs. SHOR sits between them.

```ts
import { classify } from '@reshimu/shor'

interface ToolSchema { name: string; signature: string; description: string }

async function planAndAct(
  task: string,
  conversationHistory: string,
  tools: ToolSchema[],
): Promise<{ status: 'executed' | 'blocked'; payload: unknown }> {
  // Planning agent produces a textual plan and a structured call.
  const plan = await planner.generate({ task, history: conversationHistory, tools })
  //   plan.text         -> "I'll call db.fetchAll() to load every row, then..."
  //   plan.toolCall     -> { name: 'db.fetchAll', args: {} }

  // Build the grounding context: tool schemas + conversation.
  const toolSchemas = tools.map(t => `${t.name}(${t.signature}) — ${t.description}`).join('\n')
  const context = `${toolSchemas}\n\n${conversationHistory}`

  const result = classify({
    output: plan.text,
    context,
    options: { strict: false, minEntities: 1 },
  })

  if (result.flagForReview) {
    // The plan referenced something not in the tools or the conversation.
    return {
      status: 'blocked',
      payload: {
        plan,
        shor: result,
        unverified: result.entities.filter(e => !e.found).map(e => e.text),
      },
    }
  }

  return { status: 'executed', payload: await runner.execute(plan.toolCall) }
}
```

On a plan like `"I'll call db.fetchAll() to load every row"` against a tool schema that only defines `db.query(sql)` and `db.count(table)`, SHOR returns:

```
level: 'UNGROUNDED'
score: 0
flagForReview: true
explanation: "identifier 'db.fetchAll()' not found in context."
```

The call is blocked before the runner ever sees it. The agent can be asked to retry, the unverified identifier can be surfaced to a human, or the loop can fall back to a known-safe path.

### 2. Run SHOR over RAG agent responses before showing to the user

Retrieval-augmented generation is a particularly clean fit because the retrieved documents *are* the context the agent was supposed to ground in. Anything in the answer that does not appear in the retrieved set is, by construction, ungrounded.

```python
from reshimu_shor import classify

def answer_with_rag(question: str) -> dict:
    docs = retrieve(question, k=5)
    context = "\n\n---\n\n".join(docs)
    answer = llm.generate(question=question, retrieved=docs)

    result = classify(output=answer, context=context, min_entities=2)

    if result.level == "UNGROUNDED":
        return {
            "answer": None,
            "status": "blocked",
            "reason": "Answer claims could not be verified against retrieved sources.",
            "shor": {
                "level": result.level,
                "explanation": result.explanation,
                "unverified": [e.text for e in result.entities if not e.found],
            },
        }

    if result.level == "PARTIAL":
        unverified = [e.text for e in result.entities if not e.found]
        return {
            "answer": answer,
            "status": "warn",
            "warning": (
                "Some specific claims in this answer were not found in the "
                "retrieved sources: " + ", ".join(unverified)
            ),
            "shor": result,
        }

    # GROUNDED or INDETERMINATE — show the answer.
    return {"answer": answer, "status": "ok", "shor": result}
```

The `INDETERMINATE` case here is important and easy to get wrong. A generic answer like "the user is asking about pricing" produces no extractable entities. That is not a bug; the answer makes no falsifiable claims. Letting it through is correct.

### 3. Use SHOR in evals (batch mode)

For offline evaluation across many traces, SHOR's sub-50ms throughput means you can run it over thousands of traces in seconds, then aggregate.

```ts
import { classify } from '@reshimu/shor'
import { readFileSync, writeFileSync } from 'node:fs'

interface Trace {
  id: string
  output: string
  context: string
}

const traces: Trace[] = JSON.parse(readFileSync('traces.jsonl', 'utf-8')
  .split('\n').filter(Boolean).map(line => line))

const counts = { GROUNDED: 0, PARTIAL: 0, UNGROUNDED: 0, INDETERMINATE: 0 }
const flagged: Array<{ id: string; level: string; unverified: string[] }> = []

const start = performance.now()
for (const trace of traces) {
  const result = classify({ output: trace.output, context: trace.context })
  counts[result.level]++
  if (result.flagForReview) {
    flagged.push({
      id: trace.id,
      level: result.level,
      unverified: result.entities.filter(e => !e.found).map(e => e.text),
    })
  }
}
const elapsed = performance.now() - start

console.log(`Processed ${traces.length} traces in ${elapsed.toFixed(0)}ms`)
console.log(counts)
console.log(
  `Hallucination rate: ${(
    (counts.PARTIAL + counts.UNGROUNDED) / traces.length * 100
  ).toFixed(1)}%`
)

writeFileSync('flagged.jsonl',
  flagged.map(f => JSON.stringify(f)).join('\n') + '\n')
```

Use the per-entity ledger in `flagged.jsonl` for downstream analysis — group by entity type to see what your agent fabricates most often (currencies? function names? dates?), or by source-document to see where retrieval is letting you down.

For evals that genuinely need to grade *paraphrased* claims, pair SHOR with an LLM judge — but only one from a different model family than the system under test, and only after SHOR has already eliminated the unambiguous fabrications. The LLM judge then becomes a small filter over a much smaller set of cases, not a primary grader.

### 4. Compose SHOR with NESHER for a complete pre-action gate

SHOR answers "is this output grounded?" NESHER answers "is the action this output would trigger reversible?" Either one in isolation is incomplete: a grounded output that triggers a destructive irreversible operation should still pause for review; an ungrounded output that triggers a read-only query is less urgent. The two compose into a runtime gate that reflects both axes.

```ts
import { classify as classifyGrounding } from '@reshimu/shor'
import { classify as classifyIrreversibility } from '@reshimu/nesher'

interface GateDecision {
  proceed: boolean
  reason: string
  details: {
    grounding: ReturnType<typeof classifyGrounding>
    irreversibility: ReturnType<typeof classifyIrreversibility>
  }
}

function gateToolCall(
  agentOutput: string,
  context: string,
  toolCall: { name: string; args: Record<string, unknown> },
): GateDecision {
  const grounding = classifyGrounding({ output: agentOutput, context })
  const irreversibility = classifyIrreversibility({ tool: toolCall.name, args: toolCall.args })

  const details = { grounding, irreversibility }

  // Hard block: ungrounded AND irreversible.
  if (grounding.level === 'UNGROUNDED' && irreversibility.level !== 'SAFE') {
    return { proceed: false, reason: 'Ungrounded output triggering irreversible action.', details }
  }

  // Soft block: partial grounding on an irreversible action.
  if (grounding.level === 'PARTIAL' && irreversibility.level === 'IRREVERSIBLE') {
    return { proceed: false, reason: 'Unverified claims involved in an irreversible action.', details }
  }

  // Allow with annotation: grounded irreversible, or partial reversible.
  if (irreversibility.level === 'IRREVERSIBLE' || grounding.flagForReview) {
    return { proceed: true, reason: 'Proceeding with elevated logging.', details }
  }

  // Clean path: grounded + reversible (or read-only).
  return { proceed: true, reason: 'Grounded and safe.', details }
}
```

The decision matrix is yours to tune. The point is that you have two orthogonal axes — *epistemic grounding* and *physical irreversibility* — and the right action depends on both. Combining them gives you a gate that distinguishes "this is wrong but harmless" from "this might be right but catastrophic if wrong" from "this is wrong AND catastrophic." A single classifier cannot make that distinction. This is also why the Atzmut OS roadmap calls for four validators, not one: each axis is meaningfully independent.

---

## Comparison to alternatives

A few common patterns for catching agent fabrication, and where each sits next to SHOR.

| Approach | What it catches | Latency | Determinism | Where to use |
|---|---|---|---|---|
| **SHOR** (this library) | Fabricated entities — numbers, names, identifiers, dates, quoted strings | <50 ms p99 | Deterministic, auditable | Runtime gating in front of tool calls. Pre-display checks on RAG output. |
| **LLM-as-judge** (same model) | In principle, anything. In practice, biased toward justifying the original output. | 1–5 s per call | Stochastic | Avoid. Self-evaluation is structurally compromised. |
| **LLM-as-judge** (different family) | Paraphrased claims, semantic mismatches | 1–5 s per call | Stochastic | Batch evals where you've already filtered with SHOR; not for runtime gating. |
| **Embedding similarity** (output ↔ context) | Topical drift | 50–200 ms with a model | Deterministic given a fixed embedding model | Coarse first-pass filtering; not specific enough to catch entity-level fabrication. |
| **Substring search** (DIY) | Same as SHOR's lookup layer | Fast | Deterministic | What SHOR is, plus an extraction layer, a normalization layer, an overlap resolver, and a classification rule. Skip the DIY. |
| **Fuzzing / red-teaming** | Discovery of failure modes during development | Offline, slow | Stochastic | Dev-time, not runtime. Complementary to SHOR, not a substitute. |

The honest pitch: SHOR is the highest-precision option for entity-level grounding at runtime latencies. If you need to catch *paraphrased* fabrication, pair SHOR with a different-family LLM judge in batch mode. If you need to catch *topical* drift, embedding similarity is a better tool. SHOR does not try to be those tools.

---

## FAQ

**Does SHOR work for non-English text?**

Partially. The regexes for numbers, dates, identifiers, and URLs are largely ASCII-pattern-based and work on any text that uses those conventions. Smart quotes from a fixed set of European languages are normalized. The 42-word stopword list is English-only — you can replace it via `options.stopwords` for other languages. Proper-noun extraction relies on Latin-script capitalization conventions and will not work for languages without case distinctions (Chinese, Japanese, Arabic). Citation phrases are English-only and will not fire in other languages until you fork the list. PR-friendly area.

**Why doesn't `$4.2M` match `four point two million`?**

Number normalization is digit-only by design. Generating spelled-out alternates would require a language-specific number-to-words layer that is out of scope for v0. The pragmatic answer: agents rarely fabricate spelled-out numbers. They fabricate digit-form numbers because that's what the source-of-truth documents contain. If your data is an exception, file an issue.

**What happens if my output and context are not in UTF-8?**

SHOR assumes both are UTF-8 strings. Decoding is the caller's responsibility. The string operations underlying SHOR are language-native — JavaScript and Python both handle Unicode strings cleanly, but the regex character classes are ASCII-bounded (`[a-z]`, `[A-Z]`, `\d`) to match the spec, so non-ASCII letters in identifiers or proper nouns will not be extracted. This is intentional for parity between TS and Python.

**Can I extend the entity types?**

Not in v0 — the entity taxonomy is fixed. The roadmap includes a plugin system for custom extractors in a future major version, but the cost of that flexibility is significant (overlap resolution, scoring, normalization rules all have to be parameterized) and we are not paying it until there is concrete demand. If you need a custom entity type, the cleanest pattern today is to run SHOR for the standard set and run your own check for the custom type in parallel.

**Does `flagForReview` mean "block"?**

It means "do not auto-proceed." Whether you block, route to a human, ask the agent to retry, or downgrade the operation depends on your application. A `PARTIAL` result on a deterministic read-only operation is much less concerning than a `PARTIAL` result on an irreversible write. Compose SHOR with [NESHER](https://github.com/reshimu/nesher) (the irreversibility classifier) for the full gate.

**What if the context is huge — does latency degrade?**

Lookup is `O(E × C)` where `C` is context length. At 200k characters (the documented limit), p99 is ~34 ms. At 1M characters, expect ~5× that. For practical purposes, anything you'd actually pass to a model fits within the documented envelope. If you have multi-megabyte contexts, chunk them and run SHOR per chunk, then merge.

**How does SHOR handle false positives — entities found by coincidence?**

The most common case is a short generic entity (`Q3`, `47`) matching by accident in a large context that doesn't actually contain the claim you care about. Two mitigations:

1. Use `strict: true` to require token-boundary matches and single-sentence containment.
2. Increase `minEntities` so coincidental single-match results don't dominate the score.

For very short outputs over very large contexts, false-positive rates do rise. SHOR is most useful when output and context are in roughly the same size class (the agent's response and the documents it was given to ground in), which is the realistic case.

**Is the source auditable?**

Yes. The TypeScript implementation is ~1,000 LOC of zero-dep, strict-typed source. The Python port is functionally identical and similarly sized. There are no models, no remote calls, no opaque dependencies. You can read every line of code that decides whether to flag an output. This is one of the explicit design goals.

---

## Known limitations and edge cases

The cases below are not bugs — they are documented consequences of SHOR's design. If your application falls into one of these, plan around it.

**Very short outputs against very large contexts have elevated false-positive rates on `GROUNDED`.** A single short entity like `47` or `Q3` has a high coincidental match rate in a 200k-character context. Mitigations: use `strict: true` to require token-boundary matches, or `minEntities: 3+` so a single coincidental match cannot drive the verdict.

**Acronyms are tricky.** A short uppercase acronym (`SEC`, `IBM`) appearing once in the output is not extracted as a proper noun under v0 rules (single capitalized requires 2+ occurrences). If your application leans on acronym names, this will undercount. Workaround: include them in your context as multi-word forms ("the SEC") or accept the heuristic.

**Decimal-heavy text is split unusually.** Sentence detection treats `.` followed by space as a sentence end, with a decimal-digit exception (`3.14` is one sentence). But abbreviations like `Dr. Smith` or `e.g.` are *not* exception-cased and will produce extra sentence boundaries. In strict mode this can occasionally reject a valid multi-sentence match. Workaround: avoid strict mode for free-form prose.

**The `(args)` strip is greedy.** `db.query()` matches `db.query(sql)` because we strip args from the entity. But it also matches `db.query(badArg)`, which is technically a different call. SHOR catches identity of the function name, not the correctness of the call. If you need argument-level grounding, build that on top.

**Unicode identifiers are not extracted.** Identifier patterns use ASCII letters only (`[a-zA-Z_$]`). Non-ASCII function/variable names — common in some non-English codebases — will be missed. This is intentional for TS/Python parity; the alternative is to deal with `\w` differences across regex flavors. If your codebase needs Unicode identifiers, file an issue.

**Long-context performance degrades linearly past the documented envelope.** At 200k chars (the documented limit) you get p99 ~34 ms. At 500k chars expect ~100 ms; at 1M chars ~250 ms. The algorithm is `O(E × C)` in the worst case. For multi-megabyte contexts, chunk and run per-chunk.

**SHOR does not catch self-contradiction.** If the output says "Q3 revenue was $4.2M" and the context also says "Q3 revenue was $7.7M," both numbers are extracted from their respective texts and the entity in the output (`$4.2M`) is correctly graded as `found: false`. But if the output were "Q3 revenue was $7.7M," it would be graded `GROUNDED` — even though the figure contradicts a different number in the source. SHOR matches; it does not reason about which of two values is correct.

**Cross-fixture mutation of options.** `options.stopwords` (if provided) is substitutive, not additive. Passing `['banana']` *replaces* the entire 42-word built-in list, which means common English stopwords like `the` will no longer be filtered. If you want to add to the built-in list, build the full list yourself and pass it.

---

## Where this fits in Atzmut OS

SHOR is the second of four planned validators in [Atzmut OS](https://reshimu.ai/depth/chayyot-validators.html), Reshimu's runtime stack for safe agent orchestration. NESHER, the first, classifies the *irreversibility* of an action — should this operation proceed without human review? SHOR classifies the *grounding* of an output — is what the agent just claimed actually supported by what it was given? Two more validators are in progress. Each is a standalone library that can be adopted independently; together they compose into a runtime gate that sits in front of every tool call an agent makes. The architectural argument for splitting safety into named, single-purpose validators — instead of one omnibus monitor — is the subject of the linked essay.

---

## Contributing & roadmap

### v0.x in scope

- **Type-weighted scoring** — let high-precision entity types (`quoted_string`, `identifier`) carry more weight than heuristic ones (`proper_noun`) in the score. Opt-in.
- **More citation phrases** — the v0 list of 8 phrases covers the main attribution patterns in English but is not exhaustive. PRs welcome.
- **Per-language stopword lists** — currently English-only. Adding a `stopwords_lang: 'en' | 'es' | ...` option that swaps the built-in is straightforward.
- **Locale-aware number forms** — European decimal/thousands separators (`1.234,56`).
- **Configurable known-TLD list** — currently fixed to ~25 common TLDs for bare-domain URL extraction.

### Not in scope for v0.x or v1.x

- Catching paraphrased hallucinations. This is a fundamentally different problem; it requires semantic comparison, which puts you back in LLM-judge territory. We may ship a *separate* validator for this — explicitly LLM-backed, explicitly slower, explicitly batch-only — but it will not be SHOR.
- Coreference resolution.
- Cross-language matching.
- Anything that calls a model at runtime.

### Where to discuss

- Open issues at [github.com/reshimu/shor/issues](https://github.com/reshimu/shor/issues).
- Architectural discussion: tag issues with `architecture` and reference the relevant spec section.
- Bug reports: include the `output`, `context`, `options`, and full `ClassifyResult` JSON. Reproductions without those are very hard to action.

### Versioning and stability

SHOR follows [semver](https://semver.org/). The public API surface is the exported `classify` function, the `ClassifyOptions` shape, and the `ClassifyResult` shape including the per-entity ledger. These are stable across patch and minor versions in v0.

What is **not** part of the stable contract:

- Specific entity-extraction heuristics. We may tighten or relax patterns in minor releases to fix false positives or negatives. A given output may be extracted differently across minor versions.
- The `explanation` string format. It is meant for humans, not for parsing. Do not assert on its exact text in tests.
- The order of entries in `entities`. Document order is the rule today, but if extraction rules change, order may shift. Sort or compare as sets if order matters to your downstream.
- Score precision. Scores are floats; rely on `level` for branching, not on numeric thresholds.

Major version bumps will be reserved for changes that meaningfully alter classification outcomes for existing inputs. We expect the next breaking change to come with the introduction of type-weighted scoring, which will land as `1.0.0`.

### Security

SHOR is pure-function code with no network access, no filesystem access, no `eval`, no dynamic code generation. The TS bundle and the Python package each have zero runtime dependencies, which means zero transitive supply-chain surface. The only "untrusted input" SHOR processes is the `output` and `context` strings the caller provides; these are operated on as opaque text and never executed, deserialized, or interpreted.

If you find a security issue that requires a private disclosure path, email security@reshimu.ai. Standard public issues are fine on the GitHub tracker. The threat model is intentionally minimal — there is almost no attack surface — but we treat it seriously because SHOR is a safety component, and a bug in a safety component is a bug in the safety guarantee.

### Development

```bash
git clone https://github.com/reshimu/shor.git
cd shor

# TypeScript
npm install
npm test               # run the full TS suite
npm run test:coverage  # coverage report
npm run typecheck      # tsc --noEmit

# Python
cd python
pip install -e ".[dev]"
pytest -v
mypy --strict reshimu_shor

# Cross-language parity
npx tsx scripts/generate-golden.ts   # regenerate tests/parity_golden.json from TS
cd python && pytest tests/test_cross_language_parity.py -v
```

PRs should keep both the TypeScript and Python implementations in sync. The cross-language parity test is the contract; if you change one side, you change the other, and the parity test confirms it.

---

## License

MIT. See [LICENSE](LICENSE).

---

*SHOR is part of [Reshimu.ai](https://reshimu.ai). For the architectural argument, see [Bearers of the Throne](https://reshimu.ai/depth/bearers-of-the-throne.html); for the no-LLM principle, see [Why we don't trust LLMs to classify the call they're about to make](https://reshimu.ai/blog/why-we-dont-trust-llms-to-classify.html); for the four-validator taxonomy, see [/depth/chayyot-validators](https://reshimu.ai/depth/chayyot-validators.html).*
