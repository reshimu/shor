import type {
  ClassifyInput,
  ClassifyResult,
  Entity,
  EntityType,
  Level,
  RawEntity,
} from './types.js'
import { extract } from './extractor.js'
import {
  buildNormalizedContext,
  findAll,
  type LookupConstraints,
} from './lookup.js'
import {
  DEFAULT_STOPWORDS,
  collapseWhitespace,
  normalizeSmartQuotes,
} from './utils.js'

export function classify(input: ClassifyInput): ClassifyResult {
  const { output, context } = input
  const opts = input.options ?? {}
  const strict = opts.strict ?? false
  const minEntities = opts.minEntities ?? 1
  const typeFilter: EntityType[] | ['all'] = opts.entityTypes ?? ['all']
  const stopwords: ReadonlySet<string> =
    opts.stopwords !== undefined
      ? new Set(opts.stopwords.map(w => w.toLowerCase()))
      : DEFAULT_STOPWORDS

  if (output.length === 0) {
    return {
      level: 'INDETERMINATE',
      score: 0,
      entities: [],
      explanation: 'Output is empty.',
      flagForReview: false,
    }
  }

  const raw = extract(output, stopwords)
  const filtered = filterByType(raw, typeFilter)
  const deduped = dedupe(filtered)

  if (deduped.length < minEntities) {
    return {
      level: 'INDETERMINATE',
      score: 0,
      entities: deduped.map(toEmptyEntity),
      explanation:
        deduped.length === 0
          ? 'No extractable entities in output.'
          : `Only ${deduped.length} extractable entity/entities — below minEntities=${minEntities}.`,
      flagForReview: false,
    }
  }

  const ctx = buildNormalizedContext(context, strict)
  const constraints: LookupConstraints = {
    tokenBoundary: strict,
    singleSentence: strict,
  }

  const entities: Entity[] = []
  for (const r of deduped) {
    const forms = normalizeEntity(r, strict)
    let locations: Array<[number, number]> = []
    let foundForm = ''
    for (const form of forms) {
      if (form.length === 0) continue
      const hits = findAll(form, ctx, constraints)
      if (hits.length > 0) {
        locations = hits
        foundForm = form
        break
      }
    }
    entities.push({
      text: r.text,
      normalized: foundForm !== '' ? foundForm : (forms[0] ?? r.text),
      type: r.type,
      found: locations.length > 0,
      locations,
    })
  }

  const nTotal = entities.length
  const nFound = entities.filter(e => e.found).length
  const score = nTotal === 0 ? 0 : nFound / nTotal

  let level: Level
  if (nFound === nTotal) level = 'GROUNDED'
  else if (nFound === 0) level = 'UNGROUNDED'
  else level = 'PARTIAL'

  return {
    level,
    score,
    entities,
    explanation: buildExplanation(entities, level),
    flagForReview: level === 'PARTIAL' || level === 'UNGROUNDED',
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function filterByType(
  entities: RawEntity[],
  filter: EntityType[] | ['all'],
): RawEntity[] {
  if (filter.length === 1 && filter[0] === 'all') return entities
  const allowed = new Set(filter as EntityType[])
  return entities.filter(e => allowed.has(e.type))
}

function dedupe(entities: RawEntity[]): RawEntity[] {
  const seen = new Set<string>()
  const out: RawEntity[] = []
  for (const e of entities) {
    const key = `${e.type}:${collapseWhitespace(e.text).toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}

function toEmptyEntity(r: RawEntity): Entity {
  return {
    text: r.text,
    normalized: '',
    type: r.type,
    found: false,
    locations: [],
  }
}

function normalizeEntity(r: RawEntity, strict: boolean): string[] {
  const cased = (x: string): string => (strict ? x : x.toLowerCase())

  switch (r.type) {
    case 'number': {
      const forms: string[] = []
      forms.push(cased(r.text))
      const stripped = r.text.replace(/[$€£¥,\s]/g, '')
      if (stripped !== r.text) forms.push(cased(stripped))
      const m = /^([+-]?\d+(?:\.\d+)?)([KkMmBbTt])$/.exec(stripped)
      if (m) {
        const base = parseFloat(m[1]!)
        const mult = suffixMultiplier(m[2]!)
        if (Number.isFinite(base) && mult > 0) {
          forms.push(String(Math.round(base * mult)))
        }
      }
      return uniq(forms)
    }
    case 'date': {
      const forms: string[] = [cased(r.text)]

      // ISO → written
      const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.text)
      if (iso) {
        addDateAlternates(
          forms,
          parseInt(iso[1]!, 10),
          parseInt(iso[2]!, 10),
          parseInt(iso[3]!, 10),
          cased,
        )
      }

      // "Month DD[, YYYY]" → ISO
      const written = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i.exec(r.text)
      if (written) {
        const monthIdx = parseMonth(written[1]!)
        const day = parseInt(written[2]!, 10)
        const yearStr = written[3]
        if (monthIdx > 0) {
          if (yearStr !== undefined) {
            addDateAlternates(forms, parseInt(yearStr, 10), monthIdx, day, cased)
          } else {
            const mon = monthAbbrev(monthIdx)
            if (mon) forms.push(cased(`${mon} ${day}`))
          }
        }
      }

      return uniq(forms)
    }
    case 'identifier': {
      const forms: string[] = [cased(r.text)]
      // Also try a stripped-args form so `db.query()` matches `db.query(sql)` in context
      const stripped = r.text.replace(/\([^)]*\)/g, '')
      if (stripped !== r.text && stripped.length > 1) {
        forms.push(cased(stripped))
      }
      return uniq(forms)
    }
    case 'quoted_string': {
      let inner = r.text
      const first = inner.charAt(0)
      const last = inner.charAt(inner.length - 1)
      if (
        inner.length >= 2 &&
        (first === '"' || first === "'" || first === '`') &&
        last === first
      ) {
        inner = inner.slice(1, -1)
      }
      inner = normalizeSmartQuotes(collapseWhitespace(inner))
      return [cased(inner)]
    }
    case 'citation':
      return [cased(collapseWhitespace(r.text))]
    case 'url': {
      let u = cased(r.text)
      if (u.endsWith('/')) u = u.slice(0, -1)
      return [u]
    }
    case 'proper_noun':
      return [cased(collapseWhitespace(r.text))]
  }
}

