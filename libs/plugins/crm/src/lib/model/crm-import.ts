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

import type { AglynPostalAddress } from '@aglyn/aglyn/foundation/definitions/contact.types'
import { normalizeAddress, normalizePhone } from '@aglyn/aglyn/foundation/definitions/contact.types'
import {
  composeContactName,
  CONTACT_EXTRA_PHONE_FIELDS,
  normalizeContactBirthdate,
  normalizeContactEmail,
} from '@aglyn/aglyn/app-utils/contacts'
import {
  CSV_IMPORT_CHUNK_SIZE,
  CSV_IMPORT_MAX_BODY_BYTES,
  CSV_IMPORT_MAX_ROWS,
  CSV_IMPORT_PREVIEW_ROWS,
  customImportTarget,
  customImportTargetKey,
  emptyImportResult,
  guessImportMapping,
  importAliasKeys,
  type ImportChunkResult,
  type ImportDroppedValue,
  importSkippedCsv,
  importTextValue,
  mapImportRow,
  mergeImportResults,
  parseImportFlag,
  parseImportTags,
} from '@aglyn/aglyn/app-utils/csv-import'
import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_LIFECYCLE_STAGES,
  type ContactCustomValue,
  type ContactFieldDefinition,
  type ContactLifecycleStage,
  isContactLifecycleStage,
} from '@aglyn/aglyn/app-utils/crm'

/*
 * The custom-target grammar is the shared module's; it is re-exported here
 * because every reader of a contact mapping has always taken it from this
 * file, and the companies import reads the same two functions from theirs.
 */
export { customImportTarget, customImportTargetKey } from '@aglyn/aglyn/app-utils/csv-import'

/**
 * The ceilings are the shared ones (`csv-import.ts`), under the names this
 * file has always exported: one file, one request and one preview are
 * bounded the same way for every collection, because the bounds are about
 * the browser's memory and a request's budget rather than about people.
 */
export const CONTACT_IMPORT_MAX_ROWS = CSV_IMPORT_MAX_ROWS

export const CONTACT_IMPORT_CHUNK_SIZE = CSV_IMPORT_CHUNK_SIZE

export const CONTACT_IMPORT_MAX_BODY_BYTES = CSV_IMPORT_MAX_BODY_BYTES

export const CONTACT_IMPORT_PREVIEW_ROWS = CSV_IMPORT_PREVIEW_ROWS

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
  'salutation',
  'firstName',
  'lastName',
  'name',
  'phone',
  'mobilePhone',
  'homePhone',
  'otherPhone',
  'fax',
  'doNotCall',
  'jobTitle',
  'department',
  'companyName',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'addressState',
  'addressPostalCode',
  'addressCountry',
  'otherAddressLine1',
  'otherAddressLine2',
  'otherAddressCity',
  'otherAddressState',
  'otherAddressPostalCode',
  'otherAddressCountry',
  'birthdate',
  'assistantName',
  'assistantPhone',
  'tags',
  'ownerEmail',
  'lifecycleStage',
  'marketingConsent',
] as const

export type ContactImportField = (typeof CONTACT_IMPORT_FIELDS)[number]

/** How each field reads in the mapping menu. Typed so a field cannot ship unlabeled. */
export const CONTACT_IMPORT_FIELD_LABELS: Record<ContactImportField, string> = {
  email: 'Email (required)',
  salutation: 'Salutation',
  firstName: 'First name',
  lastName: 'Last name',
  name: 'Name',
  phone: 'Phone',
  mobilePhone: 'Mobile phone',
  homePhone: 'Home phone',
  otherPhone: 'Other phone',
  fax: 'Fax',
  doNotCall: 'Do not call (yes/no)',
  jobTitle: 'Job title',
  department: 'Department',
  companyName: 'Company name',
  addressLine1: 'Mailing address line 1',
  addressLine2: 'Mailing address line 2',
  addressCity: 'Mailing city',
  addressState: 'Mailing state or region',
  addressPostalCode: 'Mailing postal code',
  addressCountry: 'Mailing country (two-letter code)',
  otherAddressLine1: 'Other address line 1',
  otherAddressLine2: 'Other address line 2',
  otherAddressCity: 'Other city',
  otherAddressState: 'Other state or region',
  otherAddressPostalCode: 'Other postal code',
  otherAddressCountry: 'Other country (two-letter code)',
  birthdate: 'Birthdate (YYYY-MM-DD)',
  assistantName: 'Assistant',
  assistantPhone: 'Assistant phone',
  tags: 'Tags (comma or | separated)',
  ownerEmail: 'Owner (team member email)',
  lifecycleStage: 'Lifecycle stage',
  marketingConsent: 'Marketing consent (yes/no)',
}

