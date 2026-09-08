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
 * BRINGING A SPREADSHEET OF LEADS INTO THE CRM — the pure half (AGL-2701).
 *
 * The contact import's three stages (`crm-import.ts`) over the lead
 * vocabulary. A lead is the one CRM record a person does not type: it is
 * what a capture door wrote when somebody signed up, booked or submitted a
 * form, plus the working state the team wrote on top. A file therefore
 * carries HALF a lead — the person, and the team's annotations — and the
 * capture half is the door's to write.
 *
 * ## The address is the identity, because it is the document id
 *
 * A lead lives at `hosts/{hostId}/leads/{personKey}`, and `personKey` is
 * the sha256 of the normalized address. So the address is not merely the
 * one required cell: it is the row's name. A cell the normalizer cannot
 * read is refused as `invalid-email`, and two rows of one file that
 * normalize to the same address are one person — the second is skipped as
 * `duplicate` rather than merged onto the first, for the reason the
 * contacts import gives: one person reported once created and once merged
 * is a number the operator cannot reconcile against the rows they sent.
 *
 * ## What a file may NOT say
 *
 * The export's `Sources`, `First seen`, `Last seen` and `Captures` columns
 * are the capture door's own record of what the visitor did, and
 * `Converted` is stamped by `crm/lead-convert` after the contact exists.
 * None of them is a field here, so the mapping leaves those columns
 * unmapped rather than mis-mapping them — a file that could write
 * "first seen" could rewrite the history it is supposed to describe. The
 * organization-level file's `Site` column is left out for a second reason:
 * the site is the drawer's question and the route's permission is granted
 * for that ONE site, so a cell must not be able to redirect a row to
 * another.
 *
 * ## Qualified is a conversion, not a status a cell can claim
 *
 * `qualified` means a lead BECAME a contact, and `convertedContactId`
 * beside it names the contact that was really created. Only the convert
 * route writes the pair, so the list's own status control offers new,
 * working and unqualified and nothing else. A cell naming `qualified` is
 * dropped and reported here for the same reason: a status claiming a
 * conversion that never happened would show a contact link to nowhere.
 *
 * ## A bad cell is dropped and named; a bad row is skipped and named
 *
 * The address is the only cell that can make a row unstorable. An
 * unreadable status, or an unqualified reason with no unqualified status
 * to belong to, is left off the lead and REPORTED under
 * {@link LeadImportRow.dropped}, so the operator learns that a column went
 * nowhere rather than discovering it weeks later.
 */

import { normalizeContactEmail } from './contacts'
import {
  CRM_LEAD_STATUS_LABELS,
  CRM_LEAD_STATUSES,
  type CrmLeadStatus,
  isCrmLeadStatus,
} from './crm'
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
export const LEAD_IMPORT_MAX_ROWS = CSV_IMPORT_MAX_ROWS
export const LEAD_IMPORT_CHUNK_SIZE = CSV_IMPORT_CHUNK_SIZE
export const LEAD_IMPORT_MAX_BODY_BYTES = CSV_IMPORT_MAX_BODY_BYTES
export const LEAD_IMPORT_PREVIEW_ROWS = CSV_IMPORT_PREVIEW_ROWS

/** The same caps the lead's own cards hold a typed value to. */
export const LEAD_IMPORT_NOTES_MAX = 4000
export const LEAD_IMPORT_REASON_MAX = 500

/** A person's name, capped where every other import caps one. */
const NAME_MAX = 120

/**
 * The statuses a file may set.
 *
 * The list's own status control offers exactly these three, and for the
 * reason given above: `qualified` is written by the conversion, beside the
 * contact it produced.
 */
export const LEAD_IMPORT_STATUSES: readonly CrmLeadStatus[] =
  CRM_LEAD_STATUSES.filter((status) => status !== 'qualified')

/** The fields a column may be mapped to, in the order the mapping menu lists them. */
export const LEAD_IMPORT_FIELDS = [
  'email',
  'name',
  'status',
  'ownerEmail',
  'unqualifiedReason',
  'notes',
] as const

export type LeadImportField = (typeof LEAD_IMPORT_FIELDS)[number]

/** How each field reads in the mapping menu. Typed so a field cannot ship unlabeled. */
export const LEAD_IMPORT_FIELD_LABELS: Record<LeadImportField, string> = {
  email: 'Email (required)',
  name: 'Name',
  status: 'Status (new, working, unqualified)',
  ownerEmail: 'Owner (team member email)',
  unqualifiedReason: 'Unqualified reason',
  notes: 'Notes',
}

/**
 * Header aliases per field, matched after the shared header normalization.
 *
 * First in each list is the header this CRM's own leads export writes, so
 * an export re-imports without a hand mapping; the export's Sources, First
 * seen, Last seen, Captures, Converted and Site columns are deliberately
 * absent from every list, so they land on "Do not import".
 */
const FIELD_ALIASES: Record<LeadImportField, readonly string[]> = {
  email: ['email', 'email address', 'e mail', 'mail', 'contact email', 'work email'],
  name: ['name', 'full name', 'lead', 'lead name', 'contact', 'contact name', 'person'],
  status: ['status', 'lead status', 'stage', 'lead stage', 'state'],
  ownerEmail: ['owner', 'owner email', 'assigned to', 'assignee', 'rep', 'sales rep'],
  unqualifiedReason: [
    'unqualified reason',
    'reason',
    'disqualified reason',
    'lost reason',
    'reason lost',
  ],
  notes: ['notes', 'note', 'description', 'comments', 'details'],
}

const FIELD_ALIAS_KEYS = importAliasKeys(LEAD_IMPORT_FIELDS, FIELD_ALIASES)

/** Column index → field. A column absent from the map is not imported. */
export type LeadImportMapping = Record<number, LeadImportField>

