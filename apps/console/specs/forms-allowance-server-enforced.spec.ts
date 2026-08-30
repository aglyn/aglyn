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
 * The saved-form catalog is a PLAN allowance, refused at the create.
 *
 * Three claims, and the second two are the ones worth having:
 *
 *  1. the allowance varies by plan and the route reads the plan's number, not
 *     a platform constant every tier shares;
 *  2. a site whose allowance is spent — or was never large enough, because the
 *     org downgraded — keeps every form it already has, editable and readable.
 *     Nothing is deleted, hidden or archived by a ceiling;
 *  3. and those forms keep collecting. Submissions are metered revenue on
 *     their own band, so a catalog ceiling that reached them would refuse the
 *     customer's leads and our billing in the same request.
 *
 * The REAL `checkQuota` / `checkEntitlement` and the REAL `PLAN_ENTITLEMENTS`
 * are wired in on purpose. A double that stubbed the policy module would make
 * every limit read zero, and a suite can then go green having proved that the
 * platform refuses everybody — which is why the Enterprise and under-cap rows
 * below exist beside the refusals.
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
import { PLAN_ENTITLEMENTS, UNLIMITED } from '@aglyn/aglyn'
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

describe('the catalog ceiling is the PLAN allowance', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    state.org = { plan: 'starter', subscription: { status: 'active' } }
    state.forms = []
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('creates the last form the allowance covers', async () => {
    state.forms = savedForms(PLAN_ENTITLEMENTS.starter.formsPerHost - 1)
    expect((await createForm()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses the next one, quoting the plan number', async () => {
    state.forms = savedForms(PLAN_ENTITLEMENTS.starter.formsPerHost)
    const response = await createForm()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain(
      String(PLAN_ENTITLEMENTS.starter.formsPerHost),
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('lets a larger plan through at the smaller plan’s ceiling', async () => {
    // The row that makes the refusal above mean something. Same count, same
    // route, same collection — only the plan differs, so a suite that passed
    // by refusing everybody fails here.
    state.org = { plan: 'business', subscription: { status: 'active' } }
    state.forms = savedForms(PLAN_ENTITLEMENTS.starter.formsPerHost)
    expect((await createForm()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('never refuses Enterprise, whose allowance is uncapped', async () => {
    // `UNLIMITED` is `Number.POSITIVE_INFINITY`, and every comparison against
    // it is ordinary arithmetic that happens to be right. A plan whose number
    // reached this route as a JSON `null` would read as 0 and refuse the first
    // form on the most expensive tier we sell.
    expect(PLAN_ENTITLEMENTS.enterprise.formsPerHost).toBe(UNLIMITED)
    state.org = { plan: 'enterprise', subscription: { status: 'active' } }
    state.forms = savedForms(5_000)
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
    state.forms = savedForms(PLAN_ENTITLEMENTS.starter.formsPerHost)
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
    // route that used it would admit a Starter site far past its allowance.
    expect(FORMS_MAX_PER_HOST).toBeGreaterThan(
      PLAN_ENTITLEMENTS.starter.formsPerHost,
    )
    state.forms = savedForms(FORMS_MAX_PER_HOST - 1)
    expect((await createForm()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('a spent allowance takes nothing away', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.memberRoles = { 'user-1': 'admin' }
    // The downgrade case: 80 forms built on a plan that allowed them, now on
    // one that includes 50. This is the state the product must survive.
    state.org = { plan: 'starter', subscription: { status: 'active' } }
    state.forms = savedForms(80)
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  })

  it('refuses the next form and deletes none of the 80', async () => {
    expect((await createForm()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
    // The collection is untouched. This route has no delete path at all, and
    // the refusal is the whole of what a ceiling does.
    expect(state.forms).toHaveLength(80)
  })

  it('is refused for CAPACITY, not for the feature', async () => {
    // The two refusals are different products. "Not included in your plan"
    // sends a paying customer to a feature comparison for something they can
    // already do 80 of; the capacity message names the number and the remedy.
    const error = (await (await createForm()).json()).error
    expect(error).toContain(String(PLAN_ENTITLEMENTS.starter.formsPerHost))
    expect(error).not.toContain('not included')
  })

  it('leaves submissions on a different route and a different band', () => {
    /*
     * The load-bearing separation, checked at the source because the two
     * routes are in different apps and the failure is a route learning about
     * the wrong number. A submit path that consulted the catalog allowance
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

  it('is published on the plan card as the plan’s own number', () => {
    /*
     * The billing page is where a customer reads what they are buying, and
     * the allowance has to come off the resolved entitlements — a card that
     * printed a constant would publish one plan's terms on all eight.
     * Checked at the source because the assertion is about WHICH value is
     * rendered, which a rendered string cannot distinguish once two keys
     * happen to hold the same number.
     */
    const card = readFileSync(
      join(
        __dirname,
        '..',
        'components',
        'billing',
        'billing-plan-cards.component.tsx',
      ),
      'utf8',
    )
    // The key and the words it is printed beside, matched together: the card
    // also BRANCHES on `formsPerHost`, so asserting the identifier alone stays
    // satisfied by a line that renders some other quota under this label.
    expect(card).toMatch(/quotaLabel\(entitlements\.formsPerHost\)[^`]{0,40}saved forms/)
  })
})
