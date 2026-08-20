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
 * AGL-1445: a screen with no slug and no routing-map entry STILL spends the
 * plan's screen allowance — deliberately, and this suite is what makes that a
 * decision rather than an oversight.
 *
 * The issue is a real observation (a screen serving zero routes consumes a
 * billable slot) attached to three candidate answers, two of which would take
 * `screensPerHost` from "enforced" to "decorative". This file pins the reason
 * in the only place it can be seen: the ENFORCEMENT POINT.
 *
 * ## Why "count only what the routing map serves" is not available
 *
 * `screensPerHost` is a CREATE-TIME gate. /api/hosts/resources counts the
 * host's billable screens and refuses the create that would exceed the plan;
 * `report-usage` re-measures monthly but records rather than enforces (see the
 * comment on `maxBillableScreens`). So the create is the only door.
 *
 * A screen is born with no slug and no routing-map entry — publishing is a
 * SEPARATE, LATER act, and it is a client `updateDoc` on the host's `screens`
 * map (`publishScreenRoute`), gated in the rules on `canPublishHostContent`
 * and on nothing else. Nothing counts anything there.
 *
 * Put those two facts together and the "obvious fix" is a bypass, not a
 * discount: if an unrouted screen did not count, then every CREATE would be
 * free — the new document is unrouted by construction — so the gate would
 * never refuse anything, and the publishes that follow are ungated. A Free
 * site would hold unlimited pages. That is why `billableScreenIds` reads the
 * routing map ADDITIVELY (a routed screen counts whatever its document claims
 * — AGL-1383) and never subtractively.
 *
 * AGL-1445's option 2 — server-stamping a non-page `kind` on orphans by a
 * sweep — lands in the same place unless the promotion back to a page passes a
 * gate, and for an orphan the promotion IS the publish. `kind: 'template'` can
 * be trusted precisely because its promotion is `convertScreenKind`, which is
 * checked exactly like a create; there is no equivalent door in front of the
 * routing map. So the answer is AGL-1445's option 1, and the price of it is
 * one slot until somebody deletes the orphan — which is one click, and which
 * the Screens page lists like any other row.
 *
 * The pair below is the whole argument: four routed pages leave room, and the
 * fifth screen closes the plan whether or not it has an address. Remove the
 * orphan from the count and the second assertion flips to a 200 — which is the
 * shape of the regression this file exists to catch.
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
} = { memberRoles: {}, org: {}, screens: [], routingMap: {} }

const screensCollection = () => ({
  select: () => ({
    get: async () => ({
      docs: state.screens.map((screen) => ({
        id: screen.id,
        get: (field: string) => screen[field],
      })),
    }),
  }),
  count: () => ({
    get: async () => ({ data: () => ({ count: state.screens.length }) }),
  }),
  doc: () => ({ create: (...args: unknown[]) => mockCreate(...args) }),
})

/**
 * The same faithful-enough `runTransaction` double `non-page-screen-cap.spec`
 * uses (AGL-2231): reads must precede writes, and a buffered create is
 * discarded when the body returns a refusal. A double that committed the write
 * anyway would report a 403 AND a created screen and call it a pass.
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

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) =>
          runTransaction(body),
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) =>
                field === 'memberRoles' ? state.memberRoles : state.routingMap,
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
  getLockdownVerdict: async () => null,
  lockdownJsonResponse: (verdict: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...verdict }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table and the REAL counting rule. Stubbing either would let
  // this suite pass against a route enforcing nothing, which is precisely the
  // outcome it exists to refuse.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
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
import {
  billableScreenIds,
  ERROR_SCREEN_MAX_PER_HOST,
  SCREEN_KIND_ERROR,
} from '@aglyn/aglyn/app-utils/screen-route'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { POST } from '../app/api/hosts/resources/route'

const createScreen = () =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/resources', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({
        hostId: 'host-1',
        resource: 'screen',
        data: { displayName: 'One more page' },
      }),
    }),
  )

/** `n` ordinary screens, published at an address of their own. */
const routedPages = (n: number) => {
  state.screens = Array.from({ length: n }, (_unused, index) => ({
    id: `page-${index}`,
  }))
  state.routingMap = Object.fromEntries(
    state.screens.map((screen) => [screen.id, `/${screen.id}`]),
  )
}

