/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
 *
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
 * The reusable-component catalog is a per-plan allowance, refused at the
 * create (AGL-3615).
 *
 *  1. Free saves ONE component per site and is refused the second for
 *     capacity — "upgrade for more" — never as a feature the plan lacks: the
 *     create is no longer behind `reusableComponents`;
 *  2. a deleted component frees its slot. Deleting stamps `deletedAt` and
 *     keeps the document, so the route counts the LIVE ones;
 *  3. every paid plan's allowance is unlimited, as it was when components
 *     were only a feature, and an unlimited allowance reads nothing to count;
 *  4. a site holding more than its plan now includes keeps every component,
 *     and only the next create is refused.
 *
 * The REAL `checkQuota` and the REAL `PLAN_ENTITLEMENTS` are wired in on
 * purpose, and every refusal is paired with the acceptance one under it.
 */

const mockVerifyIdToken = jest.fn()
const mockCreate = jest.fn()
const mockCountReads = jest.fn()

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  /** Component definitions as the SERVER sees them, never as a client claims. */
  components: Array<Record<string, unknown>>
} = { memberRoles: {}, org: {}, components: [] }

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

const componentsCollection = () => ({
  // The live count reads a `deletedAt` projection, as the flat-cap branch does.
  select: () => ({
    get: async () => {
      mockCountReads()
      return { docs: state.components.map((row) => snapshotOf(row)) }
    },
  }),
  count: () => ({
    get: async () => {
      mockCountReads()
      return { data: () => ({ count: state.components.length }) }
    },
  }),
  doc: () => ({ create: (...args: unknown[]) => mockCreate(...args) }),
})

/** Reads before writes; a buffered write lands only on commit. */
const runTransaction = async (body: (tx: any) => Promise<any>) => {
  const buffered: Array<() => unknown> = []
  const tx = {
    get: (query: any) => {
      if (buffered.length) {
        throw new Error('Firestore transactions cannot read after a write')
      }
      return query.get()
    },
    create: (ref: any, data: unknown) => {
      buffered.push(() => ref.create(data))
    },
  }
  const result = await body(tx)
  for (const write of buffered) write()
  return result
}

jest.mock('next/server', () => ({
  after: (work: () => unknown) => work(),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) => runTransaction(body),
        collection: () => ({
          doc: () => ({
            get: async () => snapshotOf({ memberRoles: state.memberRoles }),
            collection: () => componentsCollection(),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ org: state.org }),
  logHostActivity: async () => undefined,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getLockdownVerdict: async () => null,
  lockdownJsonResponse: (verdict: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...verdict }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL policy: a stubbed one answers 0 for every allowance, and "the
  // second is refused" goes green on a platform that refuses the first too.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/site-interactions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  newFormListFields: jest.requireActual('../../../libs/aglyn/src/lib/app-utils/forms')
    .newFormListFields,
  createResourceUid: () => 'generated-id',
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { PLAN_ENTITLEMENTS, UNLIMITED } from '@aglyn/aglyn'
import { POST } from '../app/api/hosts/resources/route'

const createComponent = () =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        hostId: 'host-1',
        resource: 'reusableComponent',
        data: {
          displayName: 'Hero',
          rootId: 'root',
          nodes: { root: { $id: 'root', componentId: 'div', nodes: [] } },
        },
      }),
    }),
  )

/** `n` live component definitions the server would count. */
const held = (n: number) => Array.from({ length: n }, (_, index) => ({ displayName: `c${index}` }))

beforeEach(() => {
  jest.clearAllMocks()
  state.memberRoles = { 'user-1': 'admin' }
  state.org = { plan: 'free' }
  state.components = []
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('Free saves one reusable component per site', () => {
  it('creates the first, though Free has no `reusableComponents` feature', async () => {
    expect(PLAN_ENTITLEMENTS.free.features?.reusableComponents).toBeFalsy()
    expect(PLAN_ENTITLEMENTS.free.componentsPerHost).toBe(1)
    expect((await createComponent()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses the second for CAPACITY, with the upgrade path', async () => {
    state.components = held(1)
    const response = await createComponent()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(
      'Your plan includes 1 reusable component — upgrade in Billing for more',
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('counts live components only, so deleting one frees its slot', async () => {
    // Both live shapes: a route-made component has no `deletedAt`, a
    // marketplace copy carries an explicit `null`.
    state.components = [{ displayName: 'Old', deletedAt: { seconds: 1 } }]
    expect((await createComponent()).status).toBe(200)

    jest.clearAllMocks()
    state.components = [{ displayName: 'Old', deletedAt: { seconds: 1 } }, { displayName: 'Bought', deletedAt: null }]
    expect((await createComponent()).status).toBe(403)
  })

  it('honors a per-org override, and the feature flag granted by override', async () => {
    state.components = held(3)
    state.org = { plan: 'free', entitlements: { componentsPerHost: 4 } }
    expect((await createComponent()).status).toBe(200)

    jest.clearAllMocks()
    state.org = { plan: 'free', entitlements: { features: { reusableComponents: true } } }
    expect((await createComponent()).status).toBe(200)
  })
})

describe('every paid plan keeps unlimited components', () => {
  it('admits a create beside any number held, reading nothing to count', async () => {
    const paid = (Object.keys(PLAN_ENTITLEMENTS) as Array<keyof typeof PLAN_ENTITLEMENTS>).filter(
      (plan) => plan !== 'free',
    )
    for (const plan of paid) {
      expect([plan, PLAN_ENTITLEMENTS[plan].componentsPerHost]).toEqual([plan, UNLIMITED])
      jest.clearAllMocks()
      state.org = { plan, subscription: { status: 'active' } }
      state.components = held(250)
      expect([plan, (await createComponent()).status]).toEqual([plan, 200])
      expect([plan, mockCountReads.mock.calls.length]).toEqual([plan, 0])
    }
  })
})

describe('an allowance reached takes nothing away', () => {
  it('refuses only the next create on a downgraded site, and removes none held', async () => {
    // A Pro site with 40 components that lapsed to Free keeps all 40.
    state.org = { plan: 'pro', subscription: { status: 'canceled' } }
    state.components = held(40)
    expect((await createComponent()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(state.components).toHaveLength(40)
  })
})
