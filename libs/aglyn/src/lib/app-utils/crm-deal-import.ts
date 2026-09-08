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
 * BRINGING A SPREADSHEET OF DEALS INTO THE CRM — the pure half (AGL-2662).
 *
 * The contact import's three stages (`crm-import.ts`) over the deal
 * vocabulary: a header row is matched to a proposed mapping, one line is
 * mapped to a raw row of verbatim strings, and the server normalizes each
 * row here before it resolves the two names a deal cannot be filed without.
 *
 * ## A deal names its pipeline and its stage by NAME
 *
 * A spreadsheet says "Sales" and "Proposal sent", never a document id, so
 * the file carries names and the server resolves them against the org's
 * own pipelines — case-insensitively, trimmed — and REFUSES the row, by
 * name, when it cannot: an unknown pipeline is `unknown-pipeline`, an
 * unknown stage in a known pipeline `unknown-stage`. A row with no
 * pipeline cell lands in the default pipeline, and one with no stage cell
 * in that pipeline's first open stage, the way the deal drawer opens.
 *
 * ## A deal has no key, so nothing is merged
 *
 * A contact is one address and a company one domain, but two deals titled
 * "Renewal" are two deals. Every row CREATES; importing a file twice files
 * it twice. What is refused is refused before any write.
 *
 * ## A bad cell is dropped and named; a bad row is skipped and named
 *
 * The contact import's rule: an amount that is not a number, a currency
 * that is not a code, a close date that is not a date, an owner address
 * that is not an address — each is left off the record and REPORTED under
 * {@link DealImportRow.dropped}, never silently discarded.
 */

import { normalizeContactEmail } from './contacts'
import {
  CSV_IMPORT_CHUNK_SIZE,
  CSV_IMPORT_MAX_BODY_BYTES,
  CSV_IMPORT_MAX_ROWS,
  CSV_IMPORT_PREVIEW_ROWS,
  emptyImportResult,
  guessImportMapping,
  importAliasKeys,
  type ImportChunkResult,
  type ImportDroppedValue,
  importSkippedCsv,
  importTextValue,
  mapImportRow,
  mergeImportResults,
} from './csv-import'

/** The shared ceilings, under this collection's names. */
export const DEAL_IMPORT_MAX_ROWS = CSV_IMPORT_MAX_ROWS
export const DEAL_IMPORT_CHUNK_SIZE = CSV_IMPORT_CHUNK_SIZE
export const DEAL_IMPORT_MAX_BODY_BYTES = CSV_IMPORT_MAX_BODY_BYTES
export const DEAL_IMPORT_PREVIEW_ROWS = CSV_IMPORT_PREVIEW_ROWS

/** The same caps the deal drawer holds a typed deal to. */
export const DEAL_IMPORT_TITLE_MAX = 120
export const DEAL_IMPORT_NOTES_MAX = 4000
/** The most cents one row may carry — past this the number is a slip. */
export const DEAL_IMPORT_AMOUNT_CENTS_MAX = 1_000_000_000_000

/** The fields a column may be mapped to, in the order the mapping menu lists them. */
export const DEAL_IMPORT_FIELDS = [
  'title',
  'pipeline',
  'stage',
  'amount',
  'currency',
  'ownerEmail',
  'expectedClose',
  'notes',
] as const

export type DealImportField = (typeof DEAL_IMPORT_FIELDS)[number]

/** How each field reads in the mapping menu. Typed so a field cannot ship unlabeled. */
export const DEAL_IMPORT_FIELD_LABELS: Record<DealImportField, string> = {
  title: 'Title (required)',
  pipeline: 'Pipeline (by name)',
  stage: 'Stage (by name)',
  amount: 'Amount (major units, 1250.00)',
  currency: 'Currency (three-letter code)',
  ownerEmail: 'Owner (team member email)',
  expectedClose: 'Expected close (YYYY-MM-DD)',
  notes: 'Notes',
}

