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
 * BRINGING A SPREADSHEET OF PEOPLE INTO THE CRM — the pure half (AGL-2602).
 *
 * A merchant arriving from another CRM has a CSV: a header row naming
 * columns in that product's vocabulary, and one person per line. Nothing
 * about that file is in our shape. This module is every decision about the
 * file that needs no Firestore and no React — which columns mean what, how a
 * cell becomes a stored value, and what to say about a row that cannot be
 * stored — so that the console drawer and the server route read the same
 * rules rather than two copies of them.
 *
 * ## Three stages, and only the last one touches a record
 *
 *  1. {@link guessContactImportMapping} reads the header and proposes a
 *     column → field mapping from a table of aliases. It is a PROPOSAL: the
 *     drawer shows it and the operator corrects it, because an export's
 *     "Company" column may hold a job title and no alias table can know.
 *  2. {@link mapContactImportRow} applies the mapping to one line, producing
 *     the raw row the browser posts. Strings only — the browser trims nothing
 *     and validates nothing, so the server is the one place the file is
 *     judged and a stale drawer cannot judge it differently.
 *  3. {@link normalizeContactImportRow} turns a raw row into the values that
 *     will be written, through the SAME normalizers every other door uses:
 *     `normalizeContactEmail` for the dedupe key, `normalizePhone` for E.164,
 *     `normalizeAddress` for the postal shape, `isContactLifecycleStage` for
 *     the stage. An importer with its own idea of a valid phone number is how
 *     one collection ends up storing a value three ways.
 *
 * ## A bad cell is dropped and named; a bad row is skipped and named
 *
 * The only thing that makes a row unstorable is an unusable address, because
 * the address is the identity the shared row is keyed by. Everything else is
 * a value on the row: a phone that cannot be read as a number is left off
 * the contact and REPORTED under {@link ContactImportRow.dropped}, so the
 * operator learns that forty rows had a phone in a format we could not read
 * rather than discovering, weeks later, that the phone column silently went
 * nowhere. `list-import.ts` applies the same rule to a line that is not an
 * address: reported, never quietly discarded.
 *
 * ## Ceilings are on the work, never on the audience
 *
 * {@link CONTACT_IMPORT_MAX_ROWS} bounds one FILE, and the drawer says so
 * before anything is sent. {@link CONTACT_IMPORT_CHUNK_SIZE} bounds one
 * REQUEST, so a five-thousand-row file is twenty-five requests with a
 * progress bar between them rather than one that times out halfway with no
 * record of what it did. Neither one ever trims a person to fit: a row past
 * the file ceiling is refused with the file, and a row is never dropped to
 * make a chunk smaller. The audience band is enforced where every capture
 * enforces it — inside `upsertHostContact` — and an import reports that
 * refusal per row rather than pre-empting it with a count of its own.
 */

import type { AglynPostalAddress } from '../foundation'
import { normalizeAddress, normalizePhone } from '../foundation'
import { normalizeContactEmail } from './contacts'
import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  type ContactCustomValue,
  type ContactFieldDefinition,
  type ContactLifecycleStage,
  isContactLifecycleStage,
} from './crm'

/**
 * The most rows one uploaded file may carry.
 *
 * A bound on the work one import represents and on the memory the browser
 * holds while mapping it — five thousand rows of a wide export is already
 * several megabytes of cells in a tab. A larger list is split and imported
 * in pieces; the drawer says so on the file, before a single row is sent.
 */
export const CONTACT_IMPORT_MAX_ROWS = 5_000

/**
 * Rows per request.
 *
 * Each row costs the server one dedupe read and one write, plus a company
 * lookup for a name it has not seen in this request; two hundred of those
 * sit comfortably inside a console request's budget and give the progress
 * bar twenty-five steps on the largest file the drawer accepts.
 */
export const CONTACT_IMPORT_CHUNK_SIZE = 200

