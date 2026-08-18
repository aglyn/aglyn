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
 * The `reusableComponents` gate on marketplace component install (AGL-2072).
 *
 * `/api/hosts/resources` declares that creating a doc in
 * `hosts/{hostId}/components` requires the `reusableComponents` entitlement,
 * because a reusable component RENDERS ON THE LIVE SITE and so the Starter+
 * gate has to be server-enforced rather than hidden in the console (AGL-473).
 * This route wrote the equivalent document and asked nothing, so a free org
 * installed any marketplace component and got the working feature its own
 * console would have refused.
 *
 * `checkEntitlement` is the REAL one against the REAL plan table — a fake
 * returning a boolean would only prove that this file's own stub agrees with
 * itself, and the whole defect was an assumption about what the table says.
 * The listing is FREE here (`priceUsd: 0`), which is the population the gap
 * actually served: a free org never reaches the purchase gate at all.
 */

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
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
    /** Whatever `getOrgForHost` should answer for this test. */
    org: { id: 'buyer-org', plan: 'starter' } as Record<string, unknown>,
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
        // FREE listing: the purchase gate is not what is under test, and a
        // free org installing a free component is exactly the shape that
        // reached the missing check.
        priceUsd: 0,
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
      return {
        doc: () => ({
          get: async () => ({ exists: false, data: () => undefined }),
        }),
      }
    },
  }
  return {
    __state: state,
    getOrgForHost: async () => ({ orgId: 'buyer-org', org: state.org }),
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
      org: Record<string, unknown>
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
  state.componentWrites.length = 0
  state.org = { id: 'buyer-org', plan: 'starter' }
})

describe('marketplace component install honours reusableComponents (AGL-2072)', () => {
  /** THE DEFECT: this wrote the component and returned 200. */
  it('refuses a FREE org and writes nothing', async () => {
    state.org = { id: 'buyer-org', plan: 'free' }
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(403)
    expect(String(res.body.error)).toMatch(/Starter plan or higher/)
    expect(state.componentWrites).toHaveLength(0)
  })

  /**
   * The gate is RE-ASKED per install, never inherited from the plan that was
   * in force when an earlier copy was installed: `resolveEffectivePlan`
   * collapses a dead subscription to free, and the whole org doc is read so
   * the status is actually there to see.
   */
  it('refuses a LAPSED paid org, whose stale `plan` field still says starter', async () => {
    state.org = {
      id: 'buyer-org',
      plan: 'starter',
      subscription: { status: 'canceled' },
    }
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(403)
    expect(state.componentWrites).toHaveLength(0)
  })

  /**
   * An org with no doc at all resolves as free, not as unmetered — the
   * fail-CLOSED direction, and the same one every other entitlement door
   * takes.
   */
  it('refuses an org the host index cannot resolve', async () => {
    state.org = undefined as any
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(403)
    expect(state.componentWrites).toHaveLength(0)
  })

  /** And the entitled path still installs — the assertion above is live. */
  it('installs for a STARTER org, the lowest plan that includes the feature', async () => {
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(state.componentWrites).toHaveLength(1)
    expect(state.componentWrites[0].displayName).toBe('Fancy hero')
  })

  it('installs for a BUSINESS org', async () => {
    state.org = { id: 'buyer-org', plan: 'business' }
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(state.componentWrites).toHaveLength(1)
  })

  /**
   * A per-org feature override is the supported way staff comp this, and it
   * has to keep working — the gate must read the RESOLVED entitlement, not
   * the plan name.
   */
  it('installs for a free org staff granted the feature', async () => {
    state.org = {
      id: 'buyer-org',
      plan: 'free',
      entitlements: { features: { reusableComponents: true } },
    }
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(state.componentWrites).toHaveLength(1)
  })
})
