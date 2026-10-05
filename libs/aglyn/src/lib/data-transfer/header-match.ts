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

/*==========================================
 * HEADER MATCHING — which field each column of a file most likely means.
 *
 * A proposal per column, with a confidence from 0 to 1 and the reason it
 * was made, tried in this order:
 *
 *  1. exact alias — the header IS the field's label, id or an alias (1.0);
 *  2. normalized alias — equal once case, punctuation, `camelCase` and
 *     spacing are folded (0.95);
 *  3. fuzzy — token-set and edit-distance similarity to the best alias,
 *     scaled under the exact tiers (at most 0.9) and kept above `threshold`;
 *  4. type inference — what the column's sample cells look like (emails,
 *     phones, dates…) breaks a near tie between fuzzy candidates, and on its
 *     own proposes the one field of that type when the header says nothing.
 *
 * Every field is taken by at most one column. When two columns both want a
 * field, the stronger keeps it, the other falls back to its next candidate,
 * and the clash is reported so the person decides.
 *
 * ## Plugins bring the vocabulary
 *
 * Another product's export headers (its field names for the same things)
 * are an alias dictionary the owning plugin supplies; the core matches them
 * and names the dictionary that matched, and holds no vendor's words itself.
 *=========================================*/

import { isTransferFieldImportable } from './resource'
import type { TransferField, TransferFieldType } from './resource'
import { foldText, textSimilarity } from './similarity'
import { deriveDate, deriveEmail, deriveNumber, derivePhone, deriveUrl, parseImportFlag } from './derive'

/** Why a column was proposed for a field. */
export type HeaderMatchReason = 'exactAlias' | 'normalizedAlias' | 'fuzzy' | 'typeInference'

/** Extra header spellings for a resource's fields, from one source. */
export interface TransferAliasDictionary {
  /** Who the spellings come from, shown beside the match ("Spreadsheet export"). */
  source: string
  /** Field id → header spellings. */
  aliases: Readonly<Record<string, readonly string[]>>
}

/** What a column's sample cells look like. */
export type InferredCellType = 'email' | 'phone' | 'url' | 'date' | 'number' | 'currency' | 'boolean' | 'text'

/** One candidate field for a column. */
export interface HeaderCandidate {
  fieldId: string
  confidence: number
  reason: HeaderMatchReason
  /** The alias that matched, as written. */
  alias?: string
  /** The dictionary the alias came from, when a plugin supplied it. */
  source?: string
}

/** The proposal for one column. */
export interface HeaderMatchProposal {
  column: number
  header: string
  /** The proposed field, or `null` to leave the column unmapped. */
  fieldId: string | null
  confidence: number
  reason: HeaderMatchReason | null
  alias?: string
  source?: string
  /** The next-best candidates, strongest first. */
  alternatives: HeaderCandidate[]
  /** What the sample cells look like, when samples were given. */
  inferredType: InferredCellType | null
  /** The column wanted a field another column took. */
  lostField?: string
}

/** Two or more columns that want one field. */
export interface HeaderMatchConflict {
  fieldId: string
  /** Every column whose best candidate was the field, the winner first. */
  columns: number[]
}

export interface HeaderMatchResult {
  proposals: HeaderMatchProposal[]
  /** Column → field id, for every column with a proposal. */
  mapping: Record<number, string>
  conflicts: HeaderMatchConflict[]
  /** Required fields no column was proposed for. */
  unmappedRequired: string[]
}

export interface HeaderMatchOptions {
  /** Plugin-supplied spellings, tried after the fields' own. */
  dictionaries?: readonly TransferAliasDictionary[]
  /** Sample rows (cells in column order) for type inference. */
  samples?: readonly (readonly unknown[])[]
  /** The least confidence a fuzzy match is proposed at; default 0.72. */
  threshold?: number
}

/** The default least confidence a fuzzy proposal is made at. */
export const HEADER_MATCH_THRESHOLD = 0.72

/**
 * A header folded for comparison: accents dropped, `camelCase` split,
 * punctuation and underscores to spaces, lowercased, single-spaced.
 * `First_Name`, `firstName` and `first name` fold together.
 */
