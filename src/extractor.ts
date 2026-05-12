import type { EntityType, RawEntity } from './types.js'

// Priority for overlap resolution: when two candidates overlap and one is not
// strictly contained in the other, the higher-priority span wins. Ties broken
// by longer span first.
const PRIORITY: Record<EntityType, number> = {
  url: 7,
  quoted_string: 6,
  citation: 5,
  identifier: 4,
  date: 3,
  number: 2,
  proper_noun: 1,
}

const CITATION_PHRASES: ReadonlyArray<string> = [
  'according to',
  'per the',
  'as stated in',
  'from the',
  'the report says',
  'the document mentions',
  'they said',
  'you said',
]

const KNOWN_TLDS = new Set([
  'com', 'org', 'net', 'io', 'ai', 'dev', 'app', 'co', 'gov', 'edu',
  'info', 'me', 'us', 'uk', 'de', 'fr', 'jp', 'cn', 'ru', 'br', 'in',
  'tech', 'so', 'xyz', 'site', 'cloud', 'page',
])

interface PriorityCandidate extends RawEntity {
  priority: number
}

export function extract(
  output: string,
  stopwords: ReadonlySet<string>,
): RawEntity[] {
  if (output.length === 0) return []

  const candidates: PriorityCandidate[] = []
  collect(candidates, scanUrls(output))
  collect(candidates, scanQuotedStrings(output))
  collect(candidates, scanCitations(output))
  collect(candidates, scanIdentifiers(output))
  collect(candidates, scanDates(output))
  collect(candidates, scanNumbers(output))
  collect(candidates, scanProperNouns(output, stopwords))

  applyDateNumberTiebreaker(candidates, output)
  return resolveOverlaps(candidates)
}

