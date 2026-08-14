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
 * The paid-install purchase gate (AGL-46, refund-aware per AGL-1546): a
 * webhook-written purchase record is the buyer's entitlement, and a FULLY
 * refunded one must stop counting — before AGL-1546 a refunded buyer kept
 * paid-install access forever.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  createResourceUid: () => 'component-new',
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'buyer-org',
    permissions: { installPlugins: true },
  }),
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => false,
}))

jest.mock('./provenance', () => ({
  hasDivergedFromBase: async () => false,
  recordInstallProvenance: async () => ({
    installedFrom: { sha256: 'sha' },
    baseStored: true,
  }),
}))

jest.mock('./version-stats', () => ({
  recordVersionMove: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => {
  const state = {
    purchases: [] as Array<Record<string, unknown>>,
    componentWrites: [] as Array<Record<string, unknown>>,
  }
  const componentsCollection = {
    where: () => ({
      limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
    }),
    doc: () => ({
      set: async (data: Record<string, unknown>) => {
        state.componentWrites.push(data)
      },
    }),
  }
  const hostRef = {
    get: async () => ({
      exists: true,
      get: (field: string) =>
        field === 'memberRoles' ? { 'buyer-1': 'admin' } : undefined,
    }),
    collection: () => componentsCollection,
  }
  const versionDoc = {
    get: async () => ({ data: () => ({ nodes: { root: {} }, rootId: 'root' }) }),
  }
  const listingRef = {
    get: async () => ({
      data: () => ({
        priceUsd: 100,
        profileId: 'seller-org',
        latestVersion: 1,
        displayName: 'Fancy hero',
      }),
    }),
    collection: () => ({ doc: () => versionDoc }),
    update: async () => undefined,
  }
  const firestore = {
    collection: (name: string) => {
      if (name === 'hosts') return { doc: () => hostRef }
      if (name === 'marketplaceListings') return { doc: () => listingRef }
      if (name === 'marketplacePurchases') {
        return {
          where: () => ({
            where: () => ({
              limit: () => ({
                get: async () => {
                  const docs = state.purchases.map((purchase) => ({
                    get: (field: string) => purchase[field],
                    data: () => purchase,
                  }))
                  return { empty: docs.length === 0, docs }
                },
              }),
            }),
          }),
        }
      }
      return {
        doc: () => ({
          get: async () => ({ exists: false, data: () => undefined }),
        }),
      }
    },
  }
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'buyer-1' }) }),
        firestore: () => firestore,
      }),
      firestore: {
        FieldValue: {
          serverTimestamp: () => 'NOW',
          increment: (by: number) => by,
        },
      },
    },
  }
})

import { installHandler } from './install'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: {
      purchases: Array<Record<string, unknown>>
      componentWrites: Array<Record<string, unknown>>
    }
  }
).__state

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: unknown) {
      res.body = payload
      return res
    },
  }
  return res
}

const makeReq = () =>
  ({
    method: 'POST',
    headers: { authorization: 'Bearer token' },
    body: { listingId: 'listing-1', hostId: 'host-1' },
  }) as any

beforeEach(() => {
  state.purchases.length = 0
  state.componentWrites.length = 0
})

describe('paid install gate (AGL-46/1546)', () => {
  it('402s with no purchase record at all', async () => {
    const res = makeRes()
    await installHandler(makeReq(), res)
    expect(res.statusCode).toBe(402)
    expect(state.componentWrites).toHaveLength(0)
  })

  it('402s when the only purchase was FULLY refunded', async () => {
    state.purchases.push({
      buyerUid: 'buyer-1',
      listingId: 'listing-1',
      refundedAt: 'THEN',
    })
    const res = makeRes()
    await installHandler(makeReq(), res)
    expect(res.statusCode).toBe(402)
    expect(state.componentWrites).toHaveLength(0)
  })

  it('installs when a live purchase exists — even beside a refunded one', async () => {
    state.purchases.push(
      { buyerUid: 'buyer-1', listingId: 'listing-1', refundedAt: 'THEN' },
      { buyerUid: 'buyer-1', listingId: 'listing-1' },
    )
    const res = makeRes()
    await installHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(state.componentWrites).toHaveLength(1)
  })
})
