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
 *
 * ## Salesforce's Account fields (AGL-3514)
 *
 * Type, Industry, Rating, Ownership and Account Source arrive as text and
 * are judged against the org's lists by the server, which alone reads
 * them: a value the list does not hold is dropped and named like any
 * other unreadable cell, unless the company already holds it. The address
 * the company always had is its billing address; a shipping one sits
 * beside it, and the headers Salesforce exports ("Billing Street",
 * "Shipping City") map onto both.
 */

import type { AglynPostalAddress } from '@aglyn/aglyn/foundation/definitions/contact.types'
import { normalizeAddress, normalizePhone } from '@aglyn/aglyn/foundation/definitions/contact.types'
import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import {
  type ContactFieldDefinition,
  CRM_COMPANY_EMPLOYEES_MAX,
  CRM_COMPANY_TEXT_MAX,
  type CrmCustomValue,
  normalizeCompanyDomain,
  normalizeCompanyText,
  normalizeCompanyWebsite,
} from '@aglyn/aglyn/app-utils/crm'
import { parseContactImportCustomValue } from './crm-import'
import {
  customImportTarget,
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
} from '@aglyn/aglyn/app-utils/csv-import'
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'

/** The shared ceilings, under this collection's names. */
export const COMPANY_IMPORT_MAX_ROWS = CSV_IMPORT_MAX_ROWS
export const COMPANY_IMPORT_CHUNK_SIZE = CSV_IMPORT_CHUNK_SIZE
export const COMPANY_IMPORT_MAX_BODY_BYTES = CSV_IMPORT_MAX_BODY_BYTES
export const COMPANY_IMPORT_PREVIEW_ROWS = CSV_IMPORT_PREVIEW_ROWS

/** The most tags one company may carry — the same cap a contact has. */
export const COMPANY_IMPORT_TAGS_MAX = 20

const NAME_MAX = 120
/** A picklist label's cap — the lists' own. */
const PICKLIST_LABEL_MAX = 120
const NOTES_MAX = 4000

/** The fields a column may be mapped to, in the order the mapping menu lists them. */
export const COMPANY_IMPORT_FIELDS = [
  'name',
  'domain',
  'website',
  'phone',
  'fax',
  'type',
  'industry',
  'rating',
  'ownership',
  'accountSource',
  'accountNumber',
  'site',
  'tickerSymbol',
  'sicCode',
  'numberOfEmployees',
  'annualRevenue',
  'currency',
  'ownerEmail',
  'addressLine1',
  'addressLine2',
  'addressCity',
  'addressState',
  'addressPostalCode',
  'addressCountry',
  'shippingLine1',
  'shippingLine2',
  'shippingCity',
  'shippingState',
  'shippingPostalCode',
  'shippingCountry',
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
  fax: 'Fax',
  type: 'Type',
  industry: 'Industry',
  rating: 'Rating',
  ownership: 'Ownership',
  accountSource: 'Account source',
  accountNumber: 'Account number',
  site: 'Account site',
  tickerSymbol: 'Ticker symbol',
  sicCode: 'SIC code',
  numberOfEmployees: 'Employees',
  annualRevenue: 'Annual revenue (major units, 1250000.00)',
  currency: 'Currency (three-letter code)',
  ownerEmail: 'Owner (team member email)',
  addressLine1: 'Billing address line 1',
  addressLine2: 'Billing address line 2',
  addressCity: 'Billing city',
  addressState: 'Billing state or region',
  addressPostalCode: 'Billing postal code',
  addressCountry: 'Billing country (two-letter code)',
  shippingLine1: 'Shipping address line 1',
  shippingLine2: 'Shipping address line 2',
  shippingCity: 'Shipping city',
  shippingState: 'Shipping state or region',
  shippingPostalCode: 'Shipping postal code',
  shippingCountry: 'Shipping country (two-letter code)',
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
  fax: ['fax', 'fax number', 'company fax'],
  type: ['type', 'account type', 'company type'],
  industry: ['industry', 'sector', 'vertical', 'category'],
  rating: ['rating', 'account rating'],
  ownership: ['ownership'],
  accountSource: ['account source', 'lead source', 'source'],
  accountNumber: ['account number', 'account no', 'account no.'],
  site: ['account site', 'site'],
  tickerSymbol: ['ticker symbol', 'ticker', 'stock symbol'],
  sicCode: ['sic code', 'sic'],
  numberOfEmployees: ['employees', 'number of employees', 'employee count', 'headcount'],
  annualRevenue: ['annual revenue', 'revenue'],
  currency: ['currency', 'currency code', 'account currency'],
  ownerEmail: ['owner', 'owner email', 'company owner', 'account owner', 'assigned to'],
  // The address a company always had is its billing address (AGL-3514).
  addressLine1: [
    'billing address line 1',
    'address line 1',
    'billing street',
    'billing address',
    'address',
    'street',
    'street address',
    'address 1',
  ],
  addressLine2: ['billing address line 2', 'address line 2', 'address 2', 'street 2', 'suite'],
  addressCity: ['billing city', 'city', 'town', 'locality'],
  addressState: ['billing state', 'state', 'billing state/province', 'region', 'province', 'county', 'state/region'],
  addressPostalCode: ['billing postal code', 'postal code', 'billing zip/postal code', 'postcode', 'zip', 'zip code', 'post code'],
  addressCountry: ['billing country', 'country', 'country code', 'country/region'],
  shippingLine1: ['shipping address line 1', 'shipping street', 'shipping address'],
  shippingLine2: ['shipping address line 2'],
  shippingCity: ['shipping city'],
  shippingState: ['shipping state', 'shipping state/province'],
  shippingPostalCode: ['shipping postal code', 'shipping zip/postal code', 'shipping zip'],
  shippingCountry: ['shipping country'],
  tags: ['tags', 'tag', 'labels', 'groups'],
  notes: ['notes', 'note', 'description', 'comments'],
}