function collect(into: PriorityCandidate[], items: RawEntity[]): void {
  for (const e of items) {
    into.push({ ...e, priority: PRIORITY[e.type] })
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Scanners — each emits candidates of one type, in document order.
// ────────────────────────────────────────────────────────────────────────────

function scanUrls(s: string): RawEntity[] {
  const out: RawEntity[] = []
  const TRAILING = /[.,;:!?)\]]/

  // http(s)://...
  const protoRe = /https?:\/\/[^\s<>"'`)\]]+/gi
  for (const m of s.matchAll(protoRe)) {
    if (m.index === undefined) continue
    const start = m.index
    let end = start + m[0].length
    while (end > start && TRAILING.test(s.charAt(end - 1))) end--
    out.push({ text: s.slice(start, end), type: 'url', start, end })
  }

  // Bare-domain forms: require either a slash path or a known TLD ending.
  const bareRe = /\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"'`)\]]*)?/gi
  for (const m of s.matchAll(bareRe)) {
    if (m.index === undefined) continue
    const start = m.index
    let end = start + m[0].length
    while (end > start && TRAILING.test(s.charAt(end - 1))) end--
    const text = s.slice(start, end)
    const hasPath = text.includes('/')
    const tld = text.split('/')[0]!.split('.').pop()!.toLowerCase()
    if (!hasPath && !KNOWN_TLDS.has(tld)) continue
    // Skip if this overlaps with a protocol URL already captured.
    if (out.some(u => u.start <= start && u.end >= end)) continue
    out.push({ text, type: 'url', start, end })
  }
  return out
}

function scanQuotedStrings(s: string): RawEntity[] {
  const out: RawEntity[] = []
  const openers: Record<string, string> = { '"': '"', "'": "'", '`': '`' }
  let i = 0
  while (i < s.length) {
    const c = s.charAt(i)
    if (!(c in openers)) { i++; continue }

    // Apostrophe-in-contraction guard: `'` preceded by a word char (e.g. "I'll")
    // is not a quote opener.
    if (c === "'" && i > 0 && isWordChar(s.charAt(i - 1))) {
      i++
      continue
    }

    const close = openers[c]!
    let j = i + 1
    while (j < s.length) {
      if (s.charAt(j) === '\\' && j + 1 < s.length) { j += 2; continue }
      if (s.charAt(j) === close) {
        // For single quotes, an apostrophe inside a word (e.g. "don't") is not a
        // closer. Surrounded-by-word-chars → skip.
        if (
          c === "'" &&
          j > 0 && j + 1 < s.length &&
          isWordChar(s.charAt(j - 1)) && isWordChar(s.charAt(j + 1))
        ) { j++; continue }
        break
      }
      j++
    }
    const start = i
    const end = j < s.length ? j + 1 : s.length
    if (end - start > 2) {
      out.push({ text: s.slice(start, end), type: 'quoted_string', start, end })
    }
    i = end
  }
  return out
}

function isWordChar(c: string): boolean {
  if (c === '_' || c === '$') return true
  const cc = c.charCodeAt(0)
  return (cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)
}

function scanCitations(s: string): RawEntity[] {
  const out: RawEntity[] = []
  const lower = s.toLowerCase()

  for (const phrase of CITATION_PHRASES) {
    let from = 0
    while (from < lower.length) {
      const idx = lower.indexOf(phrase, from)
      if (idx === -1) break

      // Word boundary before the phrase
      const before = idx === 0 ? '' : s.charAt(idx - 1)
      if (before !== '' && /\w/.test(before)) {
        from = idx + 1
        continue
      }

      // Skip leading whitespace after the phrase
      let t = idx + phrase.length
      while (t < s.length && /\s/.test(s.charAt(t))) t++

      // Collect up to 6 tokens, stopping at clause/sentence terminators.
      let tokens = 0
      let inWord = false
      let endIdx = t
      while (endIdx < s.length) {
        if (isCitationStop(s, endIdx)) break
        const ch = s.charAt(endIdx)
        const isSp = /\s/.test(ch)
        if (!isSp && !inWord) {
          tokens++
          if (tokens > 6) break
          inWord = true
        } else if (isSp && inWord) {
          inWord = false
        }
        endIdx++
      }
      while (endIdx > t && /\s/.test(s.charAt(endIdx - 1))) endIdx--

      if (endIdx > t) {
        out.push({
          text: s.slice(t, endIdx),
          type: 'citation',
          start: t,
          end: endIdx,
        })
      }
      from = idx + phrase.length
    }
  }
  return out
}

function isCitationStop(s: string, idx: number): boolean {
  const ch = s.charAt(idx)
  if (ch === ',' || ch === ';' || ch === '!' || ch === '?' || ch === '\n') return true
  if (ch === '.') {
    const prev = idx > 0 ? s.charAt(idx - 1) : ''
    const next = idx + 1 < s.length ? s.charAt(idx + 1) : ''
    const isDecimal =
      prev >= '0' && prev <= '9' && next >= '0' && next <= '9'
    return !isDecimal
  }
  return false
}

function scanIdentifiers(s: string): RawEntity[] {
  const candidates: RawEntity[] = []

  // Brace interpolation: ${...} or {ident} or {ident.path}
  const interpRe = /\$\{[^}]+\}|\{[a-zA-Z_$][\w$.]*\}/g
  for (const m of s.matchAll(interpRe)) {
    if (m.index === undefined) continue
    candidates.push({ text: m[0], type: 'identifier', start: m.index, end: m.index + m[0].length })
  }

  // Dotted access (optionally with a call): foo.bar, foo.bar.baz(args)
  const dottedRe = /\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+(?:\([^)]*\))?/g
  for (const m of s.matchAll(dottedRe)) {
    if (m.index === undefined) continue
    candidates.push({ text: m[0], type: 'identifier', start: m.index, end: m.index + m[0].length })
  }

  // Generic syntax: Map<K, V>, Array<int>
  const genericRe = /\b[A-Z][a-zA-Z0-9_$]*<[^<>]+>/g
  for (const m of s.matchAll(genericRe)) {
    if (m.index === undefined) continue
    candidates.push({ text: m[0], type: 'identifier', start: m.index, end: m.index + m[0].length })
  }

  // Bracketed access: arr[0], dict["k"], users[i].email
  const bracketRe = /\b[a-zA-Z_$][\w$]*(?:\[[^\]]+\])+(?:\.[a-zA-Z_$][\w$]*)*/g
  for (const m of s.matchAll(bracketRe)) {
    if (m.index === undefined) continue
    candidates.push({ text: m[0], type: 'identifier', start: m.index, end: m.index + m[0].length })
  }

  // Slash-paths: src/lib/util.ts, /api/v1/users, ./relative/path.py
  const pathRe = /(?:\.{1,2}\/|\/)[a-zA-Z0-9_\-./]+|\b[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_\-./]+)+/g
  for (const m of s.matchAll(pathRe)) {
    if (m.index === undefined) continue
    const text = m[0]
    // Skip pure number-slash patterns like "1/2"
    if (/^\d+\/\d+$/.test(text)) continue
    candidates.push({ text, type: 'identifier', start: m.index, end: m.index + text.length })
  }

  // Function call: foo(args)
  const funcRe = /\b[a-zA-Z_$][\w$]*\([^)]*\)/g
  for (const m of s.matchAll(funcRe)) {
    if (m.index === undefined) continue
    candidates.push({ text: m[0], type: 'identifier', start: m.index, end: m.index + m[0].length })
  }

  // snake_case
  const snakeRe = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g
  for (const m of s.matchAll(snakeRe)) {
    if (m.index === undefined) continue
    candidates.push({ text: m[0], type: 'identifier', start: m.index, end: m.index + m[0].length })
  }

  // camelCase / PascalCase with at least one internal upper→lower transition
  const camelRe = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+\b/g
  for (const m of s.matchAll(camelRe)) {
    if (m.index === undefined) continue
    candidates.push({ text: m[0], type: 'identifier', start: m.index, end: m.index + m[0].length })
  }

  return candidates.filter(c => c.end - c.start >= 2)
}

