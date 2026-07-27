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
  findCollectionSlugOwner,
  isCollectionSlugTaken,
} from './collection-slug'

const existing = [
  { $id: 'c1', displayName: 'Blog', slug: 'blog' },
  { $id: 'c2', displayName: 'News', slug: 'news' },
  { $id: 'k1', name: 'Sale', slug: 'sale', mode: 'manual' },
]

describe('findCollectionSlugOwner', () => {
  it('finds the collection already using a slug', () => {
    expect(findCollectionSlugOwner('blog', 'content', existing)).toBe('c1')
    expect(findCollectionSlugOwner('sale', 'catalog', existing)).toBe('k1')
  })

  it('returns null when the slug is free', () => {
    expect(findCollectionSlugOwner('projects', 'content', existing)).toBeNull()
  })

  // Content serves /{slug} and catalog serves /collections/{slug}, so the two
  // namespaces are independent.
  it('scopes uniqueness to the kind', () => {
    expect(findCollectionSlugOwner('blog', 'catalog', existing)).toBeNull()
    expect(findCollectionSlugOwner('sale', 'content', existing)).toBeNull()
  })

  it('ignores the collection being edited, so a rename can keep its slug', () => {
    expect(findCollectionSlugOwner('blog', 'content', existing, 'c1')).toBeNull()
    expect(findCollectionSlugOwner('blog', 'content', existing, 'c2')).toBe('c1')
  })

  it('compares case- and space-insensitively', () => {
    expect(findCollectionSlugOwner('  BLOG ', 'content', existing)).toBe('c1')
  })

  it('treats an empty slug as free rather than colliding with everything', () => {
    expect(findCollectionSlugOwner('', 'content', existing)).toBeNull()
    expect(findCollectionSlugOwner('   ', 'content', existing)).toBeNull()
  })

  it('tolerates a missing list', () => {
    expect(findCollectionSlugOwner('blog', 'content', null)).toBeNull()
    expect(isCollectionSlugTaken('blog', 'content', undefined)).toBe(false)
  })
})
