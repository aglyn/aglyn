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
 * The company-file normalizer (AGL-2621): the contact import's three stages
 * over the company vocabulary.
 *
 * What is pinned by name: a row is refused ONLY for a missing name; a
 * domain, a website, a phone or a country that cannot be read is dropped
 * and reported rather than silently left off; and the match key is the
 * domain when there is one and the name's search key otherwise.
 */

import {
  COMPANY_IMPORT_FIELDS,
  COMPANY_IMPORT_FIELD_LABELS,
  COMPANY_IMPORT_SKIP_LABELS,
  companyImportMatchKey,
  companyImportSkippedCsv,
  emptyCompanyImportResult,
  guessCompanyImportMapping,
  mapCompanyImportRow,
  mergeCompanyImportResults,
  normalizeCompanyImportRow,
} from './crm-company-import'

describe('the company vocabulary', () => {
  it('labels every field and every skip reason', () => {
    for (const field of COMPANY_IMPORT_FIELDS) {
      expect(COMPANY_IMPORT_FIELD_LABELS[field]).toBeTruthy()
    }
    expect(Object.keys(COMPANY_IMPORT_SKIP_LABELS).sort()).toEqual([
      'duplicate',
      'missing-name',
      'records-band',
      'write-failed',
    ])
  })
})

describe('guessCompanyImportMapping', () => {
  it('reads the usual headers, each field once, and leaves the rest unmapped', () => {
    const mapping = guessCompanyImportMapping([
      'Company',
      'Domain',
      'Web site',
      'Phone',
      'Industry',
      'Owner',
      'Street',
      'City',
      'State/Region',
      'Zip',
      'Country',
      'Tags',
      'Notes',
      'Company name',
      'Employees',
    ])
    expect(mapping).toEqual({
      0: 'name',
      1: 'domain',
      2: 'website',
      3: 'phone',
      4: 'industry',
      5: 'ownerEmail',
      6: 'addressLine1',
      7: 'addressCity',
      8: 'addressState',
      9: 'addressPostalCode',
      10: 'addressCountry',
      11: 'tags',
      12: 'notes',
    })
  })
})

describe('mapCompanyImportRow', () => {
  it('carries the mapped cells verbatim and leaves blank cells absent', () => {
    expect(
      mapCompanyImportRow([' Acme ', '', 'https://acme.com'], {
        0: 'name',
        1: 'domain',
        2: 'website',
      }),
    ).toEqual({ name: ' Acme ', website: 'https://acme.com' })
  })
})

describe('normalizeCompanyImportRow', () => {
  it('refuses only a row with no name', () => {
    expect(normalizeCompanyImportRow({ domain: 'acme.com' })).toEqual({
      ok: false,
      reason: 'missing-name',
      input: 'acme.com',
    })
    expect(normalizeCompanyImportRow({ name: '   ' }).ok).toBe(false)
  })

  it('normalizes every field through the company drawer’s own rules', () => {
    const verdict = normalizeCompanyImportRow({
      name: '  Acme   Corp ',
      domain: 'https://www.Acme.com/about',
      website: 'acme.com',
      phone: '(512) 555-0123',
      industry: 'Manufacturing',
      ownerEmail: ' Owner@Example.com ',
      addressLine1: '1 Main St',
      addressCity: 'Austin',
      addressState: 'TX',
      addressPostalCode: '78701',
      addressCountry: 'us',
      tags: 'VIP, vip | Wholesale',
      notes: 'Key account',
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.row).toMatchObject({
      name: 'Acme Corp',
      domain: 'acme.com',
      website: 'https://acme.com/',
      phone: '+15125550123',
      industry: 'Manufacturing',
      ownerEmail: 'owner@example.com',
      tags: ['vip', 'wholesale'],
      notes: 'Key account',
    })
    expect(verdict.row.address).toMatchObject({
      line1: '1 Main St',
      city: 'Austin',
      country: 'US',
    })
    expect(verdict.row.dropped).toEqual([])
  })

  it('drops and names a cell it cannot read, and keeps the row', () => {
    const verdict = normalizeCompanyImportRow({
      name: 'Acme',
      domain: 'acme',
      website: 'javascript:alert(1)',
      phone: 'call me',
      ownerEmail: 'not an address',
      addressCountry: 'United States',
    })
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.row.domain).toBeUndefined()
    expect(verdict.row.website).toBeUndefined()
    expect(verdict.row.phone).toBeUndefined()
    expect(verdict.row.ownerEmail).toBeUndefined()
    expect(verdict.row.dropped.map((entry) => entry.field)).toEqual([
      'domain',
      'website',
      'phone',
      'ownerEmail',
      'addressCountry',
    ])
  })
})

describe('companyImportMatchKey', () => {
  it('keys on the domain when there is one, else on the name’s search key', () => {
    expect(companyImportMatchKey({ name: 'Acme', domain: 'acme.com' })).toBe(
      'domain:acme.com',
    )
    expect(companyImportMatchKey({ name: '  ACME  Inc ' })).toBe(
      companyImportMatchKey({ name: 'acme inc' }),
    )
    expect(companyImportMatchKey({ name: 'Acme' })).toMatch(/^name:/)
  })
})

describe('the tally', () => {
  it('folds chunks with file-relative indexes and deduplicated owners', () => {
    const total = mergeCompanyImportResults(
      mergeCompanyImportResults(emptyCompanyImportResult(), {
        received: 2,
        created: 1,
        merged: 0,
        skipped: [{ index: 1, name: '', reason: 'missing-name' }],
        dropped: { phone: 1 },
        ownersUnresolved: ['a@x.co'],
      }),
      {
        received: 2,
        created: 0,
        merged: 2,
        skipped: [],
        dropped: { phone: 2, domain: 1 },
        ownersUnresolved: ['a@x.co', 'b@x.co'],
      },
      2,
    )
    expect(total).toEqual({
      received: 4,
      created: 1,
      merged: 2,
      skipped: [{ index: 1, name: '', reason: 'missing-name' }],
      dropped: { phone: 3, domain: 1 },
      ownersUnresolved: ['a@x.co', 'b@x.co'],
    })
  })

  it('writes the skipped rows back with the reason as a last column', () => {
    expect(
      companyImportSkippedCsv(
        ['Company', 'Domain'],
        [{ cells: ['', 'acme.com'], reason: 'missing-name' }],
      ).split('\n'),
    ).toEqual(['Company,Domain,Skipped because', ',acme.com,No company name'])
  })
})
