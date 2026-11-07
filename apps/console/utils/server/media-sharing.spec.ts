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
 *
 * @jest-environment node
 */

import { mediaSharingChoiceFrom, mediaSharingChoiceFromScope, mediaSharingFields } from './media-sharing'

describe('mediaSharingChoiceFrom (AGL-4047)', () => {
  it('reads each choice off the wire', () => {
    expect(mediaSharingChoiceFrom({ mode: 'all' })).toEqual({ mode: 'all' })
    expect(mediaSharingChoiceFrom({ mode: 'selected', hostIds: ['a'] })).toEqual({ mode: 'selected', hostIds: ['a'] })
    expect(mediaSharingChoiceFrom({ mode: 'allExcept', exceptHostIds: ['b'] })).toEqual({
      mode: 'allExcept',
      exceptHostIds: ['b'],
    })
  })

  it.each([
    ['nothing', undefined],
    ['an unknown mode', { mode: 'none' }],
    ['ids that are not a list', { mode: 'selected', hostIds: 'a' }],
    ['an id that is a token', { mode: 'allExcept', exceptHostIds: ['host:a'] }],
    ['an id that is a path', { mode: 'selected', hostIds: ['a/b'] }],
    ['an id that is not a string', { mode: 'allExcept', exceptHostIds: [1] }],
    ['too many ids', { mode: 'selected', hostIds: Array.from({ length: 1001 }, (_, i) => `s${i}`) }],
  ])('refuses %s', (_name, value) => {
    expect(mediaSharingChoiceFrom(value)).toBeNull()
  })
})

describe('mediaSharingChoiceFromScope: an older client’s set-scope', () => {
  it('reads All sites and chosen sites', () => {
    expect(mediaSharingChoiceFromScope(['org'])).toEqual({ mode: 'all' })
    expect(mediaSharingChoiceFromScope(['org', 'host:a'])).toEqual({ mode: 'all' })
    expect(mediaSharingChoiceFromScope(['host:a', 'host:b'])).toEqual({ mode: 'selected', hostIds: ['a', 'b'] })
  })

  it('refuses a scope that cannot be stored', () => {
    expect(mediaSharingChoiceFromScope([])).toBeNull()
    expect(mediaSharingChoiceFromScope('org')).toBeNull()
    expect(mediaSharingChoiceFromScope(['nonsense'])).toBeNull()
  })
})

describe('mediaSharingFields', () => {
  it('drops a chosen site the workspace doesn’t hold, never storing it', () => {
    expect(mediaSharingFields({ mode: 'selected', hostIds: ['a', 'gone'] }, ['a', 'b']).fields).toEqual({
      visibleTo: ['host:a'],
      scopeMode: null,
      scopeExcept: null,
    })
  })

  it('refuses chosen sites that are all gone', () => {
    expect(mediaSharingFields({ mode: 'selected', hostIds: ['gone'] }, ['a']).problem).toMatch(/at least one site/i)
  })

  it('marks all sites except some', () => {
    expect(mediaSharingFields({ mode: 'allExcept', exceptHostIds: ['b'] }, ['a', 'b', 'c']).fields).toEqual({
      visibleTo: ['host:a', 'host:c'],
      scopeMode: 'allExcept',
      scopeExcept: ['host:b'],
    })
  })
})