/**
 * Header aliases per field, matched after `importHeaderKey` normalization.
 *
 * The vocabulary of the exports people actually arrive with — HubSpot's and
 * Salesforce's. A "First Name"/"Last Name" pair maps to the two fields of
 * the same names (AGL-3515), and the holder's name is composed from them,
 * so a split name is never stored as half of itself. Salesforce's "Mailing
 * …" columns are the mailing address and its "Other …" columns the other
 * address.
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
  salutation: ['salutation', 'title prefix', 'prefix', 'honorific'],
  firstName: ['first name', 'firstname', 'given name', 'forename'],
  lastName: ['last name', 'lastname', 'surname', 'family name'],
  name: ['name', 'full name', 'contact name', 'display name', 'person'],
  phone: ['phone', 'phone number', 'telephone', 'work phone', 'business phone'],
  mobilePhone: ['mobile', 'mobile phone', 'mobile phone number', 'cell', 'cell phone'],
  homePhone: ['home phone', 'home phone number', 'home telephone'],
  otherPhone: ['other phone', 'other phone number', 'alternate phone'],
  fax: ['fax', 'fax number', 'business fax'],
  doNotCall: ['do not call', 'dnc', 'no calls'],
  jobTitle: ['job title', 'title', 'position', 'role'],
  department: ['department', 'dept'],
  companyName: ['company', 'company name', 'organization', 'organisation', 'account'],
  addressLine1: [
    'address',
    'address line 1',
    'street',
    'street address',
    'address 1',
    'mailing address line 1',
    'mailing street',
    'mailing address',
  ],
  addressLine2: [
    'address line 2',
    'address 2',
    'street 2',
    'apartment',
    'suite',
    'mailing address line 2',
    'mailing street 2',
  ],
  addressCity: ['city', 'town', 'locality', 'mailing city'],
  addressState: [
    'state',
    'region',
    'province',
    'county',
    'state/region',
    'mailing state',
    'mailing state/province',
    'mailing state or region',
  ],
  addressPostalCode: [
    'postal code',
    'postcode',
    'zip',
    'zip code',
    'post code',
    'mailing postal code',
    'mailing zip/postal code',
    'mailing zip',
  ],
  addressCountry: ['country', 'country code', 'country/region', 'mailing country'],
  otherAddressLine1: ['other address line 1', 'other street', 'other address'],
  otherAddressLine2: ['other address line 2', 'other street 2'],
  otherAddressCity: ['other city'],
  otherAddressState: ['other state', 'other state/province', 'other state or region'],
  otherAddressPostalCode: ['other postal code', 'other zip/postal code', 'other zip'],
  otherAddressCountry: ['other country'],
  birthdate: ['birthdate', 'birthday', 'date of birth', 'dob', 'birth date'],
  assistantName: ['assistant', 'assistant name', "assistant's name"],
  assistantPhone: ['assistant phone', 'asst. phone', 'asst phone'],
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

/**
 * What a column is mapped to: a standard field by name, or a custom field
 * as `custom:<key>` — see `customImportTarget`.
 */
export type ContactImportTargetId = ContactImportField | `custom:${string}`

/** Column index → target. A column absent from the map is not imported. */
export type ContactImportMapping = Record<number, ContactImportTargetId>

/** {@link FIELD_ALIASES}, normalized once for the matcher. */
const FIELD_ALIAS_KEYS = importAliasKeys(CONTACT_IMPORT_FIELDS, FIELD_ALIASES)

/**
 * A proposed mapping from a file's header row — the shared matcher over the
 * contact vocabulary. Custom fields win over standard aliases when a header
 * matches a definition's label or key exactly: a merchant who defined a
 * field called "Status" meant THEIR status, not our lifecycle stage.
 */
