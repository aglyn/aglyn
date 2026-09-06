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
 * BRINGING A SPREADSHEET OF COMPANIES INTO THE CRM — the pure half
 * (AGL-2621).
 *
 * The contact import's three stages (`crm-import.ts`) over the company
 * vocabulary: a header row is matched to a proposed mapping, one line is
 * mapped to a raw row of verbatim strings, and the server normalizes each
 * row through the SAME functions the company drawer runs —
 * `normalizeCompanyDomain` for the key, `normalizeCompanyWebsite` for the
 * link, `normalizePhone` for E.164, `normalizeAddress` for the postal shape
 * — so an imported company and a typed one are the same document.
 *
 * ## The name is the one thing a row must have
 *
 * A company is matched by its DOMAIN first and its name second, because a
 * domain is a key and a name is a spelling: two files calling one business
 * "Acme" and "Acme Inc" meet at `acme.com`. But a row with a domain and no
 * name would create a record the list cannot caption, so the name is
 * required and the domain optional — the opposite of the contact import,
 * where the address is both the key and the caption.
 *
 * ## A bad cell is dropped and named; a bad row is skipped and named
 *
 * The contact import's rule, unchanged: a domain that is not a hostname, a
 * phone that is not a number, a website that is not a URL, a country that
 * is not a code — each is left off the record and REPORTED under
 * {@link CompanyImportRow.dropped}, never silently discarded.
 */

import type { AglynPostalAddress } from '../foundation'
import { normalizeAddress, normalizePhone } from '../foundation'
import { normalizeContactEmail } from './contacts'
import { normalizeCompanyDomain, normalizeCompanyWebsite } from './crm'
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
  parseImportTags,
} from './csv-import'
import { nameSearchKey } from './name-search'

/** The shared ceilings, under this collection's names. */
export const COMPANY_IMPORT_MAX_ROWS = CSV_IMPORT_MAX_ROWS
export const COMPANY_IMPORT_CHUNK_SIZE = CSV_IMPORT_CHUNK_SIZE
export const COMPANY_IMPORT_MAX_BODY_BYTES = CSV_IMPORT_MAX_BODY_BYTES
export const COMPANY_IMPORT_PREVIEW_ROWS = CSV_IMPORT_PREVIEW_ROWS

/** The most tags one company may carry — the same cap a contact has. */
export const COMPANY_IMPORT_TAGS_MAX = 20

const NAME_MAX = 120
const INDUSTRY_MAX = 80
const NOTES_MAX = 4000

/** The fields a column may be mapped to, in the order the mapping menu lists them. */
export const COMPANY_IMPORT_FIELDS = [
  'name',
  'domain',
  'website',
  'phone',
  'industry',
  'ownerEmail',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'addressState',
  'addressPostalCode',
  'addressCountry',
  'tags',
  'notes',
] as const

export type CompanyImportField = (typeof COMPANY_IMPORT_FIELDS)[number]

/** How each field reads in the mapping menu. Typed so a field cannot ship unlabeled. */
export const COMPANY_IMPORT_FIELD_LABELS: Record<CompanyImportField, string> = {
  name: 'Company name (required)',
  domain: 'Domain',
  website: 'Website',
  phone: 'Phone',
  industry: 'Industry',
  ownerEmail: 'Owner (team member email)',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  addressCity: 'City',
  addressState: 'State or region',
  addressPostalCode: 'Postal code',
  addressCountry: 'Country (two-letter code)',
  tags: 'Tags (comma or | separated)',
  notes: 'Notes',
}

/**
 * Header aliases per field, matched after the shared header normalization.
 *
 * The vocabulary of the exports people arrive with, and — first in each
 * list — the header this CRM's own companies export writes, so an export
 * re-imports without a hand mapping.
 */
const FIELD_ALIASES: Record<CompanyImportField, readonly string[]> = {
  name: ['company', 'company name', 'name', 'organization', 'organisation', 'account', 'account name'],
  domain: ['domain', 'company domain', 'domain name', 'web domain', 'email domain'],
  website: ['website', 'web site', 'url', 'website url', 'homepage', 'web'],
  phone: ['phone', 'phone number', 'telephone', 'company phone', 'main phone'],
  industry: ['industry', 'sector', 'vertical', 'category'],
  ownerEmail: ['owner', 'owner email', 'company owner', 'account owner', 'assigned to'],
  addressLine1: ['address line 1', 'address', 'street', 'street address', 'address 1'],
  addressLine2: ['address line 2', 'address 2', 'street 2', 'suite'],
  addressCity: ['city', 'town', 'locality'],
  addressState: ['state', 'region', 'province', 'county', 'state/region'],
  addressPostalCode: ['postal code', 'postcode', 'zip', 'zip code', 'post code'],
  addressCountry: ['country', 'country code', 'country/region'],
  tags: ['tags', 'tag', 'labels', 'groups'],
  notes: ['notes', 'note', 'description', 'comments'],
}

const FIELD_ALIAS_KEYS = importAliasKeys(COMPANY_IMPORT_FIELDS, FIELD_ALIASES)

/** Column index → field. A column absent from the map is not imported. */
export type CompanyImportMapping = Record<number, CompanyImportField>

