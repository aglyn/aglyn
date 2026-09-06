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

import { duplicateNameKey, likelyDuplicateReasons } from './contact-duplicates'

/**
 * The likely-duplicate rule (AGL-2625): a shared name AND a shared phone or
 * company, read through the viewing group's facet and never another's.
 */

const G = 'h1'
const current = {
  id: 'c-1',
  doc: {
    email: 'jane@acme.com',
    name: 'Jane Doe',
    facets: { [G]: { sources: {}, interactions: [], phone: '+15125550100', companyId: 'co-1' } },
    companyIds: ['co-1'],
  },
}

const candidate = (doc: Record<string, unknown>, id = 'c-2') => ({ id, doc })

describe('likelyDuplicateReasons', () => {
  it('matches a same-named record on the phone, on the company, or on both', () => {
    expect(
      likelyDuplicateReasons(
        current,
        candidate({
          email: 'jane@gmail.com',
          name: 'jane  doe',
          facets: { [G]: { sources: {}, interactions: [], phone: '+15125550100' } },
        }),
        G,
      ),
    ).toEqual(['phone'])
    expect(
      likelyDuplicateReasons(
        current,
        candidate({ email: 'j@x.com', name: 'Jane Doe', companyIds: ['co-1'] }),
        G,
      ),
    ).toEqual(['company'])
    expect(
      likelyDuplicateReasons(
        current,
        candidate({
          email: 'j@x.com',
          name: 'Jane Doe',
          phone: '+15125550100',
          facets: { [G]: { sources: {}, interactions: [], companyId: 'co-1' } },
        }),
        G,
      ),
    ).toEqual(['phone', 'company'])
  })

  it('matches a company by the typed name when nothing is linked', () => {
    const typed = {
      id: 'c-1',
      doc: {
        name: 'Sam Lee',
        facets: { [G]: { sources: {}, interactions: [], companyName: 'Acme Coffee' } },
      },
    }
    expect(
      likelyDuplicateReasons(
        typed,
        candidate({ name: 'Sam Lee', companyName: 'acme coffee' }),
        G,
      ),
    ).toEqual(['company'])
  })

  it('never matches on a name alone, a phone alone, or the record itself', () => {
    expect(likelyDuplicateReasons(current, candidate({ name: 'Jane Doe' }), G)).toEqual([])
    expect(
      likelyDuplicateReasons(
        current,
        candidate({ name: 'Sam Lee', phone: '+15125550100', companyIds: ['co-1'] }),
        G,
      ),
    ).toEqual([])
    expect(likelyDuplicateReasons(current, candidate(current.doc, 'c-1'), G)).toEqual([])
  })

  it('reads another holder’s phone and company as nothing', () => {
    expect(
      likelyDuplicateReasons(
        current,
        candidate({
          name: 'Jane Doe',
          facets: { other: { sources: {}, interactions: [], phone: '+15125550100', companyId: 'co-1' } },
        }),
        G,
      ),
    ).toEqual([])
  })

  it('compares on this holder’s own name for the person before the canonical one', () => {
    expect(
      duplicateNameKey({ name: 'J Doe', facets: { [G]: { name: 'Jane Doe' } } }, G),
    ).toBe('jane doe')
    expect(duplicateNameKey({ name: 'J Doe' }, G)).toBe('j doe')
  })
})
