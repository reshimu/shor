import { describe, it, expect } from 'vitest'
import {
  buildNormalizedContext,
  findAll,
  type LookupConstraints,
} from '../src/lookup.js'

const LENIENT: LookupConstraints = { tokenBoundary: false, singleSentence: false }
const STRICT: LookupConstraints = { tokenBoundary: true, singleSentence: true }

describe('buildNormalizedContext', () => {
  it('collapses whitespace runs to single space', () => {
    const ctx = buildNormalizedContext('hello    world\n\ntest', false)
    expect(ctx.normalized).toBe('hello world test')
  })

  it('lowercases in lenient mode', () => {
    const ctx = buildNormalizedContext('Hello World', false)
    expect(ctx.normalized).toBe('hello world')
  })

  it('preserves case in strict mode', () => {
    const ctx = buildNormalizedContext('Hello World', true)
    expect(ctx.normalized).toBe('Hello World')
  })

  it('normalizes smart quotes to ASCII', () => {
    const ctx = buildNormalizedContext('She said “hello” today.', false)
    expect(ctx.normalized).toContain('"hello"')
  })

  it('builds an offset map back to original indices', () => {
    const original = 'Hello   World'
    const ctx = buildNormalizedContext(original, false)
    expect(ctx.offsetMap[0]).toBe(0)
    expect(ctx.offsetMap[ctx.offsetMap.length - 1]).toBe(12)
  })

  it('builds sentence ranges from . ! ?', () => {
    const ctx = buildNormalizedContext('First sentence. Second sentence! Third? End.', false)
    expect(ctx.sentenceRanges.length).toBeGreaterThanOrEqual(4)
  })

  it('does not split on decimals like 3.14', () => {
    const ctx = buildNormalizedContext('Pi is 3.14 approximately. Next.', false)
    expect(ctx.sentenceRanges.length).toBe(2)
  })

  it('detects sentence breaks at newline followed by capital', () => {
    const ctx = buildNormalizedContext('First fragment\nSecond fragment', false)
    expect(ctx.sentenceRanges.length).toBeGreaterThanOrEqual(2)
  })

  it('handles empty input', () => {
    const ctx = buildNormalizedContext('', false)
    expect(ctx.normalized).toBe('')
    expect(ctx.sentenceRanges).toEqual([])
  })

  it('handles whitespace-only input', () => {
    const ctx = buildNormalizedContext('   \n\t  ', false)
    expect(ctx.normalized).toBe('')
  })
})

describe('findAll: substring match', () => {
  it('finds a present substring and returns original-coord range', () => {
    const ctx = buildNormalizedContext('hello world', false)
    const hits = findAll('world', ctx, LENIENT)
    expect(hits.length).toBe(1)
    expect(hits[0]).toEqual([6, 11])
  })

  it('returns empty for absent substring', () => {
    const ctx = buildNormalizedContext('hello world', false)
    expect(findAll('zebra', ctx, LENIENT)).toEqual([])
  })

  it('returns multiple non-overlapping occurrences', () => {
    const ctx = buildNormalizedContext('cat dog cat dog cat', false)
    const hits = findAll('cat', ctx, LENIENT)
    expect(hits.length).toBe(3)
  })

  it('returns empty for empty needle', () => {
    const ctx = buildNormalizedContext('hello world', false)
    expect(findAll('', ctx, LENIENT)).toEqual([])
  })

  it('returns empty when needle longer than context', () => {
    const ctx = buildNormalizedContext('hi', false)
    expect(findAll('hello world', ctx, LENIENT)).toEqual([])
  })

  it('handles original-coord mapping through collapsed whitespace', () => {
    const ctx = buildNormalizedContext('Hello   World', false)
    const hits = findAll('hello world', ctx, LENIENT)
    expect(hits.length).toBe(1)
    expect(hits[0]![0]).toBe(0)
    expect(hits[0]![1]).toBe(13)
  })
})

describe('findAll: case handling', () => {
  it('lenient context is lowercased; lookup uses lowercase needles', () => {
    const ctx = buildNormalizedContext('Hello World', false)
    expect(findAll('hello', ctx, LENIENT).length).toBe(1)
    expect(findAll('Hello', ctx, LENIENT)).toEqual([])
  })

  it('strict context preserves case; lookup is case-sensitive', () => {
    const ctx = buildNormalizedContext('Hello World', true)
    expect(findAll('Hello', ctx, STRICT).length).toBe(1)
    expect(findAll('hello', ctx, STRICT)).toEqual([])
  })
})

describe('findAll: token boundary (strict)', () => {
  it('matches at word boundaries', () => {
    const ctx = buildNormalizedContext('cat dog', true)
    expect(findAll('cat', ctx, STRICT).length).toBe(1)
  })

  it('rejects sub-token matches in strict mode', () => {
    const ctx = buildNormalizedContext('category dog', true)
    expect(findAll('cat', ctx, STRICT)).toEqual([])
  })

  it('accepts sub-token matches in lenient mode', () => {
    const ctx = buildNormalizedContext('category dog', false)
    expect(findAll('cat', ctx, LENIENT).length).toBe(1)
  })

  it('treats punctuation as a token boundary', () => {
    const ctx = buildNormalizedContext('hello, world', true)
    expect(findAll('hello', ctx, STRICT).length).toBe(1)
  })
})

describe('findAll: single-sentence constraint (strict)', () => {
  it('rejects matches that span a sentence boundary', () => {
    const ctx = buildNormalizedContext('First sentence. Second sentence.', true)
    expect(findAll('sentence. Second', ctx, STRICT)).toEqual([])
  })

  it('accepts matches within a single sentence', () => {
    const ctx = buildNormalizedContext('First sentence here. Second one.', true)
    expect(findAll('First sentence', ctx, STRICT).length).toBe(1)
  })

  it('accepts in lenient mode regardless of sentence boundaries', () => {
    const ctx = buildNormalizedContext('First sentence. Second sentence.', false)
    expect(findAll('sentence. second', ctx, LENIENT).length).toBe(1)
  })
})
