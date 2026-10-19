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
  exactDomainFromQuery,
  isOfferedName,
  labelFromQuery,
  MAX_CANDIDATES,
  searchCandidates,
} from './search-candidates'

describe('search candidates (AGL-3962)', () => {
  it('turns a business name into one label', () => {
    expect(labelFromQuery("Joe's Plumbing & Heating")).toBe('joesplumbingandheating')
    expect(labelFromQuery('Café Brûlée')).toBe('cafebrulee')
    expect(labelFromQuery('!')).toBe('')
  })

  it('asks about a typed hostname exactly, first', () => {
    expect(exactDomainFromQuery('https://www.TestBakery.com/menu')).toBe('testbakery.com')
    const names = searchCandidates('testbakery.shop')
    expect(names[0]).toBe('testbakery.shop')
    expect(names).toContain('testbakery.com')
  })

  it('offers only one-label names under the endings we sell', () => {
    expect(isOfferedName('testbakery.com')).toBe(true)
    expect(isOfferedName('shop.testbakery.com')).toBe(false)
    expect(isOfferedName('testbakery.us')).toBe(false)
    expect(searchCandidates('testbakery.us')).not.toContain('testbakery.us')
  })

  it('tries .com variations and stays within one registrar call', () => {
    const names = searchCandidates('Test Bakery')
    expect(names).toEqual(expect.arrayContaining(['testbakery.com', 'gettestbakery.com', 'testbakeryco.com']))
    expect(names.length).toBeLessThanOrEqual(MAX_CANDIDATES)
    expect(new Set(names).size).toBe(names.length)
  })
})
