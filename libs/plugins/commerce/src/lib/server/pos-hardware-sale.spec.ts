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
 * @jest-environment node
 */

/**
 * Selling a card reader in person at the platform's own store's register
 * (AGL-4038), driven through the real route with Firestore faked:
 *
 * - `status` says whether a store is the configured hardware seller, and on
 *   every other store says no and nothing else.
 */

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import { resetFakeFirestore } from '../testing/fake-firestore'

let mockManagePos = true
/** Which workspace owns each store. */
const mockOwners: Record<string, string> = { 'host-seller': 'org-seller', 'host-other': 'org-other' }

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({ permissions: { managePos: mockManagePos } }),
}))
jest.mock('@aglyn/tenant-data-admin', () => {
  const fake = jest.requireActual('../testing/fake-firestore')
  return {
    firebaseAdmin: {
      app: () => ({
        auth: () => ({
          verifyIdToken: async (token: string) => {
            if (token !== 'cashier') throw Object.assign(new Error('expired'), { code: 'auth/id-token-expired' })
            return { uid: 'cashier-1', email_verified: true }
          },
        }),
        firestore: () => fake.fakeFirestore,
      }),
      firestore: { FieldValue: fake.fakeFieldValue },
    },
    getOrgForHost: async (hostId: string) => ({
      orgId: mockOwners[hostId],
      org: { id: mockOwners[hostId], plan: 'business', subscriptionStatus: 'active' },
    }),
  }
})

import { fakeDocs } from '../testing/fake-firestore'
import { POS_HARDWARE_ENV, POS_HARDWARE_SKUS } from '../model/pos-hardware'
import { posHardwareSaleHandler } from './pos-hardware-sale'

const ENV_KEYS = [POS_HARDWARE_ENV.inPersonEnabled, POS_HARDWARE_ENV.sellerHostId, POS_HARDWARE_ENV.sellerOrgId]

function turnOn(overrides: Partial<Record<string, string>> = {}) {
  process.env[POS_HARDWARE_ENV.inPersonEnabled] = 'true'
  process.env[POS_HARDWARE_ENV.sellerHostId] = 'host-seller'
  process.env[POS_HARDWARE_ENV.sellerOrgId] = 'org-seller'
  Object.assign(process.env, overrides)
}

function response() {
  const result = { status: 0, body: undefined as any }
  const res = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

async function sale(body: Record<string, unknown>, options: { token?: string; key?: string } = {}) {
  const { res, result } = response()
  const req = {
    method: 'POST',
    query: {},
    body: { hostId: 'host-seller', ...body },
    headers: {
      authorization: `Bearer ${options.token ?? 'cashier'}`,
      ...(options.key ? { 'idempotency-key': options.key } : {}),
    },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
  await posHardwareSaleHandler(req, res)
  return result
}

beforeEach(() => {
  resetFakeFirestore()
  mockManagePos = true
  for (const key of ENV_KEYS) delete process.env[key]
  fakeDocs.set('hosts/host-seller', { name: 'Aglyn store' })
  fakeDocs.set('hosts/host-other', { name: 'Another store' })
})

afterAll(() => {
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('status: is this store the platform’s hardware seller', () => {
  it('answers yes, with every hardware item, only on the configured store of the configured workspace', async () => {
    turnOn()
    const result = await sale({ action: 'status' })
    expect(result.status).toBe(200)
    expect(result.body.seller).toBe(true)
    expect(result.body.items.map((item: any) => item.sku)).toEqual(POS_HARDWARE_SKUS.map((sku) => sku.id))
    expect(result.body.items[0]).toEqual({ sku: 'stripe-reader-s710', name: 'Stripe Reader S710', kind: 'reader' })
  })

  it('says no, and nothing else, on any other store or while the sale is off', async () => {
    turnOn()
    expect((await sale({ action: 'status', hostId: 'host-other' })).body).toEqual({ seller: false })
    // The store named, but now in another workspace: not the seller.
    turnOn({ [POS_HARDWARE_ENV.sellerOrgId]: 'org-elsewhere' })
    expect((await sale({ action: 'status' })).body).toEqual({ seller: false })
    for (const key of ENV_KEYS) delete process.env[key]
    expect((await sale({ action: 'status' })).body).toEqual({ seller: false })
  })

  it('is gated like the register', async () => {
    turnOn()
    expect((await sale({ action: 'status' }, { token: 'nobody' })).status).toBe(401)
    mockManagePos = false
    expect((await sale({ action: 'status' })).status).toBe(403)
    expect((await sale({ action: 'bogus' })).status).toBe(403)
    mockManagePos = true
    expect((await sale({ action: 'bogus' })).status).toBe(400)
  })
})
