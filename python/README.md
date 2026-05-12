# reshimu-shor

> Deterministic, non-LLM grounding & hallucination classifier for agent loops.

Python port of [@reshimu/shor](https://github.com/reshimu/shor). Functionally identical to the TypeScript implementation — same input produces the same classification. Sub-50ms. Zero runtime dependencies (stdlib only).

This is the minimal README. The full README ships at the project root in a later step.

## Install

```bash
pip install reshimu-shor
```

## Quick start

```python
from reshimu_shor import classify

result = classify(
    output="According to the report, Q3 revenue was $4.2M from 47 customers.",
    context="...the conversation history, tool outputs, documents the agent saw...",
)

print(result.level)            # 'GROUNDED' | 'PARTIAL' | 'UNGROUNDED' | 'INDETERMINATE'
print(result.score)            # [0, 1]
print(result.entities)         # per-entity lookup ledger
print(result.flag_for_review)  # True for PARTIAL and UNGROUNDED
```

## License

MIT
