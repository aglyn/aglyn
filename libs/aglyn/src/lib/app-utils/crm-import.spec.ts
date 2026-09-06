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
 * The contact-file normalizer (AGL-2602): what a cell becomes, and what is
 * said about a cell that becomes nothing.
 *
 * Pure, so every case here is a table of inputs and outputs. The two
 * properties the route and the drawer both lean on are proved by name: a
 * row is refused ONLY for its address, and a value that cannot be read is
 * reported rather than silently left off.
 */

import {
  CONTACT_IMPORT_FIELDS,
  CONTACT_IMPORT_FIELD_LABELS,
  CONTACT_IMPORT_SKIP_LABELS,
  CONTACT_IMPORT_TAGS_MAX,
  contactImportSkippedCsv,
  customImportTarget,
  customImportTargetKey,
  emptyContactImportResult,
  guessContactImportMapping,
  mapContactImportRow,
  mergeContactImportResults,
  normalizeContactImportRow,
  parseContactImportCustomValue,
  parseContactImportFlag,
  parseContactImportLifecycleStage,
  parseContactImportTags,
} from './crm-import'
import type { ContactFieldDefinition } from './crm'

const field = (
  key: string,
  type: ContactFieldDefinition['type'],
  extra: Partial<ContactFieldDefinition> = {},
): ContactFieldDefinition => ({
  key,
  label: key,
  type,
  order: 0,
  visibleTo: ['org'],
  hostId: 'h1',
  ...extra,
})

describe('the mapping menu', () => {
  it('labels every standard field', () => {
    for (const entry of CONTACT_IMPORT_FIELDS) {
      expect(CONTACT_IMPORT_FIELD_LABELS[entry]).toBeTruthy()
    }
  })

  it('labels every skip reason', () => {
    expect(Object.keys(CONTACT_IMPORT_SKIP_LABELS).sort()).toEqual([
      'audience-band',
      'duplicate',
      'erased',
      'invalid-email',
      'write-failed',
    ])
  })

  it('round-trips a custom target id', () => {
    expect(customImportTargetKey(customImportTarget('annual_revenue'))).toBe(
      'annual_revenue',
    )
    expect(customImportTargetKey('email')).toBeNull()
  })
})

describe('guessContactImportMapping', () => {
  it('reads the usual header spellings, whatever the case or separator', () => {
    const mapping = guessContactImportMapping([
      'E-Mail Address',
      'Full Name',
      'Mobile_Phone',
      'Company',
      'Zip Code',
      'Country/Region',
      'Tags',
      'Contact Owner',
      'Lifecycle Stage',
      'Opt-In',
      'Favorite color',
    ])
    expect(mapping).toEqual({
      0: 'email',
      1: 'name',
      2: 'phone',
      3: 'companyName',
      4: 'addressPostalCode',
      5: 'addressCountry',
      6: 'tags',
      7: 'ownerEmail',
      8: 'lifecycleStage',
      9: 'marketingConsent',
    })
  })

  it('maps one column per target — the first claim wins', () => {
    const mapping = guessContactImportMapping(['Email', 'Work Email', 'Name'])
    expect(mapping).toEqual({ 0: 'email', 2: 'name' })
  })

  it('lets a custom field claim a header that would otherwise be a standard one', () => {
    // A merchant who defined a field called "Status" meant their status.
    const mapping = guessContactImportMapping(
      ['Email', 'Status', 'Annual revenue'],
      [field('status', 'select', { label: 'Status' }), field('annual_revenue', 'number', { label: 'Annual revenue' })],
    )
    expect(mapping).toEqual({
      0: 'email',
      1: 'custom:status',
      2: 'custom:annual_revenue',
    })
  })
})

describe('mapContactImportRow', () => {
  it('carries mapped cells verbatim and leaves blank ones absent', () => {
    const row = mapContactImportRow(
      ['  Ada@Example.com ', '', 'Ada', '42'],
      { 0: 'email', 1: 'phone', 2: 'name', 3: 'custom:seats' },
    )
    expect(row).toEqual({
      email: '  Ada@Example.com ',
      name: 'Ada',
      custom: { seats: '42' },
    })
  })
})

