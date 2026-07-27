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

import { hostCollectionKind, isHostCollectionKind } from './collection-kind'

describe('hostCollectionKind', () => {
  it('trusts an explicit kind', () => {
    expect(hostCollectionKind({ kind: 'catalog', displayName: 'Blog' })).toBe(
      'catalog',
    )
    expect(
      hostCollectionKind({ kind: 'content', mode: 'manual', name: 'Sale' }),
    ).toBe('content')
  })

  it('ignores a kind that is not one of the two', () => {
    expect(hostCollectionKind({ kind: 'nonsense', mode: 'smart' })).toBe(
      'catalog',
    )
    expect(hostCollectionKind({ kind: 42 })).toBe('content')
  })

  // Legacy documents (pre-AGL-954) carry no `kind`, so shape decides.
  it('reads legacy catalog collections from their membership keys', () => {
    expect(hostCollectionKind({ name: 'Sale', slug: 's', mode: 'manual' })).toBe(
      'catalog',
    )
    expect(hostCollectionKind({ name: 'New', rules: [] })).toBe('catalog')
    expect(hostCollectionKind({ name: 'Picks', productIds: [] })).toBe('catalog')
  })

  it('reads legacy content collections, including bare ones', () => {
    expect(
      hostCollectionKind({ displayName: 'Blog', slug: 'blog' }),
    ).toBe('content')
    expect(hostCollectionKind({})).toBe('content')
  })

  // Ambiguity resolves to content: content is the kind that owns `entries`,
  // and misreading it as catalog is what exposes those entries to a delete.
  it('defaults missing data to content', () => {
    expect(hostCollectionKind(null)).toBe('content')
    expect(hostCollectionKind(undefined)).toBe('content')
  })

  it('filters a mixed list', () => {
    const docs = [
      { displayName: 'Blog' },
      { name: 'Sale', mode: 'manual' },
      { kind: 'catalog', name: 'Featured' },
    ]
    expect(docs.filter(isHostCollectionKind('content'))).toEqual([
      { displayName: 'Blog' },
    ])
    expect(docs.filter(isHostCollectionKind('catalog'))).toHaveLength(2)
  })
})
