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
 * READING A MERCHANT'S CONTACT FILE, and saying what is in it.
 *
 * `docs/specs/email-competitive-gaps.md` G5 is the product gap — a customer
 * arriving with a list has no way to bring it — and P4 is its condition: an
 * importer is simultaneously the biggest onboarding blocker and the biggest
 * abuse vector, so it ships WITH its controls or not at all. This module is
 * the pure half of those controls. It parses, it de-duplicates, and it
 * SCREENS. It decides nothing about consent and it enrolls nobody: the
 * consent question belongs to `list-assignment-policy`, which the one-address
 * add path already asks, and an import that answered it a second way would be
 * exactly the defect class the register has a P1 entry for.
 *
 * ## The screening reports, it never refuses
 *
 * M3AAWG's Vetting BCP supplies two cheap mechanical checks and both are
 * signals rather than verdicts. A role account (`sales@`, `info@`) is, in
 * M3AAWG's words, indicative of poor acquisition practice — it is not proof
 * of one, and plenty of legitimate B2B lists carry a handful. A column named
 * `jigsaw` or `append` is a purchase tell, and again a merchant may simply
 * have named a column badly.
 *
 * So neither one drops an address. Both are put in front of the operator
 * BEFORE they attest, because the attestation is the thing with teeth: an
 * operator who states they have permission for a file whose headers say it
 * was appended has made a claim their own console showed them the evidence
 * against. That is what makes the record worth keeping.
 *
 * ## A declared basis per address, and why it is still an assertion
 *
 * P4 asks for "a declared basis per address, not one checkbox over the file".
 * A file may carry an opt-in source and an opt-in date per row, and when it
 * does they are read here and carried onto the import as evidence. They do
 * NOT become the person's own opt-in. Nothing arriving in a spreadsheet is a
 * checkbox somebody ticked; it is the merchant telling us about one, which is
 * an operator assertion however many columns it arrives in. The basis stays
 * `operator-attested` and the declared source rides along as the reason.
 */

import { parseCsv } from './dataset-csv'
import { normalizeContactEmail } from './contacts'

/**
 * The most addresses one uploaded file may name.
 *
 * A bound on the WORK an import represents, not a capacity limit: it refuses
 * a FILE, before anything is written, and it can never drop a person already
 * on a list or trim one to make room. A merchant with more than this splits
 * the file, which is a nuisance; a merchant whose audience got silently
 * truncated has an audience they cannot reason about.
 *
 * 50,000 is Klaviyo's shape rather than a number of our own — its only
 * published hard import limit is a 50 MB CSV, which is the same statement in
 * bytes. Above this the parse itself is the cost, and it happens in one
 * request.
 */
export const LIST_IMPORT_MAX_ADDRESSES = 50_000

/**
 * The most characters one uploaded file may carry.
 *
 * Checked before the parse rather than after, because the parse is what the
 * ceiling is protecting: a 400 answered on the byte count costs nothing,
 * where discovering the file was too big by materializing all of its cells
 * has already spent the memory the limit exists to bound.
 */
export const LIST_IMPORT_MAX_CHARACTERS = 8_000_000

/**
 * Local parts that make an address a ROLE account.
 *
 * A mailbox several people read, or none. M3AAWG's Vetting BCP: their
 * appearance on a customer list "may be indicative of poor acquisition
 * practices" — a list built by scraping a website collects these, a list
 * built from signups does not.
 *
 * Reported, never dropped. A merchant importing their own supplier contacts
 * legitimately has `orders@`, and an importer that quietly removed addresses
 * would be telling the operator a different number went on the list than did.
 */
export const ROLE_ACCOUNT_LOCAL_PARTS: readonly string[] = [
  'abuse',
  'admin',
  'billing',
  'contact',
  'enquiries',
  'help',
  'hello',
  'hr',
  'info',
  'inquiries',
  'mail',
  'marketing',
  'noreply',
  'no-reply',
  'office',
  'orders',
  'postmaster',
  'sales',
  'security',
  'staff',
  'support',
  'team',
  'webmaster',
]

/**
 * Column names that say where the file came from, when the answer is "not
 * from people who asked".
 *
 * M3AAWG names `jigsaw` and `append` specifically. The rest are the same tell
 * in the vocabulary the data brokers actually use, and they are matched as
 * substrings of a normalized header so `Appended Email` and `append_date`
 * both hit.
 *
 * Every vendor surveyed prohibits purchased lists outright, Apple bans
 * purchased, rented and appended lists, and M3AAWG calls appending "a direct
 * violation of core M3AAWG values". This is not a policy we invented and the
 * screening exists so that a merchant cannot attest their way past it without
 * having been shown it.
 */