/**
 * The most bytes one request may carry, checked before the body is judged.
 *
 * Two hundred rows of a wide export with long custom values is well under a
 * megabyte; two megabytes is the line past which a request is not a chunk
 * of a contact file but something else being pushed through this door.
 */
export const CONTACT_IMPORT_MAX_BODY_BYTES = 2_000_000

/** How many mapped rows the drawer shows before the operator commits. */
export const CONTACT_IMPORT_PREVIEW_ROWS = 10

/**
 * The most tags one row may carry — the profile drawer's own cap, so an
 * imported person cannot hold more tags than a hand-edited one.
 */
export const CONTACT_IMPORT_TAGS_MAX = 20

/** The longest text a name, title, company name or custom text value keeps. */
const NAME_MAX = 120
const CUSTOM_TEXT_MAX = 1_000

/**
 * The standard fields a column may be mapped to, in the order the mapping
 * menu lists them. A custom field is mapped by its key — see
 * {@link ContactImportTargetId}.
 */
export const CONTACT_IMPORT_FIELDS = [
  'email',
  'name',
  'phone',
  'jobTitle',
  'companyName',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'addressState',
  'addressPostalCode',
  'addressCountry',
  'tags',
  'ownerEmail',
  'lifecycleStage',
  'marketingConsent',
] as const

export type ContactImportField = (typeof CONTACT_IMPORT_FIELDS)[number]

/** How each field reads in the mapping menu. Typed so a field cannot ship unlabeled. */
export const CONTACT_IMPORT_FIELD_LABELS: Record<ContactImportField, string> = {
  email: 'Email (required)',
  name: 'Name',
  phone: 'Phone',
  jobTitle: 'Job title',
  companyName: 'Company name',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  addressCity: 'City',
  addressState: 'State or region',
  addressPostalCode: 'Postal code',
  addressCountry: 'Country (two-letter code)',
  tags: 'Tags (comma or | separated)',
  ownerEmail: 'Owner (team member email)',
  lifecycleStage: 'Lifecycle stage',
  marketingConsent: 'Marketing consent (yes/no)',
}

/**
 * Header aliases per field, matched after {@link headerKey} normalization.
 *
 * The vocabulary of the exports people actually arrive with — HubSpot's
 * "First Name"/"Last Name" pair is deliberately NOT here, because two columns
 * cannot map to one field and a guess that took only the first name would
 * store half a name and look right in the preview. An operator with a split
 * name maps one of the two by hand, and the preview shows what they chose.
 */
const FIELD_ALIASES: Record<ContactImportField, readonly string[]> = {
  email: [
    'email',
    'email address',
    'e-mail',
    'e-mail address',
    'contact email',
    'primary email',
    'work email',
  ],
  name: ['name', 'full name', 'contact name', 'display name', 'person'],
  phone: [
    'phone',
    'phone number',
    'telephone',
    'mobile',
    'mobile phone',
    'cell',
    'work phone',
  ],
  jobTitle: ['job title', 'title', 'position', 'role'],
  companyName: ['company', 'company name', 'organization', 'organisation', 'account'],
  addressLine1: ['address', 'address line 1', 'street', 'street address', 'address 1'],
  addressLine2: ['address line 2', 'address 2', 'street 2', 'apartment', 'suite'],
  addressCity: ['city', 'town', 'locality'],
  addressState: ['state', 'region', 'province', 'county', 'state/region'],
  addressPostalCode: ['postal code', 'postcode', 'zip', 'zip code', 'post code'],
  addressCountry: ['country', 'country code', 'country/region'],
  tags: ['tags', 'tag', 'labels', 'groups', 'segments'],
  ownerEmail: ['owner', 'owner email', 'contact owner', 'assigned to', 'account owner'],
  lifecycleStage: ['lifecycle stage', 'stage', 'lifecycle', 'status', 'lead status'],
  marketingConsent: [
    'marketing consent',
    'consent',
    'opt in',
    'opt-in',
    'opted in',
    'subscribed',
    'marketing opt in',
    'email consent',
  ],
}

/** The prefix a custom-field target id carries. */
const CUSTOM_TARGET_PREFIX = 'custom:'