function suffixMultiplier(c: string): number {
  switch (c.toLowerCase()) {
    case 'k': return 1_000
    case 'm': return 1_000_000
    case 'b': return 1_000_000_000
    case 't': return 1_000_000_000_000
    default: return 0
  }
}

function monthAbbrev(m: number): string | null {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  if (m < 1 || m > 12) return null
  return months[m - 1] ?? null
}

function parseMonth(name: string): number {
  const lower = name.toLowerCase()
  const prefixes = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ]
  for (let i = 0; i < prefixes.length; i++) {
    if (lower.startsWith(prefixes[i]!)) return i + 1
  }
  return 0
}

function addDateAlternates(
  forms: string[],
  year: number,
  month: number,
  day: number,
  cased: (s: string) => string,
): void {
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  forms.push(iso)
  const mon = monthAbbrev(month)
  if (mon) {
    forms.push(cased(`${mon} ${day}, ${year}`))
    forms.push(cased(`${mon} ${day} ${year}`))
    forms.push(cased(`${mon} ${day}`))
  }
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    if (!seen.has(x)) { seen.add(x); out.push(x) }
  }
  return out
}

function buildExplanation(entities: Entity[], level: Level): string {
  if (level === 'GROUNDED') return 'All extracted entities verified in context.'
  if (level === 'INDETERMINATE') return 'No extractable entities in output.'
  const unfound = entities.filter(e => !e.found).slice(0, 3)
  if (unfound.length === 0) return 'Mixed grounding.'
  const parts = unfound.map(e => `${typeLabel(e.type)} '${e.text}'`)
  const list =
    parts.length === 1
      ? parts[0]!
      : parts.length === 2
        ? `${parts[0]} and ${parts[1]}`
        : `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
  return `${list} not found in context.`
}

function typeLabel(t: EntityType): string {
  switch (t) {
    case 'number': return 'number'
    case 'date': return 'date'
    case 'identifier': return 'identifier'
    case 'quoted_string': return 'quoted string'
    case 'citation': return 'citation'
    case 'url': return 'URL'
    case 'proper_noun': return 'name'
  }
}