export const PURCHASE_TELL_COLUMNS: readonly string[] = [
  'jigsaw',
  'append',
  'purchased',
  'rented',
  'databroker',
  'data broker',
  'leadgen',
  'lead gen',
  'scraped',
]

/** Header aliases that name the address column. */
const EMAIL_COLUMNS = [
  'email',
  'emailaddress',
  'email address',
  'e-mail',
  'e-mail address',
  'mail',
  'contact email',
  'primary email',
]

/** Header aliases that name a display name. */
const NAME_COLUMNS = [
  'name',
  'full name',
  'fullname',
  'display name',
  'contact name',
  'first name',
  'firstname',
  'given name',
]

/** Header aliases carrying the merchant's declared opt-in source. */
const OPT_IN_SOURCE_COLUMNS = [
  'opt-in source',
  'optin source',
  'opt in source',
  'consent source',
  'signup source',
  'subscription source',
  'source',
]

/** Header aliases carrying the merchant's declared opt-in date. */
const OPT_IN_DATE_COLUMNS = [
  'opt-in date',
  'optin date',
  'opt in date',
  'consent date',
  'signup date',
  'subscribed at',
  'date subscribed',
  'confirmed at',
]

/** What the merchant's file says about one person. */
export interface ListImportRow {
  /** The source line, verbatim, so a bad one can be pointed at on screen. */
  input: string
  /** The normalized address, or `null` when the line does not carry one. */
  email: string | null
  /** A display name from the file, or `''`. */
  name: string
  /**
   * Where the file says this person opted in, or `''`.
   *
   * Evidence for the operator's assertion and never a basis of its own — see
   * the module note.
   */
  declaredSource: string
  /** When the file says they opted in, or `''`, kept as written. */
  declaredAt: string
}

/** What one file turned out to be. */
export interface ParsedListImport {
  /** The header row's column names, or `[]` for a bare list of addresses. */
  columns: string[]
  /**
   * One row per usable, first-seen address, plus one per unusable line.
   *
   * A repeat of an address already seen is collapsed and counted in
   * {@link duplicates} rather than carried: the membership is keyed by the
   * normalized address, so two lines would be one row and reporting them as
   * two would tell the operator they are attesting for more people than they
   * are. That is exactly the rule `resolveAddresses` applies to a paste.
   */
  rows: ListImportRow[]
  /** Rows carrying a usable address. */
  usable: number
  /** Lines that are not addresses. Reported, never dropped. */
  unusable: number
  /** Repeat appearances of an address already counted. */
  duplicates: number
  /** True when the file names more than {@link LIST_IMPORT_MAX_ADDRESSES}. */
  overCeiling: boolean
}

/** What the mechanical screening found. Signals, not verdicts. */
export interface ListImportScreening {
  /** Addresses at a shared or unattended mailbox. */
  roleAccounts: string[]
  /** Column names in the file that read as purchase or append tells. */
  purchaseTellColumns: string[]
  /** True when the file declares an opt-in source or date per row. */
  declaresBasis: boolean
}

/** Normalizes a header cell for alias matching. */
function headerKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
}

/** The index of the first column matching one of `aliases`, or -1. */
function columnIndex(columns: string[], aliases: readonly string[]): number {
  const keys = columns.map(headerKey)
  for (const alias of aliases) {
    const at = keys.indexOf(alias)
    if (at !== -1) return at
  }
  return -1
}

/**
 * Whether a parsed first row is a HEADER rather than a person.
 *
 * A header is a row with no address in it. That test rather than an alias
 * match, because the common shape of a merchant's export is a header whose
 * address column is called something we have never seen — and treating that
 * file as headerless would import the word "Email Address" as a line that is
 * not an address, and shift every subsequent column read by one.
 *
 * A one-column file of bare addresses therefore has no header, correctly:
 * every row including the first carries an address.
 */
function looksLikeHeader(cells: readonly string[]): boolean {
  return !cells.some((cell) => normalizeContactEmail(cell))
}

/**
 * Reads an uploaded or pasted file into rows.
 *
 * Handles the two shapes a merchant's list actually arrives in: a CSV with a
 * header, and a bare column of addresses with no header at all. Both go
 * through one parser — `parseCsv` — because a newline-separated list of
 * addresses IS a single-column CSV, and a second code path for it would be a
 * second place for the quoting rules to differ.
 *
 * ## Every line comes back, including the bad ones
 *
 * A file that silently discarded its malformed lines would tell an operator
 * that 100 addresses went on the list when 94 did, and the six they never
 * hear about are the six they typed wrong. This is the rule `resolveAddresses`
 * already applies to a paste, restated for a file.
 */