/**
 * What a column is mapped to: a standard field by name, or a custom field
 * as `custom:<key>`. One string rather than a discriminated object because
 * it is the VALUE of a select control and travels through a form.
 */
export type ContactImportTargetId = ContactImportField | `custom:${string}`

/** The custom-field target id for a definition key. */
export function customImportTarget(key: string): ContactImportTargetId {
  return `${CUSTOM_TARGET_PREFIX}${key}`
}

/** The definition key a custom target names, or `null` for a standard field. */
export function customImportTargetKey(target: string): string | null {
  return target.startsWith(CUSTOM_TARGET_PREFIX)
    ? target.slice(CUSTOM_TARGET_PREFIX.length)
    : null
}

/** Column index → target. A column absent from the map is not imported. */
export type ContactImportMapping = Record<number, ContactImportTargetId>

/**
 * Normalizes a header cell for alias matching.
 *
 * Underscores, dots and hyphens all become one space, so `e-mail`,
 * `email_address` and `Email Address` compare as the words they are. The
 * aliases above are written in the human spelling and pass through the same
 * function, so the table stays readable and the comparison stays exact.
 */
function headerKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_.\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** {@link FIELD_ALIASES}, normalized once through {@link headerKey}. */
const FIELD_ALIAS_KEYS: Record<ContactImportField, ReadonlySet<string>> = (() => {
  const keys = {} as Record<ContactImportField, ReadonlySet<string>>
  for (const field of CONTACT_IMPORT_FIELDS) {
    keys[field] = new Set(FIELD_ALIASES[field].map(headerKey))
  }
  return keys
})()

/**
 * A proposed mapping from a file's header row.
 *
 * Custom fields win over standard aliases when a header matches a
 * definition's label or key exactly — a merchant who defined a field called
 * "Status" meant THEIR status, not our lifecycle stage. Each target is
 * taken at most once, by the first column that claims it, so a file with two
 * columns named "Email" maps the first and leaves the second for the
 * operator to decide.
 */
export function guessContactImportMapping(
  columns: readonly string[],
  fields: readonly Pick<ContactFieldDefinition, 'key' | 'label'>[] = [],
): ContactImportMapping {
  const mapping: ContactImportMapping = {}
  const taken = new Set<string>()
  const customByHeader = new Map<string, string>()
  for (const field of fields) {
    customByHeader.set(headerKey(field.label), field.key)
    customByHeader.set(headerKey(field.key), field.key)
  }
  columns.forEach((column, index) => {
    const key = headerKey(column)
    if (!key) return
    const customKey = customByHeader.get(key)
    if (customKey) {
      const target = customImportTarget(customKey)
      if (!taken.has(target)) {
        mapping[index] = target
        taken.add(target)
      }
      return
    }
    for (const field of CONTACT_IMPORT_FIELDS) {
      if (taken.has(field)) continue
      if (FIELD_ALIAS_KEYS[field].has(key)) {
        mapping[index] = field
        taken.add(field)
        return
      }
    }
  })
  return mapping
}

/**
 * What the browser posts for one line: the cells the mapping selected,
 * under the field they were mapped to, verbatim.
 *
 * Values are `unknown` because the server reads this off an untrusted body;
 * the mapper below only ever writes strings into it.
 */
export interface ContactImportRawRow {
  email?: unknown
  name?: unknown
  phone?: unknown
  jobTitle?: unknown
  companyName?: unknown
  addressLine1?: unknown
  addressLine2?: unknown
  addressCity?: unknown
  addressState?: unknown
  addressPostalCode?: unknown
  addressCountry?: unknown
  tags?: unknown
  ownerEmail?: unknown
  lifecycleStage?: unknown
  marketingConsent?: unknown
  /** Custom values keyed by definition key. */
  custom?: unknown
}

