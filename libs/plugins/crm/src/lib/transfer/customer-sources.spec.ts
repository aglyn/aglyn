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
 *
 * @jest-environment node
 */

/**
 * A store's customer file (AGL-4245): the three platforms' headers map
 * themselves through the real header matcher, the file is told apart by its
 * headers, a marketing cell reads as a choice, and the plan carries a choice
 * only under its rules. The header lists are hand-written from each
 * platform's documented export, not real files.
 */

import {
  buildTransferPlan,
  createTransferPolicy,
  isTransferFieldExportable,
  matchHeaders,
  type RowMatchOutcome,
  type TransferPlanRow,
} from '@aglyn/aglyn/data-transfer'
import { CONTACT_ALIASES } from './aliases'
import {
  importedConsentChange,
  planContactConsent,
  withoutCustomerSourceFields,
  type ContactConsentPlanContext,
} from './customer-consent-plan'
import {
  CONTACT_CONSENT_STEP_ID,
  CUSTOMER_FIELD,
  customerFileSource,
  readContactConsentAnswer,
  readMarketingChoice,
} from './customer-sources'
import { CONTACT_TRANSFER_FIELDS } from './fields'

const SHOPIFY = [
  'Customer ID', 'First Name', 'Last Name', 'Email', 'Accepts Email Marketing', 'Default Address Company',
  'Default Address Address1', 'Default Address Address2', 'Default Address City', 'Default Address Province Code',
  'Default Address Country Code', 'Default Address Zip', 'Default Address Phone', 'Phone', 'Accepts SMS Marketing',
  'Total Spent', 'Total Orders', 'Note', 'Tax Exempt', 'Tags',
]
const SHOPIFY_OLD = [
  'First Name', 'Last Name', 'Email', 'Company', 'Address1', 'Address2', 'City', 'Province', 'Province Code',
  'Country', 'Country Code', 'Zip', 'Phone', 'Accepts Marketing', 'Total Spent', 'Total Orders', 'Tags', 'Note', 'Tax Exempt',
]
const WIX = [
  'First Name', 'Last Name', 'Email 1', 'Email 2', 'Phone 1', 'Phone 2', 'Address 1 - Street', 'Address 1 - City',
  'Address 1 - State/Region', 'Address 1 - Zip', 'Address 1 - Country', 'Address 2 - Street', 'Address 2 - City',
  'Address 2 - State/Region', 'Address 2 - Zip', 'Address 2 - Country', 'Company', 'Position', 'Labels',
  'Email subscriber status', 'SMS subscriber status', 'Created At (UTC+0)', 'Language', 'Source', 'Last Activity',
  'Last Activity Date (UTC+0)',
]
const SQUARESPACE = [
  'Email', 'First Name', 'Last Name', 'Shipping Address 1', 'Shipping Address 2', 'Shipping City', 'Shipping Zip',
  'Shipping Province/State', 'Shipping Country', 'Shipping Phone Number', 'Billing Address 1', 'Billing Address 2',
  'Billing City', 'Billing Zip', 'Billing Province/State', 'Billing Country', 'Billing Phone Number', 'Accepts Marketing',
  'Tags', 'Created On', 'Last Order Date', 'Order Count', 'Total Spent', 'Has Account', 'Customer Since', 'Mailing Lists',
]

/** Header → the field it mapped to, `null` for none. */
function mapped(headers: readonly string[]): Record<string, string | null> {
  const { proposals } = matchHeaders(headers, CONTACT_TRANSFER_FIELDS, { dictionaries: CONTACT_ALIASES })
  return Object.fromEntries(proposals.map((proposal) => [proposal.header, proposal.fieldId]))
}