describe('parseContactImportTags', () => {
  it('splits on | or , and lowercases, dedupes and caps', () => {
    expect(parseContactImportTags('VIP, beta|vip | Press')).toEqual([
      'vip',
      'beta',
      'press',
    ])
    const many = Array.from({ length: 30 }, (_, index) => `t${index}`).join(',')
    expect(parseContactImportTags(many)).toHaveLength(CONTACT_IMPORT_TAGS_MAX)
    expect(parseContactImportTags(undefined)).toEqual([])
  })
})

describe('parseContactImportFlag', () => {
  it('reads the affirmatives, the negatives, and refuses the rest', () => {
    for (const yes of ['yes', 'Y', 'TRUE', '1', 'Subscribed']) {
      expect(parseContactImportFlag(yes)).toBe(true)
    }
    for (const no of ['no', 'false', '0', '']) {
      expect(parseContactImportFlag(no)).toBe(false)
    }
    expect(parseContactImportFlag('maybe')).toBeNull()
    expect(parseContactImportFlag(true)).toBe(true)
  })
})

describe('parseContactImportLifecycleStage', () => {
  it('accepts the id, the label and the spellings between', () => {
    expect(parseContactImportLifecycleStage('lead')).toBe('lead')
    expect(parseContactImportLifecycleStage('Sales qualified')).toBe('sales-qualified')
    expect(parseContactImportLifecycleStage('Marketing_Qualified')).toBe(
      'marketing-qualified',
    )
    expect(parseContactImportLifecycleStage('hot')).toBeNull()
    expect(parseContactImportLifecycleStage('')).toBeNull()
  })
})

describe('parseContactImportCustomValue', () => {
  it('reads each type into the value it stores', () => {
    expect(parseContactImportCustomValue(field('a', 'text'), ' hello ')).toEqual({
      value: 'hello',
    })
    expect(parseContactImportCustomValue(field('a', 'number'), '$1,200')).toEqual({
      value: 1200,
    })
    expect(parseContactImportCustomValue(field('a', 'number'), 'twelve')).toBeNull()
    expect(parseContactImportCustomValue(field('a', 'date'), '2026-03-04')).toEqual({
      value: Date.parse('2026-03-04'),
    })
    expect(parseContactImportCustomValue(field('a', 'date'), 'someday')).toBeNull()
    expect(
      parseContactImportCustomValue(
        field('a', 'select', { options: ['Gold', 'Silver'] }),
        'gold',
      ),
    ).toEqual({ value: 'Gold' })
    expect(
      parseContactImportCustomValue(field('a', 'select', { options: ['Gold'] }), 'Bronze'),
    ).toBeNull()
    expect(parseContactImportCustomValue(field('a', 'checkbox'), 'yes')).toEqual({
      value: true,
    })
    expect(parseContactImportCustomValue(field('a', 'checkbox'), 'sometimes')).toBeNull()
    // A blank cell is nothing to write and nothing to report.
    expect(parseContactImportCustomValue(field('a', 'number'), '')).toEqual({
      value: undefined,
    })
  })
})