/** One parsed line under the mapping. Empty cells are left absent. */
export function mapContactImportRow(
  cells: readonly string[],
  mapping: ContactImportMapping,
): ContactImportRawRow {
  const row: ContactImportRawRow = {}
  const custom: Record<string, string> = {}
  for (const [indexText, target] of Object.entries(mapping)) {
    const value = String(cells[Number(indexText)] ?? '')
    if (!value.trim()) continue
    const customKey = customImportTargetKey(target)
    if (customKey) {
      custom[customKey] = value
    } else {
      row[target as ContactImportField] = value
    }
  }
  if (Object.keys(custom).length) row.custom = custom
  return row
}

/** Why one row was not stored. */
export type ContactImportSkipReason =
  | 'invalid-email'
  | 'duplicate'
  | 'audience-band'
  | 'write-failed'

/** How a skip reason reads on screen and in the downloaded file. */
export const CONTACT_IMPORT_SKIP_LABELS: Record<ContactImportSkipReason, string> = {
  'invalid-email': 'Not a valid email address',
  duplicate: 'Appears earlier in the file',
  'audience-band': 'Contact limit reached',
  'write-failed': 'Could not be saved',
}

/** A cell the file carried that could not be read as the field it was mapped to. */
export interface ContactImportDroppedValue {
  /** The standard field name, or `custom:<key>`. */
  field: string
  value: string
}

/** One row, ready to be written. */
export interface ContactImportRow {
  email: string
  name?: string
  /** E.164. */
  phone?: string
  jobTitle?: string
  companyName?: string
  address?: AglynPostalAddress
  /** Lowercased, deduplicated, capped at {@link CONTACT_IMPORT_TAGS_MAX}. */
  tags: string[]
  /** Normalized, for the server to resolve against the org's members. */
  ownerEmail?: string
  lifecycleStage?: ContactLifecycleStage
  marketingConsent: boolean
  /** Only the keys whose definition the caller supplied and whose value read. */
  custom: Record<string, ContactCustomValue>
  dropped: ContactImportDroppedValue[]
}

export type ContactImportRowVerdict =
  | { ok: true; row: ContactImportRow }
  | { ok: false; reason: 'invalid-email'; input: string }

/**
 * A tag cell as the tags it names.
 *
 * `|` or `,` separated — the CSV export writes `|`, most other products
 * write `,` — lowercased and trimmed like the profile drawer's own tag
 * field, so an imported `VIP` and a typed `vip` are one tag and not two.
 */
export function parseContactImportTags(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map((entry) => String(entry ?? ''))
    : String(value ?? '').split(/[|,]/)
  return [
    ...new Set(
      parts.map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    ),
  ].slice(0, CONTACT_IMPORT_TAGS_MAX)
}

/**
 * A yes/no cell as a boolean, or `null` when it is neither.
 *
 * The affirmatives are the ones consent and checkbox columns actually
 * carry; the negatives are listed so that an explicit `no` is a `false`
 * rather than an unreadable value that gets reported as dropped.
 */
export function parseContactImportFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (['yes', 'y', 'true', '1', 'on', 'subscribed', 'opted in', 'opted-in'].includes(text)) {
    return true
  }
  if (['no', 'n', 'false', '0', 'off', 'unsubscribed', ''].includes(text)) {
    return false
  }
  return null
}

/**
 * A stage cell as a stage, accepting the stored id (`sales-qualified`), its
 * label ("Sales qualified") and the spellings between them
 * (`Sales_Qualified`), or `null` when it names none of them.
 */
export function parseContactImportLifecycleStage(
  value: unknown,
): ContactLifecycleStage | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return null
  const key = text.replace(/[\s_]+/g, '-')
  if (isContactLifecycleStage(key)) return key
  for (const stage of CONTACT_LIFECYCLE_STAGES) {
    if (CONTACT_LIFECYCLE_STAGE_LABELS[stage].toLowerCase() === text) return stage
  }
  return null
}

