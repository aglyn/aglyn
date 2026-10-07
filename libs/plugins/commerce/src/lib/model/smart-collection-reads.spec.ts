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
 * The console's smart-collection reads and the native app's copy (AGL-3621)
 * ask Firestore the same question and stamp the same membership, so a
 * product saved on a phone lands in the collections the console would put
 * it in.
 */

import * as Console from '../components/console/smart-collections'
import * as App from './smart-collection-reads'

const mockQueries: unknown[] = []

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  getDocs: async (q: unknown) => {
    mockQueries.push(q)
    const rows: Record<string, Record<string, unknown>> = {
      sale: { rules: [{ field: 'tag', op: 'eq', value: 'sale' }], matchAll: true },
      empty: {},
    }
    return {
      docs: Object.entries(rows).map(([id, data]) => ({ id, get: (key: string) => data[key] })),
    }
  },
}))

const firestore = {} as never

describe('smart-collection reads, console and app', () => {
  beforeEach(() => {
    mockQueries.length = 0
  })

  it('reads the same smart collections with the same query', async () => {
    const consoleRules = await Console.readSmartCollections(firestore, 'host-1')
    const appRules = await App.readSmartCollections(firestore, 'host-1')
    expect(appRules).toEqual(consoleRules)
    expect(mockQueries[1]).toEqual(mockQueries[0])
    expect(mockQueries[0]).toEqual({
      ref: { path: 'hosts/host-1/collections' },
      constraints: [
        { field: 'kind', op: '==', value: 'catalog' },
        { field: 'mode', op: '==', value: 'smart' },
      ],
    })
  })

  it('stamps the same membership, read or handed', async () => {
    const product = { name: 'Mug', tags: ['sale'], categories: [], variants: [] } as never
    const consoleFields = await Console.productCollectionFields(firestore, 'host-1', product)
    const appFields = await App.productCollectionFields(firestore, 'host-1', product)
    expect(appFields).toEqual(consoleFields)
    expect(appFields).toEqual({ collectionIds: ['sale'] })
    const rules = await App.readSmartCollections(firestore, 'host-1')
    expect(await App.productCollectionFields(firestore, 'host-1', product, rules)).toEqual(
      await Console.productCollectionFields(firestore, 'host-1', product, rules),
    )
  })
})
