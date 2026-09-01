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
 * The saved-form catalog is an abuse ceiling, refused at the create.
 *
 * Three claims, and the second two are the ones worth having:
 *
 *  1. the ceiling is the SAME on every plan that can build forms — Starter and
 *     Enterprise are refused at the identical count — and the route reads the
 *     resolved entitlement, so a per-org override still lands;
 *  2. a site holding more forms than the ceiling keeps every one of them,
 *     editable and readable. Nothing is deleted, hidden or archived by a
 *     ceiling, including for a customer who moved to a cheaper plan;
 *  3. and those forms keep collecting. Submissions are metered revenue on
 *     their own band, so a catalog ceiling that reached them would refuse the
 *     customer's leads and our billing in the same request.
 *
 * The REAL `checkQuota` / `checkEntitlement` and the REAL `PLAN_ENTITLEMENTS`
 * are wired in on purpose. A double that stubbed the policy module would make
 * every limit read zero, and a suite can then go green having proved that the
 * platform refuses everybody — which is why every refusal below is paired
 * with the acceptance one form under it.
 */

const mockVerifyIdToken = jest.fn()
const mockCreate = jest.fn()

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  /** Form definitions as the SERVER sees them, never as a client claims. */
  forms: Array<Record<string, unknown>>
} = { memberRoles: {}, org: {}, forms: [] }

const snapshotOf = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
})

const formsCollection = () => ({
  count: () => ({
    get: async () => ({ data: () => ({ count: state.forms.length }) }),
  }),
  doc: () => ({ create: (...args: unknown[]) => mockCreate(...args) }),
})

/**
 * A faithful-enough `runTransaction`: reads must precede writes, and a
 * buffered write only lands on a successful commit. Contention is not modeled
 * — `host-resource-cap-is-atomic.spec.ts` owns that question.
 */
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
            collection: () => formsCollection(),
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
  // The REAL policy. Stubbing it is how a clamp passes having refused
  // everything: a mocked module answers 0 for every ceiling, so "the 51st is
  // refused" goes green on a platform that also refuses the 1st.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  // The REAL node codec (AGL-1151). The route under test compresses any
  // `nodes` it writes, and this factory is a CLOSED WORLD — an absent export
  // throws inside the route and its own catch answers 500, which reads
  // exactly like the behaviour under test regressing.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/stored-nodes'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FORMS_PER_HOST_CEILING, PLAN_ENTITLEMENTS } from '@aglyn/aglyn'
import { FORMS_MAX_PER_HOST } from '@aglyn/aglyn/app-utils/forms'
import { POST } from '../app/api/hosts/resources/route'

const createForm = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        hostId: 'host-1',
        resource: 'form',
        data: { displayName: 'Contact us', slug: 'contact-us', fields: [] },
        ...body,
      }),
    }),
  )

/** `n` form definitions the server would count. */
const savedForms = (n: number) =>
  Array.from({ length: n }, (_, index) => ({ displayName: `form ${index}` }))