export function guessContactImportMapping(
  columns: readonly string[],
  fields: readonly Pick<ContactFieldDefinition, 'key' | 'label'>[] = [],
): ContactImportMapping {
  return guessImportMapping(columns, CONTACT_IMPORT_FIELDS, FIELD_ALIAS_KEYS, fields)
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
  salutation?: unknown
  firstName?: unknown
  lastName?: unknown
  name?: unknown
  phone?: unknown
  mobilePhone?: unknown
  homePhone?: unknown
  otherPhone?: unknown
  fax?: unknown
  doNotCall?: unknown
  department?: unknown
  birthdate?: unknown
  assistantName?: unknown
  assistantPhone?: unknown
  otherAddressLine1?: unknown
  otherAddressLine2?: unknown
  otherAddressCity?: unknown
  otherAddressState?: unknown
  otherAddressPostalCode?: unknown
  otherAddressCountry?: unknown
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
  return mapImportRow(cells, mapping)
}

/** Why one row was not stored. */
export type ContactImportSkipReason =
  | 'invalid-email'
  | 'duplicate'
  | 'audience-band'
  /** The person was erased from this workspace at their request (AGL-2623). */
  | 'erased'
  | 'write-failed'
  /**
   * The request ran out of time before it reached the row (AGL-3423). Nothing
   * was written for it, and importing the skipped file again is safe: a row
   * that did land merges into its record rather than creating a second one.
   */
  | 'not-reached'

/** How a skip reason reads on screen and in the downloaded file. */
export const CONTACT_IMPORT_SKIP_LABELS: Record<ContactImportSkipReason, string> = {
  'invalid-email': 'Not a valid email address',
  duplicate: 'Appears earlier in the file',
  'audience-band': 'Contact limit reached',
  erased: 'Erased from this workspace at their request',
  'write-failed': 'Could not be saved',
  'not-reached': 'Not reached in time; import the skipped rows again',
}

/** A cell the file carried that could not be read as the field it was mapped to. */
export type ContactImportDroppedValue = ImportDroppedValue

/** One row, ready to be written. */
export interface ContactImportRow {
  email: string
  /** As typed, or composed from {@link firstName} and {@link lastName} when either was given. */
  name?: string
  /** The label as the file spelled it; the server judges it against the org's list. */
  salutation?: string
  firstName?: string
  lastName?: string
  /** E.164. */
  phone?: string
  /** E.164, each (AGL-3515). */
  mobilePhone?: string
  homePhone?: string
  otherPhone?: string
  fax?: string
  assistantPhone?: string
  /** Only ever `true` — a file says a person asked not to be called, never the reverse. */
  doNotCall?: true
  department?: string
  /** `YYYY-MM-DD`. */
  birthdate?: string
  assistantName?: string
  jobTitle?: string
  companyName?: string
  /** The mailing address. */
  address?: AglynPostalAddress
  otherAddress?: AglynPostalAddress
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
  return parseImportTags(value, CONTACT_IMPORT_TAGS_MAX)
}

/**
 * A yes/no cell as a boolean, or `null` when it is neither.
 *
 * The affirmatives are the ones consent and checkbox columns actually
 * carry; the negatives are listed so that an explicit `no` is a `false`
 * rather than an unreadable value that gets reported as dropped.
 */
export function parseContactImportFlag(value: unknown): boolean | null {
  return parseImportFlag(value)
}

/**
 * A birthdate cell as `YYYY-MM-DD`, or `null` when it is not a past date
 * (AGL-3515). The stored spelling, and the `M/D/YYYY` a US spreadsheet
 * writes a date in — Salesforce's report export among them.
 */