describe('the three files map themselves', () => {
  it('reads a Shopify customers export', () => {
    expect(mapped(SHOPIFY)).toEqual({
      'Customer ID': CUSTOMER_FIELD.customerId,
      'First Name': 'firstName',
      'Last Name': 'lastName',
      Email: 'email',
      'Accepts Email Marketing': CUSTOMER_FIELD.emailMarketing,
      'Default Address Company': 'company',
      'Default Address Address1': 'mailingStreet',
      'Default Address Address2': 'mailingStreet2',
      'Default Address City': 'mailingCity',
      'Default Address Province Code': 'mailingState',
      'Default Address Country Code': 'mailingCountry',
      'Default Address Zip': 'mailingPostalCode',
      'Default Address Phone': 'otherPhone',
      Phone: 'phone',
      'Accepts SMS Marketing': CUSTOMER_FIELD.smsMarketing,
      'Total Spent': CUSTOMER_FIELD.totalSpent,
      'Total Orders': CUSTOMER_FIELD.orderCount,
      Note: 'notes',
      'Tax Exempt': null,
      Tags: 'tags',
    })
  })

  it('reads an older Shopify export, the first of two columns for one field winning', () => {
    const out = mapped(SHOPIFY_OLD)
    expect(out).toMatchObject({
      Email: 'email',
      Company: 'company',
      Address1: 'mailingStreet',
      Address2: 'mailingStreet2',
      City: 'mailingCity',
      Province: 'mailingState',
      Country: 'mailingCountry',
      Zip: 'mailingPostalCode',
      'Accepts Marketing': CUSTOMER_FIELD.emailMarketing,
      Tags: 'tags',
      Note: 'notes',
    })
    expect(Object.values(out).filter((fieldId) => fieldId === 'mailingState')).toHaveLength(1)
  })

  it('reads a Wix contacts export: the first email and phone are the person’s', () => {
    expect(mapped(WIX)).toMatchObject({
      'First Name': 'firstName',
      'Last Name': 'lastName',
      'Email 1': 'email',
      'Phone 1': 'phone',
      'Phone 2': 'otherPhone',
      'Address 1 - Street': 'mailingStreet',
      'Address 1 - City': 'mailingCity',
      'Address 1 - State/Region': 'mailingState',
      'Address 1 - Zip': 'mailingPostalCode',
      'Address 1 - Country': 'mailingCountry',
      'Address 2 - Street': 'otherStreet',
      'Address 2 - City': 'otherCity',
      'Address 2 - Country': 'otherCountry',
      Company: 'company',
      Position: 'jobTitle',
      Labels: 'tags',
      'Email subscriber status': CUSTOMER_FIELD.emailMarketing,
      'SMS subscriber status': CUSTOMER_FIELD.smsMarketing,
    })
  })

  it('reads a Squarespace customers export: shipping is the mailing address, billing the other', () => {
    expect(mapped(SQUARESPACE)).toMatchObject({
      Email: 'email',
      'Shipping Address 1': 'mailingStreet',
      'Shipping Address 2': 'mailingStreet2',
      'Shipping City': 'mailingCity',
      'Shipping Zip': 'mailingPostalCode',
      'Shipping Province/State': 'mailingState',
      'Shipping Country': 'mailingCountry',
      'Shipping Phone Number': 'phone',
      'Billing Address 1': 'otherStreet',
      'Billing City': 'otherCity',
      'Billing Phone Number': 'otherPhone',
      'Accepts Marketing': CUSTOMER_FIELD.emailMarketing,
      Tags: 'tags',
      'Order Count': CUSTOMER_FIELD.orderCount,
      'Total Spent': CUSTOMER_FIELD.totalSpent,
    })
  })

  it('tolerates header casing and missing columns', () => {
    expect(mapped(['EMAIL', 'accepts email marketing', 'first name'])).toEqual({
      EMAIL: 'email',
      'accepts email marketing': CUSTOMER_FIELD.emailMarketing,
      'first name': 'firstName',
    })
  })

  it('never offers the store-only fields on export', () => {
    const storeOnly = CONTACT_TRANSFER_FIELDS.filter((field) => Object.values(CUSTOMER_FIELD).includes(field.id as never))
    expect(storeOnly).toHaveLength(5)
    expect(storeOnly.filter(isTransferFieldExportable)).toEqual([])
  })
})

