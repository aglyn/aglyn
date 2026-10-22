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
 * The staff overview route (AGL-135/238): who reaches it, and that what it
 * says about an org names the org (AGL-2501).
 *
 * The marketplace's purchase feed and its refund-reversal recovery queue
 * (AGL-2309) used to ride this route. They are the marketplace's collection,
 * so since AGL-3080 its own staff route serves them and its widget draws them
 * in the page's `staffOverview` zone — with this file's queue assertions, in
 * `libs/plugins/marketplace/src/lib/server/admin-overview.spec.ts`. The double
 * below REFUSES a read of `marketplacePurchases`, so the route reaching back
 * for them fails here.
 */

const mockVerifyIdToken = jest.fn()

const state: {
  /**
   * Orgs, and each one's monthly usage rollup by month key.
   *
   * Seeded because two of the route's answers are ABOUT an org rather than
   * merely keyed on one: the recovery queue names the seller, and the anomaly
   * detector names the workspace that spiked. Neither can be checked against
   * an empty orgs collection.
   */
  orgs: Record<
    string,
    { data: Record<string, unknown>; usage?: Record<string, Record<string, unknown>> }
  >
  /** The Users list's directory size, as `countUsersAcrossPools` reports it. */
  users: number
} = { orgs: {}, users: 0 }

const stamp = (millis: number) => ({ toMillis: () => millis })

/**
 * A listing over `state.orgs`, including each org's `usage/{month}` docs.
 *
 * The usage docs answer through `get(field)`, the way an Admin SDK snapshot
 * does, and a month that was never seeded reports `exists: false` — which is
 * what makes "no prior month, so no spike" a case the detector really sees
 * rather than one the double smooths over.
 */
const orgListing = (): any => ({
  orderBy: () => orgListing(),
  limit: () => orgListing(),
  where: () => orgListing(),
  select: () => orgListing(),
  count: () => ({
    get: async () => ({ data: () => ({ count: Object.keys(state.orgs).length }) }),
  }),
  get: async () => {
    const docs = Object.entries(state.orgs).map(([id, org]) => ({
      id,
      data: () => org.data,
      get: (field: string) => org.data[field],
      ref: {
        collection: () => ({
          doc: (month: string) => ({
            get: async () => {
              const held = org.usage?.[month]
              return {
                exists: Boolean(held),
                data: () => held ?? {},
                get: (field: string) => held?.[field],
              }
            },
          }),
        }),
      },
    }))
    return { docs, size: docs.length, empty: docs.length === 0 }
  },
  doc: () => ({
    get: async () => ({ exists: false, data: () => ({}), get: () => undefined }),
    collection: () => emptyListing(),
  }),
})

/** A listing over nothing, for the collections this file does not seed. */
const emptyListing = (): any => ({
  orderBy: () => emptyListing(),
  limit: () => emptyListing(),
  where: () => emptyListing(),
  select: () => emptyListing(),
  count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
  get: async () => ({ docs: [], size: 0, empty: true }),
  doc: () => ({
    get: async () => ({ exists: false, data: () => ({}), get: () => undefined }),
    collection: () => emptyListing(),
  }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  countUsersAcrossPools: async () => ({ count: state.users, truncated: false }),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'marketplacePurchases') {
            throw new Error('the staff overview read the marketplace’s purchases')
          }
          if (name === 'orgs') return orgListing()
          return emptyListing()
        },
        collectionGroup: () => emptyListing(),
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

// The REAL revenue and cost helpers are spread in — stubbing them would make
// this file assert that a mock agreed with itself about MRR.
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/org-billing-doc'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { GET } from '../app/api/admin/overview/route'
import { previousMonth } from '../utils/billing-month'

const overview = (token = 'staff-token') =>
  GET(
    new Request('https://console.aglyn.com/api/admin/overview', {
      headers: { authorization: `Bearer ${token}` },
    }),
  )

beforeEach(() => {
  state.orgs = {}
  state.users = 0
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
})

describe('only staff reach the overview', () => {
  it('401s without a bearer token', async () => {
    const response = await GET(
      new Request('https://console.aglyn.com/api/admin/overview'),
    )
    expect(response.status).toBe(401)
  })

  it('403s a signed-in customer — platform metrics are not a customer fact', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
    expect((await overview()).status).toBe(403)
  })
})

