// Quick verification that the README examples produce the documented output.
import { classify } from '../src/index.js'

function show(label: string, input: { output: string; context: string }, opts?: Record<string, unknown>) {
  const r = classify({ output: input.output, context: input.context, options: opts as never })
  console.log(`\n=== ${label} ===`)
  console.log(`level: ${r.level}`)
  console.log(`score: ${r.score}`)
  console.log(`flagForReview: ${r.flagForReview}`)
  console.log(`explanation: ${r.explanation}`)
  console.log(`entities:`)
  for (const e of r.entities) {
    console.log(`  - "${e.text}" [${e.type}] found=${e.found}`)
  }
}

show('quick-start GROUNDED', {
  output: 'Q3 revenue was $4.2M from 47 customers.',
  context: 'Q3 numbers: 47 customers signed up, revenue of $4.2M for the quarter.',
})

show('quick-start PARTIAL', {
  output: 'Q3 revenue was $4.2M from 47 customers.',
  context: 'Q3 numbers: 47 customers signed up, but revenue was not disclosed.',
})

show('hallucinated SEC report', {
  output: 'According to the SEC report, revenue was $4.2M.',
  context: 'The SEC report covered market conditions. No revenue figures were disclosed.',
})

show('pre-tool-call gate', {
  output: 'I will call db.fetchAll() to load every row.',
  context: 'Available tools: db.query(sql), db.count(table). No bulk-fetch methods exist.',
})