const FIELD_ALIAS_KEYS = importAliasKeys(COMPANY_IMPORT_FIELDS, FIELD_ALIASES)

/**
 * Column index → field, or a company custom field as `custom:<key>` (AGL-2661).
 * A column absent from the map is not imported.
 */
export type CompanyImportMapping = Record<number, CompanyImportField | `custom:${string}`>

/**
 * A proposed mapping from a file's header row, each field taken at most
 * once. `fields` is the org's COMPANY definitions (AGL-2661): a header
 * matching one's label or key maps onto it, and wins over a standard
 * alias, the contact import's rule.
 */
export function guessCompanyImportMapping(
  columns: readonly string[],
  fields: readonly Pick<ContactFieldDefinition, 'key' | 'label'>[] = [],
): CompanyImportMapping {
  return guessImportMapping(columns, COMPANY_IMPORT_FIELDS, FIELD_ALIAS_KEYS, fields)
}

/**
 * What the browser posts for one line: the cells the mapping selected,
 * under the field they were mapped to, verbatim. `unknown` because the
 * server reads this off an untrusted body.
 */
export type CompanyImportRawRow = Partial<Record<CompanyImportField, unknown>> & {
  /** Custom values by definition key, verbatim — judged by `normalizeCompanyImportRow`. */
  custom?: unknown
}

/**
 * One parsed line under the mapping. Empty cells are left absent; custom
 * values are gathered under `custom` by definition key (AGL-2661).
 */
export function mapCompanyImportRow(
  cells: readonly string[],
  mapping: CompanyImportMapping,
): CompanyImportRawRow {
  return mapImportRow(cells, mapping)
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
  fax?: string
  /**
   * The picklist fields as the file spelled them (AGL-3514) — the server
   * judges each against the org's list and drops what the list refuses.
   */
  type?: string
  industry?: string
  rating?: string
  ownership?: string
  accountSource?: string
  accountNumber?: string
  site?: string
  tickerSymbol?: string
  sicCode?: string
  numberOfEmployees?: number
  /** Minor units of {@link CompanyImportRow.currency}. */
  annualRevenueCents?: number
  /** Lowercase ISO 4217. */
  currency?: string
  /** Normalized, for the server to resolve against the org's members. */
  ownerEmail?: string
  /** The billing address. */
  address?: AglynPostalAddress
  shippingAddress?: AglynPostalAddress
  /** Lowercased, deduplicated, capped at {@link COMPANY_IMPORT_TAGS_MAX}. */
  tags: string[]
  notes?: string
  dropped: ImportDroppedValue[]
  /**
   * Custom values under the org's COMPANY definitions (AGL-2661), each
   * coerced by its type the way a contact's are. Empty when the file
   * mapped none, or none survived.
   */
  custom: Record<string, CrmCustomValue>
}

