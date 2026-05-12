// Generate the cross-language parity golden file from the TS implementation.
// Run with: npx tsx scripts/generate-golden.ts
//
// Output: tests/parity_golden.json — consumed by the Python parity test.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify } from '../src/index.js'
import type { ClassifyOptions, Entity } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = join(__dirname, '..', 'tests', 'fixtures')
const OUTPUT = join(__dirname, '..', 'tests', 'parity_golden.json')

interface FixtureRaw {
  output: string
  context?: string
  context_synthesize?: { seed: string; repeat: number; embed?: string }
  options?: ClassifyOptions
}

function buildContext(fx: FixtureRaw): string {
  if (fx.context !== undefined) return fx.context
  const syn = fx.context_synthesize
  if (syn) {
    const noise = syn.seed.repeat(syn.repeat)
    if (syn.embed === undefined) return noise
    const mid = Math.floor(noise.length / 2)
    return noise.slice(0, mid) + ' ' + syn.embed + ' ' + noise.slice(mid)
  }
  return ''
}

const files = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

const out: Record<string, unknown> = {}
for (const file of files) {
  const fx = JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')) as FixtureRaw
  const context = buildContext(fx)
  const result = classify({ output: fx.output, context, options: fx.options })
  out[file] = {
    level: result.level,
    score: result.score,
    flagForReview: result.flagForReview,
    entityCount: result.entities.length,
    foundCount: result.entities.filter((e: Entity) => e.found).length,
    entities: result.entities.map((e: Entity) => ({
      text: e.text,
      type: e.type,
      found: e.found,
    })),
  }
}

writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + '\n')
console.log(`Wrote ${Object.keys(out).length} golden results to ${OUTPUT}`)