/**
 * AGL-1445's host, exactly: a live screen document carrying no `kind`, no
 * `deletedAt`, no slug, and no entry in the routing map. Nothing serves it.
 */
const addOrphan = (id = 'r_RYOXo-98') => {
  state.screens = [...state.screens, { id }]
}

beforeEach(() => {
  jest.clearAllMocks()
  state.memberRoles = { 'user-1': 'admin' }
  state.org = { plan: 'free' }
  state.screens = []
  state.routingMap = {}
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('an unrouted screen still spends the plan (AGL-1445)', () => {
  it('is the premise: the free plan holds five screens', () => {
    expect(PLAN_ENTITLEMENTS.free.screensPerHost).toBe(5)
  })

  it('admits the fifth screen while only four pages exist', async () => {
    // The half that must PASS. Without it the refusal below would be satisfied
    // by a route that refuses everything, and the suite would prove nothing.
    routedPages(4)
    expect((await createScreen()).status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses the sixth once an orphan holds the fifth slot', async () => {
    // Four published pages plus AGL-1445's screen: no slug, no route, serving
    // nothing. The plan is full, and this is the assertion that flips to 200
    // the moment somebody stops counting unrouted screens.
    routedPages(4)
    addOrphan()
    const response = await createScreen()
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('5')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('refuses when the host has never published anything at all', async () => {
    // The stronger form: an empty routing map, five screens, none reachable.
    // A count keyed off the map alone reads this host as zero — and a create
    // gate that admits every create is not a gate.
    state.routingMap = {}
    state.screens = Array.from({ length: 5 }, (_unused, index) => ({
      id: `draft-${index}`,
    }))
    expect((await createScreen()).status).toBe(403)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('counts the orphan in the rule itself, not only at the route', () => {
    expect(billableScreenIds([{ id: 'orphan' }], {})).toEqual(
      new Set(['orphan']),
    )
    expect(billableScreenIds([{ id: 'orphan' }], undefined)).toEqual(
      new Set(['orphan']),
    )
  })
})

/**
 * The console's precheck and the server's rule are ONE function (AGL-2093).
 *
 * The Screens page carries its own `billableScreenCount`, and its comment says
 * why it must not drift: *"a precheck that warns on a different number than the
 * API enforces is worse than no precheck at all."* It had drifted. The page
 * restated `routed || screenClaimsToBeAPage` and never learned AGL-2093's
 * bound, under which the FIFTH live `kind: 'error'` screen is a billable page
 * again — so on such a host the console offered room the API then refused.
 *
 * Restating a rule is what produced the divergence, so the fix is not a second
 * restatement with the bound bolted on: `billableScreenIds` moved into
 * `screen-route.ts` beside `screenClaimsToBeAPage` — the client barrel already
 * exports it — and both callers now ask the same function.
 */
describe('the console precheck asks the server rule (AGL-2093)', () => {
  const source = readFileSync(
    join(
      __dirname,
      '../app/(app)/[orgSlug]/hosts/[host]/screens/page.tsx',
    ),
    'utf8',
  )

  it('calls the shared rule rather than restating it', () => {
    expect(source).toContain('billableScreenIds(')
    // The restatement, which is the thing that could drift again.
    expect(source).not.toMatch(/routingMap\?\.\[[^\]]*\] !== undefined \|\|/)
  })

  it('is the number the page would now show: the fifth error screen counts', () => {
    const screens = Array.from(
      { length: ERROR_SCREEN_MAX_PER_HOST + 1 },
      (_unused, index) => ({ id: `err-${index}`, kind: SCREEN_KIND_ERROR }),
    )
    expect(billableScreenIds(screens, {}).size).toBe(1)
  })
})