export type CompanyImportRowVerdict =
  | { ok: true; row: CompanyImportRow }
  | { ok: false; reason: 'missing-name'; input: string }

/**
 * A revenue cell in major units as minor units, or `null` when it is not
 * an amount — a deal amount's reading (`parseImportAmountCents`) without
 * its ceiling, because a company's revenue is not a slip at ten billion.
 */
export function parseImportRevenueCents(value: string): number | null {
  const text = value
    .trim()
    .replace(/[,\s]/g, '')
    .replace(/^[^\d.-]+/, '')
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

/**
 * One raw row as the values that will be written, or the reason it cannot
 * be. Refused only for a missing name; every other unreadable cell is
 * dropped and named.
 */
export function normalizeCompanyImportRow(
  raw: CompanyImportRawRow,
  /**
   * The org's live COMPANY definitions (AGL-2661): a value under a key
   * with no definition is dropped and reported, because a value nobody
   * defined a field for is a value no surface will ever show.
   */
  fields: readonly Pick<ContactFieldDefinition, 'key' | 'type' | 'options'>[] = [],
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
    custom: {},
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

  const faxText = importTextValue(raw.fax, 64)
  if (faxText) {
    const fax = normalizePhone(faxText)
    if (fax) row.fax = fax
    else drop('fax', faxText)
  }

  for (const field of ['type', 'industry', 'rating', 'ownership', 'accountSource'] as const) {
    const label = importTextValue(raw[field], PICKLIST_LABEL_MAX)
    if (label) row[field] = normalizeCompanyText(label)
  }

  for (const field of ['accountNumber', 'site', 'tickerSymbol', 'sicCode'] as const) {
    const text = importTextValue(raw[field], CRM_COMPANY_TEXT_MAX[field])
    if (text) row[field] = normalizeCompanyText(text)
  }

  const employeesText = importTextValue(raw.numberOfEmployees, 32)
  if (employeesText) {
    const cleaned = employeesText.replace(/[\s,]/g, '')
    const employees = /^\d+$/.test(cleaned) ? Number(cleaned) : NaN
    if (employees <= CRM_COMPANY_EMPLOYEES_MAX) row.numberOfEmployees = employees
    else drop('numberOfEmployees', employeesText)
  }

  const revenueText = importTextValue(raw.annualRevenue, 64)
  if (revenueText) {
    const cents = parseImportRevenueCents(revenueText)
    if (cents !== null) row.annualRevenueCents = cents
    else drop('annualRevenue', revenueText)
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

  const shipping = normalizeAddress({
    line1: importTextValue(raw.shippingLine1, 200),
    line2: importTextValue(raw.shippingLine2, 200),
    city: importTextValue(raw.shippingCity, 120),
    state: importTextValue(raw.shippingState, 120),
    postalCode: importTextValue(raw.shippingPostalCode, 32),
    country: importTextValue(raw.shippingCountry, 8),
  })
  if (shipping) row.shippingAddress = shipping
  const shippingCountryText = importTextValue(raw.shippingCountry, 64)
  if (shippingCountryText && !shipping?.country) drop('shippingCountry', shippingCountryText)

  const notes = importTextValue(raw.notes, NOTES_MAX)
  if (notes) row.notes = notes

  // The contact import's custom rule, over the company's definitions.
  const custom =
    raw.custom && typeof raw.custom === 'object' && !Array.isArray(raw.custom)
      ? (raw.custom as Record<string, unknown>)
      : {}
  const definitions = new Map(fields.map((field) => [field.key, field]))
  for (const [key, value] of Object.entries(custom)) {
    const definition = definitions.get(key)
    if (!definition) {
      dropped.push({ field: customImportTarget(key), value: String(value ?? '').trim() })
      continue
    }
    const parsed = parseContactImportCustomValue(definition, value)
    if (!parsed) {
      dropped.push({ field: customImportTarget(key), value: String(value ?? '').trim() })
    } else if (parsed.value !== undefined) {
      row.custom[key] = parsed.value
    }
  }

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