/** A proposed mapping from a file's header row, each field taken at most once. */
export function guessCompanyImportMapping(
  columns: readonly string[],
): CompanyImportMapping {
  return guessImportMapping(columns, COMPANY_IMPORT_FIELDS, FIELD_ALIAS_KEYS)
}

/**
 * What the browser posts for one line: the cells the mapping selected,
 * under the field they were mapped to, verbatim. `unknown` because the
 * server reads this off an untrusted body.
 */
export type CompanyImportRawRow = Partial<Record<CompanyImportField, unknown>>

/** One parsed line under the mapping. Empty cells are left absent. */
export function mapCompanyImportRow(
  cells: readonly string[],
  mapping: CompanyImportMapping,
): CompanyImportRawRow {
  const { custom: _custom, ...row } = mapImportRow(cells, mapping)
  return row
}

/** Why one row was not stored. */
export type CompanyImportSkipReason =
  | 'missing-name'
  | 'duplicate'
  | 'records-band'
  | 'write-failed'

/** How a skip reason reads on screen and in the downloaded file. */
export const COMPANY_IMPORT_SKIP_LABELS: Record<CompanyImportSkipReason, string> = {
  'missing-name': 'No company name',
  duplicate: 'Appears earlier in the file',
  'records-band': 'CRM records limit reached',
  'write-failed': 'Could not be saved',
}

/** One row, ready to be written. */
export interface CompanyImportRow {
  name: string
  /** Lowercase hostname — the match key when present. */
  domain?: string
  /** An absolute http(s) URL. */
  website?: string
  /** E.164. */
  phone?: string
  industry?: string
  /** Normalized, for the server to resolve against the org's members. */
  ownerEmail?: string
  address?: AglynPostalAddress
  /** Lowercased, deduplicated, capped at {@link COMPANY_IMPORT_TAGS_MAX}. */
  tags: string[]
  notes?: string
  dropped: ImportDroppedValue[]
}

export type CompanyImportRowVerdict =
  | { ok: true; row: CompanyImportRow }
  | { ok: false; reason: 'missing-name'; input: string }

/**
 * One raw row as the values that will be written, or the reason it cannot
 * be. Refused only for a missing name; every other unreadable cell is
 * dropped and named.
 */
export function normalizeCompanyImportRow(
  raw: CompanyImportRawRow,
): CompanyImportRowVerdict {
  const name = importTextValue(raw.name, NAME_MAX)?.replace(/\s+/g, ' ')
  if (!name) {
    return { ok: false, reason: 'missing-name', input: String(raw.domain ?? '').trim() }
  }
  const dropped: ImportDroppedValue[] = []
  const drop = (field: CompanyImportField, value: unknown) => {
    dropped.push({ field, value: String(value ?? '').trim() })
  }
  const row: CompanyImportRow = {
    name,
    tags: parseImportTags(raw.tags, COMPANY_IMPORT_TAGS_MAX),
    dropped,
  }

  const domainText = importTextValue(raw.domain, 300)
  if (domainText) {
    const domain = normalizeCompanyDomain(domainText)
    if (domain) row.domain = domain
    else drop('domain', domainText)
  }

  const websiteText = importTextValue(raw.website, 600)
  if (websiteText) {
    const website = normalizeCompanyWebsite(websiteText)
    if (website) row.website = website
    else drop('website', websiteText)
  }

  const phoneText = importTextValue(raw.phone, 64)
  if (phoneText) {
    const phone = normalizePhone(phoneText)
    if (phone) row.phone = phone
    else drop('phone', phoneText)
  }

  const industry = importTextValue(raw.industry, INDUSTRY_MAX)
  if (industry) row.industry = industry

  const ownerText = importTextValue(raw.ownerEmail, 320)
  if (ownerText) {
    const owner = normalizeContactEmail(ownerText)
    if (owner) row.ownerEmail = owner
    else drop('ownerEmail', ownerText)
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

  const notes = importTextValue(raw.notes, NOTES_MAX)
  if (notes) row.notes = notes

  return { ok: true, row }
}

/**
 * How two rows are recognized as one company: by domain when the row has
 * one, else by the name's search key — the same `nameLower` the companies
 * list searches on, so "Acme" and "ACME " are one key.
 */
export function companyImportMatchKey(
  row: Pick<CompanyImportRow, 'name' | 'domain'>,
): string {
  return row.domain ? `domain:${row.domain}` : `name:${nameSearchKey(row.name)}`
}

/** One row the server did not store, by its index in the request, named by the company. */
export interface CompanyImportSkippedRow {
  index: number
  name: string
  reason: CompanyImportSkipReason
}

/** What one request did. The drawer sums these across a file. */
export type CompanyImportChunkResult = ImportChunkResult<CompanyImportSkippedRow>

export function emptyCompanyImportResult(): CompanyImportChunkResult {
  return emptyImportResult<CompanyImportSkippedRow>()
}

export function mergeCompanyImportResults(
  total: CompanyImportChunkResult,
  chunk: CompanyImportChunkResult,
  offset = 0,
): CompanyImportChunkResult {
  return mergeImportResults(total, chunk, offset)
}

/** The skipped rows as a file the operator can fix and re-import. */
export function companyImportSkippedCsv(
  columns: readonly string[],
  entries: readonly { cells: readonly string[]; reason: CompanyImportSkipReason }[],
): string {
  return importSkippedCsv(columns, entries, COMPANY_IMPORT_SKIP_LABELS)
}
