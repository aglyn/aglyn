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

import type { TransferAliasDictionary, TransferField, TransferFieldGroup } from '@aglyn/aglyn/data-transfer'

/*==========================================
 * A STORE'S CUSTOMER FILE (AGL-4245).
 *
 * A store moving from Shopify, Wix or Squarespace brings its customers in
 * through the contact import. Each platform's customer export is recognized
 * by its own column names (the dictionaries below, read by the header
 * matcher like Salesforce's), so the Columns step maps it with nothing to
 * pick. Unknown and missing columns are never a failure.
 *
 * ## The marketing choice the file records
 *
 * Each file says whether a customer agreed to marketing email: Shopify's
 * `Accepts Email Marketing` (`Accepts Marketing` in older files), Wix's
 * `Email subscriber status`, Squarespace's `Accepts Marketing`. It is read
 * into an import-only field and carried under three rules:
 *
 * - **An opt-in** becomes the contact's marketing consent for the import's
 *   site ONLY when the person importing states, on the Permission step, that
 *   these people agreed to hear from this business. Without that, nobody is
 *   opted in from the file. A contact who unsubscribed here (a refusal on
 *   record, or the site's unsubscribe list) is never opted back in.
 * - **An opt-out** (`no`, `false`, `Unsubscribed`) is ALWAYS kept, whatever
 *   the step says: it is recorded as the contact's refusal, and a contact
 *   who was subscribed here is unsubscribed.
 * - **No choice** (`Never subscribed`, `Pending`, blank, a word we cannot
 *   read) changes nothing.
 *
 * The plan carries each change as a `marketingConsent` row change stamped
 * with who planned it and whether they confirmed, so the apply never takes
 * either from the browser (`customer-consent-plan.ts`).
 *
 * Types only from the transfer core, so the console registrar that reads
 * the dictionaries costs no transfer code.
 *
 * Text message marketing is not sent from here, so its column is read and
 * not kept; a store's lifetime spend and order count are not kept either,
 * because a contact's spend counts what they buy here. The dry run says so.
 *=========================================*/

/** The field ids this module reads; the import-only ones are never stored. */
export const CUSTOMER_FIELD = {
  emailMarketing: 'emailMarketingChoice',
  smsMarketing: 'smsMarketingChoice',
  totalSpent: 'oldStoreTotalSpent',
  orderCount: 'oldStoreOrderCount',
  customerId: 'oldStoreCustomerId',
} as const

const C = CUSTOMER_FIELD

/** The contact field a carried choice changes. */
export const MARKETING_CONSENT_FIELD_ID = 'marketingConsent'

/** The fields that exist only to read another platform's file; never stored, never exported. */
export const CUSTOMER_SOURCE_ONLY_FIELDS: readonly string[] = [
  C.emailMarketing,
  C.smsMarketing,
  C.totalSpent,
  C.orderCount,
  C.customerId,
]

/** The picker group the import-only fields are listed under. */
export const CUSTOMER_SWITCHING_GROUP: TransferFieldGroup = { id: 'switching', label: 'From your old store' }

/** The import-only fields, as the Columns step offers them. */
export const CUSTOMER_SOURCE_FIELDS: readonly TransferField[] = [
  {
    id: C.emailMarketing,
    label: 'Email marketing choice',
    group: CUSTOMER_SWITCHING_GROUP.id,
    importOnly: true,
    type: 'text',
    maxLength: 60,
    aliases: ['accepts email marketing', 'email marketing', 'email subscriber status', 'accepts marketing'],
    description:
      'Yes or Subscribed opts a person in only when you confirm on the Permission step that they agreed to hear from you. No or Unsubscribed is always kept.',
  },
  {
    id: C.smsMarketing,
    label: 'Text message marketing choice',
    group: CUSTOMER_SWITCHING_GROUP.id,
    importOnly: true,
    type: 'text',
    maxLength: 60,
    aliases: ['accepts sms marketing', 'sms subscriber status', 'sms marketing'],
    description: 'Read and not kept: marketing texts are not sent from here.',
  },
  {
    id: C.totalSpent,
    label: 'Total spent at your old store',
    group: CUSTOMER_SWITCHING_GROUP.id,
    importOnly: true,
    type: 'text',
    maxLength: 60,
    description: 'Read and not kept: a contact’s spend counts what they buy on your site.',
  },
  {
    id: C.orderCount,
    label: 'Orders at your old store',
    group: CUSTOMER_SWITCHING_GROUP.id,
    importOnly: true,
    type: 'text',
    maxLength: 60,
    description: 'Read and not kept, like the total spent.',
  },
  {
    id: C.customerId,
    label: 'Old store customer ID',
    group: CUSTOMER_SWITCHING_GROUP.id,
    importOnly: true,
    type: 'text',
    maxLength: 120,
    description: 'Read and not kept. A person is matched by their email.',
  },
]

