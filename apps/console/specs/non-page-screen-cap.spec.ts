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
 * AGL-1399 / AGL-1439: a screen document that is NOT a billable page is capped
 * by `NON_PAGE_SCREEN_MAX_PER_HOST`, counted from a server read.
 *
 * `kind` is on the screen allow-list because the email composer must send
 * `kind: 'email'` on the create it owns, and `countBillableScreens` subtracts
 * that value — so `POST /api/hosts/resources { resource: 'screen', data: { kind:
 * 'email' } }` created a document that no cap counted, repeatable without limit.
 * AGL-1400 then gave the same property to `kind: 'template'`, and AGL-1439 found
 * the identical hole one value over.
 *
 * ## Why the cap is keyed off the PREDICATE, not off the two values
 *
 * Both issues are one sentence: *a `kind` value that excludes a document from
 * billing, declarable by the metered party*. A cap written as
 * `kind === 'email' || kind === 'template'` would be correct today and wrong the
 * next time a non-page kind is added — which is how this arc has gone four times
 * (AGL-1173, AGL-1383, AGL-1387, AGL-1390). So the cap counts the complement of
 * `billableScreenIds` over LIVE screens: whatever `screenClaimsToBeAPage` stops
 * calling a page arrives already bounded.
 *
 * ## What this is NOT
 *
 * Not a re-pricing. AGL-1173 removed the `screensPerHost` charge for template
 * screens and AGL-1400 kept the exclusion, on the reasoning that a screen
 * serving every entry at no URL of its own is not a page. Nothing here counts an
 * email document or an entry template against a plan — this is a flat
 * infrastructure bound with no `OrgEntitlements` key, shaped exactly like
 * `WEBHOOK_MAX_PER_HOST` (AGL-1360), and the assertions below pin that a paid
 * plan's screen allowance is untouched in both directions.
 */

const mockVerifyIdToken = jest.fn()
const mockCreate = jest.fn()

interface FakeScreen {
  id: string
  kind?: unknown
  deletedAt?: unknown
  [field: string]: unknown
}

const state: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  screens: Array<FakeScreen>
  /** The host's `screens` routing map (id → path). */
  routingMap: Record<string, unknown>
  /** Field masks the route asked for, so we can prove it read the server. */
  selects: Array<Array<string>>
} = { memberRoles: {}, org: {}, screens: [], routingMap: {}, selects: [] }

const screensCollection = () => ({
  select: (...fields: Array<string>) => {
    state.selects.push(fields)
    return {
      get: async () => ({
        docs: state.screens.map((screen) => ({
          id: screen.id,
          get: (field: string) => screen[field],
        })),
      }),
    }
  },
  count: () => ({
    get: async () => ({ data: () => ({ count: state.screens.length }) }),
  }),
  doc: () => ({ create: (...args: unknown[]) => mockCreate(...args) }),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) =>
                field === 'memberRoles' ? state.memberRoles : state.routingMap,
              // Read by the AGL-1501 lockdown verdict for the host scope;
              // this fake host carries no takedown fields.
              data: () => undefined,
            }),
            collection: () => screensCollection(),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ org: state.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  // Lockdown (AGL-1501): the verdict's own logic is unit-tested in
  // libs/tenant/data/admin lockdown.spec.ts; this mirror keeps its contract
  // observable here — staff bypass, suspended org/host => locked (423).
  getLockdownVerdict: async (options: Record<string, any>) =>
    options?.staff === true
      ? null
      : options?.org?.suspendedAt != null
        ? { scope: 'org', reason: 'manual' }
        : options?.host?.suspendedAt != null
          ? { scope: 'host', reason: 'manual' }
          : null,
  lockdownJsonResponse: (state: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...state }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan limits, the REAL page-claim rule and the REAL cap constant. A
  // suite that stubbed any of the three would pass against a route enforcing
  // nothing, which is the failure mode this issue IS.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/actions'),
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

// The workspace alias, not a relative path: a static import that reaches into
// another project's source crosses the nx boundary and fails
// `@nx/enforce-module-boundaries`. The `requireActual` strings above are
// runtime lookups inside a mock factory, so they stay as-is.
import {
  NON_PAGE_SCREEN_MAX_PER_HOST,
  SCREEN_KIND_EMAIL,
  SCREEN_KIND_TEMPLATE,
} from '@aglyn/aglyn/app-utils/screen-route'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { POST } from '../app/api/hosts/resources/route'

