// Small primitives used by the extractor, lookup, and classifier.
// No runtime deps; no I/O.

export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their',
  'is', 'are', 'was', 'were', 'be',
  'have', 'has', 'had', 'do', 'did',
  'and', 'or', 'but', 'not',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'as',
])

const SMART_QUOTE_MAP: Readonly<Record<string, string>> = {
  '“': '"', '”': '"',
  '‘': "'", '’': "'",
  '«': '"', '»': '"',
  '′': "'", '″': '"',
}

export function replaceSmartQuote(c: string): string {
  return SMART_QUOTE_MAP[c] ?? c
}

export function normalizeSmartQuotes(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    out += SMART_QUOTE_MAP[c] ?? c
  }
  return out
}

export function isWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'
}

export function isLetter(c: string): boolean {
  const cc = c.charCodeAt(0)
  return (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)
}

export function isDigit(c: string): boolean {
  const cc = c.charCodeAt(0)
  return cc >= 48 && cc <= 57
}

export function isUpper(c: string): boolean {
  const cc = c.charCodeAt(0)
  return cc >= 65 && cc <= 90
}

export function isWordChar(c: string): boolean {
  if (c === '_' || c === '$') return true
  return isLetter(c) || isDigit(c)
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}
