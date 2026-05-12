import { describe, it, expect } from 'vitest'
import { extract } from '../src/extractor.js'
import { DEFAULT_STOPWORDS } from '../src/utils.js'
import type { EntityType } from '../src/types.js'

const sw = DEFAULT_STOPWORDS

function find(text: string, type: EntityType): string[] {
  return extract(text, sw)
    .filter(e => e.type === type)
    .map(e => e.text)
}

function allTexts(text: string): string[] {
  return extract(text, sw).map(e => e.text)
}

describe('extractor: URL', () => {
  it('extracts http and https URLs', () => {
    const urls = find('Visit https://example.com or http://api.example.org/v1.', 'url')
    expect(urls).toContain('https://example.com')
    expect(urls).toContain('http://api.example.org/v1')
  })

  it('strips trailing punctuation', () => {
    const urls = find('See https://example.com.', 'url')
    expect(urls).toContain('https://example.com')
  })

  it('extracts bare domains with a path', () => {
    const urls = find('Read example.com/docs/index for more.', 'url')
    expect(urls.some(u => u.startsWith('example.com'))).toBe(true)
  })

  it('extracts bare domains with known TLDs', () => {
    const urls = find('Open reshimu.ai today.', 'url')
    expect(urls).toContain('reshimu.ai')
  })

  it('does not extract unknown-TLD sentence endings as bare domains', () => {
    const urls = find('Sentence.End of next.', 'url')
    expect(urls).toEqual([])
  })
})

describe('extractor: quoted_string', () => {
  it('extracts double-quoted strings', () => {
    expect(find('He said "hello world" loudly.', 'quoted_string')).toContain('"hello world"')
  })

  it('extracts backtick strings', () => {
    expect(find('Run `npm install` here.', 'quoted_string')).toContain('`npm install`')
  })

  it('extracts single-quoted strings', () => {
    expect(find('"', 'quoted_string')).toEqual([])
    expect(find("She replied 'sure' then left.", 'quoted_string')).toContain("'sure'")
  })

  it('skips empty quotes', () => {
    expect(find('The result was "" today.', 'quoted_string')).toEqual([])
  })

  it('captures unclosed quotes to EOF', () => {
    const qs = find('She said "this is unclosed', 'quoted_string')
    expect(qs[0]).toBe('"this is unclosed')
  })
})

describe('extractor: citation', () => {
  it('extracts trailing noun phrase after a citation phrase', () => {
    const cs = find('According to the SEC report, revenue grew.', 'citation')
    expect(cs.some(c => c.toLowerCase().includes('sec report'))).toBe(true)
  })

  it('matches "per the X"', () => {
    expect(find('Per the meeting minutes, the project is on track.', 'citation'))
      .toContain('meeting minutes')
  })

  it('matches "the document mentions X"', () => {
    expect(find('The document mentions quarterly losses for the quarter.', 'citation').length).toBeGreaterThan(0)
  })

  it('skips citation phrase with zero trailing tokens', () => {
    expect(find('per the.', 'citation')).toEqual([])
  })

  it('respects word boundaries', () => {
    expect(find('Wordsperthephrase.', 'citation')).toEqual([])
  })
})

describe('extractor: identifier', () => {
  it('extracts dotted access', () => {
    expect(find('Set user.email = something', 'identifier')).toContain('user.email')
  })

  it('extracts function call with args', () => {
    const ids = find('Call db.query("SELECT 1") today.', 'identifier')
    expect(ids.some(id => id.startsWith('db.query'))).toBe(true)
  })

  it('extracts snake_case names', () => {
    expect(find('use get_user_email here', 'identifier')).toContain('get_user_email')
  })

  it('extracts camelCase names', () => {
    expect(find('use getUserEmail here', 'identifier')).toContain('getUserEmail')
  })

  it('extracts paths', () => {
    const ids = find('Edit src/lib/util.ts now.', 'identifier')
    expect(ids.some(id => id.includes('src/lib/util.ts'))).toBe(true)
  })

  it('extracts bracket access', () => {
    const ids = find('Read arr[0] for the value.', 'identifier')
    expect(ids).toContain('arr[0]')
  })

  it('extracts brace interpolation', () => {
    const ids = find('use ${user.email} there', 'identifier')
    expect(ids).toContain('${user.email}')
  })

  it('extracts generic types', () => {
    expect(find('See Map<string, User> below.', 'identifier').some(s => s.startsWith('Map<'))).toBe(true)
  })

  it('skips single-character ids', () => {
    expect(find('let x = 5', 'identifier')).not.toContain('x')
  })

  it('does not extract pure number/number paths like 1/2', () => {
    expect(find('write 1/2 cup of flour', 'identifier').some(s => s === '1/2')).toBe(false)
  })
})