export function normalizeHeader(value: unknown): string {
  const split = String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return foldText(split)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** A header with every separator removed: `e-mail` and `email` compare equal. */
export function compactHeader(value: unknown): string {
  return normalizeHeader(value).replace(/ /g, '')
}

/**
 * What a column's cells look like: the type at least 80% of its non-blank
 * samples read as, or `text`. `null` when there is no non-blank sample.
 */
export function inferCellType(cells: readonly unknown[]): InferredCellType | null {
  const values = cells.map((cell) => String(cell ?? '').trim()).filter(Boolean)
  if (!values.length) return null
  const share = (test: (value: string) => boolean): number =>
    values.filter(test).length / values.length
  const enough = 0.8
  if (share((value) => deriveEmail(value).ok) >= enough) return 'email'
  if (share((value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^www\./i.test(value)) >= enough && share((value) => deriveUrl(value).ok) >= enough) {
    return 'url'
  }
  if (share((value) => /^[^\d\s]{1,3}\s?-?[\d.,\s]+$|^-?[\d.,\s]+\s?[^\d\s]{1,3}$/.test(value) && /[$€£¥₹]|^[A-Z]{3}\s|\s[A-Z]{3}$/.test(value)) >= enough) {
    return 'currency'
  }
  if (share((value) => /^(?:true|false|yes|no|y|n)$/i.test(value) && parseImportFlag(value) !== null) >= enough) {
    return 'boolean'
  }
  if (share((value) => /[/.-]|[a-z]{3}/i.test(value) && /\d/.test(value) && deriveDate(value, { excelSerials: false }).ok) >= enough) {
    return 'date'
  }
  if (share((value) => /^\+?[\d\s().-]{7,}$/.test(value) && /[\s().+-]/.test(value) && derivePhone(value).derivations.every((entry) => entry.kind !== 'phoneUnnormalized')) >= enough) {
    return 'phone'
  }
  if (share((value) => deriveNumber(value).ok) >= enough) return 'number'
  return 'text'
}

/** Whether a field of `type` would take cells that look like `inferred`. */
export function inferredTypeFits(type: TransferFieldType, inferred: InferredCellType): boolean {
  switch (inferred) {
    case 'email':
      return type === 'email' || type === 'lookup'
    case 'phone':
      return type === 'phone'
    case 'url':
      return type === 'url'
    case 'date':
      return type === 'date' || type === 'datetime'
    case 'number':
      return ['number', 'integer', 'currency', 'percent', 'phone'].includes(type)
    case 'currency':
      return type === 'currency'
    case 'boolean':
      return type === 'boolean'
    case 'text':
      return !['number', 'integer', 'currency', 'percent', 'boolean', 'date', 'datetime', 'email', 'url'].includes(type)
  }
}

/** The types inference may propose a field for on its own, with no header help. */
const DISTINCTIVE: readonly InferredCellType[] = ['email', 'phone', 'url']

interface Spelling {
  text: string
  normalized: string
  compact: string
  source?: string
}

function spellingsOf(field: TransferField, dictionaries: readonly TransferAliasDictionary[]): Spelling[] {
  const own = [field.label, field.id, ...(field.aliases ?? [])].map((text) => ({ text }))
  const plugged = dictionaries.flatMap((dictionary) =>
    (dictionary.aliases[field.id] ?? []).map((text) => ({ text, source: dictionary.source })),
  )
  return [...own, ...plugged]
    .filter((entry) => String(entry.text ?? '').trim())
    .map((entry) => ({ ...entry, normalized: normalizeHeader(entry.text), compact: compactHeader(entry.text) }))
}

/** Every candidate field for one header, strongest first. */
export function headerCandidates(
  header: string,
  fields: readonly TransferField[],
  options: Pick<HeaderMatchOptions, 'dictionaries' | 'threshold'> = {},
): HeaderCandidate[] {
  const threshold = options.threshold ?? HEADER_MATCH_THRESHOLD
  const raw = String(header ?? '').trim().toLowerCase()
  const normalized = normalizeHeader(header)
  const compact = compactHeader(header)
  if (!normalized) return []
  const candidates: HeaderCandidate[] = []
  for (const field of fields) {
    if (!isTransferFieldImportable(field)) continue
    let best: HeaderCandidate | null = null
    for (const spelling of spellingsOf(field, options.dictionaries ?? [])) {
      const source = spelling.source ? { source: spelling.source } : {}
      let candidate: HeaderCandidate | null = null
      if (spelling.text.trim().toLowerCase() === raw) {
        candidate = { fieldId: field.id, confidence: 1, reason: 'exactAlias', alias: spelling.text, ...source }
      } else if (spelling.normalized === normalized || (compact.length > 2 && spelling.compact === compact)) {
        candidate = { fieldId: field.id, confidence: 0.95, reason: 'normalizedAlias', alias: spelling.text, ...source }
      } else {
        const score = Math.round(textSimilarity(normalized, spelling.normalized) * 0.9 * 1000) / 1000
        if (score >= threshold) {
          candidate = { fieldId: field.id, confidence: score, reason: 'fuzzy', alias: spelling.text, ...source }
        }
      }
      if (candidate && (!best || candidate.confidence > best.confidence)) best = candidate
    }
    if (!best) continue
    // A custom field wins a tie with a standard one: the organization named
    // that field itself, so a header spelling its name meant THEIR field.
    candidates.push(field.custom ? { ...best, confidence: best.confidence + 1e-6 } : best)
  }
  return candidates.sort((a, b) => b.confidence - a.confidence)
}

/** How far apart two fuzzy candidates are and still a tie for inference to break. */
const NEAR_TIE = 0.05

/**
 * A proposal for every column of a file.
 *
 * Candidates are scored per column, nudged by type inference where samples
 * were given (a fitting type breaks a near tie; a clearly misfitting one is
 * demoted), then assigned greedily strongest first so each field goes to
 * one column. A column with no header candidate but distinctive cells (all
 * emails, all phones, all web addresses) is offered the one importable
 * field of that type nobody took.
 */
export function matchHeaders(
  headers: readonly string[],
  fields: readonly TransferField[],
  options: HeaderMatchOptions = {},
): HeaderMatchResult {
  const inferred = headers.map((_header, column) =>
    options.samples ? inferCellType(options.samples.map((row) => row[column])) : null,
  )
  const byId = new Map(fields.map((field) => [field.id, field]))
  const perColumn = headers.map((header, column) => {
    const type = inferred[column]
    const candidates = headerCandidates(header, fields, options)
    if (!type || !candidates.length) return candidates
    const top = candidates[0] as HeaderCandidate
    return candidates
      .map((candidate) => {
        const field = byId.get(candidate.fieldId) as TransferField
        if (candidate.reason !== 'fuzzy') return candidate
        const fits = inferredTypeFits(field.type, type)
        if (fits && top.confidence - candidate.confidence <= NEAR_TIE) {
          return { ...candidate, confidence: Math.min(0.9, candidate.confidence + NEAR_TIE + 0.001) }
        }
        if (!fits && type !== 'text') return { ...candidate, confidence: candidate.confidence - 0.15 }
        return candidate
      })
      .filter((candidate) => candidate.confidence >= (candidate.reason === 'fuzzy' ? options.threshold ?? HEADER_MATCH_THRESHOLD : 0))
      .sort((a, b) => b.confidence - a.confidence)
  })

  const pairs = perColumn
    .flatMap((candidates, column) => candidates.map((candidate, rank) => ({ column, rank, candidate })))
    .sort((a, b) => b.candidate.confidence - a.candidate.confidence || a.rank - b.rank || a.column - b.column)
  const chosen = new Map<number, HeaderCandidate>()
  const takenBy = new Map<string, number>()
  for (const { column, candidate } of pairs) {
    if (chosen.has(column) || takenBy.has(candidate.fieldId)) continue
    chosen.set(column, candidate)
    takenBy.set(candidate.fieldId, column)
  }

  headers.forEach((_header, column) => {
    const type = inferred[column]
    if (chosen.has(column) || !type || !DISTINCTIVE.includes(type)) return
    const open = fields.filter(
      (field) => isTransferFieldImportable(field) && !takenBy.has(field.id) && inferredTypeFits(field.type, type) && field.type !== 'lookup',
    )
    if (open.length !== 1) return
    const field = open[0] as TransferField
    chosen.set(column, { fieldId: field.id, confidence: 0.55, reason: 'typeInference' })
    takenBy.set(field.id, column)
  })

  const conflicts = new Map<string, number[]>()
  perColumn.forEach((candidates, column) => {
    const top = candidates[0]
    if (!top) return
    const winner = takenBy.get(top.fieldId)
    if (winner === undefined || winner === column) return
    const list = conflicts.get(top.fieldId) ?? [winner]
    list.push(column)
    conflicts.set(top.fieldId, list)
  })

  const proposals: HeaderMatchProposal[] = headers.map((header, column) => {
    const pick = chosen.get(column)
    const top = perColumn[column]?.[0]
    const lost = top && takenBy.get(top.fieldId) !== column ? top.fieldId : undefined
    return {
      column,
      header,
      fieldId: pick?.fieldId ?? null,
      confidence: pick ? Math.min(1, Math.round(pick.confidence * 1000) / 1000) : 0,
      reason: pick?.reason ?? null,
      ...(pick?.alias !== undefined ? { alias: pick.alias } : {}),
      ...(pick?.source !== undefined ? { source: pick.source } : {}),
      alternatives: (perColumn[column] ?? []).filter((candidate) => candidate.fieldId !== pick?.fieldId).slice(0, 4),
      inferredType: inferred[column] ?? null,
      ...(lost ? { lostField: lost } : {}),
    }
  })

  const mapping: Record<number, string> = {}
  for (const proposal of proposals) if (proposal.fieldId) mapping[proposal.column] = proposal.fieldId
  return {
    proposals,
    mapping,
    conflicts: [...conflicts.entries()].map(([fieldId, columns]) => ({ fieldId, columns })),
    unmappedRequired: mappingUnmappedRequired(mapping, fields),
  }
}

/** Required fields a mapping leaves without a column. */
export function mappingUnmappedRequired(
  mapping: Readonly<Record<number, string | null | undefined>>,
  fields: readonly TransferField[],
): string[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean))
  return fields.filter((field) => field.required && !mapped.has(field.id)).map((field) => field.id)
}

