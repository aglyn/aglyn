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
 * The lead-file normalizer (AGL-2701).
 *
 * What is pinned by name: the address is the only cell that can refuse a
 * row, because it is the document id; `qualified` is not a status a file
 * may set; an unqualified reason with no unqualified status to belong to
 * is dropped and reported; and the leads export's own header maps itself,
 * with the capture door's columns left alone.
 */

import { effectiveCrmLeadStatusPicklist } from '@aglyn/aglyn/app-utils/crm'
import { leadCsvHeader } from './crm-csv'
import {
  LEAD_IMPORT_FIELD_LABELS,
  LEAD_IMPORT_FIELDS,
  LEAD_IMPORT_REASON_MAX,
  LEAD_IMPORT_SKIP_LABELS,
  LEAD_IMPORT_STATUSES,
  guessLeadImportMapping,
  leadImportSkippedCsv,
  mapLeadImportRow,
  normalizeLeadImportRow,
  parseImportLeadStatus,
  parseImportLeadStatusValue,
} from './crm-lead-import'

describe('the lead vocabulary', () => {
  it('labels every field and every skip reason', () => {
    for (const field of LEAD_IMPORT_FIELDS) {
      expect(LEAD_IMPORT_FIELD_LABELS[field]).toBeTruthy()
    }
    expect(Object.keys(LEAD_IMPORT_SKIP_LABELS).sort()).toEqual([
      'campaign-unknown',
      'duplicate',
      'invalid-email',
      'lead-ceiling',
      'lead-source-unknown',
      'write-failed',
    ])
  })

  /** The campaigns column (AGL-3254): names as typed, for the server to resolve. */
  it('reads the campaigns a row names, as names, and leaves `campaign` to the lead source', () => {
    const verdict = normalizeLeadImportRow({
      email: 'dana@example.com',
      campaigns: ' Founder · ICP 2 | Founder · ICP 2, Spring  push ',
    })
    expect(verdict.ok && verdict.row.campaigns).toEqual(['Founder · ICP 2', 'Spring push'])
    expect(guessLeadImportMapping(['Email', 'Campaign', 'Campaigns'])).toEqual({
      0: 'email',
      1: 'leadSource',
      2: 'campaigns',
    })
  })

  /**
   * The list's own status control offers new, nurturing, working and unqualified;
   * qualification is the conversion's to write, beside the contact it
   * created. A file may set exactly what a person may.
   */
  it('offers the four statuses a person may set, and not qualified', () => {
    expect([...LEAD_IMPORT_STATUSES]).toEqual(['new', 'nurturing', 'working', 'unqualified'])
  })
})

describe('guessLeadImportMapping', () => {
  it("reads the leads export header, leaving the capture door's columns unmapped", () => {
    expect(guessLeadImportMapping(leadCsvHeader())).toEqual({
      0: 'email',
      1: 'name',
      // Salesforce's standard lead fields (AGL-3513) read back too.
      2: 'salutation',
      3: 'firstName',
      4: 'lastName',
      5: 'company',
      6: 'jobTitle',
      7: 'phone',
      8: 'mobilePhone',
      9: 'fax',
      10: 'doNotCall',
      11: 'website',
      12: 'industry',
      13: 'rating',
      14: 'numberOfEmployees',
      15: 'annualRevenue',
      16: 'currency',
      17: 'status',
      18: 'ownerEmail',
      19: 'leadSource',
      24: 'addressLine1',
      25: 'addressLine2',
      26: 'addressCity',
      27: 'addressState',
      28: 'addressPostalCode',
      29: 'addressCountry',
      30: 'tags',
      31: 'unqualifiedReason',
      33: 'notes',
    })
  })

  /**
   * At the organization level the export gains a `Site` column after
   * `Owner`. The drawer's picker names the one site the route is
   * authorized for, so a cell must never be able to redirect a row.
   */
  it('leaves the organization file’s Site column unmapped', () => {
    const header = leadCsvHeader({ siteName: (id: string) => id })
    const mapping = guessLeadImportMapping(header)
    expect(mapping[header.indexOf('Site')]).toBeUndefined()
    expect(Object.values(mapping)).not.toContain('hostId')
  })

  it('reads another product’s header from the aliases', () => {
    expect(
      guessLeadImportMapping([
        'Email Address',
        'Full Name',
        'Lead Status',
        'Assigned To',
        'Lost reason',
        'Comments',
        'Account Name',
        'Headline',
        'Mobile',
        'Company Domain',
        'Source',
        'Labels',
      ]),
    ).toEqual({
      0: 'email',
      1: 'name',
      2: 'status',
      3: 'ownerEmail',
      4: 'unqualifiedReason',
      5: 'notes',
      6: 'company',
      7: 'jobTitle',
      // A Mobile column is the mobile phone, as on a contact (AGL-3513).
      8: 'mobilePhone',
      9: 'website',
      10: 'leadSource',
      11: 'tags',
    })
  })
})

