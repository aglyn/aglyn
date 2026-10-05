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
 * WHAT A MERCHANT'S CONTACT FILE SAYS ABOUT ITSELF — the pure half of the
 * list-member import's controls.
 *
 * `docs/specs/email-competitive-gaps.md` G5 is the product gap — a customer
 * arriving with a list has no way to bring it — and P4 is its condition: an
 * importer is simultaneously the biggest onboarding blocker and the biggest
 * abuse vector, so it ships WITH its controls or not at all. The import runs
 * on the platform's transfer framework (AGL-3529), which reads the file,
 * maps its columns, collapses repeated addresses and reports the lines that
 * are not addresses; this module is what the framework cannot know: the
 * header spellings that mean an address, a name or a declared opt-in, and
 * the two SCREENS. It decides nothing about consent and it enrolls nobody:
 * the consent question belongs to `enrollment-basis`, which the one-address
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
 * So neither one drops an address. Both are put in front of the operator as
 * warnings they acknowledge BEFORE the import writes, beside the statement of
 * permission, because the attestation is the thing with teeth: an operator who
 * states they have permission for a file whose headers say it was appended
 * has made a claim their own console showed them the evidence against. That
 * is what makes the record worth keeping.
 *
 * ## A declared basis per address, and why it is still an assertion
 *
 * P4 asks for "a declared basis per address, not one checkbox over the file".
 * A file may carry an opt-in source and an opt-in date per row, and when it
 * does they are read and carried onto the membership as evidence. They do
 * NOT become the person's own opt-in. Nothing arriving in a spreadsheet is a
 * checkbox somebody ticked; it is the merchant telling us about one, which is
 * an operator assertion however many columns it arrives in. The basis stays
 * `operator-attested` and the declared source rides along as the reason.
 */

/**
 * The most rows one uploaded file may carry — the list-member resource's
 * `limits.maxRows` in `plugins.config.json`, which the transfer engine
 * enforces at the upload (`list-import.spec.ts` holds the two equal).
 *
 * A bound on the WORK an import represents, not a capacity limit: it refuses
 * a FILE, before anything is written, and it can never drop a person already
 * on a list or trim one to make room. A merchant with more than this splits
 * the file, which is a nuisance; a merchant whose audience got silently
 * truncated has an audience they cannot reason about.
 *
 * 50,000 is Klaviyo's shape rather than a number of our own — its only
 * published hard import limit is a 50 MB CSV, which is the same statement in
 * bytes.
 */
export const LIST_IMPORT_MAX_ADDRESSES = 50_000

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

/** Header spellings that name the address column. */
export const LIST_IMPORT_EMAIL_COLUMNS: readonly string[] = [
  'email',
  'emailaddress',
  'email address',
  'e-mail',
  'e-mail address',
  'mail',
  'contact email',
  'primary email',
]

/**
 * Header spellings that name the member's display name.
 *
 * Not `First name`: a file that splits the name maps its parts to the
 * contact record's first and last name, and the membership's name is
 * composed from them when no column names it whole.
 */
export const LIST_IMPORT_NAME_COLUMNS: readonly string[] = [
  'name',
  'full name',
  'fullname',
  'display name',
  'contact name',
]

/** Header spellings carrying the merchant's declared opt-in source. */
export const LIST_IMPORT_OPT_IN_SOURCE_COLUMNS: readonly string[] = [
  'opt-in source',
  'optin source',
  'opt in source',
  'consent source',
  'signup source',
  'subscription source',
  'source',
]

/** Header spellings carrying the merchant's declared opt-in date. */
export const LIST_IMPORT_OPT_IN_DATE_COLUMNS: readonly string[] = [
  'opt-in date',
  'optin date',
  'opt in date',
  'consent date',
  'signup date',
  'subscribed at',
  'date subscribed',
  'confirmed at',
]

/** Normalizes a header cell for the purchase-tell match. */
function headerKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
}

/** Whether a normalized address is at a shared or unattended mailbox. */
export function isRoleAccount(email: string | null | undefined): boolean {
  const address = String(email ?? '')
  const at = address.indexOf('@')
  if (at <= 0) return false
  return ROLE_ACCOUNT_LOCAL_PARTS.includes(address.slice(0, at).toLowerCase())
}

/**
 * The file's column names that read as purchase or append tells — every
 * column, mapped or not: a column the operator chose to ignore still says
 * where the file came from.
 */
export function purchaseTellColumns(headers: readonly string[]): string[] {
  return headers.filter((column) => {
    const key = headerKey(column)
    return PURCHASE_TELL_COLUMNS.some((tell) => key.includes(tell))
  })
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