/** What is wrong with a mapping as the person left it. */
export interface MappingProblems {
  /** Fields two or more columns are mapped to. */
  duplicates: HeaderMatchConflict[]
  /** Required fields with no column. */
  unmappedRequired: string[]
  /** Columns mapped to a field that does not exist or cannot be imported. */
  invalid: { column: number; fieldId: string }[]
}

/**
 * The problems that must be resolved before a mapping can be used: a field
 * two columns write, a required field nobody writes, a target that cannot
 * be imported.
 */
export function mappingProblems(
  mapping: Readonly<Record<number, string | null | undefined>>,
  fields: readonly TransferField[],
): MappingProblems {
  const byId = new Map(fields.map((field) => [field.id, field]))
  const columnsOf = new Map<string, number[]>()
  const invalid: { column: number; fieldId: string }[] = []
  for (const [columnText, fieldId] of Object.entries(mapping)) {
    if (!fieldId) continue
    const column = Number(columnText)
    const field = byId.get(fieldId)
    if (!field || !isTransferFieldImportable(field)) {
      invalid.push({ column, fieldId })
      continue
    }
    columnsOf.set(fieldId, [...(columnsOf.get(fieldId) ?? []), column])
  }
  return {
    duplicates: [...columnsOf.entries()]
      .filter(([, columns]) => columns.length > 1)
      .map(([fieldId, columns]) => ({ fieldId, columns: columns.sort((a, b) => a - b) })),
    unmappedRequired: mappingUnmappedRequired(mapping, fields),
    invalid,
  }
}

/** Whether a mapping has nothing that blocks it. */
export function mappingIsUsable(problems: MappingProblems): boolean {
  return !problems.duplicates.length && !problems.unmappedRequired.length && !problems.invalid.length
}