describe('mapLeadImportRow', () => {
  it('takes the mapped cells verbatim and leaves the empty ones absent', () => {
    expect(
      mapLeadImportRow(['  Dana@Example.com ', '', 'Working'], {
        0: 'email',
        1: 'name',
        2: 'status',
      }),
    ).toEqual({ email: '  Dana@Example.com ', status: 'Working' })
  })
})

describe('parseImportLeadStatus', () => {
  it('reads a status by id or by label, in any case', () => {
    expect(parseImportLeadStatus('working')).toBe('working')
    expect(parseImportLeadStatus('  WORKING ')).toBe('working')
    expect(parseImportLeadStatus('Unqualified')).toBe('unqualified')
    expect(parseImportLeadStatus('New')).toBe('new')
  })

  it('refuses qualified and anything it does not know', () => {
    expect(parseImportLeadStatus('qualified')).toBeNull()
    expect(parseImportLeadStatus('Qualified')).toBeNull()
    expect(parseImportLeadStatus('converted')).toBeNull()
    expect(parseImportLeadStatus('')).toBeNull()
    expect(parseImportLeadStatus(undefined)).toBeNull()
  })

  it('reads any active value of the org’s list as its meaning and its label (AGL-3512)', () => {
    const statuses = effectiveCrmLeadStatusPicklist({
      values: [
        { id: 'contacted', label: 'Contacted', active: true, meaning: 'working' },
        { id: 'stale', label: 'Stale', active: false, meaning: 'working' },
        { id: 'converted', label: 'Converted', active: true, meaning: 'qualified' },
      ],
      defaultValueId: null,
    })
    expect(parseImportLeadStatusValue(' contacted ', statuses)).toEqual({
      status: 'working',
      statusLabel: 'Contacted',
    })
    // A bare meaning takes the meaning's own label.
    expect(parseImportLeadStatusValue('working', statuses)).toEqual({
      status: 'working',
      statusLabel: 'Working',
    })
    expect(parseImportLeadStatusValue('Stale', statuses)).toBeNull()
    expect(parseImportLeadStatusValue('Converted', statuses)).toBeNull()
  })
})

describe('normalizeLeadImportRow', () => {
  it('normalizes the address, tidies the name, and carries the rest', () => {
    const verdict = normalizeLeadImportRow({
      email: '  Dana@EXAMPLE.com ',
      name: ' Dana   Marsh ',
      status: 'Working',
      ownerEmail: ' Rep@Example.com ',
      notes: 'Met at the trade show',
    })
    expect(verdict).toEqual({
      ok: true,
      row: {
        email: 'dana@example.com',
        name: 'Dana Marsh',
        status: 'working',
        statusLabel: 'Working',
        ownerEmail: 'rep@example.com',
        notes: 'Met at the trade show',
        profile: {},
        dropped: [],
      },
    })
  })

  /**
   * The lead's own profile (AGL-3231): every field through the normalizer
   * the record's card runs, so an imported phone dials and an imported
   * website opens; a value neither can read is dropped and named.
   */
  it('normalizes the profile the way the record stores it', () => {
    const verdict = normalizeLeadImportRow({
      email: 'dana@example.com',
      company: ' Acme  Brands ',
      jobTitle: 'VP Marketing',
      phone: '(512) 555-0107',
      website: 'acme.com',
      leadSource: 'Sales Navigator',
      addressCity: 'Austin',
      addressState: 'TX',
      addressCountry: 'us',
      tags: 'ICP2, a-list | Icp2',
    })
    expect(verdict.ok && verdict.row.profile).toEqual({
      company: 'Acme Brands',
      jobTitle: 'VP Marketing',
      phone: '+15125550107',
      website: 'https://acme.com/',
      leadSource: 'Sales Navigator',
      address: { city: 'Austin', state: 'TX', country: 'US' },
      tags: ['icp2', 'a-list'],
    })
  })

  it('drops a phone, a website or a country it cannot read, and names each', () => {
    const verdict = normalizeLeadImportRow({
      email: 'dana@example.com',
      phone: 'call me',
      website: 'javascript:alert(1)',
      addressCountry: 'United States',
    })
    expect(verdict.ok && verdict.row.profile).toEqual({})
    expect(verdict.ok && verdict.row.dropped).toEqual([
      { field: 'phone', value: 'call me' },
      { field: 'website', value: 'javascript:alert(1)' },
      { field: 'addressCountry', value: 'United States' },
    ])
  })

  it('refuses a row whose address cannot be read, and says what it was', () => {
    expect(normalizeLeadImportRow({ email: 'not-an-address', name: 'Dana' })).toEqual({
      ok: false,
      reason: 'invalid-email',
      input: 'not-an-address',
    })
    expect(normalizeLeadImportRow({})).toEqual({
      ok: false,
      reason: 'invalid-email',
      input: '',
    })
  })

  it('drops a status it may not set and reports the cell', () => {
    const verdict = normalizeLeadImportRow({ email: 'a@b.com', status: 'Qualified' })
    expect(verdict.ok).toBe(true)
    if (verdict.ok === false) return
    expect(verdict.row.status).toBeUndefined()
    expect(verdict.row.dropped).toEqual([{ field: 'status', value: 'Qualified' }])
  })

  /** The reason is what an unqualified lead was CLOSED for; on any other
   * row it describes nothing, so it is reported rather than stored. */
  it('keeps an unqualified reason only beside the unqualified status', () => {
    const closed = normalizeLeadImportRow({
      email: 'a@b.com',
      status: 'unqualified',
      unqualifiedReason: 'No budget',
    })
    expect(closed.ok === true && closed.row.unqualifiedReason).toBe('No budget')
    expect(closed.ok === true && closed.row.dropped).toEqual([])

    const open = normalizeLeadImportRow({
      email: 'a@b.com',
      status: 'working',
      unqualifiedReason: 'No budget',
    })
    expect(open.ok === true && open.row.unqualifiedReason).toBeUndefined()
    expect(open.ok === true && open.row.dropped).toEqual([
      { field: 'unqualifiedReason', value: 'No budget' },
    ])
  })

  it('drops an owner address it cannot read and reports it', () => {
    const verdict = normalizeLeadImportRow({ email: 'a@b.com', ownerEmail: 'nobody' })
    expect(verdict.ok === true && verdict.row.ownerEmail).toBeUndefined()
    expect(verdict.ok === true && verdict.row.dropped).toEqual([
      { field: 'ownerEmail', value: 'nobody' },
    ])
  })

  it('caps the reason where the unqualify dialog caps it', () => {
    const verdict = normalizeLeadImportRow({
      email: 'a@b.com',
      status: 'unqualified',
      unqualifiedReason: 'x'.repeat(LEAD_IMPORT_REASON_MAX + 50),
    })
    expect(verdict.ok === true && verdict.row.unqualifiedReason?.length).toBe(
      LEAD_IMPORT_REASON_MAX,
    )
  })
})

