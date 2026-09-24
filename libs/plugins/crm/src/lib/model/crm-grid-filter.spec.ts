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
 * The quick search every CRM list answers itself (AGL-3313, AGL-3315): any
 * word of a value, mid-string, case-insensitive, every word required.
 */

import { crmRowMatchesSearch } from './crm-grid-filter'

describe('crmRowMatchesSearch', () => {
  const deal = { title: 'Acme Coffee — annual renewal', tags: ['q4', 'Priority'] }

  it('finds a deal by a word from the middle of its title, whatever the case', () => {
    expect(crmRowMatchesSearch(deal, ['title'], ['RENEWAL'])).toBe(true)
    expect(crmRowMatchesSearch(deal, ['title'], ['newal'])).toBe(true)
    expect(crmRowMatchesSearch(deal, ['title'], ['acme', 'annual'])).toBe(true)
    expect(crmRowMatchesSearch(deal, ['title'], ['acme', 'globex'])).toBe(false)
  })

  it('matches every row on a blank search, and reads a list member by member', () => {
    expect(crmRowMatchesSearch(deal, ['title'], [])).toBe(true)
    expect(crmRowMatchesSearch(deal, ['title'], ['  '])).toBe(true)
    expect(crmRowMatchesSearch(deal, ['tags'], ['priority'])).toBe(true)
    expect(crmRowMatchesSearch({}, ['title'], ['acme'])).toBe(false)
  })
})
