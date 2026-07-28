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
  hostCollectionKind,
  isHostCollectionKind,
  legacyCollectionKind,
} from './collection-kind'

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
    // Strict since AGL-979 — an unrecognized kind falls to the content
    // default, not to whatever the shape suggests.
    expect(hostCollectionKind({ kind: 'nonsense', mode: 'smart' })).toBe(
      'content',
    )
    expect(hostCollectionKind({ kind: 42 })).toBe('content')
  })

  // Strict since AGL-979: reads never infer from shape. Every live document
  // was backfilled, and a catalog-shaped doc with no `kind` is now content.
  it('does not infer from shape', () => {
    expect(hostCollectionKind({ name: 'Sale', slug: 's', mode: 'manual' })).toBe(
      'content',
    )
    expect(hostCollectionKind({ name: 'New', rules: [] })).toBe('content')
    expect(hostCollectionKind({ displayName: 'Blog', slug: 'blog' })).toBe(
      'content',
    )
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
      { kind: 'content', displayName: 'Blog' },
      { kind: 'catalog', name: 'Sale', mode: 'manual' },
      { kind: 'catalog', name: 'Featured' },
    ]
    expect(docs.filter(isHostCollectionKind('content'))).toEqual([
      { kind: 'content', displayName: 'Blog' },
    ])
    expect(docs.filter(isHostCollectionKind('catalog'))).toHaveLength(2)
  })
})

// The one place shape inference survives: bundles exported before AGL-954.
describe('legacyCollectionKind', () => {
  it('infers catalog from the membership keys', () => {
    expect(legacyCollectionKind({ name: 'Sale', mode: 'manual' })).toBe('catalog')
    expect(legacyCollectionKind({ name: 'New', rules: [] })).toBe('catalog')
    expect(legacyCollectionKind({ name: 'Picks', productIds: [] })).toBe('catalog')
  })

  it('infers content for everything else', () => {
    expect(legacyCollectionKind({ displayName: 'Blog', slug: 'blog' })).toBe(
      'content',
    )
    expect(legacyCollectionKind({})).toBe('content')
    expect(legacyCollectionKind(null)).toBe('content')
  })

  it('still prefers an explicit kind in the bundle', () => {
    expect(legacyCollectionKind({ kind: 'content', mode: 'manual' })).toBe(
      'content',
    )
  })
})
