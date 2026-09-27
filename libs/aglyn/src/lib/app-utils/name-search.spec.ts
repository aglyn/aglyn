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
  displayNameSearchFields,
  nameSearchFields,
  nameSearchNormalizers,
} from './name-search'

describe('displayNameSearchFields', () => {
  it('derives the same three keys nameSearchFields derives from a name', () => {
    const named = nameSearchFields('Acme  Coffee')
    expect(displayNameSearchFields('Acme  Coffee')).toEqual({
      nameLower: named.nameLower,
      nameTokens: named.nameTokens,
      nameReversed: named.nameReversed,
    })
    expect(displayNameSearchFields('Acme Coffee')).toEqual({
      nameLower: 'acme coffee',
      nameTokens: ['a', 'ac', 'acm', 'acme', 'c', 'co', 'cof', 'coff', 'coffe', 'coffee'],
      nameReversed: 'eeffoc emca',
    })
  })

  it('never returns displayName, so a nameless create does not gain an empty one', () => {
    expect(displayNameSearchFields('Home')).not.toHaveProperty('displayName')
  })

  it('stamps empty keys for a missing or non-string name, so orderBy(nameLower) keeps the document', () => {
    for (const missing of [undefined, null, 42, {}, '   ']) {
      expect(displayNameSearchFields(missing)).toEqual({
        nameLower: '',
        nameTokens: [],
        nameReversed: '',
      })
    }
  })

  it('asks what the writer stored: a typed search word is one of the stored tokens', () => {
    const { nameTokens, nameLower } = displayNameSearchFields('Spring Sale Landing')
    expect(nameTokens).toContain(nameSearchNormalizers.token('SALE'))
    expect(nameSearchNormalizers.key(' spring  SALE landing ')).toBe(nameLower)
  })
})
