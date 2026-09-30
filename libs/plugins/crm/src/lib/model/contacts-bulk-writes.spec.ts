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
 * WHICH ROWS A BULK ACTION REACHES, AND WHAT IT SAYS ABOUT A ROW IT COULD
 * NOT (AGL-2603, AGL-2804).
 *
 * The properties a second copy of this would get wrong: a row with nothing
 * to change is left out silently and a row that cannot be reached is named;
 * and the tag cap is the record page's. Letting rows go is
 * `crm/contact-remove`'s (AGL-3338), and its spec is `contact-remove.spec.ts`.
 */

import {
  CONTACT_TAGS_CAP,
  normalizeBulkTag,
  planAddTag,
  planRemoveTag,
  planSetCompany,
} from './contacts-bulk-writes'

const rows = [
  { $id: 'c1', email: 'a@example.com', tags: ['vip'], visibleTo: ['host:h1'] },
  { $id: 'c2', email: 'b@example.com', tags: [], visibleTo: ['host:h1', 'host:h9'] },
]
const ids = (selection: { rows: Array<{ $id: string }> }) =>
  selection.rows.map((row) => row.$id)

describe('a tag, normalized the way the record page stores one', () => {
  it('lowercases and trims, and refuses a blank', () => {
    expect(normalizeBulkTag('  VIP ')).toBe('vip')
    expect(normalizeBulkTag('   ')).toBeNull()
  })
})

describe('adding a tag', () => {
  it('reaches every row that lacks it', () => {
    expect(ids(planAddTag(rows, 'wholesale'))).toEqual(['c1', 'c2'])
  })

  it('leaves a row that already carries the tag out, silently', () => {
    const selection = planAddTag(rows, 'vip')
    expect(ids(selection)).toEqual(['c2'])
    expect(selection.skipped).toEqual([])
  })

  it('names a row already at the record page’s cap rather than slipping past it', () => {
    const full = {
      $id: 'c3',
      email: 'full@example.com',
      tags: Array.from({ length: CONTACT_TAGS_CAP }, (_, i) => `t${i}`),
    }
    const selection = planAddTag([full], 'one-more')
    expect(selection.rows).toEqual([])
    expect(selection.skipped).toEqual([
      { email: 'full@example.com', reason: `already has ${CONTACT_TAGS_CAP} tags` },
    ])
  })
})

describe('removing a tag', () => {
  it('reaches the rows that carry it, and only those', () => {
    expect(ids(planRemoveTag(rows, 'vip'))).toEqual(['c1'])
  })
})

/**
 * Filing the selection under one company (AGL-2613): the rows whose link
 * would change, and a row whose link state the table could not project
 * named rather than guessed at.
 */
describe('setting the company', () => {
  const linked = [
    {
      $id: 'c1',
      email: 'a@example.com',
      companyLink: { companyId: null, companyIds: [], heldElsewhere: [] },
    },
    {
      $id: 'c2',
      email: 'b@example.com',
      companyLink: { companyId: 'c-acme', companyIds: ['c-acme'], heldElsewhere: [] },
    },
    {
      $id: 'c3',
      email: 'c@example.com',
      companyLink: { companyId: 'c-globex', companyIds: ['c-globex'], heldElsewhere: [] },
    },
  ]

  it('reaches the rows not already at the company', () => {
    const selection = planSetCompany(linked, 'c-acme')
    // c2 is already at Acme and is left out, silently.
    expect(ids(selection)).toEqual(['c1', 'c3'])
    expect(selection.skipped).toEqual([])
  })

  it('unlinks the rows that have a company, with an empty choice', () => {
    expect(ids(planSetCompany(linked, null))).toEqual(['c2', 'c3'])
  })

  it('names a row whose link state the table could not project, rather than guessing', () => {
    const selection = planSetCompany([{ $id: 'c9', email: 'z@example.com' }], 'c-acme')
    expect(selection.rows).toEqual([])
    expect(selection.skipped).toEqual([
      { email: 'z@example.com', reason: 'its company link could not be read' },
    ])
  })
})