/**
 * Header aliases per field, matched after the shared header normalization.
 *
 * First in each list is the header this CRM's own deals export writes, so
 * an export re-imports without a hand mapping; the export's Status,
 * Contact, Company, Closed and Lost reason columns are deliberately
 * absent, because the stage decides the status and a link is made on the
 * record, not from a file.
 */
const FIELD_ALIASES: Record<DealImportField, readonly string[]> = {
  title: ['title', 'deal', 'deal name', 'deal title', 'name', 'opportunity', 'opportunity name'],
  pipeline: ['pipeline', 'pipeline name', 'board'],
  stage: ['stage', 'stage name', 'deal stage', 'step'],
  amount: ['amount', 'value', 'deal value', 'deal amount', 'total', 'price'],
  currency: ['currency', 'currency code'],
  ownerEmail: ['owner', 'owner email', 'deal owner', 'assigned to', 'rep'],
  expectedClose: ['expected close', 'close date', 'expected close date', 'closing date', 'expected closing'],
  notes: ['notes', 'note', 'description', 'comments'],
}

const FIELD_ALIAS_KEYS = importAliasKeys(DEAL_IMPORT_FIELDS, FIELD_ALIASES)

/** Column index → field. A column absent from the map is not imported. */
export type DealImportMapping = Record<number, DealImportField>

/** A proposed mapping from a file's header row, each field taken at most once. */
export function guessDealImportMapping(columns: readonly string[]): DealImportMapping {
  return guessImportMapping(columns, DEAL_IMPORT_FIELDS, FIELD_ALIAS_KEYS)
}

/**
 * What the browser posts for one line: the cells the mapping selected,
 * under the field they were mapped to, verbatim. `unknown` because the
 * server reads this off an untrusted body.
 */
export type DealImportRawRow = Partial<Record<DealImportField, unknown>>

/**
 * One parsed line under the mapping. Empty cells are left absent. A deal
 * has no custom fields yet, so a custom target the shared drawer could
 * name is dropped here rather than refused at the type.
 */
export function mapDealImportRow(
  cells: readonly string[],
  mapping: Record<number, DealImportField | `custom:${string}`>,
): DealImportRawRow {
  const { custom: _custom, ...row } = mapImportRow(cells, mapping)
  return row
}

export type DealImportSkipReason =
  | 'missing-title'
  | 'unknown-pipeline'
  | 'unknown-stage'
  | 'records-band'
  | 'write-failed'

/** How a skip reason reads on screen and in the downloaded file. */
export const DEAL_IMPORT_SKIP_LABELS: Record<DealImportSkipReason, string> = {
  'missing-title': 'No title',
  'unknown-pipeline': 'No pipeline by that name',
  'unknown-stage': 'No stage by that name in that pipeline',
  'records-band': 'CRM records limit reached',
  'write-failed': 'Could not be saved',
}

/** One row, ready for the server to resolve and write. */
export interface DealImportRow {
  title: string
  /** The pipeline's name as typed, trimmed; absent means the default pipeline. */
  pipeline?: string
  /** The stage's name as typed, trimmed; absent means the pipeline's first open stage. */
  stage?: string
  amountCents?: number
  /** Lowercase ISO 4217. */
  currency?: string
  /** Normalized, for the server to resolve against the org's members. */
  ownerEmail?: string
  /** Epoch ms at noon UTC of the typed calendar day, or the typed instant. */
  expectedCloseAtMs?: number
  notes?: string
  dropped: ImportDroppedValue[]
}

export type DealImportRowVerdict =
  | { ok: true; row: DealImportRow }
  | { ok: false; reason: 'missing-title'; input: string }

/**
 * A money cell as cents — `1,250.00`, `$1250`, `1250` → 125000 — or
 * `null` when it is not a number. Rounded to the cent: a spreadsheet
 * that computed `12.345` meant a price, not a third of a cent.
 */
