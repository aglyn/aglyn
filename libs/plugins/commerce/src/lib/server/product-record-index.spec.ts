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

/**
 * The commerce plugin's product and category indexes (AGL-3080): what another
 * plugin — an AI job, a composer — reads of a site's catalog. Live, named
 * records only, with the facts the module's docblock lists, and a
 * `truncated` that is a fact rather than a guess.
 */

type Doc = Record<string, unknown>
let mockDocs: Record<string, Doc> = {}

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => {
  const query = (prefix: string, max = Infinity): any => ({
    select: () => query(prefix, max),
    limit: (count: number) => query(prefix, count),
    get: async () => {
      const docs = Object.entries(mockDocs)
        .filter(([path]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
        .slice(0, max)
        .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data, get: (field: string) => data[field] }))
      return { docs, size: docs.length }
    },
  })
  const ref = (path: string): any => ({
    collection: (name: string) => ({ ...query(`${path}/${name}`), doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    get: async () => ({
      id: path.split('/').pop(),
      exists: path in mockDocs,
      data: () => mockDocs[path],
      get: (field: string) => mockDocs[path]?.[field],
    }),
  })
  return {
    firebaseAdmin: {
      app: () => ({ firestore: () => ({ collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }) }) }),
    },
  }
})

import { productCategoryRecordIndex, productRecordIndex } from './product-record-index'

beforeEach(() => {
  mockDocs = {
    'hosts/h1/products/lamp': {
      name: 'Desk lamp',
      type: 'physical',
      description: 'Brass.',
      tags: ['lighting', 3],
      categoryIds: ['c1'],
      options: [{ name: 'finish', values: ['Brass', 'Black'] }],
      mediaUrls: ['media://lamp.jpg'],
      seo: { title: 'Lamp', description: 'A lamp' },
    },
    'hosts/h1/products/gone': { name: 'Old', deletedAt: 123 },
    'hosts/h1/products/unnamed': { name: '' },
    'hosts/h1/productCategories/c1': { name: 'Lighting' },
    'hosts/h1/productCategories/c2': { name: '' },
  }
})

describe('the product index', () => {
  it('reads one live product with the facts it documents', async () => {
    await expect(productRecordIndex.get({ hostId: 'h1', id: 'lamp' })).resolves.toEqual({
      id: 'lamp',
      name: 'Desk lamp',
      facts: {
        type: 'physical',
        description: 'Brass.',
        tags: ['lighting'],
        categoryIds: ['c1'],
        options: [{ name: 'finish', values: ['Brass', 'Black'] }],
        imageUrl: 'media://lamp.jpg',
        seoTitle: 'Lamp',
        seoDescription: 'A lamp',
      },
    })
  })

  it('answers nothing for a deleted, an unnamed or a missing product, or with no site', async () => {
    await expect(productRecordIndex.get({ hostId: 'h1', id: 'gone' })).resolves.toBeNull()
    await expect(productRecordIndex.get({ hostId: 'h1', id: 'unnamed' })).resolves.toBeNull()
    await expect(productRecordIndex.get({ hostId: 'h1', id: 'nope' })).resolves.toBeNull()
    await expect(productRecordIndex.get({ orgId: 'o1', id: 'lamp' })).resolves.toBeNull()
  })

  it('lists live, named products only, and says when the site holds more', async () => {
    const all = await productRecordIndex.list({ hostId: 'h1', limit: 10 })
    expect(all.records.map((record) => record.id)).toEqual(['lamp'])
    expect(all.truncated).toBe(false)
    const one = await productRecordIndex.list({ hostId: 'h1', limit: 1 })
    expect(one.truncated).toBe(true)
  })
})

describe('the category index', () => {
  it('lists named categories, and reads one by id', async () => {
    const { records } = await productCategoryRecordIndex.list({ hostId: 'h1', limit: 10 })
    expect(records).toEqual([{ id: 'c1', name: 'Lighting', facts: {} }])
    await expect(productCategoryRecordIndex.get({ hostId: 'h1', id: 'c1' })).resolves.toEqual({
      id: 'c1',
      name: 'Lighting',
      facts: {},
    })
    await expect(productCategoryRecordIndex.get({ hostId: 'h1', id: 'c2' })).resolves.toBeNull()
  })
})