export function parseContactImportBirthdate(value: unknown, nowMs = Date.now()): string | null {
  const text = String(value ?? '').trim()
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
  const iso = us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : text
  return normalizeContactBirthdate(iso, nowMs) || null
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

  const firstName = composeContactName(importTextValue(raw.firstName, NAME_MAX), '')
  if (firstName) row.firstName = firstName
  const lastName = composeContactName('', importTextValue(raw.lastName, NAME_MAX))
  if (lastName) row.lastName = lastName
  // The parts make the name when the file has them (AGL-3515).
  const name = composeContactName(firstName, lastName) || importTextValue(raw.name, NAME_MAX)
  if (name) row.name = name
  const salutation = importTextValue(raw.salutation, NAME_MAX)
  if (salutation) row.salutation = salutation
  const department = importTextValue(raw.department, NAME_MAX)
  if (department) row.department = department
  const assistantName = importTextValue(raw.assistantName, NAME_MAX)
  if (assistantName) row.assistantName = assistantName
  for (const key of CONTACT_EXTRA_PHONE_FIELDS) {
    const text = importTextValue(raw[key], 64)
    if (!text) continue
    const phone = normalizePhone(text)
    if (phone) row[key] = phone
    else drop(key, text)
  }
  const birthdateText = importTextValue(raw.birthdate, 64)
  if (birthdateText) {
    const birthdate = parseContactImportBirthdate(birthdateText)
    if (birthdate) row.birthdate = birthdate
    else drop('birthdate', birthdateText)
  }
  const doNotCallText = raw.doNotCall
  if (doNotCallText !== undefined && doNotCallText !== null && String(doNotCallText).trim()) {
    const flag = parseContactImportFlag(doNotCallText)
    if (flag === null) drop('doNotCall', doNotCallText)
    else if (flag) row.doNotCall = true
  }
  const jobTitle = importTextValue(raw.jobTitle, NAME_MAX)
  if (jobTitle) row.jobTitle = jobTitle
  const companyName = importTextValue(raw.companyName, NAME_MAX)
  if (companyName) row.companyName = companyName

  const phoneText = importTextValue(raw.phone, 64)
  if (phoneText) {
    const phone = normalizePhone(phoneText)
    if (phone) row.phone = phone
    else drop('phone', phoneText)
  }

  const address = normalizeAddress({
    line1: importTextValue(raw.addressLine1, 200),
    line2: importTextValue(raw.addressLine2, 200),
    city: importTextValue(raw.addressCity, 120),
    state: importTextValue(raw.addressState, 120),
    postalCode: importTextValue(raw.addressPostalCode, 32),
    country: importTextValue(raw.addressCountry, 8),
  })
  if (address) row.address = address
  // The country is the one address part the normalizer drops silently — a
  // typed name is not a code — so it is the one part the report has to name.
  const countryText = importTextValue(raw.addressCountry, 64)
  if (countryText && !address?.country) drop('addressCountry', countryText)
  const otherAddress = normalizeAddress({
    line1: importTextValue(raw.otherAddressLine1, 200),
    line2: importTextValue(raw.otherAddressLine2, 200),
    city: importTextValue(raw.otherAddressCity, 120),
    state: importTextValue(raw.otherAddressState, 120),
    postalCode: importTextValue(raw.otherAddressPostalCode, 32),
    country: importTextValue(raw.otherAddressCountry, 8),
  })
  if (otherAddress) row.otherAddress = otherAddress
  const otherCountryText = importTextValue(raw.otherAddressCountry, 64)
  if (otherCountryText && !otherAddress?.country) drop('otherAddressCountry', otherCountryText)

  const ownerText = importTextValue(raw.ownerEmail, 320)
  if (ownerText) {
    const owner = normalizeContactEmail(ownerText)
    if (owner) row.ownerEmail = owner
    else drop('ownerEmail', ownerText)
  }

  const stageText = importTextValue(raw.lifecycleStage, 64)
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

/** One row the server did not store, by its index in the request, named by address. */
export interface ContactImportSkippedRow {
  index: number
  email: string
  reason: ContactImportSkipReason
}

/**
 * What one request did — the shared tally plus how many companies the
 * company column brought into being. The drawer sums these across a file.
 */
export interface ContactImportChunkResult
  extends ImportChunkResult<ContactImportSkippedRow> {
  companiesCreated: number
}

/** An empty tally, for the drawer to fold chunk results into. */
export function emptyContactImportResult(): ContactImportChunkResult {
  return { ...emptyImportResult<ContactImportSkippedRow>(), companiesCreated: 0 }
}

/**
 * Two results as one — the shared fold, with the company tally beside it.
 * `offset` is where the chunk started in the file, so a skipped row's index
 * comes back as its position in the FILE rather than in the request.
 */
export function mergeContactImportResults(
  total: ContactImportChunkResult,
  chunk: ContactImportChunkResult,
  offset = 0,
): ContactImportChunkResult {
  return {
    ...mergeImportResults(total, chunk, offset),
    companiesCreated: total.companiesCreated + Number(chunk.companiesCreated ?? 0),
  }
}

/**
 * The skipped rows as a file the operator can fix and re-import: the
 * original columns verbatim plus a trailing `Skipped because` column.
 */
export function contactImportSkippedCsv(
  columns: readonly string[],
  entries: readonly { cells: readonly string[]; reason: ContactImportSkipReason }[],
): string {
  return importSkippedCsv(columns, entries, CONTACT_IMPORT_SKIP_LABELS)
}