/**
 * A cell as the value a custom field of this type stores.
 *
 * `{ value }` when it read, `{ value: undefined }` for a blank cell (nothing
 * to write and nothing to report), and `null` when the cell held something
 * the type cannot hold — a word in a number field, a choice a select does
 * not offer. A date is stored as epoch milliseconds, the shape every other
 * timestamp on a CRM record takes (`dueAtMs`, `expectedCloseAtMs`).
 */
export function parseContactImportCustomValue(
  definition: Pick<ContactFieldDefinition, 'type' | 'options'>,
  value: unknown,
): { value: ContactCustomValue | undefined } | null {
  const text = String(value ?? '').trim()
  if (!text) return { value: undefined }
  switch (definition.type) {
    case 'text':
    case 'url':
      return { value: text.slice(0, CUSTOM_TEXT_MAX) }
    case 'number': {
      const number = Number(text.replace(/[,\s$€£]/g, ''))
      return Number.isFinite(number) ? { value: number } : null
    }
    case 'date': {
      const ms = Date.parse(text)
      return Number.isFinite(ms) ? { value: ms } : null
    }
    case 'select': {
      const wanted = text.toLowerCase()
      const option = (definition.options ?? []).find(
        (candidate) => String(candidate).trim().toLowerCase() === wanted,
      )
      return option === undefined ? null : { value: String(option) }
    }
    case 'checkbox': {
      const flag = parseContactImportFlag(text)
      return flag === null ? null : { value: flag }
    }
    default:
      return null
  }
}

/** A cell as trimmed text capped at `max`, or `undefined` when blank. */
function textValue(value: unknown, max: number): string | undefined {
  const text = String(value ?? '')
    .trim()
    .slice(0, max)
  return text || undefined
}

/**
 * One raw row as the values that will be written, or the reason it cannot
 * be.
 *
 * `fields` is the holder's live definitions: a custom value under a key
 * with no definition is dropped and reported, because a value nobody
 * defined a field for is a value no form will ever show.
 */
export function normalizeContactImportRow(
  raw: ContactImportRawRow,
  fields: readonly Pick<ContactFieldDefinition, 'key' | 'type' | 'options'>[] = [],
): ContactImportRowVerdict {
  const email = normalizeContactEmail(raw.email)
  if (!email) {
    return { ok: false, reason: 'invalid-email', input: String(raw.email ?? '').trim() }
  }
  const dropped: ContactImportDroppedValue[] = []
  const drop = (field: string, value: unknown) => {
    dropped.push({ field, value: String(value ?? '').trim() })
  }

  const row: ContactImportRow = {
    email,
    tags: parseContactImportTags(raw.tags),
    marketingConsent: false,
    custom: {},
    dropped,
  }

  const name = textValue(raw.name, NAME_MAX)
  if (name) row.name = name
  const jobTitle = textValue(raw.jobTitle, NAME_MAX)
  if (jobTitle) row.jobTitle = jobTitle
  const companyName = textValue(raw.companyName, NAME_MAX)
  if (companyName) row.companyName = companyName

  const phoneText = textValue(raw.phone, 64)
  if (phoneText) {
    const phone = normalizePhone(phoneText)
    if (phone) row.phone = phone
    else drop('phone', phoneText)
  }

  const address = normalizeAddress({
    line1: textValue(raw.addressLine1, 200),
    line2: textValue(raw.addressLine2, 200),
    city: textValue(raw.addressCity, 120),
    state: textValue(raw.addressState, 120),
    postalCode: textValue(raw.addressPostalCode, 32),
    country: textValue(raw.addressCountry, 8),
  })
  if (address) row.address = address
  // The country is the one address part the normalizer drops silently — a
  // typed name is not a code — so it is the one part the report has to name.
  const countryText = textValue(raw.addressCountry, 64)
  if (countryText && !address?.country) drop('addressCountry', countryText)

  const ownerText = textValue(raw.ownerEmail, 320)
  if (ownerText) {
    const owner = normalizeContactEmail(ownerText)
    if (owner) row.ownerEmail = owner
    else drop('ownerEmail', ownerText)
  }

  const stageText = textValue(raw.lifecycleStage, 64)
  if (stageText) {
    const stage = parseContactImportLifecycleStage(stageText)
    if (stage) row.lifecycleStage = stage
    else drop('lifecycleStage', stageText)
  }

  const consentText = raw.marketingConsent
  if (consentText !== undefined && consentText !== null && String(consentText).trim()) {
    const flag = parseContactImportFlag(consentText)
    if (flag === null) drop('marketingConsent', consentText)
    else row.marketingConsent = flag
  }

  const custom =
    raw.custom && typeof raw.custom === 'object' && !Array.isArray(raw.custom)
      ? (raw.custom as Record<string, unknown>)
      : {}
  const definitions = new Map(fields.map((field) => [field.key, field]))
  for (const [key, value] of Object.entries(custom)) {
    const definition = definitions.get(key)
    if (!definition) {
      drop(customImportTarget(key), value)
      continue
    }
    const parsed = parseContactImportCustomValue(definition, value)
    if (!parsed) drop(customImportTarget(key), value)
    else if (parsed.value !== undefined) row.custom[key] = parsed.value
  }

  return { ok: true, row }
}