/** A proposed mapping from a file's header row, each field taken at most once. */
export function guessLeadImportMapping(columns: readonly string[]): LeadImportMapping {
  return guessImportMapping(columns, LEAD_IMPORT_FIELDS, FIELD_ALIAS_KEYS)
}

/**
 * What the browser posts for one line: the cells the mapping selected,
 * under the field they were mapped to, verbatim. `unknown` because the
 * server reads this off an untrusted body.
 */
export type LeadImportRawRow = Partial<Record<LeadImportField, unknown>>

/** One parsed line under the mapping. Empty cells are left absent; a lead has no custom fields. */
export function mapLeadImportRow(
  cells: readonly string[],
  mapping: Record<number, LeadImportField | `custom:${string}`>,
): LeadImportRawRow {
  const { custom: _custom, ...row } = mapImportRow(cells, mapping)
  return row
}

export type LeadImportSkipReason =
  | 'invalid-email'
  | 'duplicate'
  | 'lead-ceiling'
  | 'write-failed'

/** How a skip reason reads on screen and in the downloaded file. */
export const LEAD_IMPORT_SKIP_LABELS: Record<LeadImportSkipReason, string> = {
  'invalid-email': 'No usable email address',
  duplicate: 'The same address appears earlier in this file',
  'lead-ceiling': 'This site is at the platform lead limit',
  'write-failed': 'Could not be saved',
}

/** One row, ready for the server to resolve and write. */
export interface LeadImportRow {
  /** Normalized — the address `personKey` derives the document id from. */
  email: string
  name?: string
  /** Absent leaves an existing lead's status alone and a new one reading as `new`. */
  status?: CrmLeadStatus
  /** Normalized, for the server to resolve against the org's members. */
  ownerEmail?: string
  /** Only ever set beside `status: 'unqualified'` — the pair is one fact. */
  unqualifiedReason?: string
  notes?: string
  dropped: ImportDroppedValue[]
}

export type LeadImportRowVerdict =
  | { ok: true; row: LeadImportRow }
  | { ok: false; reason: 'invalid-email'; input: string }

/**
 * A status cell by id or by label — `working`, `Working` and `WORKING` are
 * one status. `null` for a cell naming no status a file may set, which
 * includes the well-spelled `Qualified` the export writes for a converted
 * lead.
 */
export function parseImportLeadStatus(value: unknown): CrmLeadStatus | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return null
  const byId = isCrmLeadStatus(text) ? text : null
  const byLabel =
    LEAD_IMPORT_STATUSES.find(
      (status) => CRM_LEAD_STATUS_LABELS[status].toLowerCase() === text,
    ) ?? null
  const status = byId ?? byLabel
  return status && LEAD_IMPORT_STATUSES.includes(status) ? status : null
}

/**
 * One raw row as the values that will be written, or the reason it cannot
 * be. Refused here only for an unusable address, because the address is
 * the document id; the owner is refused by the server, which alone can
 * look them up.
 */
export function normalizeLeadImportRow(raw: LeadImportRawRow): LeadImportRowVerdict {
  const emailText = importTextValue(raw.email, 320) ?? ''
  const email = normalizeContactEmail(emailText)
  if (!email) {
    return { ok: false, reason: 'invalid-email', input: emailText }
  }
  const dropped: ImportDroppedValue[] = []
  const drop = (field: LeadImportField, value: unknown) => {
    dropped.push({ field, value: String(value ?? '').trim() })
  }
  const row: LeadImportRow = { email, dropped }

  const name = importTextValue(raw.name, NAME_MAX)?.replace(/\s+/g, ' ')
  if (name) row.name = name

  const statusText = importTextValue(raw.status, 32)
  if (statusText) {
    const status = parseImportLeadStatus(statusText)
    if (status) row.status = status
    else drop('status', statusText)
  }

  const ownerText = importTextValue(raw.ownerEmail, 320)
  if (ownerText) {
    const owner = normalizeContactEmail(ownerText)
    if (owner) row.ownerEmail = owner
    else drop('ownerEmail', ownerText)
  }

  /*
   * The reason belongs to the status: it is what an unqualified lead was
   * closed FOR, and on a lead that is not unqualified it describes
   * nothing. A row that carries one without the other keeps the status and
   * reports the reason, so a mis-mapped column is visible rather than
   * stored where nothing reads it.
   */
  const reasonText = importTextValue(raw.unqualifiedReason, LEAD_IMPORT_REASON_MAX)
  if (reasonText) {
    if (row.status === 'unqualified') row.unqualifiedReason = reasonText
    else drop('unqualifiedReason', reasonText)
  }

  const notes = importTextValue(raw.notes, LEAD_IMPORT_NOTES_MAX)
  if (notes) row.notes = notes

  return { ok: true, row }
}

/** One row the server did not store, by its index in the request, named by the address. */
export interface LeadImportSkippedRow {
  index: number
  email: string
  reason: LeadImportSkipReason
}

/** What one request did. The drawer sums these across a file. */
export type LeadImportChunkResult = ImportChunkResult<LeadImportSkippedRow>

export function emptyLeadImportResult(): LeadImportChunkResult {
  return emptyImportResult<LeadImportSkippedRow>()
}

export function mergeLeadImportResults(
  total: LeadImportChunkResult,
  chunk: LeadImportChunkResult,
  offset = 0,
): LeadImportChunkResult {
  return mergeImportResults(total, chunk, offset)
}

/** The skipped rows as a file the operator can fix and re-import. */
export function leadImportSkippedCsv(
  columns: readonly string[],
  entries: readonly { cells: readonly string[]; reason: LeadImportSkipReason }[],
): string {
  return importSkippedCsv(columns, entries, LEAD_IMPORT_SKIP_LABELS)
}
