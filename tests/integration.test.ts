import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify } from '../src/classifier.js'
import type { ClassifyOptions, Level } from '../src/types.js'

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

interface Fixture {
  name: string
  description: string
  output: string
  context?: string
  context_synthesize?: { seed: string; repeat: number; embed?: string }
  options?: ClassifyOptions
  expected: {
    level: Level
    minScore?: number
    maxScore?: number
    flagForReview?: boolean
  }
}

function loadFixture(file: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf-8')) as Fixture
}

function buildContext(fx: Fixture): string {
  if (fx.context !== undefined) return fx.context
  if (fx.context_synthesize) {
    const { seed, repeat, embed } = fx.context_synthesize
    const noise = seed.repeat(repeat)
    if (embed === undefined) return noise
    // Embed the relevant content in the middle of the noise
    const mid = Math.floor(noise.length / 2)
    return noise.slice(0, mid) + ' ' + embed + ' ' + noise.slice(mid)
  }
  return ''
}

const files = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()

describe('integration: realistic fixtures', () => {
  for (const file of files) {
    const fx = loadFixture(file)
    it(`${file}: ${fx.name}`, () => {
      const context = buildContext(fx)
      const result = classify({
        output: fx.output,
        context,
        options: fx.options,
      })
      const debug = JSON.stringify(
        { level: result.level, score: result.score, entities: result.entities },
        null,
        2,
      )
      expect(result.level, `expected ${fx.expected.level}, got ${result.level}\n${debug}`).toBe(
        fx.expected.level,
      )
      if (fx.expected.minScore !== undefined) {
        expect(result.score).toBeGreaterThanOrEqual(fx.expected.minScore)
      }
      if (fx.expected.maxScore !== undefined) {
        expect(result.score).toBeLessThanOrEqual(fx.expected.maxScore)
      }
      if (fx.expected.flagForReview !== undefined) {
        expect(result.flagForReview).toBe(fx.expected.flagForReview)
      }
    })
  }
})

describe('integration: very long context', () => {
  it('classifies correctly with ~50k-token context', () => {
    const seed =
      'Routine status update with no specific numbers. Team members met as scheduled. Various items were discussed. '
    // Roughly 50k tokens ≈ 200k characters
    const noiseLen = 50_000
    const noise = seed.repeat(Math.ceil(200_000 / seed.length)).slice(0, 200_000)
    const half = Math.floor(noise.length / 2)
    const context =
      noise.slice(0, half) +
      ' The CEO reported Q3 revenue of $4.2M from 47 customers. ' +
      noise.slice(half)
    const result = classify({
      output: 'Q3 revenue was $4.2M from 47 customers.',
      context,
    })
    expect(result.level).toBe('GROUNDED')
    expect(noiseLen).toBeGreaterThan(0) // silence unused-var
  })
})