describe('normalizeContactImportRow', () => {
  it('refuses a row for its address and for nothing else', () => {
    expect(normalizeContactImportRow({ email: 'not an address', phone: 'x' })).toEqual({
      ok: false,
      reason: 'invalid-email',
      input: 'not an address',
    })
    expect(normalizeContactImportRow({})).toMatchObject({ ok: false })
    const verdict = normalizeContactImportRow({
      email: ' Ada@Example.COM ',
      phone: 'not a number',
      lifecycleStage: 'hot',
    })
    expect(verdict.ok).toBe(true)
  })

  it('normalizes every field through the shared normalizers', () => {
    const verdict = normalizeContactImportRow({
      email: ' Ada@Example.COM ',
      name: '  Ada Lovelace ',
      phone: '(512) 555-0123',
      jobTitle: 'Analyst',
      companyName: 'Acme',
      addressLine1: '1 Main St',
      addressCity: 'Austin',
      addressState: 'TX',
      addressPostalCode: '78701',
      addressCountry: 'us',
      tags: 'VIP|Beta',
      ownerEmail: 'Owner@Example.com',
      lifecycleStage: 'Customer',
      marketingConsent: 'yes',
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok === false) throw new Error('unreachable')
    expect(verdict.row).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      phone: '+15125550123',
      jobTitle: 'Analyst',
      companyName: 'Acme',
      address: {
        line1: '1 Main St',
        city: 'Austin',
        state: 'TX',
        postalCode: '78701',
        country: 'US',
      },
      tags: ['vip', 'beta'],
      ownerEmail: 'owner@example.com',
      lifecycleStage: 'customer',
      marketingConsent: true,
      custom: {},
      dropped: [],
    })
  })

  it('leaves an unreadable value off and names it', () => {
    const verdict = normalizeContactImportRow({
      email: 'ada@example.com',
      phone: '12',
      addressCountry: 'United States',
      lifecycleStage: 'hot',
      marketingConsent: 'perhaps',
      ownerEmail: 'nobody',
    })
    if (verdict.ok === false) throw new Error('unreachable')
    expect(verdict.row.phone).toBeUndefined()
    expect(verdict.row.address).toBeUndefined()
    expect(verdict.row.lifecycleStage).toBeUndefined()
    expect(verdict.row.marketingConsent).toBe(false)
    expect(verdict.row.ownerEmail).toBeUndefined()
    expect(verdict.row.dropped).toEqual([
      { field: 'phone', value: '12' },
      { field: 'addressCountry', value: 'United States' },
      { field: 'ownerEmail', value: 'nobody' },
      { field: 'lifecycleStage', value: 'hot' },
      { field: 'marketingConsent', value: 'perhaps' },
    ])
  })

  it('records consent only for an affirmative cell', () => {
    const row = (marketingConsent: unknown) => {
      const verdict = normalizeContactImportRow({ email: 'a@b.co', marketingConsent })
      if (verdict.ok === false) throw new Error('unreachable')
      return verdict.row
    }
    expect(row('1').marketingConsent).toBe(true)
    expect(row('no').marketingConsent).toBe(false)
    expect(row(undefined).marketingConsent).toBe(false)
    expect(row(undefined).dropped).toEqual([])
  })

  it('keeps a custom value only under a defined key, typed by its definition', () => {
    const verdict = normalizeContactImportRow(
      {
        email: 'a@b.co',
        custom: { seats: '12', tier: 'gold', ghost: 'x', seats_text: 'twelve' },
      },
      [
        field('seats', 'number'),
        field('tier', 'select', { options: ['Gold'] }),
        field('seats_text', 'number'),
      ],
    )
    if (verdict.ok === false) throw new Error('unreachable')
    expect(verdict.row.custom).toEqual({ seats: 12, tier: 'Gold' })
    expect(verdict.row.dropped).toEqual([
      { field: 'custom:ghost', value: 'x' },
      { field: 'custom:seats_text', value: 'twelve' },
    ])
  })
})

describe('mergeContactImportResults', () => {
  it('sums the counts, offsets the skipped indexes and dedupes the owners', () => {
    const first = mergeContactImportResults(emptyContactImportResult(), {
      received: 2,
      created: 1,
      merged: 0,
      skipped: [{ index: 1, email: 'x', reason: 'invalid-email' }],
      dropped: { phone: 1 },
      companiesCreated: 1,
      ownersUnresolved: ['o@x.co'],
    })
    const total = mergeContactImportResults(
      first,
      {
        received: 2,
        created: 0,
        merged: 1,
        skipped: [{ index: 0, email: 'y', reason: 'audience-band' }],
        dropped: { phone: 2, lifecycleStage: 1 },
        companiesCreated: 0,
        ownersUnresolved: ['o@x.co', 'p@x.co'],
      },
      200,
    )
    expect(total).toEqual({
      received: 4,
      created: 1,
      merged: 1,
      skipped: [
        { index: 1, email: 'x', reason: 'invalid-email' },
        { index: 200, email: 'y', reason: 'audience-band' },
      ],
      dropped: { phone: 3, lifecycleStage: 1 },
      companiesCreated: 1,
      ownersUnresolved: ['o@x.co', 'p@x.co'],
    })
  })
})

describe('contactImportSkippedCsv', () => {
  it('writes the original columns plus the reason, quoted where it must be', () => {
    const csv = contactImportSkippedCsv(
      ['Email', 'Name'],
      [
        { cells: ['bad', 'Smith, Jo'], reason: 'invalid-email' },
        { cells: ['a@b.co'], reason: 'audience-band' },
      ],
    )
    expect(csv.split('\n')).toEqual([
      'Email,Name,Skipped because',
      'bad,"Smith, Jo",Not a valid email address',
      'a@b.co,,Contact limit reached',
    ])
  })
})
