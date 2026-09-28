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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import {
  type QueryFakeFirestore,
  queryFakeFirestore,
} from '@aglyn/tenant-data-admin/server/test-firestore-queries'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'

/**
 * A smart collection's membership lives on its products (AGL-3321), so a rule
 * change must move every product it now does or does not match — past any
 * window, idempotently, in bounded passes — and a deleted collection must come
 * off every product. Driven through the real pass over a query-faithful fake.
 */

let fake: QueryFakeFirestore
let mockDecoded: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => fake,
      auth: () => ({ verifyIdToken: async () => mockDecoded }),
    }),
    firestore: { FieldPath, FieldValue },
  },
}))

import {
  collectionMembershipHandler,
  MEMBERSHIP_SCAN_MAX,
  restampCollectionMembership,
} from './collection-membership'

const HOST = 'hosts/h1'

function seedProduct(id: string, data: Record<string, unknown>) {
  fake.seed(`${HOST}/products/${id}`, {
    type: 'physical',
    status: 'active',
    deletedAt: null,
    variants: [{ id: 'v', priceUsd: 10 }],
    ...data,
  })
}

const membership = (id: string) => fake.read(`${HOST}/products/${id}`)?.['collectionIds']

beforeEach(() => {
  fake = queryFakeFirestore()
  fake.seed(HOST, { memberRoles: { editor: 'editor', viewer: 'viewer' } })
  fake.seed(`${HOST}/collections/walnut`, {
    kind: 'catalog',
    mode: 'smart',
    name: 'Walnut',
    slug: 'walnut',
    rules: [{ field: 'name', op: 'contains', value: 'walnut' }],
  })
})

describe('restampCollectionMembership', () => {
  it('adds the collection to every product its rules match, and to no other', async () => {
    seedProduct('a', { name: 'Walnut Chair' })
    seedProduct('b', { name: 'Oak Chair', collectionIds: ['walnut', 'other'] })
    seedProduct('c', { name: 'Walnut Desk', collectionIds: ['other'] })
    const pass = await restampCollectionMembership(fake as never, 'h1', 'walnut')
    expect(pass).toMatchObject({ done: true, scanned: 3, updated: 3 })
    expect(membership('a')).toEqual(['walnut'])
    expect(membership('b')).toEqual(['other'])
    expect(membership('c')).toEqual(['other', 'walnut'])
  })

  it('writes nothing the second time', async () => {
    seedProduct('a', { name: 'Walnut Chair' })
    await restampCollectionMembership(fake as never, 'h1', 'walnut')
    fake.resetWrites()
    const again = await restampCollectionMembership(fake as never, 'h1', 'walnut')
    expect(again.updated).toBe(0)
    expect(fake.writes()).toBe(0)
  })

  it('walks a large catalog in bounded passes that finish it', async () => {
    for (let index = 0; index < MEMBERSHIP_SCAN_MAX + 5; index += 1) {
      seedProduct(`p${String(index).padStart(5, '0')}`, { name: `Plain ${index}` })
    }
    seedProduct('zz', { name: 'Walnut Last' })
    const first = await restampCollectionMembership(fake as never, 'h1', 'walnut')
    expect(first.done).toBe(false)
    expect(membership('zz')).toBeUndefined()
    const second = await restampCollectionMembership(fake as never, 'h1', 'walnut', first.after)
    expect(second.done).toBe(true)
    expect(membership('zz')).toEqual(['walnut'])
  })

  it('takes a deleted or manual collection off every product', async () => {
    seedProduct('a', { name: 'Walnut Chair', collectionIds: ['walnut', 'other'] })
    seedProduct('b', { name: 'Oak', collectionIds: ['walnut'] })
    fake.seed(`${HOST}/collections/walnut`, { kind: 'catalog', mode: 'manual', productIds: [] })
    const pass = await restampCollectionMembership(fake as never, 'h1', 'walnut')
    expect(pass.done).toBe(true)
    expect(membership('a')).toEqual(['other'])
    expect(membership('b')).toEqual([])
  })
})

describe('the route', () => {
  const call = async (body: Record<string, unknown>) => {
    let status = 0
    let payload: any
    const res = {
      status(code: number) {
        status = code
        return this
      },
      json(value: unknown) {
        payload = value
        return this
      },
    } as unknown as PluginApiResponse
    await collectionMembershipHandler(
      { method: 'POST', headers: { authorization: 'Bearer t' }, body } as unknown as PluginApiRequest,
      res,
    )
    return { status, payload }
  }

  it('lets a collection editor re-stamp, and refuses a viewer before any write', async () => {
    seedProduct('a', { name: 'Walnut Chair' })
    mockDecoded = { uid: 'viewer' }
    expect((await call({ hostId: 'h1', collectionId: 'walnut' })).status).toBe(403)
    expect(membership('a')).toBeUndefined()
    mockDecoded = { uid: 'editor' }
    const ok = await call({ hostId: 'h1', collectionId: 'walnut' })
    expect(ok).toMatchObject({ status: 200, payload: { done: true, updated: 1 } })
    expect(membership('a')).toEqual(['walnut'])
  })
})