/*------------------------------------------
 * The three files' columns
 *-----------------------------------------*/

/** A contact address's six columns, under the field prefix (`mailing`, `other`). */
function addressColumns(
  prefix: 'mailing' | 'other',
  words: { street: string[]; street2: string[]; city: string[]; state: string[]; postalCode: string[]; country: string[] },
): Record<string, readonly string[]> {
  return {
    [`${prefix}Street`]: words.street,
    [`${prefix}Street2`]: words.street2,
    [`${prefix}City`]: words.city,
    [`${prefix}State`]: words.state,
    [`${prefix}PostalCode`]: words.postalCode,
    [`${prefix}Country`]: words.country,
  }
}

/**
 * Shopify's customers CSV, by the field each column means: today's
 * `Default Address …` columns and the older file's bare ones. Its address
 * phone is the contact's other phone; its `Phone` is their phone.
 */
export const SHOPIFY_CUSTOMER_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [C.customerId]: ['Customer ID'],
  firstName: ['First Name'],
  lastName: ['Last Name'],
  email: ['Email'],
  phone: ['Phone'],
  otherPhone: ['Default Address Phone'],
  company: ['Default Address Company', 'Company'],
  [C.emailMarketing]: ['Accepts Email Marketing', 'Accepts Marketing'],
  [C.smsMarketing]: ['Accepts SMS Marketing'],
  [C.totalSpent]: ['Total Spent'],
  [C.orderCount]: ['Total Orders'],
  notes: ['Note'],
  tags: ['Tags'],
  ...addressColumns('mailing', {
    street: ['Default Address Address1', 'Address1'],
    street2: ['Default Address Address2', 'Address2'],
    city: ['Default Address City', 'City'],
    state: ['Default Address Province Code', 'Province', 'Province Code'],
    postalCode: ['Default Address Zip', 'Zip'],
    country: ['Default Address Country Code', 'Country Code', 'Country'],
  }),
}

/** Wix's contacts CSV: two emails and phones (the first is the person's), two addresses, labels. */
export const WIX_CONTACT_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  firstName: ['First Name'],
  lastName: ['Last Name'],
  email: ['Email 1'],
  phone: ['Phone 1'],
  otherPhone: ['Phone 2'],
  company: ['Company'],
  jobTitle: ['Position'],
  tags: ['Labels'],
  [C.emailMarketing]: ['Email subscriber status'],
  [C.smsMarketing]: ['SMS subscriber status'],
  ...addressColumns('mailing', {
    street: ['Address 1 - Street', 'Address 1 - Street Line 1'],
    street2: ['Address 1 - Street Line 2', 'Address 1 - Street 2'],
    city: ['Address 1 - City'],
    state: ['Address 1 - State/Region', 'Address 1 - State'],
    postalCode: ['Address 1 - Zip', 'Address 1 - Zip/Postal Code'],
    country: ['Address 1 - Country'],
  }),
  ...addressColumns('other', {
    street: ['Address 2 - Street', 'Address 2 - Street Line 1'],
    street2: ['Address 2 - Street Line 2', 'Address 2 - Street 2'],
    city: ['Address 2 - City'],
    state: ['Address 2 - State/Region', 'Address 2 - State'],
    postalCode: ['Address 2 - Zip', 'Address 2 - Zip/Postal Code'],
    country: ['Address 2 - Country'],
  }),
}

/** Squarespace's customers CSV: the shipping address is the mailing one, billing the other. */
export const SQUARESPACE_CUSTOMER_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  email: ['Email'],
  firstName: ['First Name'],
  lastName: ['Last Name'],
  phone: ['Shipping Phone Number'],
  otherPhone: ['Billing Phone Number'],
  tags: ['Tags'],
  [C.emailMarketing]: ['Accepts Marketing'],
  [C.totalSpent]: ['Total Spent'],
  [C.orderCount]: ['Order Count'],
  ...addressColumns('mailing', {
    street: ['Shipping Address 1'],
    street2: ['Shipping Address 2'],
    city: ['Shipping City'],
    state: ['Shipping Province/State', 'Shipping State'],
    postalCode: ['Shipping Zip', 'Shipping Postal Code'],
    country: ['Shipping Country'],
  }),
  ...addressColumns('other', {
    street: ['Billing Address 1'],
    street2: ['Billing Address 2'],
    city: ['Billing City'],
    state: ['Billing Province/State', 'Billing State'],
    postalCode: ['Billing Zip', 'Billing Postal Code'],
    country: ['Billing Country'],
  }),
}