describe('which store a file came from', () => {
  it('is read from the headers', () => {
    expect(customerFileSource(SHOPIFY)).toBe('shopify')
    expect(customerFileSource(SHOPIFY_OLD)).toBe('shopify')
    expect(customerFileSource(WIX)).toBe('wix')
    expect(customerFileSource(SQUARESPACE)).toBe('squarespace')
    expect(customerFileSource(['email', 'accepts email marketing'])).toBe('shopify')
    expect(customerFileSource(['Email', 'First Name', 'Mailing City'])).toBeNull()
    expect(customerFileSource(undefined)).toBeNull()
  })
})

describe('a marketing cell', () => {
  it('reads yes, no and the subscriber statuses, case-insensitively', () => {
    for (const word of ['yes', 'YES', 'true', 'True', 'Subscribed']) expect(readMarketingChoice(word)).toEqual({ choice: 'optIn', read: true })
    for (const word of ['no', 'No', 'FALSE', 'Unsubscribed']) expect(readMarketingChoice(word)).toEqual({ choice: 'optOut', read: true })
    for (const word of ['Never subscribed', 'Pending', '', null]) expect(readMarketingChoice(word)).toEqual({ choice: 'none', read: true })
  })

  it('reads a word it does not know as no choice, never an opt-in', () => {
    expect(readMarketingChoice('maybe')).toEqual({ choice: 'none', read: false })
  })
})

describe('the Permission answer', () => {
  it('is a statement only as a literal true', () => {
    expect(readContactConsentAnswer({ [CONTACT_CONSENT_STEP_ID]: { attest: true } })).toEqual({ attest: true })
    expect(readContactConsentAnswer({ [CONTACT_CONSENT_STEP_ID]: { attest: 'true' } })).toEqual({ attest: false })
    expect(readContactConsentAnswer(undefined)).toEqual({ attest: false })
  })
})

/*------------------------------------------
 * The plan
 *-----------------------------------------*/

const M = CUSTOMER_FIELD.emailMarketing

/** Rows of `[email, choice]`; an email in `matched` is an existing contact with that stored consent. */
function planned(
  cells: Array<[string, string]>,
  matched: Record<string, { id: string; consent: boolean | null }>,
  ctx: Partial<ContactConsentPlanContext> = {},
) {
  const rows: TransferPlanRow[] = cells.map(([email, choice], index) => ({ index, values: { email, [M]: choice } }))
  const matches: RowMatchOutcome[] = cells.map(([email]) =>
    matched[email] ? { kind: 'matched', recordId: matched[email].id, via: { fieldId: 'email' } } : { kind: 'new' },
  ) as RowMatchOutcome[]
  const existing = new Map(
    Object.entries(matched).map(([email, entry]) => [entry.id, { email, marketingConsent: entry.consent }]),
  )
  const core = buildTransferPlan({
    fields: CONTACT_TRANSFER_FIELDS,
    rows: withoutCustomerSourceFields(rows),
    matches,
    existing,
    policy: createTransferPolicy({}),
  })
  return planContactConsent(core, rows, existing, {
    hostId: 'site-1',
    attested: false,
    recordedBy: 'uid-me',
    jobId: 'job-1',
    source: 'shopify',
    suppressed: new Set(),
    ...ctx,
  })
}

const actions = (plan: ReturnType<typeof planned>['plan']) =>
  plan.rows.map((row) => importedConsentChange(row)?.consent.action ?? null)

