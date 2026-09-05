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

import { CONTACT_CSV_COLUMNS, contactsCsv } from './contacts-csv'

/**
 * The selection's export is the table's export over fewer rows (AGL-2603):
 * the six columns the Export button has always written, in its order, with
 * its `|` joins and its quoting.
 */
describe('the contacts CSV', () => {
  it('writes the table’s six columns in the table’s order', () => {
    expect([...CONTACT_CSV_COLUMNS]).toEqual([
      'email',
      'name',
      'sources',
      'tags',
      'lastInteraction',
      'notes',
    ])
  })

  it('joins multi-valued cells with | and quotes what needs quoting', () => {
    const csv = contactsCsv([
      {
        email: 'a@example.com',
        name: 'Ada, Countess',
        sources: { form: true, order: true },
        tags: ['vip', 'wholesale'],
        notes: 'Said "hello"',
        interactions: [{ atMs: Date.UTC(2026, 0, 2) }],
      },
      { email: 'b@example.com' },
    ])
    expect(csv.split('\n')).toEqual([
      'email,name,sources,tags,lastInteraction,notes',
      'a@example.com,"Ada, Countess",form|order,vip|wholesale,2026-01-02T00:00:00.000Z,"Said ""hello"""',
      'b@example.com,,,,,',
    ])
  })
})