export function parseListImport(text: string): ParsedListImport {
  const table = parseCsv(String(text ?? ''))
  if (!table.length) {
    return {
      columns: [],
      rows: [],
      usable: 0,
      unusable: 0,
      duplicates: 0,
      overCeiling: false,
    }
  }
  const headed = table.length > 1 && looksLikeHeader(table[0])
  const columns = headed ? table[0].map((cell) => String(cell ?? '').trim()) : []
  const body = headed ? table.slice(1) : table

  const emailAt = headed ? columnIndex(columns, EMAIL_COLUMNS) : 0
  const nameAt = headed ? columnIndex(columns, NAME_COLUMNS) : -1
  const sourceAt = headed ? columnIndex(columns, OPT_IN_SOURCE_COLUMNS) : -1
  const dateAt = headed ? columnIndex(columns, OPT_IN_DATE_COLUMNS) : -1

  const seen = new Set<string>()
  const rows: ListImportRow[] = []
  let usable = 0
  let unusable = 0
  let duplicates = 0
  let overCeiling = false

  for (const cells of body) {
    /*
     * The named column when the header named one, and otherwise the first
     * cell in the row that IS an address.
     *
     * The fallback is what makes an unrecognized header survivable: an
     * export whose address column is called `Primary contact e-mail (work)`
     * matches no alias, and refusing the whole file over a column name would
     * be refusing the customer's migration over our vocabulary.
     */
    const raw =
      emailAt >= 0 && emailAt < cells.length
        ? String(cells[emailAt] ?? '')
        : (cells.find((cell) => normalizeContactEmail(cell)) ?? '')
    const email = normalizeContactEmail(raw)
    const input = String(raw ?? '').trim() || cells.join(', ').trim()
    if (!email) {
      unusable += 1
      rows.push({
        input,
        email: null,
        name: '',
        declaredSource: '',
        declaredAt: '',
      })
      continue
    }
    if (seen.has(email)) {
      duplicates += 1
      continue
    }
    if (seen.size >= LIST_IMPORT_MAX_ADDRESSES) {
      overCeiling = true
      break
    }
    seen.add(email)
    usable += 1
    rows.push({
      input,
      email,
      name: nameAt >= 0 ? String(cells[nameAt] ?? '').trim() : '',
      declaredSource: sourceAt >= 0 ? String(cells[sourceAt] ?? '').trim() : '',
      declaredAt: dateAt >= 0 ? String(cells[dateAt] ?? '').trim() : '',
    })
  }

  return { columns, rows, usable, unusable, duplicates, overCeiling }
}

/**
 * The mechanical checks, over a parsed file.
 *
 * Cheap by construction: two substring passes and one set membership per
 * address. It is deliberately not a deliverability service — Omnisend's own
 * caveat on the one that exists is that "list cleaning confirms
 * deliverability only and does not establish recipient consent", and consent
 * is the only question this import actually turns on.
 */
export function screenListImport(
  parsed: Pick<ParsedListImport, 'columns' | 'rows'>,
): ListImportScreening {
  const roleAccounts: string[] = []
  for (const row of parsed.rows) {
    if (!row.email) continue
    const local = row.email.slice(0, row.email.indexOf('@'))
    if (ROLE_ACCOUNT_LOCAL_PARTS.includes(local)) roleAccounts.push(row.email)
  }
  const purchaseTellColumns = parsed.columns.filter((column) => {
    const key = headerKey(column)
    return PURCHASE_TELL_COLUMNS.some((tell) => key.includes(tell))
  })
  return {
    roleAccounts,
    purchaseTellColumns,
    declaresBasis: parsed.rows.some(
      (row) => !!row.declaredSource || !!row.declaredAt,
    ),
  }
}

/**
 * The sentence recorded as the REASON behind an imported person's basis.
 *
 * One line, built from what the file actually declared, so a compliance
 * question about one address gets an answer about that address rather than
 * "somebody ticked a box on an import once". Empty declarations produce the
 * plain sentence rather than a sentence with holes in it.
 */
export function importedBasisReason(row: {
  declaredSource: string
  declaredAt: string
}): string {
  const parts: string[] = []
  if (row.declaredSource) parts.push(`declared source: ${row.declaredSource}`)
  if (row.declaredAt) parts.push(`declared opt-in: ${row.declaredAt}`)
  return parts.length
    ? `Imported from a file, attested by the operator (${parts.join('; ')}).`
    : 'Imported from a file, attested by the operator.'
}
