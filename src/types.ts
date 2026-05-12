// Public types for @reshimu/shor.

export type EntityType =
  | 'proper_noun'
  | 'identifier'
  | 'number'
  | 'date'
  | 'quoted_string'
  | 'citation'
  | 'url'

export type Level = 'GROUNDED' | 'PARTIAL' | 'UNGROUNDED' | 'INDETERMINATE'

export interface Entity {
  text: string
  normalized: string
  type: EntityType
  found: boolean
  locations: Array<[number, number]>
}

export interface ClassifyOptions {
  strict?: boolean
  minEntities?: number
  entityTypes?: EntityType[] | ['all']
  stopwords?: string[]
}

export interface ClassifyInput {
  output: string
  context: string
  options?: ClassifyOptions
}

export interface ClassifyResult {
  level: Level
  score: number
  entities: Entity[]
  explanation: string
  flagForReview: boolean
}

// Internal: a normalized view of the context with offsets back to the original.
export interface NormalizedContext {
  original: string
  normalized: string
  // offsetMap[i] is the original-string index that normalized[i] came from.
  offsetMap: number[]
  // Sentence boundaries in normalized-string coordinates, half-open [start, end).
  sentenceRanges: Array<[number, number]>
}

// Internal: an extracted entity in raw form (before normalization for lookup).
export interface RawEntity {
  text: string
  type: EntityType
  start: number
  end: number
}