const createScreen = (data: Record<string, unknown> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        hostId: 'host-1',
        resource: 'screen',
        data: { displayName: 'Untitled email', ...data },
      }),
    }),
  )

const createEmail = () => createScreen({ kind: SCREEN_KIND_EMAIL })

/** `n` screen documents of one kind, as the SERVER sees them. */
const screensOfKind = (
  n: number,
  kind: unknown,
  prefix = 'screen',
): Array<FakeScreen> =>
  Array.from({ length: n }, (_unused, index) => ({
    id: `${prefix}-${index}`,
    ...(kind === undefined ? {} : { kind }),
  }))

/**
 * Route the seeded screens matching `pick` — publishing a page writes the
 * routing map, and a routed screen counts against `screensPerHost` whatever its
 * document claims (AGL-1383). Which screens are routed is therefore never
 * incidental to a count, so each test says.
 */
const route = (pick: (screen: FakeScreen) => boolean) => {
  state.routingMap = Object.fromEntries(
    state.screens
      .filter(pick)
      .map((screen) => [screen.id, `/${screen.id}`]),
  )
}

/** The pages, which are the screens carrying no `kind` at all. */
const routePages = () => route((screen) => screen.kind === undefined)

beforeEach(() => {
  jest.clearAllMocks()
  state.memberRoles = { 'user-1': 'admin' }
  // Business: `screensPerHost` is UNLIMITED there, so every refusal below can
  // only be the flat cap — never the plan's allowance wearing its coat.
  state.org = { plan: 'business' }
  state.screens = []
  state.routingMap = {}
  state.selects = []
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('non-page screen documents are capped server-side (AGL-1399)', () => {
  it('is the premise: business screens are unlimited, so only the flat cap can refuse', () => {
    expect(PLAN_ENTITLEMENTS.business.screensPerHost).toBe(Infinity)
    expect(Number.isFinite(NON_PAGE_SCREEN_MAX_PER_HOST)).toBe(true)
  })

  it('creates an email document under the cap', async () => {
    state.screens = screensOfKind(NON_PAGE_SCREEN_MAX_PER_HOST - 1, SCREEN_KIND_EMAIL)
    const response = await createEmail()
    expect(response.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ kind: SCREEN_KIND_EMAIL })
  })

  it('refuses the create at the cap even though the client sent no count', async () => {
    // THE bug: `POST /api/hosts/resources { data: { kind: 'email' } }` was a
    // document no cap counted, repeatable without limit. The request body
    // carries no count at all, so the only number in play is the one the route
    // read for itself.
    state.screens = screensOfKind(NON_PAGE_SCREEN_MAX_PER_HOST, SCREEN_KIND_EMAIL)
    const response = await createEmail()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain(
      String(NON_PAGE_SCREEN_MAX_PER_HOST),
    )
    expect(mockCreate).not.toHaveBeenCalled()
    // Read from the server with a field mask, not from a client number.
    expect(state.selects).toContainEqual(['kind', 'deletedAt'])
  })

  it('refuses past the cap, so an over-cap host cannot grow further', async () => {
    state.screens = screensOfKind(NON_PAGE_SCREEN_MAX_PER_HOST + 3, SCREEN_KIND_EMAIL)
    expect((await createEmail()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('cannot be talked out of the count by anything in the body', async () => {
    state.screens = screensOfKind(NON_PAGE_SCREEN_MAX_PER_HOST, SCREEN_KIND_EMAIL)
    const response = await POST(
      new Request('https://app.aglyn.com/api/hosts/resources', {
        method: 'POST',
        headers: { authorization: 'Bearer tok' },
        body: JSON.stringify({
          hostId: 'host-1',
          resource: 'screen',
          count: 0,
          used: 0,
          data: { displayName: 'x', kind: SCREEN_KIND_EMAIL, count: 0, deletedAt: { seconds: 1 } },
        }),
      }),
    )
    expect(response.status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('counts BOTH non-page kinds against one cap (AGL-1439)', async () => {
    // The whole reason the two issues are done together. Half the host's
    // non-page documents are entry templates — created by demoting a page
    // (/api/hosts/screens) or restored from a bundle, never through this route
    // — and they fill the same bucket. A cap that only looked at `kind: 'email'`
    // would let this create through.
    const half = NON_PAGE_SCREEN_MAX_PER_HOST / 2
    state.screens = [
      ...screensOfKind(half, SCREEN_KIND_EMAIL, 'email'),
      ...screensOfKind(half, SCREEN_KIND_TEMPLATE, 'template'),
    ]
    expect((await createEmail()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()

    // One template short of the cap, the same create is allowed — so the
    // refusal above was arithmetic over both kinds and not a blanket no.
    state.screens = state.screens.slice(0, NON_PAGE_SCREEN_MAX_PER_HOST - 1)
    expect((await createEmail()).status).toBe(200)
  })

  it('leaves a legitimate PAGE create alone at the cap', async () => {
    // The failure mode of a flat cap is blocking work the price list cannot
    // explain. A host whose email library is full may still author pages: the
    // cap counts what is NOT a billable page, and a page is not that.
    state.screens = screensOfKind(NON_PAGE_SCREEN_MAX_PER_HOST + 10, SCREEN_KIND_EMAIL)
    const response = await createScreen({ displayName: 'Pricing' })
    expect(response.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate.mock.calls[0][0]).not.toHaveProperty('kind')
  })

  it('charges nothing new to the plan: pages still count, non-pages still do not', async () => {
    // The re-pricing guard, in both directions. A free plan holds five pages,
    // and this change must not have turned an email document into a sixth.
    state.org = { plan: 'free' }
    state.screens = [
      ...screensOfKind(PLAN_ENTITLEMENTS.free.screensPerHost - 1, undefined, 'page'),
      ...screensOfKind(50, SCREEN_KIND_EMAIL, 'email'),
      ...screensOfKind(50, SCREEN_KIND_TEMPLATE, 'template'),
    ]
    routePages()
    // Four pages and a hundred non-pages: the fifth page is the plan's, not the
    // hundred-and-fifth document.
    expect((await createScreen({ displayName: 'Fifth' })).status).toBe(200)

    state.screens = [
      ...screensOfKind(PLAN_ENTITLEMENTS.free.screensPerHost, undefined, 'page'),
      ...screensOfKind(50, SCREEN_KIND_EMAIL, 'email'),
    ]
    routePages()
    const refused = await createScreen({ displayName: 'Sixth' })
    expect(refused.status).toBe(403)
    expect((await refused.json()).error).toContain('5 screens')
  })

  it('counts LIVE documents only, so a soft delete frees a slot', async () => {
    // Delete stamps `deletedAt` rather than removing the doc. Counting the
    // whole collection would be the AGL-1173 screens bug, one cap over: a host
    // at the cap could never create another email document again.
    state.screens = [
      ...screensOfKind(NON_PAGE_SCREEN_MAX_PER_HOST - 1, SCREEN_KIND_EMAIL),
      { id: 'retired', kind: SCREEN_KIND_EMAIL, deletedAt: { seconds: 1 } },
      { id: 'also-retired', kind: SCREEN_KIND_TEMPLATE, deletedAt: { seconds: 2 } },
    ]
    expect((await createEmail()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('does not charge a routed email screen twice', async () => {
    // A ROUTED screen counts against `screensPerHost` whatever its document
    // claims (AGL-1383) — it is a page the plan is already paying for, so it is
    // not also infrastructure this cap bounds. The two sets partition the live
    // screens; neither number is reached by double-counting.
    state.screens = screensOfKind(NON_PAGE_SCREEN_MAX_PER_HOST, SCREEN_KIND_EMAIL)
    route(() => true)
    expect((await createEmail()).status).toBe(200)
  })

  it('refuses a viewer — the cap is not the only thing the client asserted', async () => {
    state.memberRoles = { 'user-1': 'viewer' }
    expect((await createEmail()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses while the owning org is suspended — 423, the distinct lockdown status (AGL-1501)', async () => {
    state.org = { plan: 'business', suspendedAt: { seconds: 1 } }
    expect((await createEmail()).status).toBe(423)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