function scanDates(s: string): RawEntity[] {
  const out: RawEntity[] = []
  const patterns: RegExp[] = [
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{4}-Q[1-4]\b/g,
    /\bQ[1-4](?:\s+\d{4})?\b/g,
    /\bFY\d{2,4}\b/g,
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+\d{4})?\b/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    /\b\d+\s+(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?)(?:\s+ago)?\b/gi,
  ]
  for (const re of patterns) {
    for (const m of s.matchAll(re)) {
      if (m.index === undefined) continue
      out.push({ text: m[0], type: 'date', start: m.index, end: m.index + m[0].length })
    }
  }
  return out
}

function scanNumbers(s: string): RawEntity[] {
  const out: RawEntity[] = []

  // Currency forms: $4.2M, €1,200, £500k
  const currencyRe = /[$€£¥]\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?[KkMmBbTt]?/g
  for (const m of s.matchAll(currencyRe)) {
    if (m.index === undefined) continue
    out.push({ text: m[0], type: 'number', start: m.index, end: m.index + m[0].length })
  }

  // Percent: 47%, 3.5%
  const percentRe = /[+-]?\d+(?:\.\d+)?%/g
  for (const m of s.matchAll(percentRe)) {
    if (m.index === undefined) continue
    out.push({ text: m[0], type: 'number', start: m.index, end: m.index + m[0].length })
  }

  // Bare number with suffix: 4.2M, 500k
  const suffixRe = /\b\d+(?:\.\d+)?[KkMmBbTt]\b/g
  for (const m of s.matchAll(suffixRe)) {
    if (m.index === undefined) continue
    out.push({ text: m[0], type: 'number', start: m.index, end: m.index + m[0].length })
  }

  // Number with explicit unit token: 47 customers, 3 days
  const unitRe = /[+-]?\d+(?:,\d{3})*(?:\.\d+)?\s+[a-zA-Z]{2,}\b/g
  for (const m of s.matchAll(unitRe)) {
    if (m.index === undefined) continue
    out.push({ text: m[0], type: 'number', start: m.index, end: m.index + m[0].length })
  }

  // Plain number (signed/unsigned, decimals, comma groupings)
  const plainRe = /[+-]?\d+(?:,\d{3})*(?:\.\d+)?/g
  for (const m of s.matchAll(plainRe)) {
    if (m.index === undefined) continue
    const text = m[0]
    // Skip lone 0 / 1
    const bare = text.replace(/^[+-]/, '')
    if (bare === '0' || bare === '1') continue
    out.push({ text, type: 'number', start: m.index, end: m.index + text.length })
  }

  return out
}

function scanProperNouns(s: string, stopwords: ReadonlySet<string>): RawEntity[] {
  const out: RawEntity[] = []

  // Multi-word: 2+ consecutive capitalized words.
  const multiRe = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g
  for (const m of s.matchAll(multiRe)) {
    if (m.index === undefined) continue
    const text = m[0]
    const tokens = text.split(/\s+/).map(t => t.toLowerCase())
    if (tokens.every(t => stopwords.has(t))) continue
    // Filter sentence-start multi-word spans (heuristic).
    if (isAtSentenceStart(s, m.index)) continue
    out.push({ text, type: 'proper_noun', start: m.index, end: m.index + text.length })
  }

  // Single capitalized appearing ≥ 2 times (excluding stopwords).
  const singleRe = /\b[A-Z][a-z]{2,}\b/g
  const occurrences = new Map<string, Array<[number, number]>>()
  for (const m of s.matchAll(singleRe)) {
    if (m.index === undefined) continue
    const text = m[0]
    if (stopwords.has(text.toLowerCase())) continue
    const list = occurrences.get(text) ?? []
    list.push([m.index, m.index + text.length])
    occurrences.set(text, list)
  }
  for (const [text, hits] of occurrences) {
    if (hits.length < 2) continue
    for (const [start, end] of hits) {
      out.push({ text, type: 'proper_noun', start, end })
    }
  }

  return out
}

