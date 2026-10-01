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
 * A site's products, as this plugin finds them for another plugin's picker
 * (AGL-3080): a search over ACTIVE products by the first word typed, ordered
 * by name — none with nothing typed or at the organization — each read with
 * its price and its priced variants.
 */

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  documentId: () => '__name__',
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  limit: (count: number) => ({ limit: count }),
  query: (base: { path: string }, ...constraints: unknown[]) => ({ path: base.path, constraints }),
}))

import { pluginRecordListSource } from '@aglyn/aglyn/plugin-manager/plugin-record-lists'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import type { Firestore } from 'firebase/firestore'
import { productRecordListSource, registerCommerceRecordLists } from './commerce-record-lists'

const DB = {} as Firestore

beforeEach(() => resetPluginServicesForTests())

describe('the product list source', () => {
  it('is published under this plugin', () => {
    registerCommerceRecordLists()
    expect(pluginRecordListSource('product')?.pluginId).toBe('commerce')
  })

  it('searches active products by the first word typed, ordered by name', () => {
    expect(productRecordListSource.query(DB, { hostId: 'h1', search: 'Desk lamp', limit: 8 })).toEqual({
      path: 'hosts/h1/products',
      constraints: [
        { where: ['status', '==', 'active'] },
        { where: ['nameTokens', 'array-contains', 'desk'] },
        { orderBy: 'nameLower' },
        { limit: 8 },
      ],
    })
  })

  it('finds nothing with nothing typed, at the organization, or for a listing', () => {
    expect(productRecordListSource.query(DB, { hostId: 'h1', search: '  ', limit: 8 })).toBeNull()
    expect(productRecordListSource.query(DB, { hostId: null, search: 'lamp', limit: 8 })).toBeNull()
    expect(productRecordListSource.query(DB, { hostId: 'h1', search: 'lamp', installedFrom: 'lst-1', limit: 8 })).toBeNull()
  })

  it('reads a product with its price and priced variants', () => {
    const record = productRecordListSource.record('lamp', {
      name: 'Desk lamp',
      priceUsd: 40,
      variants: [{ id: 'v1', options: { finish: 'Brass' }, priceUsd: 42 }],
    })
    expect(record?.name).toBe('Desk lamp')
    expect(record?.facts).toMatchObject({
      priceUsd: 40,
      variants: [{ id: 'v1', options: { finish: 'Brass' }, priceUsd: 42 }],
    })
  })
})