export function parseImportAmountCents(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null
  }
  const text = String(value ?? '')
    .trim()
    .replace(/[,\s]/g, '')
    .replace(/^[^\d.-]+/, '')
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  return Number.isFinite(cents) && cents <= DEAL_IMPORT_AMOUNT_CENTS_MAX ? cents : null
}

/**
 * A date cell as epoch ms: a calendar day (`2026-09-30`) at noon UTC — a
 * day, not an instant, so any zone reads the same date back — or an ISO
 * instant as itself. `null` when it is neither.
 */
export function parseImportDate(value: unknown): number | null {
  const text = String(value ?? '').trim()
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (day) {
    const ms = Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12)
    // `Date.UTC` rolls February 30 into March; a typed day that moved is not a day.
    const back = new Date(ms)
    return back.getUTCMonth() === Number(day[2]) - 1 && back.getUTCDate() === Number(day[3])
      ? ms
      : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? ms : null
}

/**
 * One raw row as the values that will be written, or the reason it cannot
 * be. Refused here only for a missing title; the pipeline and the stage
 * are refused by the server, which alone can look them up; every other
 * unreadable cell is dropped and named.
 */
export function normalizeDealImportRow(raw: DealImportRawRow): DealImportRowVerdict {
  const title = importTextValue(raw.title, DEAL_IMPORT_TITLE_MAX)?.replace(/\s+/g, ' ')
  if (!title) {
    return { ok: false, reason: 'missing-title', input: '' }
  }
  const dropped: ImportDroppedValue[] = []
  const drop = (field: DealImportField, value: unknown) => {
    dropped.push({ field, value: String(value ?? '').trim() })
  }
  const row: DealImportRow = { title, dropped }

  const pipeline = importTextValue(raw.pipeline, 120)
  if (pipeline) row.pipeline = pipeline
  const stage = importTextValue(raw.stage, 120)
  if (stage) row.stage = stage

  const amountText = importTextValue(raw.amount, 64)
  if (amountText) {
    const cents = parseImportAmountCents(amountText)
    if (cents !== null) row.amountCents = cents
    else drop('amount', amountText)
  }

  const currencyText = importTextValue(raw.currency, 16)
  if (currencyText) {
    const code = currencyText.toLowerCase()
    if (/^[a-z]{3}$/.test(code)) row.currency = code
    else drop('currency', currencyText)
  }

  const ownerText = importTextValue(raw.ownerEmail, 320)
  if (ownerText) {
    const owner = normalizeContactEmail(ownerText)
    if (owner) row.ownerEmail = owner
    else drop('ownerEmail', ownerText)
  }

  const closeText = importTextValue(raw.expectedClose, 64)
  if (closeText) {
    const ms = parseImportDate(closeText)
    if (ms !== null) row.expectedCloseAtMs = ms
    else drop('expectedClose', closeText)
  }

  const notes = importTextValue(raw.notes, DEAL_IMPORT_NOTES_MAX)
  if (notes) row.notes = notes

  return { ok: true, row }
}

/** A name as the key two spellings of one pipeline or stage meet at. */
export function dealImportNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** One row the server did not store, by its index in the request, named by the deal. */
export interface DealImportSkippedRow {
  index: number
  title: string
  reason: DealImportSkipReason
}

/** What one request did. The drawer sums these across a file. */
export type DealImportChunkResult = ImportChunkResult<DealImportSkippedRow>

export function emptyDealImportResult(): DealImportChunkResult {
  return emptyImportResult<DealImportSkippedRow>()
}

export function mergeDealImportResults(
  total: DealImportChunkResult,
  chunk: DealImportChunkResult,
  offset = 0,
): DealImportChunkResult {
  return mergeImportResults(total, chunk, offset)
}

/** The skipped rows as a file the operator can fix and re-import. */
export function dealImportSkippedCsv(
  columns: readonly string[],
  entries: readonly { cells: readonly string[]; reason: DealImportSkipReason }[],
): string {
  return importSkippedCsv(columns, entries, DEAL_IMPORT_SKIP_LABELS)
}