describe('the catalog ceiling does not vary by plan', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    state.org = { plan: 'starter', subscription: { status: 'active' } }
    state.forms = []
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('creates the last form the ceiling covers', async () => {
    state.forms = savedForms(FORMS_PER_HOST_CEILING - 1)
    expect((await createForm()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses the next one, quoting the number', async () => {
    state.forms = savedForms(FORMS_PER_HOST_CEILING)
    const response = await createForm()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain(String(FORMS_PER_HOST_CEILING))
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('answers the same for every plan that has forms, in BOTH directions', async () => {
    /*
     * The row that makes the refusal above mean something, and the one that
     * catches a policy module reading 0 for every ceiling: each plan is walked
     * through the real route twice, once one form under the ceiling and once
     * at it, and both verdicts are asserted. A suite that passed by refusing
     * everybody fails on the first acceptance.
     */
    const plansWithForms = (
      Object.keys(PLAN_ENTITLEMENTS) as Array<keyof typeof PLAN_ENTITLEMENTS>
    ).filter((plan) => PLAN_ENTITLEMENTS[plan].features?.reusableComponents)
    expect(plansWithForms.length).toBeGreaterThan(5)

    for (const plan of plansWithForms) {
      state.org = { plan, subscription: { status: 'active' } }

      jest.clearAllMocks()
      state.forms = savedForms(FORMS_PER_HOST_CEILING - 1)
      expect([plan, (await createForm()).status]).toEqual([plan, 200])
      expect([plan, mockCreate.mock.calls.length]).toEqual([plan, 1])

      jest.clearAllMocks()
      state.forms = savedForms(FORMS_PER_HOST_CEILING)
      expect([plan, (await createForm()).status]).toEqual([plan, 403])
      expect([plan, mockCreate.mock.calls.length]).toEqual([plan, 0])
    }
  })

  it('refuses Enterprise at the identical count, because a ceiling is not a tier', async () => {
    // The most expensive plan we sell is uncapped on the dimensions it buys.
    // This is not one of them: an unbounded catalog is a storage vector at any
    // price. A deal that needs more takes a per-org override.
    expect(PLAN_ENTITLEMENTS.enterprise.formsPerHost).toBe(FORMS_PER_HOST_CEILING)
    state.org = { plan: 'enterprise', subscription: { status: 'active' } }
    state.forms = savedForms(FORMS_PER_HOST_CEILING)
    expect((await createForm()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('honors a per-org override above the ceiling', async () => {
    // The route reads the RESOLVED entitlement, not the constant — which is
    // the whole reason the ceiling rides an entitlement key at all.
    state.org = {
      plan: 'starter',
      subscription: { status: 'active' },
      entitlements: { formsPerHost: FORMS_PER_HOST_CEILING + 100 },
    }
    state.forms = savedForms(FORMS_PER_HOST_CEILING)
    expect((await createForm()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses Free on the entitlement, before the number is reached', async () => {
    // Free carries no `reusableComponents`, so the form entity is refused as a
    // feature rather than as a count — and the message says so, which is the
    // difference between "upgrade for more" and "this is not on your plan".
    state.org = { plan: 'free' }
    state.forms = []
    const response = await createForm()
    expect(response.status).toBe(403)
    // The wording, not merely the status. Free's count is also 0, so a route
    // that lost the entitlement gate would refuse with the same code and a
    // capacity message — telling a customer to upgrade for "more" of a thing
    // they have never had one of.
    expect((await response.json()).error).toContain('not included in your plan')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('cannot be talked out of the count by anything in the body', async () => {
    state.forms = savedForms(FORMS_PER_HOST_CEILING)
    const response = await createForm({
      count: 0,
      used: 0,
      data: { displayName: 'x', slug: 'x', fields: [], count: 0 },
    })
    expect(response.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does not read the listing bound as the ceiling', async () => {
    // `FORMS_MAX_PER_HOST` pages a read; it is not what a site may hold. A
    // route that used it would admit a site far past its ceiling.
    expect(FORMS_MAX_PER_HOST).toBeGreaterThan(FORMS_PER_HOST_CEILING)
    state.forms = savedForms(FORMS_MAX_PER_HOST - 1)
    expect((await createForm()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('a ceiling reached takes nothing away', () => {
  /**
   * More forms than the ceiling allows. A site reaches this by having the
   * number lowered under a catalog already built — a per-org override
   * withdrawn, or the platform ceiling itself coming down.
   *
   * The rule under test is the capacity rule, not a data migration: a limit
   * binds the ALLOCATION of the next form and never access to the ones held.
   * Refusing at use time would delete a customer's intake and their leads
   * with it.
   */
  const HELD = FORMS_PER_HOST_CEILING + 30

  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    state.org = { plan: 'starter', subscription: { status: 'active' } }
    state.forms = savedForms(HELD)
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('refuses the next form and deletes none of the ones held', async () => {
    expect((await createForm()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
    // The collection is untouched. This route has no delete path at all, and
    // the refusal is the whole of what a ceiling does.
    expect(state.forms).toHaveLength(HELD)
  })

  it('is refused for CAPACITY, not for the feature', async () => {
    // The two refusals are different products. "Not included in your plan"
    // sends a paying customer to a feature comparison for something they can
    // already do hundreds of; the capacity message names the number.
    const error = (await (await createForm()).json()).error
    expect(error).toContain(String(FORMS_PER_HOST_CEILING))
    expect(error).not.toContain('not included')
  })

  it('leaves submissions on a different route and a different band', () => {
    /*
     * The load-bearing separation, checked at the source because the two
     * routes are in different apps and the failure is a route learning about
     * the wrong number. A submit path that consulted the catalog ceiling
     * would refuse a visitor on a site that has done nothing wrong — and
     * refuse the metered revenue that submission represents.
     */
    const submitRoute = readFileSync(
      join(__dirname, '..', '..', 'tenant', 'app', 'api', 'forms', 'submit', 'route.ts'),
      'utf8',
    )
    // Matched as a CALL. A bare substring stays satisfied by a renamed
    // identifier that no longer resolves to anything.
    expect(submitRoute).toMatch(/checkFormSubmissionQuota\(/)
    expect(submitRoute).not.toContain('formsPerHost')
    expect(submitRoute).not.toContain('FORMS_MAX_PER_HOST')
  })

  it('is not published as a per-plan number on the plan cards', () => {
    /*
     * The plan cards exist to be COMPARED. A ceiling identical on all eight
     * would render as eight matching cells and send a buyer hunting for a
     * difference that is not there, so the cards carry the submissions band —
     * genuinely tiered, genuinely charged — and not this. The ceiling is
     * published against the site's own count on the usage meters, where it is
     * a fact rather than an implied comparison.
     *
     * Checked at the source: a rendered card cannot say which of two keys
     * produced a number once both are on screen.
     */
    const cards = readFileSync(
      join(
        __dirname,
        '..',
        'components',
        'billing',
        'billing-plan-cards.component.tsx',
      ),
      'utf8',
    )
    expect(cards).not.toContain('formsPerHost')
    expect(cards).toMatch(
      /quotaCount\(entitlements\.formSubmissionsPerMonth\)[^`]{0,40}form submissions/,
    )

    // The odometer keeps it, against a real count. Dropping it from the cards
    // must not have dropped it from the product.
    const meters = readFileSync(
      join(__dirname, '..', 'components', 'billing', 'billing-usage.component.tsx'),
      'utf8',
    )
    expect(meters).toMatch(/limit=\{entitlements\.formsPerHost\}/)
  })
})
