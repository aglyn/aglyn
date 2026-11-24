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

import { escapeCsvCell } from '@aglyn/aglyn/app-utils/csv'
import { compileRedirectRegex } from '../model/redirects'

/*==========================================
 * SQUARESPACE URL MAPPINGS (AGL-4245): the text a site owner copies out of
 * Squarespace's Settings → URL Mappings, read into the CSV the redirects
 * import already takes.
 *
 * Squarespace has no redirect export: its rules are one text box, one rule
 * per line, `/old-path -> /new-path 301` (or `302`). Blank lines and lines
 * that start with `#` are comments, and a line may carry extra spaces. A
 * rule may name a part of the path with a variable, `[name]`, and use it on
 * the right: `/blog/[name] -> /news/[name] 301`.
 *
 * Read in the browser, before the upload step shows the file, so every
 * later step (mapping, review, dry run, apply, undo) is the import's own and
 * nothing in it is Squarespace's. The columns written here are named in the
 * `Squarespace URL mappings` alias dictionary, so they map on their own.
 *
 * A variable is one path segment, so a rule with one becomes a regex rule
 * (the redirects page's own pattern mode): each variable is `([^/]+)` and the
 * destination names it `$1`, `$2`, … in the order the left side gives them.
 * A pattern that cannot be one (a destination naming a variable the left
 * side lacks, more than nine variables, a pattern the matcher cannot run) is
 * not imported, and the read lists it with why.
 *=========================================*/

import {
  SQUARESPACE_URL_MAPPING_HEADERS,
  SQUARESPACE_URL_MAPPINGS_SOURCE,
} from './squarespace-url-mapping-headers'

export { SQUARESPACE_URL_MAPPING_HEADERS, SQUARESPACE_URL_MAPPINGS_SOURCE }

/** One rule line, its spaces folded: a from, an arrow, a to, and an optional status code. */
const RULE_LINE = /^(\S+) ?-> ?(\S+)(?: (\d{3}))?$/

/** A variable, `[name]`. */
const VARIABLE = /\[([^\]\s/]+)\]/g

/** Whether a path names a variable. */
const hasVariable = (path: string): boolean => /\[[^\]\s/]+\]/.test(path)

/** The most capture groups a destination may name (`$1` … `$9`). */
const MAX_VARIABLES = 9

/** One rule as read. */
export interface SquarespaceUrlMapping {
  /** The 1-based line in the text. */
  line: number
  source: string
  destination: string
  /** 301 or 302; absent when the line gives no code. */
  statusCode?: 301 | 302
  kind: 'exact' | 'regex'
}

/** A line that is not imported, and why, in words a person reads. */
export interface SquarespaceUrlMappingSkip {
  line: number
  text: string
  reason: string
}

export interface SquarespaceUrlMappingsRead {
  rules: SquarespaceUrlMapping[]
  skipped: SquarespaceUrlMappingSkip[]
}

/** The text's lines that are rules or attempts at one: comments and blank lines dropped, spaces folded. */
function ruleLines(text: string): Array<{ line: number; text: string }> {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .map((raw, index) => ({ line: index + 1, text: raw.trim().replace(/\s+/g, ' ') }))
    .filter((entry) => entry.text && !entry.text.startsWith('#'))
}

/** Whether a text reads as Squarespace's URL mappings: every rule line has an arrow, and one reads as a rule. */
export function looksLikeSquarespaceUrlMappings(text: string): boolean {
  const lines = ruleLines(text)
  if (!lines.length) return false
  if (!lines.every((entry) => entry.text.includes('->'))) return false
  return lines.some((entry) => RULE_LINE.test(entry.text))
}

const escapeRegex = (literal: string): string => literal.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

/**
 * A pattern line as a regex rule's source and destination, or why it cannot
 * be one. The literal parts are lowercased and a trailing slash dropped, as
 * the serve path reads the address it matches.
 */
