/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  COLLECTION_TOKEN_CATALOG,
  ENTRY_TOKEN_CATALOG,
  humanizeDatasetFieldId,
} from '@aglyn/aglyn'

import type { BindingOption } from '../contexts/binding-picker-context'

/**
 * Token-pill segment model (AGL-586). Stored prop strings keep the raw
 * id-based `{{...}}` grammar (AGL-100/185) — these helpers only SPLIT a
 * string into runs of plain text and atomic tokens so editors can render
 * the tokens as friendly, clickable pills. Serializing the segments always
 * reproduces the exact input string; nothing here ever rewrites a token.
 *
 * Offset model: editor carets address "units", where every plain-text
 * character is 1 unit and every token — however long its raw text — is 1
 * atomic unit. A caret can therefore sit before or after a pill but never
 * inside one, which is exactly how the pills behave in the DOM
 * (`contenteditable="false"`).
 */
export interface TokenSegment {
  type: 'text' | 'token'
  /** The literal slice of the serialized string (raw `{{...}}` for tokens). */
  value: string
  /** Set on token segments: the raw token, identical to `value`. */
  token?: string
}

/**
 * Any `{{...}}` occurrence without nested braces — var:/fn:/entry./
 * collection./item.* AND unknown tokens alike. `{{a{{b}}` yields the text
 * `{{a` plus the token `{{b}}` (the opener without a closer is plain text).
 */
export const TOKEN_SEGMENT_PATTERN = /\{\{[^{}]*\}\}/g

/** Drops empty text runs and merges adjacent text segments. */
function normalizeSegments(segments: TokenSegment[]): TokenSegment[] {
  const out: TokenSegment[] = []
  for (const segment of segments) {
    if (segment.type === 'text' && !segment.value) continue
    const last = out[out.length - 1]
    if (segment.type === 'text' && last?.type === 'text') {
      last.value += segment.value
    } else {
      out.push({ ...segment })
    }
  }
  return out
}

/** Splits `text` on `{{...}}` occurrences into text/token segments. */
export function parseTokenSegments(text: string): TokenSegment[] {
  const segments: TokenSegment[] = []
  let cursor = 0
  const pattern = new RegExp(TOKEN_SEGMENT_PATTERN.source, 'g')
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > cursor) {
      segments.push({ type: 'text', value: text.slice(cursor, match.index) })
    }
    segments.push({ type: 'token', value: match[0], token: match[0] })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) {
    segments.push({ type: 'text', value: text.slice(cursor) })
  }
  return segments
}

/** Joins segments back to the exact stored string (lossless round-trip). */
export function serializeTokenSegments(segments: TokenSegment[]): string {
  return segments.map((segment) => segment.value).join('')
}

/** True when any text run still holds a complete raw `{{...}}` token. */
export function hasUnmaterializedTokens(segments: TokenSegment[]): boolean {
  const probe = new RegExp(TOKEN_SEGMENT_PATTERN.source)
  return segments.some(
    (segment) => segment.type === 'text' && probe.test(segment.value),
  )
}

/** Unit length of one segment: text = char count, token = 1 atomic unit. */
export function segmentUnitLength(segment: TokenSegment): number {
  return segment.type === 'token' ? 1 : segment.value.length
}

/** Total unit length of a segment list (pills count as 1 unit each). */
export function segmentsUnitLength(segments: TokenSegment[]): number {
  return segments.reduce((sum, segment) => sum + segmentUnitLength(segment), 0)
}

/**
 * Extracts [from, to) in unit offsets. Tokens are atomic: since a token is
 * exactly 1 unit, an integer range either includes it wholly or not at all
 * — a caret can never split a pill.
 */
export function sliceSegmentsByUnits(
  segments: TokenSegment[],
  from: number,
  to: number,
): TokenSegment[] {
  const out: TokenSegment[] = []
  let position = 0
  for (const segment of segments) {
    const length = segmentUnitLength(segment)
    const start = Math.max(from, position)
    const stop = Math.min(to, position + length)
    if (stop > start) {
      if (segment.type === 'token') {
        out.push({ ...segment })
      } else {
        out.push({
          type: 'text',
          value: segment.value.slice(start - position, stop - position),
        })
      }
    }
    position += length
  }
  return normalizeSegments(out)
}

/**
 * Splices `replacement` into `segments` at the unit-offset selection,
 * replacing any selected range — the caret-preserving insert used by the
 * {x} picker (AGL-583 semantics, pill-aware). A null/undefined start means
 * "no caret captured": the replacement appends at the end. Returns the new
 * segment list and the caret unit just after the inserted content.
 */
