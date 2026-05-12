import { describe, it, expect } from 'vitest'
import { classify } from '../src/index.js'
import type {
  EntityType,
  Level,
  Entity,
  ClassifyOptions,
  ClassifyInput,
  ClassifyResult,
} from '../src/index.js'

describe('public API surface', () => {
  it('re-exports classify from package root', () => {
    expect(typeof classify).toBe('function')
  })

  it('classify returns a typed result through the public entry', () => {
    const r: ClassifyResult = classify({
      output: '$4.2M',
      context: '$4.2M was reported.',
    })
    expect(r.level).toBe('GROUNDED')
    expect(r.score).toBe(1)
    expect(Array.isArray(r.entities)).toBe(true)
  })

  it('exposed types are usable at the call site', () => {
    const opts: ClassifyOptions = {
      strict: false,
      minEntities: 1,
      entityTypes: ['number'],
      stopwords: [],
    }
    const input: ClassifyInput = {
      output: 'see $4.2M',
      context: '$4.2M known',
      options: opts,
    }
    const r = classify(input)
    const ent: Entity | undefined = r.entities[0]
    const lvl: Level = r.level
    const et: EntityType | undefined = ent?.type
    expect(lvl).toBeDefined()
    expect(et === undefined || typeof et === 'string').toBe(true)
  })
})
