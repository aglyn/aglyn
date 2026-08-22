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

/**
 * The responsive span/offset syntax the besigner persists for MUI Grid
 * (AGL-2486).
 *
 * A Grid cell's `size` and `offset` are stored as ONE string in the node's
 * props — `"6"`, `"auto"`, `"xs:12 md:6"` — because MUI v6+ replaced the
 * per-breakpoint `xs=`/`md=` props with a single value-or-object prop. That
 * string is the persisted format and it does not change here; what changes is
 * that the attributes panel no longer asks an author to TYPE it (a developer
 * syntax nobody outside the docs knows). Parse and serialize live together in
 * this shared module, the same arrangement `parseCssDimension`/
 * `buildCssDimension` above have, so the editor and the renderer cannot drift
 * into two different readings of the same stored string.
 *
 * `raw` is the escape hatch that keeps the editor from destroying what it
 * cannot model — a half-typed pair, a `{{token}}` binding, an unknown
 * breakpoint. The string comes back untouched instead of collapsing to
 * whatever a lenient parse salvaged.
 */

/** Breakpoint keys MUI's responsive `size`/`offset` objects accept. */
export const SPAN_BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl'] as const

export type SpanBreakpoint = (typeof SPAN_BREAKPOINTS)[number]

/** One span: a column count, or one of MUI's two sizing keywords. */
export type SpanValue = number | 'auto' | 'grow'

export interface BreakpointSpan {
  /**
   * A value authored with NO breakpoint (`"6"`, `"auto"`). MUI applies it at
   * every size, and it is mutually exclusive with {@link values} — the prop
   * is either a scalar or an object, never both.
   */
  base?: SpanValue
  /** Per-breakpoint values, normalized into {@link SPAN_BREAKPOINTS} order. */
  values?: Partial<Record<SpanBreakpoint, SpanValue>>
  /** Set ONLY when the string is not a span this module can model. */
  raw?: string
}

/** `12`, `-4`, `2.5` — a bare quantity with no breakpoint attached. */
const BARE_NUMBER = /^-?\d+(\.\d+)?$/
/** `md:6`, `XS = auto` — one breakpoint pair, in either separator style. */
const PAIR = /^([a-z]+)\s*[:=]\s*(auto|grow|-?\d+(?:\.\d+)?)$/i

const isBreakpoint = (key: string): key is SpanBreakpoint =>
  (SPAN_BREAKPOINTS as readonly string[]).includes(key)

/**
 * Reads a stored span string into {@link BreakpointSpan}.
 *
 * A partly-parseable list comes back as `raw`, never as a partial object: a
 * half-applied breakpoint map is a layout that silently differs from what the
 * author typed, which is worse than no layout at all.
 */
export function parseBreakpointSpan(
  value: string | number | undefined | null,
): BreakpointSpan {
  // `value === 0` is a real span the author can mean, so this tests for
  // absence explicitly rather than for falsiness (strictNullChecks is off
  // repo-wide, and `!value` would swallow the zero).
  if (value === undefined || value === null || value === '') return {}
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { base: value } : {}
  }

  const text = `${value}`.trim()
  if (!text) return {}
  if (text === 'auto' || text === 'grow') return { base: text }
  if (BARE_NUMBER.test(text)) return { base: Number(text) }

  const pairs = text.split(/[\s,]+/).filter(Boolean)
  const values: Partial<Record<SpanBreakpoint, SpanValue>> = {}
  for (const pair of pairs) {
    const match = PAIR.exec(pair)
    if (!match) return { raw: text }
    const key = (match[1] ?? '').toLowerCase()
    if (!isBreakpoint(key)) return { raw: text }
    const span = match[2] ?? ''
    values[key] =
      span === 'auto' || span === 'grow' ? (span as SpanValue) : Number(span)
  }
  if (!Object.keys(values).length) return { raw: text }

  // Normalized to breakpoint order so the serialized string is stable no
  // matter what order the author wrote the pairs in.
  const ordered: Partial<Record<SpanBreakpoint, SpanValue>> = {}
  for (const key of SPAN_BREAKPOINTS) {
    if (values[key] !== undefined) ordered[key] = values[key]
  }
  return { values: ordered }
}

/**
 * Serializes a {@link BreakpointSpan} back to the single string that gets
 * persisted. The inverse of {@link parseBreakpointSpan}: an empty span
 * serializes to an empty string, never to a partial pair like `md:`.
 */
export function buildBreakpointSpan(span?: BreakpointSpan): string {
  if (!span) return ''
  if (span.raw !== undefined) return span.raw
  if (span.base !== undefined) return `${span.base}`
  const values = span.values
  if (!values) return ''
  const pairs: string[] = []
  for (const key of SPAN_BREAKPOINTS) {
    const value = values[key]
    if (value === undefined || value === null || (value as unknown) === '') {
      continue
    }
    pairs.push(`${key}:${value}`)
  }
  return pairs.join(' ')
}