/**
 * THE ORG BEHIND THE ID (AGL-2501).
 *
 * A staff reader recognizes a customer by name, never by a document id. The
 * anomaly detector's answer is ABOUT an org rather than merely keyed on one:
 * it names the workspace that spiked.
 *
 * The anomaly case is also a regression guard on a live fault. `orgLabel` is
 * a `const` arrow, and the anomaly list is built eagerly ABOVE where it used
 * to be declared — a temporal dead zone, so the call threw
 * `ReferenceError: Cannot access 'orgLabel' before initialization`. It threw
 * only on a row that actually spiked, because the call sits inside the
 * ternary's consequent, so the whole staff overview would have started
 * returning 500 on the first abuse alert and never before it.
 */
describe('the overview names the org, not its document id', () => {
  /** The rollup keys the route reads: last calendar month and the one before. */
  const month = previousMonth()
  const [year, monthPart] = month.split('-').map(Number)
  const prior = new Date(Date.UTC(year, monthPart - 2, 1))
  const priorMonth = `${prior.getUTCFullYear()}-${String(
    prior.getUTCMonth() + 1,
  ).padStart(2, '0')}`

  it('THE CONTROL: the two rollup keys are different months', () => {
    // A prior key equal to the current one would let one seeded document
    // satisfy both sides of the ratio, and the spike below would be an
    // artifact of the fixture rather than of the detector.
    expect(priorMonth).not.toBe(month)
  })

  it('answers with a NAMED anomaly instead of throwing on the first spike', async () => {
    state.orgs = {
      'org-runaway': {
        data: { name: 'Globex Shop', plan: 'free' },
        usage: {
          // 100 -> 5,000 page views is the >=10x the detector looks for, and
          // 100 clears its noise floor.
          [priorMonth]: { month: priorMonth, pageViews: 100 },
          [month]: { month, pageViews: 5000 },
        },
      },
    }

    const response = await overview()
    // A 200 is half the assertion. Before the label map was lifted above its
    // callers this threw, the handler's catch turned it into a 500, and the
    // whole staff overview went dark at exactly the moment an abuse alert
    // was the thing somebody needed to read.
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.anomalies).toHaveLength(1)
    expect(body.anomalies[0].orgId).toBe('org-runaway')
    expect(body.anomalies[0].orgLabel).toBe('Globex Shop')
    expect(body.anomalies[0].spikes[0]).toContain('page views')
  })

  it('THE CONTROL: a workspace that did not spike is not reported', async () => {
    // Otherwise the test above is satisfied by a detector that flags every
    // org it reads, and "named the workspace that spiked" would be a claim
    // about a list that means nothing.
    state.orgs = {
      'org-steady': {
        data: { name: 'Steady Co', plan: 'free' },
        usage: {
          [priorMonth]: { month: priorMonth, pageViews: 100 },
          [month]: { month, pageViews: 140 },
        },
      },
    }
    const body = await (await overview()).json()
    expect(body.anomalies).toEqual([])
  })
})

describe('the overview reads nothing of the marketplace’s', () => {
  it('answers without touching the purchases, and without their fields', async () => {
    const response = await overview()
    // The double throws on a `marketplacePurchases` read, which the handler
    // would turn into a 500.
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).not.toHaveProperty('purchases')
    expect(body).not.toHaveProperty('reversalRecovery')
    expect(body.metrics).not.toHaveProperty('reversalOwedCents')
  })
})

describe('the overview counts users and labels plans', () => {
  it('reports the directory total as metrics.users', async () => {
    state.users = 41
    const body = await (await overview()).json()
    expect(body.metrics.users).toBe(41)
    expect(body.metrics.usersTruncated).toBe(false)
  })

  it('labels an org that never stored a plan as free, not "no plan"', async () => {
    state.orgs = {
      'org-blank': { data: { name: 'Blank Co' } },
      'org-pro': { data: { name: 'Pro Co', plan: 'pro' } },
    }
    const body = await (await overview()).json()
    const plans = Object.fromEntries(
      body.newestOrgs.map((org: any) => [org.$id, org.plan]),
    )
    expect(plans['org-blank']).toBe('free')
    expect(plans['org-pro']).not.toBeNull()
  })
})