export function spliceSegmentsAtUnits(
  segments: TokenSegment[],
  replacement: TokenSegment[],
  start?: number | null,
  end?: number | null,
): { segments: TokenSegment[]; caretUnit: number } {
  const length = segmentsUnitLength(segments)
  const clamp = (value: number) => Math.min(Math.max(value, 0), length)
  const at = start == null ? length : clamp(start)
  const to = end == null ? at : Math.max(clamp(end), at)
  const next = normalizeSegments([
    ...sliceSegmentsByUnits(segments, 0, at),
    ...replacement,
    ...sliceSegmentsByUnits(segments, to, Infinity),
  ])
  return { segments: next, caretUnit: at + segmentsUnitLength(replacement) }
}

/** A single token segment for `spliceSegmentsAtUnits` insertion. */
export function tokenSegment(token: string): TokenSegment {
  return { type: 'token', value: token, token }
}

/** A single text segment for `spliceSegmentsAtUnits` insertion. */
export function textSegment(text: string): TokenSegment {
  return { type: 'text', value: text }
}

/** Which catalog family a token belongs to — drives the pill color. */
export type TokenGroup =
  | 'variable'
  | 'function'
  | 'entry'
  | 'collection'
  | 'dataset'
  | 'unknown'

/**
 * Display-name inputs for {@link resolveTokenLabel}: the picker options
 * (which already carry friendly labels for every insertable token), the
 * host's variable/function docs keyed by id (AGL-194), and the ancestor
 * repeatable's dataset model fields (id → current display name).
 */
export interface TokenLabelContext {
  options?: BindingOption[]
  variables?: Record<string, { name?: string } | undefined>
  functions?: Record<string, { name?: string } | undefined>
  datasetFields?: Array<{ id: string; label: string }>
}

export interface ResolvedTokenLabel {
  /** Friendly display name (the CURRENT name — ids stay in storage). */
  label: string
  /** Family for the pill color; shape-derived, stable across renames. */
  group: TokenGroup
  /** False when the referent can't be resolved (warning-colored pill). */
  known: boolean
}

const stripBraces = (token: string): string =>
  token.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '')

/** Whitespace-insensitive raw-token comparison (`{{ var:x }}` ≡ `{{var:x}}`). */
const canonical = (token: string): string => token.replace(/\s+/g, '')

/**
 * Resolves a raw token to its display name (AGL-586 requirement 2: users
 * see NAMES, storage keeps IDS). The group comes from the token's shape so
 * pills stay consistently colored even when the referent is missing;
 * `known: false` marks unresolvable tokens for warning styling with the
 * raw token surfaced as the tooltip.
 */
export function resolveTokenLabel(
  token: string,
  context: TokenLabelContext = {},
): ResolvedTokenLabel {
  const inner = stripBraces(token).trim()
  const optionByToken = (candidate: string): BindingOption | undefined =>
    (context.options ?? []).find(
      (option) => canonical(option.token) === canonical(candidate),
    )

  const variableMatch = /^var:([^\s(){}]+)$/.exec(inner)
  if (variableMatch) {
    const id = variableMatch[1] as string
    const name =
      context.variables?.[id]?.name ?? optionByToken(`{{var:${id}}}`)?.label
    return { label: name ?? id, group: 'variable', known: Boolean(name) }
  }

  const functionMatch = /^fn:([^(){}]+)\(([^)]*)\)$/.exec(inner)
  if (functionMatch) {
    const id = String(functionMatch[1]).trim()
    // A stored call's args differ from the picker's parameter template, so
    // options match on the `{{fn:id(` prefix rather than the whole token.
    const name =
      context.functions?.[id]?.name ??
      (context.options ?? []).find((option) =>
        canonical(option.token).startsWith(canonical(`{{fn:${id}(`)),
      )?.label
    return { label: name ?? id, group: 'function', known: Boolean(name) }
  }

  if (inner.startsWith('entry.')) {
    const entry = ENTRY_TOKEN_CATALOG.find(
      (candidate) => canonical(candidate.token) === canonical(`{{${inner}}}`),
    )
    return { label: entry?.label ?? inner, group: 'entry', known: Boolean(entry) }
  }

  if (inner.startsWith('collection.')) {
    const entry = COLLECTION_TOKEN_CATALOG.find(
      (candidate) => canonical(candidate.token) === canonical(`{{${inner}}}`),
    )
    return {
      label: entry?.label ?? inner,
      group: 'collection',
      known: Boolean(entry),
    }
  }

  const itemMatch = /^item\.([^.\s{}]+)(?:\.([^.\s{}]+))?$/.exec(inner)
  if (itemMatch) {
    const fieldId = itemMatch[1] as string
    const hopId = itemMatch[2]
    const field = (context.datasetFields ?? []).find(
      (candidate) => candidate.id === fieldId,
    )
    const label = field
      ? hopId
        ? `${field.label} → ${humanizeDatasetFieldId(hopId)}`
        : field.label
      : inner
    return { label, group: 'dataset', known: Boolean(field) }
  }

  return { label: inner || token, group: 'unknown', known: false }
}
