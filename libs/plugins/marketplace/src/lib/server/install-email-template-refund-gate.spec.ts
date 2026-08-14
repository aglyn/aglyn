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
 * One of the six routes AGL-1546 never reached, driven end to end (AGL-1699).
 *
 * `purchase-entitlement.spec.ts` proves the predicate; this proves the WIRING
 * — that a refunded buyer is turned away at the route rather than by a helper
 * nobody calls. Email templates stand in for the other five: the gate is the
 * same shared call in all of them, and this one has the smallest mock surface.
 *
 * Deliberately NOT mocking `./purchase-entitlement` — it is the thing on
 * trial.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  createResourceUid: () => 'version-new',
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  resolveOrgPermissions: async () => ({
    orgId: 'buyer-org',
    permissions: { installPlugins: true },
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  TENANT_EMAIL_COLLECTION: 'emailTemplates',
  getTenantEmail: () => ({ plugin: 'Commerce', pluginId: null }),
  isTenantEmailEditable: () => true,
}))

jest.mock('./publisher-profile', () => ({
  canActAsPublisher: async () => false,
}))

jest.mock('./provenance', () => ({
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
    templateWrites: [] as Array<Record<string, unknown>>,
  }
  const versionDoc = {
    get: async () => ({
      exists: true,
      get: (field: string) =>
        ({
          nodes: { root: {} },
          rootId: 'root',
          emailTemplateKey: 'order-confirmation',
          subject: 'Thanks',
          preheader: '',
        })[field],
      data: () => ({ nodes: { root: {} }, rootId: 'root' }),
    }),
  }
  const templateRef = {
    collection: () => ({
      doc: () => ({
        set: async (data: Record<string, unknown>) => {
          state.templateWrites.push(data)
        },
      }),
    }),
    set: async (data: Record<string, unknown>) => {
      state.templateWrites.push(data)
    },
  }
  const hostRef = {
    get: async () => ({
      exists: true,
      get: (field: string) =>
        field === 'memberRoles'
          ? { 'buyer-1': 'admin' }
          : field === 'enabledPlugins'
            ? []
            : undefined,
    }),
    collection: () => ({ doc: () => templateRef }),
  }
  const listingRef = {
    get: async () => ({
      data: () => ({
        artifactType: 'emailTemplate',
        priceUsd: 100,
        profileId: 'seller-org',
        latestVersion: 1,
        emailTemplateKey: 'order-confirmation',
        displayName: 'Tidy receipt',
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
        const chain: any = {
          where: () => chain,
          limit: () => chain,
          get: async () => ({
            empty: state.purchases.length === 0,
            docs: state.purchases.map((purchase) => ({
              get: (field: string) => purchase[field],
              data: () => purchase,
            })),
          }),
        }
        return chain
      }
      return {
        doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
      }
    },
    batch: () => ({
      set: (_ref: unknown, data: Record<string, unknown>) => {
        state.templateWrites.push(data)
      },
      commit: async () => undefined,
    }),
  }
  return {
    __state: state,
    firebaseAdmin: {
      app: () => ({
        auth: () => ({ verifyIdToken: async () => ({ uid: 'buyer-1' }) }),
        firestore: () => firestore,
      }),
      firestore: { FieldValue: { serverTimestamp: () => 'NOW', increment: (by: number) => by } },
    },
  }
})

import { installEmailTemplateHandler } from './install-email-template'

const state = (
  jest.requireMock('@aglyn/tenant-data-admin') as {
    __state: {
      purchases: Array<Record<string, unknown>>
      templateWrites: Array<Record<string, unknown>>
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
  state.templateWrites.length = 0
})

describe('email-template install honours a refund (AGL-1699)', () => {
  it('402s when the only purchase was fully refunded', async () => {
    // Before AGL-1699 this route asked only whether a purchase doc existed,
    // so this exact case installed: buy, install, refund, keep.
    state.purchases.push({
      buyerUid: 'buyer-1',
      listingId: 'listing-1',
      refundedAt: 'THEN',
    })
    const res = makeRes()
    await installEmailTemplateHandler(makeReq(), res)
    expect(res.statusCode).toBe(402)
    expect(res.body).toMatchObject({ error: 'Purchase required' })
    expect(state.templateWrites).toHaveLength(0)
  })

  it('still installs for a buyer who was not refunded', async () => {
    state.purchases.push({ buyerUid: 'buyer-1', listingId: 'listing-1' })
    const res = makeRes()
    await installEmailTemplateHandler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(state.templateWrites.length).toBeGreaterThan(0)
  })

  it('still 402s when nothing was ever purchased', async () => {
    const res = makeRes()
    await installEmailTemplateHandler(makeReq(), res)
    expect(res.statusCode).toBe(402)
    expect(state.templateWrites).toHaveLength(0)
  })
})