describe('extractor: date', () => {
  it('extracts ISO dates', () => {
    expect(find('On 2024-01-15 it shipped.', 'date')).toContain('2024-01-15')
  })

  it('extracts quarter forms', () => {
    expect(find('Q3 2024 was strong, Q4 weak.', 'date').some(d => d.startsWith('Q3'))).toBe(true)
  })

  it('extracts month-day-year', () => {
    expect(find('Filed January 15, 2024 for review.', 'date').some(d => d.toLowerCase().startsWith('january 15'))).toBe(true)
  })

  it('extracts relative durations', () => {
    expect(find('Released 3 days ago by ops.', 'date')).toContain('3 days ago')
  })

  it('extracts FY forms', () => {
    expect(find('Earnings up in FY24', 'date')).toContain('FY24')
  })
})

describe('extractor: number', () => {
  it('extracts currency with suffix', () => {
    expect(find('Revenue was $4.2M last quarter.', 'number')).toContain('$4.2M')
  })

  it('extracts percentages', () => {
    expect(find('Growth of 47% YoY.', 'number')).toContain('47%')
  })

  it('extracts number with unit', () => {
    expect(find('Only 47 customers signed up.', 'number').some(n => n.startsWith('47'))).toBe(true)
  })

  it('extracts numbers with commas', () => {
    expect(find('Total of 1,234 users today.', 'number').some(n => n.startsWith('1,234'))).toBe(true)
  })

  it('skips lone 0 and 1', () => {
    const ns = find('Set flag to 0 or 1 only.', 'number')
    expect(ns).not.toContain('0')
    expect(ns).not.toContain('1')
  })
})

describe('extractor: proper_noun', () => {
  it('extracts multi-word capitalized names not at sentence start', () => {
    const pns = find('I visited New York City last week.', 'proper_noun')
    expect(pns).toContain('New York City')
  })

  it('filters multi-word at sentence start', () => {
    const pns = find('New York City is great.', 'proper_noun')
    expect(pns).not.toContain('New York City')
  })

  it('extracts single capitalized when appearing 2+ times', () => {
    const pns = find('Alice told Bob about it. Then Alice left.', 'proper_noun')
    expect(pns.filter(p => p === 'Alice').length).toBe(2)
  })

  it('does not extract single-occurrence capitalized words', () => {
    const pns = find('I met Charles once.', 'proper_noun')
    expect(pns).not.toContain('Charles')
  })

  it('skips stopwords even when capitalized', () => {
    const pns = find('The The And And Or Or here today.', 'proper_noun')
    expect(pns).not.toContain('The')
    expect(pns).not.toContain('And')
    expect(pns).not.toContain('Or')
  })
})

describe('extractor: empty and edge cases', () => {
  it('returns empty for empty output', () => {
    expect(extract('', sw)).toEqual([])
  })

  it('returns empty for whitespace-only output', () => {
    expect(extract('   \n\t  ', sw)).toEqual([])
  })

  it('returns empty for stopword-only output', () => {
    expect(extract('the the and and or or', sw)).toEqual([])
  })

  it('emits entities in document order', () => {
    const ents = extract('First $1.5M then user.email then https://x.com/path', sw)
    for (let i = 1; i < ents.length; i++) {
      expect(ents[i]!.start).toBeGreaterThan(ents[i - 1]!.start)
    }
  })

  it('overlap resolution prefers higher-priority spans', () => {
    // URL > identifier; the URL contains a dot but should be one URL not multiple ids
    const ents = extract('See https://api.example.com/v1/users for details', sw)
    expect(ents.some(e => e.type === 'url')).toBe(true)
    // Inner segments shouldn't also be emitted as identifiers
    const containedIds = ents.filter(e => e.type === 'identifier' && e.start > 4 && e.end < 60)
    expect(containedIds.length).toBe(0)
  })

  it('stopword override (substitutive)', () => {
    const custom = new Set(['banana'])
    const pns = extract('Banana Banana hello here', custom).filter(e => e.type === 'proper_noun')
    // "Banana" is now a stopword → not extracted (occurs 2+ times normally)
    expect(pns.length).toBe(0)
  })

  it('empty stopword override disables filtering for proper_noun', () => {
    const empty = new Set<string>()
    const pns = extract('The The The And And things go.', empty).filter(e => e.type === 'proper_noun')
    // With no stopwords, "The" (3+ occurrences) becomes a proper noun
    expect(pns.some(e => e.text === 'The')).toBe(true)
  })

  it('produces sane output on a mixed paragraph', () => {
    const all = allTexts(
      'Per the SEC filing, $4.2M was reported on 2024-01-15 by John Smith at user.email@example.com.',
    )
    expect(all.length).toBeGreaterThan(0)
  })
})
