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

import { CONTACT_IMPORT_FIELDS, guessContactImportMapping } from '@aglyn/aglyn'
import {
  CONTACT_CSV_COLUMNS,
  contactCsvHeader,
  contactImportTemplateCsv,
  contactsCsv,
} from './contacts-csv'

/**
 * The contacts file carries every CRM column (AGL-2621), the selection's
 * export is the table's export over fewer rows, and the header is the
 * import's own vocabulary so the file round-trips.
 */
describe('the contacts CSV', () => {
  it('writes every CRM column, then one per custom field', () => {
    expect([...CONTACT_CSV_COLUMNS]).toEqual([
      'Email',
      'Name',
      'Phone',
      'Job title',
      'Company',
      'Owner',
      'Lifecycle stage',
      'Address line 1',
      'Address line 2',
      'City',
      'State',
      'Postal code',
      'Country',
      'Tags',
      'Sources',
      'Last interaction',
      'Last engaged',
      'Notes',
    ])
    expect(contactCsvHeader([{ key: 'plan', label: 'Plan' }])).toEqual([
      ...CONTACT_CSV_COLUMNS,
      'Plan',
    ])
  })

  it('joins multi-valued cells with |, names the owner by address, and quotes what needs quoting', () => {
    const csv = contactsCsv(
      [
        {
          email: 'a@example.com',
          name: 'Ada, Countess',
          phone: '+15125550100',
          jobTitle: 'CTO',
          companyName: 'Acme',
          ownerUid: 'uid-1',
          lifecycleStage: 'sales-qualified',
          address: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
          sources: { form: true, order: true },
          tags: ['vip', 'wholesale'],
          notes: 'Said "hello"',
          interactions: [{ atMs: Date.UTC(2026, 0, 2) }],
          lastEmailEngagementAtMs: Date.UTC(2026, 0, 3),
          custom: { plan: 'gold', renews: true },
        },
        { email: 'b@example.com', ownerUid: 'uid-unknown' },
      ],
      {
        ownerEmail: (uid) => (uid === 'uid-1' ? 'owner@example.com' : uid),
        customFields: [
          { key: 'plan', label: 'Plan' },
          { key: 'renews', label: 'Renews' },
        ],
      },
    )
    expect(csv.split('\n')).toEqual([
      `${CONTACT_CSV_COLUMNS.join(',')},Plan,Renews`,
      'a@example.com,"Ada, Countess",+15125550100,CTO,Acme,owner@example.com,Sales qualified,1 Main St,,Austin,TX,78701,US,vip|wholesale,form|order,2026-01-02T00:00:00.000Z,2026-01-03T00:00:00.000Z,"Said ""hello""",gold,yes',
      'b@example.com,,,,,uid-unknown,,,,,,,,,,,,,,',
    ])
  })

  /**
   * The round trip: every column the import has a field for is proposed
   * back to that field from the header alone, and the template is that
   * header over no rows.
   */
  it('re-imports under its own header, custom fields included', () => {
    const fields = [{ key: 'plan', label: 'Plan' }]
    const header = contactCsvHeader(fields)
    const mapping = guessContactImportMapping(header, fields)
    const mapped = new Set(Object.values(mapping))
    for (const field of CONTACT_IMPORT_FIELDS) {
      // Consent is a statement the import asks for, never a column an
      // export writes back.
      if (field === 'marketingConsent') continue
      expect(mapped.has(field)).toBe(true)
    }
    expect(mapped.has('custom:plan')).toBe(true)
    expect(mapping[header.indexOf('Sources')]).toBeUndefined()
    expect(mapping[header.indexOf('Last interaction')]).toBeUndefined()
    expect(mapping[header.indexOf('Last engaged')]).toBeUndefined()
    expect(mapping[header.indexOf('Notes')]).toBeUndefined()
    expect(contactImportTemplateCsv(fields)).toBe(header.join(','))
  })
})
