import { describe, it, expect } from 'vitest'
import { classify } from '../src/classifier.js'

describe('classifier: level boundaries', () => {
  it('GROUNDED when all entities present', () => {
    const r = classify({
      output: 'Revenue was $4.2M.',
      context: 'Q3 revenue grew to $4.2M according to the filing.',
    })
    expect(r.level).toBe('GROUNDED')
    expect(r.score).toBe(1)
    expect(r.flagForReview).toBe(false)
  })

  it('UNGROUNDED when no entities present', () => {
    const r = classify({
      output: 'Revenue was $7.7M.',
      context: 'Unrelated text about cats and dogs.',
    })
    expect(r.level).toBe('UNGROUNDED')
    expect(r.score).toBe(0)
    expect(r.flagForReview).toBe(true)
  })

  it('PARTIAL when some entities present', () => {
    const r = classify({
      output: 'Revenue was $4.2M and $7.7M and $9.9M.',
      context: '$4.2M was the figure last quarter.',
    })
    expect(r.level).toBe('PARTIAL')
    expect(r.score).toBeGreaterThan(0)
    expect(r.score).toBeLessThan(1)
    expect(r.flagForReview).toBe(true)
  })

  it('INDETERMINATE for empty output', () => {
    const r = classify({ output: '', context: 'anything here' })
    expect(r.level).toBe('INDETERMINATE')
    expect(r.score).toBe(0)
    expect(r.flagForReview).toBe(false)
    expect(r.explanation.toLowerCase()).toContain('empty')
  })

  it('INDETERMINATE when output has no extractable entities', () => {
    const r = classify({ output: 'just words here', context: 'anything' })
    expect(r.level).toBe('INDETERMINATE')
    expect(r.flagForReview).toBe(false)
  })

  it('INDETERMINATE when extracted entities below minEntities', () => {
    const r = classify({
      output: 'See $4.2M now.',
      context: 'unrelated',
      options: { minEntities: 5 },
    })
    expect(r.level).toBe('INDETERMINATE')
  })

  it('INDETERMINATE when entityTypes filter excludes all', () => {
    const r = classify({
      output: 'Revenue was $4.2M.',
      context: '$4.2M was the figure.',
      options: { entityTypes: ['url'] },
    })
    expect(r.level).toBe('INDETERMINATE')
  })

  it('score equals n_found / n_total exactly', () => {
    const r = classify({
      output: '$1.1M $2.2M $3.3M',
      context: '$1.1M was the only known figure.',
    })
    expect(r.score).toBeCloseTo(1 / 3, 5)
    expect(r.level).toBe('PARTIAL')
  })
})

describe('classifier: GROUNDED/PARTIAL boundary', () => {
  it('100% found = GROUNDED', () => {
    const r = classify({
      output: 'Check user.email and getUserEmail today.',
      context: 'The user.email field and getUserEmail function exist.',
    })
    expect(r.level).toBe('GROUNDED')
  })

  it('one missing entity flips GROUNDED to PARTIAL', () => {
    const r = classify({
      output: 'Check user.email and getUserEmail and fake_function today.',
      context: 'The user.email field and getUserEmail function exist.',
    })
    expect(r.level).toBe('PARTIAL')
  })
})

describe('classifier: PARTIAL/UNGROUNDED boundary', () => {
  it('zero found across multiple = UNGROUNDED', () => {
    const r = classify({
      output: '$1.1M $2.2M $3.3M revenue.',
      context: 'Different context with $9.9M total.',
    })
    expect(r.level).toBe('UNGROUNDED')
  })

  it('one of many found = PARTIAL, not UNGROUNDED', () => {
    const r = classify({
      output: '$4.2M $5.5M $6.6M from many customers.',
      context: '$4.2M was last quarter only.',
    })
    expect(r.level).toBe('PARTIAL')
    expect(r.flagForReview).toBe(true)
  })
})

describe('classifier: options', () => {
  it('entityTypes filter restricts what is counted', () => {
    const r = classify({
      output: 'Revenue was $4.2M and getUserEmail() succeeded.',
      context: '$4.2M is known.',
      options: { entityTypes: ['number'] },
    })
    expect(r.entities.every(e => e.type === 'number')).toBe(true)
    expect(r.level).toBe('GROUNDED')
  })

  it('stopwords override is substitutive', () => {
    const r = classify({
      output: 'Banana Banana hello world',
      context: 'unrelated',
      options: { stopwords: ['banana'] },
    })
    // "Banana" filtered, no other entities → INDETERMINATE
    expect(r.level).toBe('INDETERMINATE')
  })

  it('empty stopwords disables filtering for proper_noun', () => {
    const r = classify({
      output: 'The The And And things happen.',
      context: 'unrelated',
      options: { stopwords: [] },
    })
    // With no stopwords, capitalized repeats become proper nouns → entities exist
    expect(r.level).not.toBe('INDETERMINATE')
  })

  it('minEntities=3 forces INDETERMINATE when fewer extracted', () => {
    const r = classify({
      output: 'See $4.2M today.',
      context: 'unrelated',
      options: { minEntities: 3 },
    })
    expect(r.level).toBe('INDETERMINATE')
  })

  it('flagForReview is explicitly false for INDETERMINATE', () => {
    const r = classify({ output: '', context: 'whatever' })
    expect(r.flagForReview).toBe(false)
  })
})

describe('classifier: date normalization (bidirectional)', () => {
  it('ISO date in output matches written form in context', () => {
    const r = classify({
      output: 'Filed on 2024-01-15.',
      context: 'Filed on Jan 15, 2024 by the team.',
    })
    expect(r.level).toBe('GROUNDED')
  })

  it('Written date in output matches ISO form in context', () => {
    const r = classify({
      output: 'Filed on January 15, 2024.',
      context: 'Filed on 2024-01-15 by the team.',
    })
    expect(r.level).toBe('GROUNDED')
  })
})

describe('classifier: explanation', () => {
  it('GROUNDED explanation states all verified', () => {
    const r = classify({
      output: 'See $4.2M today.',
      context: '$4.2M was reported.',
    })
    expect(r.explanation.toLowerCase()).toContain('verified')
  })

  it('UNGROUNDED explanation names unfound entities', () => {
    const r = classify({
      output: 'See $7.7M today.',
      context: 'unrelated text',
    })
    expect(r.explanation).toContain('$7.7M')
  })
})

describe('classifier: entity locations', () => {
  it('reports character-offset locations for found entities', () => {
    const r = classify({
      output: 'Revenue was $4.2M.',
      context: 'The $4.2M figure was reported',
    })
    const found = r.entities.find(e => e.found)
    expect(found).toBeDefined()
    expect(found!.locations.length).toBeGreaterThan(0)
    const [start, end] = found!.locations[0]!
    expect(typeof start).toBe('number')
    expect(typeof end).toBe('number')
    expect(end).toBeGreaterThan(start)
  })

  it('locations are half-open [start, end)', () => {
    const r = classify({
      output: 'See $4.2M today.',
      context: '$4.2M reported.',
    })
    const found = r.entities.find(e => e.found)
    expect(found).toBeDefined()
    const [start, end] = found!.locations[0]!
    // Length matches "$4.2M" = 5 chars
    expect(end - start).toBe(5)
  })
})
