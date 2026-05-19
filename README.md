# SHOR

**Grounding validator for autonomous agent tool calls.**

[![npm](https://img.shields.io/npm/v/@reshimu/shor)](https://www.npmjs.com/package/@reshimu/shor)
[![PyPI](https://img.shields.io/pypi/v/reshimu-shor)](https://pypi.org/project/reshimu-shor/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## What it does

SHOR classifies whether a proposed agent action is **grounded in source material** — before the action runs.

When an agent claims a task is complete, generates a summary, drafts a response, or prepares a tool call that depends on prior context, SHOR checks whether the output is actually traceable to the inputs. It does this **without calling an LLM.**

Four classification levels:

| Level | Meaning |
|---|---|
| `GROUNDED` | All factual claims in the output have direct support in the source material |
| `PARTIAL` | Some claims are supported; others have no traceable source |
| `UNGROUNDED` | Output contains claims with no support in the provided sources |
| `INDETERMINATE` | Insufficient source material to evaluate grounding |

---

## Why no LLM

Using a language model to evaluate the output of another language model is a circular dependency. The evaluator shares the generator's failure modes: it can be persuaded by fluent writing, it fills gaps rather than flagging them, and it lacks a stable reference for what "support" means across runs.

SHOR uses deterministic entity extraction and span-level matching. Same input, same classification, every time. The grounding decision does not depend on a model's confidence in its own output.

This is the [Karpathy circular-evaluation problem](https://x.com/karpathy) operationalized as a constraint.

---

## Install

**npm:**
```bash
npm install @reshimu/shor
```

**PyPI:**
```bash
pip install reshimu-shor
```

---

## Usage

### JavaScript / TypeScript

```typescript
import { classify } from '@reshimu/shor'

const result = classify({
  output: "The meeting was scheduled for Thursday at 2pm in Conference Room B.",
  sources: [
    "Per the invite, the sync is Thursday 2:00 PM, CR-B.",
    "Attendees: Priya, Marcus, Leila."
  ]
})

console.log(result.level)       // 'GROUNDED'
console.log(result.score)       // 0.94
console.log(result.unmatched)   // []
```

```typescript
import { classify } from '@reshimu/shor'

const result = classify({
  output: "The Q3 revenue was $4.2M, up 18% from Q2.",
  sources: [
    "Q3 revenue: $4.2M."
    // No Q2 comparison in source material
  ]
})

console.log(result.level)       // 'PARTIAL'
console.log(result.unmatched)   // ['up 18% from Q2']
```

### Python

```python
from reshimu_shor import classify

result = classify(
    output="The patient was prescribed 500mg twice daily.",
    sources=[
        "Dosage: 500mg BID.",
        "Medication: amoxicillin."
    ]
)

print(result.level)       # 'GROUNDED'
print(result.score)       # 0.97
print(result.unmatched)   # []
```

---

## API

### `classify(options)`

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `output` | `string` | yes | The agent output to evaluate |
| `sources` | `string[]` | yes | Source documents or context the output is expected to draw from |
| `threshold` | `number` | no | Minimum span-match ratio for `GROUNDED` (default: `0.85`) |
| `strict` | `boolean` | no | If `true`, any unmatched claim returns `UNGROUNDED` regardless of threshold (default: `false`) |

**Returns:**

| Field | Type | Description |
|---|---|---|
| `level` | `'GROUNDED' \| 'PARTIAL' \| 'UNGROUNDED' \| 'INDETERMINATE'` | Classification result |
| `score` | `number` | Span-match ratio (0–1) |
| `unmatched` | `string[]` | Claims in `output` with no traceable source span |
| `matched` | `string[]` | Claims with at least one source match |

---

## Integrating in an agent loop

SHOR sits between your agent's output and the downstream action that depends on it:

```typescript
import { classify } from '@reshimu/shor'

async function agentAction(agentOutput: string, sourceContext: string[]) {
  const grounding = classify({ output: agentOutput, sources: sourceContext })

  if (grounding.level === 'UNGROUNDED') {
    return { blocked: true, reason: 'ungrounded output', unmatched: grounding.unmatched }
  }

  if (grounding.level === 'PARTIAL') {
    // Log and escalate, or continue with a reduced-trust flag
    console.warn('Partial grounding. Unmatched claims:', grounding.unmatched)
  }

  // Proceed
  return { blocked: false, output: agentOutput }
}
```

For Python agents, the pattern is identical — classify before the action fires.

---

## Part of the Reshimu runtime stack

SHOR is the second of four runtime integrity validators — the Chayyot — built by [Reshimu.ai](https://reshimu.ai) for autonomous agent governance.

| Validator | Role | Status |
|---|---|---|
| [NESHER](https://github.com/reshimu/nesher) | Irreversibility classifier — stops unrecoverable actions before execution | `v0.1.0` |
| **SHOR** | Grounding validator — checks that agent outputs trace to source material | `v0.1.0` |
| ARYEH | Scope classifier — detects out-of-bounds tool calls and capability overreach | in development |
| PANIM ADAM | Gray-zone escalator — routes ambiguous actions to the right handler | in development |

Each validator is a zero-dependency library usable independently. The [Atzmut OS](https://reshimu.ai) MCP server integrates all four into a single intercept layer.

---

## Design constraints

- **No LLM calls.** Classification is deterministic. No network dependency, no rate limit, no API key.
- **No native dependencies.** Runs in any Node.js or Python runtime without compilation.
- **Synchronous by default.** Sub-5ms on typical agent payloads.
- **Composable.** Drop it into any orchestration framework — LangChain, LlamaIndex, AutoGen, custom.

---

## Further reading

- [Why we don't trust LLMs to classify the call they're about to make](https://reshimu.ai/blog/why-no-llm-classifier.html) — the reasoning behind the no-LLM constraint
- [The irreversible action problem](https://reshimu.ai/blog/irreversible-action-problem.html) — NESHER companion piece
- [Bearers of the Throne](https://reshimu.ai/depth/chayyot-validators.html) — the full architectural pattern

---

## License

MIT © [Reshimu.ai](https://reshimu.ai)