/** The three dictionaries, beside the CRMs' own (`aliases.ts`). */
export const CUSTOMER_ALIAS_DICTIONARIES: readonly TransferAliasDictionary[] = [
  { source: 'Shopify', aliases: SHOPIFY_CUSTOMER_COLUMNS },
  { source: 'Wix', aliases: WIX_CONTACT_COLUMNS },
  { source: 'Squarespace', aliases: SQUARESPACE_CUSTOMER_COLUMNS },
]

/** Which store's customer file this is. */
export type CustomerFileSource = 'shopify' | 'wix' | 'squarespace'

/** Each store's name, as the dry run and the consent record say it. */
export const CUSTOMER_FILE_SOURCE_NAMES: Readonly<Record<CustomerFileSource, string>> = {
  shopify: 'Shopify',
  wix: 'Wix',
  squarespace: 'Squarespace',
}

const compact = (header: unknown) => String(header ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * The store a file came from, by its header signature, or `null` for any
 * other file: Shopify's `Accepts Email Marketing` or `Default Address …`
 * columns (or the older `Accepts Marketing` beside `Total Orders`); Wix's
 * `Email 1` beside its subscriber status or numbered addresses;
 * Squarespace's `Accepts Marketing` beside its shipping or billing columns.
 */
export function customerFileSource(headers: readonly string[] | undefined): CustomerFileSource | null {
  if (!headers?.length) return null
  const have = new Set(headers.map(compact))
  if (have.has('email1') && (have.has('emailsubscriberstatus') || have.has('address1street') || have.has('labels'))) {
    return 'wix'
  }
  if (
    have.has('acceptsemailmarketing') ||
    have.has('defaultaddressaddress1') ||
    (have.has('acceptsmarketing') && (have.has('totalorders') || have.has('customerid')))
  ) {
    return 'shopify'
  }
  if (
    have.has('acceptsmarketing') &&
    (have.has('shippingaddress1') || have.has('billingaddress1') || have.has('customersince') || have.has('ordercount'))
  ) {
    return 'squarespace'
  }
  return null
}

/*------------------------------------------
 * Reading a marketing choice
 *-----------------------------------------*/

/** What a file's marketing cell records. */
export type MarketingChoice = 'optIn' | 'optOut' | 'none'

const OPT_IN_WORDS = ['yes', 'y', 'true', '1', 'subscribed', 'opted in', 'opt in', 'opted-in', 'opt-in']
const OPT_OUT_WORDS = ['no', 'n', 'false', '0', 'unsubscribed', 'opted out', 'opt out', 'opted-out', 'opt-out']
const NO_CHOICE_WORDS = ['', 'never subscribed', 'not subscribed', 'pending', 'none', 'n/a', '-', 'not set']

/**
 * A marketing cell as a choice, case-insensitively. `read` is false for a
 * word none of the lists names, which counts as no choice — never as an
 * opt-in.
 */
export function readMarketingChoice(value: unknown): { choice: MarketingChoice; read: boolean } {
  if (typeof value === 'boolean') return { choice: value ? 'optIn' : 'optOut', read: true }
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (OPT_OUT_WORDS.includes(text)) return { choice: 'optOut', read: true }
  if (OPT_IN_WORDS.includes(text)) return { choice: 'optIn', read: true }
  return { choice: 'none', read: NO_CHOICE_WORDS.includes(text) }
}

/*------------------------------------------
 * The Permission step's answer
 *-----------------------------------------*/

/** The CRM contact import's own wizard step: the statement of permission. */
export const CONTACT_CONSENT_STEP_ID = 'crm-consent'

/** The answer of the {@link CONTACT_CONSENT_STEP_ID} step. */
export interface ContactConsentAnswer {
  /** The person importing states that the people the file opts in agreed to hear from this business. */
  attest: boolean
}

/** The answer in `extras`. Anything but a literal `true` is no statement at all. */
export function readContactConsentAnswer(extras: Readonly<Record<string, unknown>> | undefined): ContactConsentAnswer {
  const value = extras?.[CONTACT_CONSENT_STEP_ID]
  return {
    attest: !!value && typeof value === 'object' && (value as Record<string, unknown>)['attest'] === true,
  }
}