function isAtSentenceStart(s: string, idx: number): boolean {
  if (idx === 0) return true
  let j = idx - 1
  while (j >= 0 && /\s/.test(s.charAt(j))) j--
  if (j < 0) return true
  const prev = s.charAt(j)
  return prev === '.' || prev === '!' || prev === '?'
}

// ────────────────────────────────────────────────────────────────────────────
// Overlap resolution + date/number tiebreaker
// ────────────────────────────────────────────────────────────────────────────

function applyDateNumberTiebreaker(
  candidates: PriorityCandidate[],
  output: string,
): void {
  const relUnit = /\d+\s+(?:days?|weeks?|months?|years?|hours?|minutes?|seconds?)$/i
  const sentences = splitSentencesOriginal(output)
  const toDrop = new Set<number>()

  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]
    if (!a || a.type !== 'date') continue
    if (!relUnit.test(a.text)) continue

    // Look for an overlapping number with identical span.
    let twinNumberIdx = -1
    for (let j = 0; j < candidates.length; j++) {
      const b = candidates[j]
      if (!b || b.type !== 'number') continue
      if (b.start === a.start && b.end === a.end) {
        twinNumberIdx = j
        break
      }
    }
    if (twinNumberIdx === -1) continue

    const sentence = sentences.find(([s, e]) => s <= a.start && a.end <= e)
    if (!sentence) {
      // Default to number, drop the date candidate.
      toDrop.add(i)
      continue
    }

    let hasNearbyDate = false
    for (let j = 0; j < candidates.length; j++) {
      if (j === i) continue
      const other = candidates[j]
      if (!other || other.type !== 'date') continue
      if (other.start < sentence[0] || other.end > sentence[1]) continue
      const dist = Math.min(
        Math.abs(other.start - a.end),
        Math.abs(other.end - a.start),
      )
      if (dist <= 30) { hasNearbyDate = true; break }
    }

    if (hasNearbyDate) {
      toDrop.add(twinNumberIdx)
    } else {
      toDrop.add(i)
    }
  }

  if (toDrop.size === 0) return
  const sorted = Array.from(toDrop).sort((a, b) => b - a)
  for (const i of sorted) candidates.splice(i, 1)
}

function splitSentencesOriginal(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (c !== '.' && c !== '!' && c !== '?') continue
    const prev = i > 0 ? s.charAt(i - 1) : ''
    const next = i + 1 < s.length ? s.charAt(i + 1) : ''
    const isDecimal =
      c === '.' &&
      prev !== '' && prev >= '0' && prev <= '9' &&
      next !== '' && next >= '0' && next <= '9'
    if (isDecimal) continue
    if (next === '' || /\s/.test(next)) {
      out.push([start, i + 1])
      let j = i + 1
      while (j < s.length && /\s/.test(s.charAt(j))) j++
      start = j
      i = j - 1
    }
  }
  if (start < s.length) out.push([start, s.length])
  return out
}

function resolveOverlaps(candidates: PriorityCandidate[]): RawEntity[] {
  // Sort by (start asc, length desc, priority desc) — longer/higher-priority
  // candidates are accepted first; shorter overlapping candidates are dropped.
  const sorted = candidates.slice().sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    const lenA = a.end - a.start
    const lenB = b.end - b.start
    if (lenA !== lenB) return lenB - lenA
    return b.priority - a.priority
  })

  const accepted: PriorityCandidate[] = []
  for (const cand of sorted) {
    const conflict = accepted.find(
      a => !(cand.end <= a.start || cand.start >= a.end),
    )
    if (!conflict) {
      accepted.push(cand)
      continue
    }
    // If the new candidate is fully contained inside an accepted one, drop it
    // (the accepted one is at least as long and at least as high priority).
    const contained = cand.start >= conflict.start && cand.end <= conflict.end
    if (contained) continue
    // Otherwise it's a partial overlap; greedy says keep the existing one.
  }

  // Dedupe and sort by start.
  const seen = new Set<string>()
  const uniq: RawEntity[] = []
  for (const e of accepted) {
    const key = `${e.start}:${e.end}:${e.type}`
    if (seen.has(key)) continue
    seen.add(key)
    const { priority: _p, ...rest } = e
    void _p
    uniq.push(rest)
  }
  uniq.sort((a, b) => a.start - b.start)
  return uniq
}