function patternRule(source: string, destination: string): { source: string; destination: string } | { reason: string } {
  const names: string[] = []
  let pattern = ''
  let at = 0
  for (const found of source.matchAll(VARIABLE)) {
    const index = found.index ?? 0
    pattern += escapeRegex(source.slice(at, index).toLowerCase())
    names.push(String(found[1]).toLowerCase())
    pattern += '([^/]+)'
    at = index + found[0].length
  }
  pattern += escapeRegex(source.slice(at).toLowerCase().replace(/\/+$/, ''))
  if (names.length > MAX_VARIABLES) {
    return { reason: `it has more than ${MAX_VARIABLES} [variables], which a redirect pattern cannot carry` }
  }
  if (new Set(names).size !== names.length) {
    return { reason: 'it uses the same [variable] twice in the old address' }
  }
  let missing: string | null = null
  const target = destination.replace(VARIABLE, (_token, name: string) => {
    const index = names.indexOf(name.toLowerCase())
    if (index < 0) missing ??= name
    return `$${index + 1}`
  })
  if (missing) return { reason: `it sends visitors to [${missing}], which the old address does not have` }
  const anchored = `^${pattern}$`
  if (!compileRedirectRegex(anchored)) return { reason: 'its pattern cannot be used as a redirect' }
  return { source: anchored, destination: target }
}

/** Squarespace's URL mappings as rules, and the lines that are not imported. Pure. */
export function readSquarespaceUrlMappings(text: string): SquarespaceUrlMappingsRead {
  const rules: SquarespaceUrlMapping[] = []
  const skipped: SquarespaceUrlMappingSkip[] = []
  for (const entry of ruleLines(text)) {
    const matched = RULE_LINE.exec(entry.text)
    if (!matched) {
      skipped.push({ ...entry, reason: 'it is not in the form /old-page -> /new-page 301' })
      continue
    }
    const from = String(matched[1])
    const to = String(matched[2])
    const code = matched[3]
    if (code && code !== '301' && code !== '302') {
      skipped.push({ ...entry, reason: `${code} is not a redirect type Squarespace uses; use 301 or 302` })
      continue
    }
    const statusCode = code ? (Number(code) as 301 | 302) : undefined
    if (!hasVariable(from) && !hasVariable(to)) {
      rules.push({ line: entry.line, source: from, destination: to, ...(statusCode ? { statusCode } : {}), kind: 'exact' })
      continue
    }
    const rule = patternRule(from, to)
    if ('reason' in rule) {
      skipped.push({ ...entry, reason: rule.reason })
      continue
    }
    rules.push({ line: entry.line, ...rule, ...(statusCode ? { statusCode } : {}), kind: 'regex' })
  }
  return { rules, skipped }
}

/** What the upload step is handed for a text that is Squarespace's URL mappings. */
export interface SquarespaceUrlMappingsCsv {
  /** The CSV the import reads: a header and one row per rule. */
  text: string
  /** The format the text was read as. */
  source: string
  /** Sentences the step shows above the preview: what was read, and each line not imported. */
  notes: string[]
}

/**
 * The text as the CSV the import reads, or `null` when it is not Squarespace's
 * URL mappings (the step then reads it as it always did).
 */
export function squarespaceUrlMappingsCsv(text: string): SquarespaceUrlMappingsCsv | null {
  if (!looksLikeSquarespaceUrlMappings(text)) return null
  const read = readSquarespaceUrlMappings(text)
  const header = [
    SQUARESPACE_URL_MAPPING_HEADERS.source,
    SQUARESPACE_URL_MAPPING_HEADERS.destination,
    SQUARESPACE_URL_MAPPING_HEADERS.statusCode,
    SQUARESPACE_URL_MAPPING_HEADERS.kind,
  ]
  const rows = read.rules.map((rule) => [rule.source, rule.destination, rule.statusCode ? String(rule.statusCode) : '', rule.kind])
  const patterns = read.rules.filter((rule) => rule.kind === 'regex').length
  const count = `${read.rules.length} ${read.rules.length === 1 ? 'redirect' : 'redirects'}`
  const notes = [
    `Read as ${SQUARESPACE_URL_MAPPINGS_SOURCE}: ${count}${patterns ? `, ${patterns} with [variables] brought in as patterns` : ''}.`,
    ...read.skipped.map((skip) => `Line ${skip.line} is not imported: ${skip.reason}. (${skip.text})`),
  ]
  return {
    text: [header, ...rows].map((cells) => cells.map((cell) => escapeCsvCell(cell)).join(',')).join('\n') + '\n',
    source: SQUARESPACE_URL_MAPPINGS_SOURCE,
    notes,
  }
}