describe('the plan of a store file’s marketing choices', () => {
  const FILE: Array<[string, string]> = [
    ['new-yes@example.com', 'yes'],
    ['new-no@example.com', 'no'],
    ['new-pending@example.com', 'Pending'],
    ['sub@example.com', 'no'],
    ['unsub@example.com', 'yes'],
    ['blank@example.com', ''],
  ]
  const MATCHED = {
    'sub@example.com': { id: 'c-sub', consent: true },
    'unsub@example.com': { id: 'c-unsub', consent: false },
    'blank@example.com': { id: 'c-blank', consent: true },
  }

  it('opts nobody in without the statement, and keeps every unsubscribe', () => {
    const { plan, counts } = planned(FILE, MATCHED)
    expect(actions(plan)).toEqual([null, 'decline', null, 'decline', null, null])
    expect(counts).toMatchObject({
      optedIn: 0,
      unsubscribes: 2,
      unsubscribedFromSubscribed: 1,
      noConsent: 2,
      notConfirmed: 1,
      keptUnsubscribed: 1,
    })
    // Sub had nothing else to change; the unsubscribe makes the row an update.
    expect(plan.rows[3]).toMatchObject({ verdict: 'update', recordId: 'c-sub' })
    expect(plan.rows[5]?.verdict).toBe('unchanged')
    const screening = plan.warnings.find((warning) => warning.class === 'screening')
    expect(screening?.requiresAcknowledgement).toBe(true)
    expect(plan.acknowledgementsRequired).toContain('screening')
    expect(screening?.samples.map((sample) => sample.detail)).toEqual(
      expect.arrayContaining([
        'Nobody will be opted in to marketing email from this file.',
        '2 unsubscribes from your Shopify file will be kept, and 1 person subscribed here will be unsubscribed.',
        '2 people have no marketing choice recorded, and nothing about their marketing email changes.',
        '1 person said yes in your Shopify file but will not be opted in, because you did not confirm on the Permission step that they agreed to hear from you.',
        '1 person said yes in your Shopify file but unsubscribed here, so they stay unsubscribed.',
      ]),
    )
  })

  it('opts in on the statement, stamped with who made it, never over an unsubscribe', () => {
    const { plan, counts } = planned(FILE, MATCHED, { attested: true })
    expect(actions(plan)).toEqual(['grant', 'decline', null, 'decline', null, null])
    expect(counts).toMatchObject({ optedIn: 1, keptUnsubscribed: 1, notConfirmed: 0 })
    expect(importedConsentChange(plan.rows[0] as never)).toMatchObject({
      fieldId: 'marketingConsent',
      before: null,
      after: true,
      consent: { action: 'grant', by: 'uid-me', attested: true, jobId: 'job-1', source: 'shopify' },
    })
  })

  it('keeps an address on the site’s unsubscribe list unsubscribed', () => {
    const { plan, counts } = planned([['listed@example.com', 'yes']], {}, { attested: true, suppressed: new Set(['listed@example.com']) })
    expect(actions(plan)).toEqual([null])
    expect(counts?.keptUnsubscribed).toBe(1)
  })

  it('brings no opt-in in with no site, and still keeps the unsubscribes', () => {
    const { plan, counts } = planned(FILE.slice(0, 2), {}, { attested: true, hostId: null })
    expect(actions(plan)).toEqual([null, 'decline'])
    expect(counts?.noSite).toBe(1)
  })

  it('says what is not kept, and leaves a file with no store column as it came', () => {
    const rows: TransferPlanRow[] = [{ index: 0, values: { email: 'a@example.com', [CUSTOMER_FIELD.smsMarketing]: 'yes', [CUSTOMER_FIELD.totalSpent]: '$10.00' } }]
    const core = buildTransferPlan({
      fields: CONTACT_TRANSFER_FIELDS,
      rows: withoutCustomerSourceFields(rows),
      matches: [{ kind: 'new' } as RowMatchOutcome],
      existing: new Map(),
      policy: createTransferPolicy({}),
    })
    // The core never sees the store-only values.
    expect(core.rows[0]?.diff.map((change) => change.fieldId)).toEqual(['email'])
    const ctx = { hostId: 'site-1', attested: false, recordedBy: null, jobId: null, source: null, suppressed: new Set<string>() }
    const notes = planContactConsent(core, rows, new Map(), ctx).plan.warnings.find((warning) => warning.class === 'screening')
    expect(notes?.samples.map((sample) => sample.fieldId)).toEqual([CUSTOMER_FIELD.smsMarketing, CUSTOMER_FIELD.totalSpent])

    const plain: TransferPlanRow[] = [{ index: 0, values: { email: 'a@example.com' } }]
    const untouched = buildTransferPlan({
      fields: CONTACT_TRANSFER_FIELDS,
      rows: plain,
      matches: [{ kind: 'new' } as RowMatchOutcome],
      existing: new Map(),
      policy: createTransferPolicy({}),
    })
    expect(planContactConsent(untouched, plain, new Map(), ctx).plan).toBe(untouched)
  })
})
