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
 * The component-allowance gate on marketplace component install (AGL-2072,
 * a count since AGL-3615).
 *
 * `/api/hosts/resources` counts a doc created in `hosts/{hostId}/components`
 * against `componentsPerHost` — Free 1, every paid plan unlimited — because
 * a reusable component RENDERS ON THE LIVE SITE and so the gate has to be
 * server-enforced rather than hidden in the console (AGL-473). This route
 * wrote the equivalent document and asked nothing, so a free org installed
 * any number of marketplace components its own console would have refused.
 *
 * `checkQuota` is the REAL one against the REAL plan table — a fake
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
    /** How many components the site already holds, for the count. */
    held: 0,
    /** How many of those are deleted: a tombstone keeps its document. */
    deleted: 0,
  }
  const componentsCollection = {
    // The allowance reads `deletedAt` and counts the live ones (AGL-3615).
    select: () => ({
      get: async () => ({
        docs: Array.from({ length: state.held }, (_, index) => ({
          get: () => (index < state.deleted ? { seconds: 1 } : undefined),
        })),
      }),
    }),
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
      held: number
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
  state.held = 0
  state.deleted = 0
})

describe('marketplace component install meets the component allowance (AGL-2072, AGL-3615)', () => {
  /*
   * THE DEFECT AGL-2072 closed: this wrote the component and returned 200
   * whatever the plan said. Since AGL-3615 the plan's answer is a count —
   * Free 1 — so a Free site holding its one component is refused the next.
   */
  it('refuses a FREE site that already holds its one component, and writes nothing', async () => {
    state.org = { id: 'buyer-org', plan: 'free' }
    state.held = 1
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('Your plan includes 1 reusable component — upgrade in Billing for more')
    expect(state.componentWrites).toHaveLength(0)
  })

  it('installs on a FREE site whose one component was deleted, counting live ones only', async () => {
    state.org = { id: 'buyer-org', plan: 'free' }
    state.held = 1
    state.deleted = 1
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(state.componentWrites).toHaveLength(1)
  })

  it('installs on a FREE site with none, as its one component', async () => {
    state.org = { id: 'buyer-org', plan: 'free' }
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(200)
    expect(state.componentWrites).toHaveLength(1)
  })

  /**
   * The gate is RE-ASKED per install, never inherited from the plan that was
   * in force when an earlier copy was installed: `resolveEffectivePlan`
   * collapses a dead subscription to free, and the whole org doc is read so
   * the status is actually there to see.
   */
  it('counts a LAPSED paid org as Free, whose stale `plan` field still says starter', async () => {
    state.org = {
      id: 'buyer-org',
      plan: 'starter',
      subscription: { status: 'canceled' },
    }
    state.held = 1
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
  it('counts an org the host index cannot resolve as Free', async () => {
    state.org = undefined as any
    state.held = 1
    const res = makeRes()

    await installHandler(makeReq(), res)

    expect(res.statusCode).toBe(403)
    expect(state.componentWrites).toHaveLength(0)
  })

  /** And the entitled path still installs — the assertion above is live. */
  it('installs for a STARTER org beside any number held, its allowance unlimited', async () => {
    state.held = 200
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
  it('installs for a free org staff granted the feature, which lifts the count', async () => {
    state.held = 40
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