/** One row the server did not store, by its index in the request. */
export interface ContactImportSkippedRow {
  index: number
  email: string
  reason: ContactImportSkipReason
}

/** What one request did. The drawer sums these across a file. */
export interface ContactImportChunkResult {
  received: number
  created: number
  merged: number
  skipped: ContactImportSkippedRow[]
  /** Unreadable cells, tallied by field. */
  dropped: Record<string, number>
  companiesCreated: number
  /** Owner addresses that matched no member of the organization. */
  ownersUnresolved: string[]
}

/** An empty tally, for the drawer to fold chunk results into. */
export function emptyContactImportResult(): ContactImportChunkResult {
  return {
    received: 0,
    created: 0,
    merged: 0,
    skipped: [],
    dropped: {},
    companiesCreated: 0,
    ownersUnresolved: [],
  }
}

/**
 * Two results as one.
 *
 * `offset` is where the chunk started in the file, so a skipped row's index
 * comes back as its position in the FILE rather than in the request — which
 * is what the download of skipped rows has to look up.
 */
export function mergeContactImportResults(
  total: ContactImportChunkResult,
  chunk: ContactImportChunkResult,
  offset = 0,
): ContactImportChunkResult {
  const dropped = { ...total.dropped }
  for (const [field, count] of Object.entries(chunk.dropped ?? {})) {
    dropped[field] = (dropped[field] ?? 0) + Number(count ?? 0)
  }
  return {
    received: total.received + Number(chunk.received ?? 0),
    created: total.created + Number(chunk.created ?? 0),
    merged: total.merged + Number(chunk.merged ?? 0),
    skipped: [
      ...total.skipped,
      ...(chunk.skipped ?? []).map((entry) => ({
        ...entry,
        index: Number(entry.index) + offset,
      })),
    ],
    dropped,
    companiesCreated: total.companiesCreated + Number(chunk.companiesCreated ?? 0),
    ownersUnresolved: [
      ...new Set([...total.ownersUnresolved, ...(chunk.ownersUnresolved ?? [])]),
    ],
  }
}

/** A CSV cell, quoted only when it has to be. */
function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The skipped rows as a file the operator can fix and re-import.
 *
 * The original columns verbatim plus a trailing `Skipped because` column,
 * so the file round-trips: correct the address, delete the last column or
 * leave it unmapped, and import it again.
 */
export function contactImportSkippedCsv(
  columns: readonly string[],
  entries: readonly { cells: readonly string[]; reason: ContactImportSkipReason }[],
): string {
  const header = [...columns, 'Skipped because'].map(csvCell).join(',')
  const lines = entries.map((entry) =>
    [
      ...columns.map((_column, index) => entry.cells[index] ?? ''),
      CONTACT_IMPORT_SKIP_LABELS[entry.reason] ?? entry.reason,
    ]
      .map(csvCell)
      .join(','),
  )
  return [header, ...lines].join('\n')
}