describe('leadImportSkippedCsv', () => {
  it('round-trips the original columns with the reason appended', () => {
    expect(
      leadImportSkippedCsv(
        ['Email', 'Name'],
        [
          { cells: ['bad', 'Dana'], reason: 'invalid-email' },
          { cells: ['a@b.com', 'Ada'], reason: 'duplicate' },
        ],
      ),
    ).toBe(
      'Email,Name,Skipped because\n' +
        'bad,Dana,No usable email address\n' +
        'a@b.com,Ada,The same address appears earlier in this file',
    )
  })
})

describe("Salesforce's standard lead fields (AGL-3513)", () => {
  it('reads the name parts, the phones, the flag and the account fields', () => {
    const verdict = normalizeLeadImportRow({
      email: 'maya@example.com',
      name: 'Ignored Whole Name',
      salutation: ' Dr. ',
      firstName: ' Maya ',
      lastName: 'Quinn',
      mobilePhone: '+1 512 555 0108',
      fax: '+1 512 555 0109',
      doNotCall: 'yes',
      industry: 'Food   & Beverage',
      rating: 'Hot',
      numberOfEmployees: '1,200',
      annualRevenue: '$1,250,000.50',
      currency: 'EUR',
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    // While a part is filled the name is their composition.
    expect(verdict.row.name).toBe('Maya Quinn')
    expect(verdict.row.profile).toEqual({
      firstName: 'Maya',
      lastName: 'Quinn',
      mobilePhone: '+15125550108',
      fax: '+15125550109',
      doNotCall: true,
      salutation: 'Dr.',
      industry: 'Food & Beverage',
      rating: 'Hot',
      numberOfEmployees: 1200,
      annualRevenueCents: 125000050,
      currency: 'eur',
    })
    expect(verdict.row.dropped).toEqual([])
  })

  it('drops, and names, what it cannot read', () => {
    const verdict = normalizeLeadImportRow({
      email: 'maya@example.com',
      mobilePhone: 'call me',
      doNotCall: 'maybe',
      numberOfEmployees: 'lots',
      annualRevenue: 'n/a',
      currency: 'euro',
    })
    expect(verdict.ok && verdict.row.dropped.map((entry) => entry.field)).toEqual([
      'mobilePhone',
      'doNotCall',
      'numberOfEmployees',
      'annualRevenue',
      'currency',
    ])
  })

  it('keeps the Name column when no part is filled, and a "no" flag stores nothing', () => {
    const verdict = normalizeLeadImportRow({ email: 'maya@example.com', name: 'Maya Q', doNotCall: 'no' })
    expect(verdict.ok && verdict.row.name).toBe('Maya Q')
    expect(verdict.ok && verdict.row.profile).toEqual({})
  })
})
