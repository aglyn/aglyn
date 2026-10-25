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

import { SITE_KINDS, siteKind, siteKindFor } from './site-kinds'

describe('site kinds (AGL-4049)', () => {
  it('lists the 21 kinds, every id once', () => {
    const ids = SITE_KINDS.map((kind) => kind.id)
    expect(ids).toHaveLength(21)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe('business')
  })

  it('carries no look, design or page guidance: those are the AI start\'s', () => {
    for (const kind of SITE_KINDS) {
      expect(Object.keys(kind).sort()).toEqual(['blurb', 'hints', 'icon', 'id', 'keywords', 'label', 'starter'])
    }
  })

  it('reads a kind by id, and nothing else', () => {
    expect(siteKind('trades')?.label).toBe('Home services & trades')
    expect(siteKind('nope')).toBeNull()
    expect(siteKind('')).toBeNull()
    expect(siteKind(7)).toBeNull()
  })

  it('classifies an answer as the AI start always has', () => {
    expect(siteKindFor('roofer').id).toBe('trades')
    expect(siteKindFor('a neighborhood book club').id).toBe('nonprofit')
    expect(siteKindFor('wedding photographer').id).toBe('photography')
    expect(siteKindFor('a bookstore with author events').id).toBe('store')
    expect(siteKindFor('a club', 'golf players').id).toBe('fitness')
    expect(siteKindFor('').id).toBe('business')
  })
})
