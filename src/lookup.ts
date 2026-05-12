import type { NormalizedContext } from './types.js'
import { isWhitespace, replaceSmartQuote, isUpper, isWordChar } from './utils.js'

export interface LookupConstraints {
  tokenBoundary: boolean
  singleSentence: boolean
}

// Build a normalized view of the context:
//   - smart quotes ASCII'd
//   - whitespace runs collapsed to single space
//   - lowercased in lenient mode; preserved in strict mode
// Maintains a per-character map back to original-string offsets so found
// locations can be reported in original coordinates.
export function buildNormalizedContext(
  context: string,
  strict: boolean,
): NormalizedContext {
  const chars: string[] = []
  const offsetMap: number[] = []
  const newlineCollapsedAt: number[] = []
  let lastWasSpace = false

  for (let i = 0; i < context.length; i++) {
    const raw = context.charAt(i)
    const c = replaceSmartQuote(raw)

    if (isWhitespace(c)) {
      if (!lastWasSpace && chars.length > 0) {
        chars.push(' ')
        offsetMap.push(i)
        if (c === '\n') newlineCollapsedAt.push(chars.length - 1)
        lastWasSpace = true
      } else if (lastWasSpace && c === '\n') {
        // Newline absorbed into a previously emitted space.
        newlineCollapsedAt.push(chars.length - 1)
      }
      continue
    }

    lastWasSpace = false
    const c2 = strict ? c : c.toLowerCase()
    chars.push(c2)
    offsetMap.push(i)
  }

  // Trim trailing collapsed space.
  if (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop()
    offsetMap.pop()
  }

  const normalized = chars.join('')
  const sentenceRanges = detectSentences(normalized, context, offsetMap, newlineCollapsedAt)
  return { original: context, normalized, offsetMap, sentenceRanges }
}

// Sentence detection on the normalized string. Boundaries are:
//   - `.` `!` `?` followed by space or EOF (decimals like "3.14" excluded)
//   - any position where a newline was collapsed AND the next non-space char in
//     the ORIGINAL (pre-lowercase) string is uppercase
function detectSentences(
  s: string,
  original: string,
  offsetMap: number[],
  newlineCollapsedAt: number[],
): Array<[number, number]> {
  if (s.length === 0) return []
  const breaks = new Set<number>() // index AFTER which a sentence ends

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
    if (next === '' || next === ' ') {
      breaks.add(i)
    }
  }

  for (const pos of newlineCollapsedAt) {
    // Look at the next non-space char in normalized to find its original-coord
    // position, then check the ORIGINAL char's casing.
    let j = pos + 1
    while (j < s.length && s.charAt(j) === ' ') j++
    if (j >= s.length) continue
    const origIdx = offsetMap[j]
    if (origIdx === undefined || origIdx >= original.length) continue
    if (isUpper(original.charAt(origIdx))) {
      if (pos > 0) breaks.add(pos - 1)
    }
  }

  const sorted = Array.from(breaks).sort((a, b) => a - b)
  const ranges: Array<[number, number]> = []
  let start = 0
  for (const b of sorted) {
    const end = b + 1
    if (end > start) ranges.push([start, end])
    start = end
    while (start < s.length && s.charAt(start) === ' ') start++
  }
  if (start < s.length) ranges.push([start, s.length])
  return ranges
}

// Find all substring occurrences of `needle` in `ctx.normalized`, returning
// half-open [start, end) pairs in *original* coordinates. Non-overlapping.
export function findAll(
  needle: string,
  ctx: NormalizedContext,
  constraints: LookupConstraints,
): Array<[number, number]> {
  if (needle.length === 0 || needle.length > ctx.normalized.length) return []
  const hay = ctx.normalized
  const out: Array<[number, number]> = []

  let from = 0
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from)
    if (idx === -1) break
    const endIdx = idx + needle.length

    if (constraints.tokenBoundary) {
      const beforeOK = idx === 0 || !isWordChar(hay.charAt(idx - 1))
      const afterOK = endIdx >= hay.length || !isWordChar(hay.charAt(endIdx))
      if (!beforeOK || !afterOK) {
        from = idx + 1
        continue
      }
    }

    if (constraints.singleSentence) {
      const fits = ctx.sentenceRanges.some(
        ([s, e]) => s <= idx && endIdx <= e,
      )
      if (!fits) {
        from = idx + 1
        continue
      }
    }

    const origStart = ctx.offsetMap[idx] ?? 0
    const origEnd = (ctx.offsetMap[endIdx - 1] ?? origStart) + 1
    out.push([origStart, origEnd])
    from = endIdx
  }
  return out
}
