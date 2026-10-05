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

import {
  COMPANY_IMPORT_FIELDS,
  guessCompanyImportMapping,
} from './crm-company-import'
import {
  COMPANY_CSV_COLUMNS,
  companiesCsv,
  companyImportTemplateCsv,
} from './companies-csv'

/**
 * The companies file (AGL-2621): every column, the owner by address, and a
 * header the companies import reads back without a hand mapping.
 */
describe('the companies CSV', () => {
  it('heads every column as the import reads it, the contacts count last', () => {
    expect([...COMPANY_CSV_COLUMNS]).toEqual([
      'Company',
      'Domain',
      'Website',
      'Phone',
      'Fax',
      'Type',
      'Industry',
      'Rating',
      'Ownership',
      'Account source',
      'Account number',
      'Account site',
      'Ticker symbol',
      'SIC code',
      'Employees',
      'Annual revenue',
      'Currency',
      'Owner',
      'Billing address line 1',
      'Billing address line 2',
      'Billing city',
      'Billing state',
      'Billing postal code',
      'Billing country',
      'Shipping address line 1',
      'Shipping address line 2',
      'Shipping city',
      'Shipping state',
      'Shipping postal code',
      'Shipping country',
      'Tags',
      'Notes',
      'Contacts',
    ])
  })

  it('writes every column, the owner by address, and quotes what needs quoting', () => {
    const csv = companiesCsv(
      [
        {
          name: 'Acme, Inc',
          domain: 'acme.com',
          website: 'https://acme.com/',
          phone: '+15125550100',
          fax: '+15125550101',
          type: 'Customer',
          industry: 'Technology',
          rating: 'Hot',
          ownership: 'Private',
          accountSource: 'Web',
          accountNumber: 'A-1',
          site: 'HQ',
          tickerSymbol: 'ACME',
          sicCode: '7372',
          numberOfEmployees: 250,
          annualRevenueCents: 125_000_000,
          currency: 'eur',
          ownerUid: 'uid-1',
          address: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
          shippingAddress: { line1: '2 Dock Rd', city: 'Round Rock', country: 'US' },
          tags: ['enterprise', 'west'],
          notes: 'Said "hello"',
          contactsCount: 4,
        },
        { name: 'Globex', ownerUid: 'uid-unknown' },
      ],
      { ownerEmail: (uid) => (uid === 'uid-1' ? 'owner@example.com' : uid) },
    )
    expect(csv.split('\n')).toEqual([
      COMPANY_CSV_COLUMNS.join(','),
      '"Acme, Inc",acme.com,https://acme.com/,+15125550100,+15125550101,Customer,Technology,Hot,Private,Web,A-1,HQ,ACME,7372,250,1250000.00,EUR,owner@example.com,1 Main St,,Austin,TX,78701,US,2 Dock Rd,,Round Rock,,,US,enterprise|west,"Said ""hello""",4',
      'Globex,,,,,,,,,,,,,,,,,uid-unknown,,,,,,,,,,,,,,,0',
    ])
  })

  /**
   * The round trip: every field the import has is proposed back from the
   * header alone, the contacts count maps to nothing, and the template is
   * that header over no rows.
   */
  it('re-imports under its own header', () => {
    const header = [...COMPANY_CSV_COLUMNS]
    const mapping = guessCompanyImportMapping(header)
    const mapped = new Set(Object.values(mapping))
    for (const field of COMPANY_IMPORT_FIELDS) {
      expect(mapped.has(field)).toBe(true)
    }
    const contactsAt = header.indexOf('Contacts')
    expect(contactsAt).toBeGreaterThanOrEqual(0)
    expect(mapping[contactsAt]).toBeUndefined()
    expect(companyImportTemplateCsv()).toBe(header.join(','))
  })
})
