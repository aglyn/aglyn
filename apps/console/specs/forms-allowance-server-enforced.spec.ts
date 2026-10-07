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
 * The saved-form catalog is a per-plan allowance, refused at the create.
 *
 * Three claims, and the second two are the ones worth having:
 *
 *  1. each plan is refused at its own rung — Free 1, Starter 5, Pro 25,
 *     Business 100, `FORMS_PER_HOST_CEILING` above (AGL-3597) — and the route
 *     reads the resolved entitlement, so a per-org override still lands. Free
 *     is refused on the count, never on a feature: the saved form is not
 *     behind `reusableComponents`;
 *  2. a site holding more forms than its allowance keeps every one of them,
 *     editable and readable. Nothing is deleted, hidden or archived by an
 *     allowance, including for a customer who moved to a cheaper plan;
 *  3. and those forms keep collecting. Submissions are metered revenue on
 *     their own band, so a catalog allowance that reached them would refuse
 *     the customer's leads and our billing in the same request.
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
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/site-interactions'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/organizations'),
  // The REAL fields a new form is written with for its list (AGL-3330).
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

describe('each plan is refused at its own rung', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    state.org = { plan: 'starter', subscription: { status: 'active' } }
    state.forms = []
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('creates the last form Starter covers', async () => {
    state.forms = savedForms(PLAN_ENTITLEMENTS.starter.formsPerHost - 1)
    expect((await createForm()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses the next one, quoting the number and the upgrade path', async () => {
    state.forms = savedForms(PLAN_ENTITLEMENTS.starter.formsPerHost)
    const response = await createForm()
    expect(response.status).toBe(403)
    const error = (await response.json()).error
    expect(error).toContain(`includes ${PLAN_ENTITLEMENTS.starter.formsPerHost} forms`)
    expect(error).toContain('upgrade in Billing')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('answers every plan at its own rung, in BOTH directions', async () => {
    /*
     * The row that makes the refusal above mean something, and the one that
     * catches a policy module reading 0 for every allowance: each plan is
     * walked through the real route twice, once one form under its rung and
     * once at it, and both verdicts are asserted.
     */
    const plans = Object.keys(PLAN_ENTITLEMENTS) as Array<keyof typeof PLAN_ENTITLEMENTS>
    expect(
      Object.fromEntries(plans.map((plan) => [plan, PLAN_ENTITLEMENTS[plan].formsPerHost])),
    ).toEqual({
      free: 1,
      starter: 5,
      pro: 25,
      business: 100,
      scale: FORMS_PER_HOST_CEILING,
      advanced: FORMS_PER_HOST_CEILING,
      agency: FORMS_PER_HOST_CEILING,
      enterprise: FORMS_PER_HOST_CEILING,
    })

    for (const plan of plans) {
      const rung = PLAN_ENTITLEMENTS[plan].formsPerHost
      state.org = plan === 'free' ? { plan } : { plan, subscription: { status: 'active' } }

      jest.clearAllMocks()
      state.forms = savedForms(rung - 1)
      expect([plan, (await createForm()).status]).toEqual([plan, 200])
      expect([plan, mockCreate.mock.calls.length]).toEqual([plan, 1])

      jest.clearAllMocks()
      state.forms = savedForms(rung)
      expect([plan, (await createForm()).status]).toEqual([plan, 403])
      expect([plan, mockCreate.mock.calls.length]).toEqual([plan, 0])
    }
  })

  it('caps Enterprise too, because an unbounded catalog is a storage vector', async () => {
    expect(PLAN_ENTITLEMENTS.enterprise.formsPerHost).toBe(FORMS_PER_HOST_CEILING)
    state.org = { plan: 'enterprise', subscription: { status: 'active' } }
    state.forms = savedForms(FORMS_PER_HOST_CEILING)
    expect((await createForm()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('honors a per-org override above the plan', async () => {
    // The route reads the RESOLVED entitlement, not the constant — which is
    // the whole reason the allowance rides an entitlement key at all.
    state.org = {
      plan: 'starter',
      subscription: { status: 'active' },
      entitlements: { formsPerHost: FORMS_PER_HOST_CEILING + 100 },
    }
    state.forms = savedForms(FORMS_PER_HOST_CEILING)
    expect((await createForm()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('saves Free its one form, though Free has no reusable components', async () => {
    // The saved form left the component feature (AGL-3597): Free's first form
    // is created, and the second is refused for CAPACITY — "upgrade for more"
    // — never as a feature the plan lacks.
    expect(PLAN_ENTITLEMENTS.free.features?.reusableComponents).toBeFalsy()
    state.org = { plan: 'free' }
    state.forms = []
    expect((await createForm()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)

    jest.clearAllMocks()
    state.forms = savedForms(1)
    const response = await createForm()
    expect(response.status).toBe(403)
    const error = (await response.json()).error
    expect(error).toContain('includes 1 form —')
    expect(error).not.toContain('not included in your plan')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('cannot be talked out of the count by anything in the body', async () => {
    state.forms = savedForms(PLAN_ENTITLEMENTS.starter.formsPerHost)
    const response = await createForm({
      count: 0,
      used: 0,
      data: { displayName: 'x', slug: 'x', fields: [], count: 0 },
    })
    expect(response.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('does not read the listing bound as the allowance', async () => {
    // `FORMS_MAX_PER_HOST` pages a read; it is not what a site may hold. A
    // route that used it would admit a site far past its allowance.
    expect(FORMS_MAX_PER_HOST).toBeGreaterThan(FORMS_PER_HOST_CEILING)
    state.forms = savedForms(FORMS_MAX_PER_HOST - 1)
    expect((await createForm()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('an allowance reached takes nothing away', () => {
  /**
   * More forms than the plan allows. A site reaches this by moving to a
   * cheaper plan under a catalog already built (an Advanced site with 30
   * forms moving to Starter's 5), or by a per-org override withdrawn.
   *
   * The rule under test is the capacity rule, not a data migration: a limit
   * binds the ALLOCATION of the next form and never access to the ones held.
   * Refusing at use time would delete a customer's intake and their leads
   * with it.
   */
  const HELD = 30

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
    // already do several of; the capacity message names the number.
    const error = (await (await createForm()).json()).error
    expect(error).toContain(String(PLAN_ENTITLEMENTS.starter.formsPerHost))
    expect(error).not.toContain('not included')
  })

  it('leaves submissions on a different route and a different band', () => {
    /*
     * The load-bearing separation, checked at the source because the two
     * routes are in different packages and the failure is a route learning about
     * the wrong number. A submit path that consulted the catalog ceiling
     * would refuse a visitor on a site that has done nothing wrong — and
     * refuse the metered revenue that submission represents.
     */
    const submitRoute = readFileSync(
      join(__dirname, '..', '..', '..', 'libs', 'plugins', 'forms', 'src', 'lib', 'server', 'form-submit.ts'),
      'utf8',
    )
    // Matched as a CALL. A bare substring stays satisfied by a renamed
    // identifier that no longer resolves to anything.
    expect(submitRoute).toMatch(/checkFormSubmissionQuota\(/)
    expect(submitRoute).not.toContain('formsPerHost')
    expect(submitRoute).not.toContain('FORMS_MAX_PER_HOST')
  })

  it('is published as a per-plan number on the plan cards, and metered on the usage card', () => {
    /*
     * A ladder is a thing a buyer compares, so the cards print each plan's
     * rung (AGL-3597) directly above the submissions band. Checked at the
     * source: a rendered card cannot say which of two keys produced a number
     * once both are on screen.
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
    expect(cards).toMatch(/quotaLabel\(entitlements\.formsPerHost\)/)
    expect(cards).toMatch(
      /quotaCount\(entitlements\.formSubmissionsPerMonth\)[^`]{0,40}form submissions/,
    )

    // The odometer keeps it, against the site's real count.
    const meters = readFileSync(
      join(__dirname, '..', 'components', 'billing', 'billing-usage.component.tsx'),
      'utf8',
    )
    expect(meters).toMatch(/limit=\{entitlements\.formsPerHost\}/)
  })
})
