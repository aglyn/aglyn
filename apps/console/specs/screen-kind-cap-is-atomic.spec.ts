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
 * AGL-2369 — `/api/hosts/screens` holds its caps under CONCURRENCY.
 *
 * AGL-2231 made the CREATE end of the screen cap atomic and left this end
 * alone, and this route's own doc comment claimed otherwise: *"Promotion
 * (template → page) is checked exactly like a create… This is where the
 * laundering loop is met."* It was not met. Both writes here counted with a
 * plain `.get()`, decided, and then wrote — the exact shape AGL-2231 fixed one
 * route over.
 *
 * ## The two doors
 *
 *  - **`convert` (template → page).** N concurrent promotions of N DIFFERENT
 *    template screens each read the same pre-state and each simulate promoting
 *    only THEMSELVES, so each computes `next.size = billable + 1`. From a site
 *    at `limit - 1` every one of them passes and every one lands. Templates are
 *    free to accumulate — demotion always succeeds — so the supply runs to
 *    `NON_PAGE_SCREEN_MAX_PER_HOST`.
 *  - **`error-screen` (assign).** Stamping `kind: 'error'` takes a screen OFF
 *    `screensPerHost`, and the four-slot bound is the only thing stopping that
 *    from being a free-screen generator. It committed a `WriteBatch`, which is
 *    atomic but NOT conditional on a read taken before it, so N concurrent
 *    assigns each saw zero live error screens and each stamped a different
 *    screen. The host keeps one pointer; the other N−1 are unbound, unbilled
 *    and — because the rules freeze `kind` on update — permanent.
 *
 * ## What the double models, and why that is not cheating
 *
 * `Transaction.get(Query)` holds a pessimistic lock on every document the query
 * matched, so two transactions counting the same collection cannot both commit
 * against the same snapshot: the loser aborts, retries, re-reads the higher
 * count and is refused. The fake below models exactly that and nothing more —
 * a body runs holding a global lock, reads see the store as of that moment,
 * buffered writes apply on commit, and a read after a write throws as the
 * server does.
 *
 * **The lock is on the TRANSACTION, not on the handler.** That is what makes
 * this suite discriminate rather than decorate: with the counting reads hoisted
 * back outside the transaction — the code as it shipped — serializing the
 * transaction body changes nothing, because the count was already taken. See
 * `FORCED RED` on each concurrency test for the exact mutation and its result.
 *
 * ## Both halves, always
 *
 * A suite asserting only "the last one is refused" also passes against a route
 * that refuses EVERYTHING, which is the likeliest way a cap fix goes wrong. So
 * every case here pins the pair: the last permitted write SUCCEEDS and the next
 * is refused, the concurrent cases assert the EXACT number of survivors rather
 * than "not all of them", and an UNLIMITED plan lands all of them.
 */

const mockVerifyIdToken = jest.fn()

interface FakeScreen {
  id: string
  kind?: unknown
  deletedAt?: unknown
  displayName?: unknown
  [field: string]: unknown
}

const mockState: {
  memberRoles: Record<string, string>
  org: Record<string, unknown>
  host: Record<string, unknown>
  /** The host's screen documents, keyed by id — the SERVER's view. */
  screens: Map<string, FakeScreen>
  /** How many transaction attempts ran, including retries. */
  attempts: number
  staff: boolean
} = {
  memberRoles: {},
  org: {},
  host: {},
  screens: new Map(),
  attempts: 0,
  staff: false,
}

const snapshotOf = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
  ref: { id },
})

/** Every screen row, projected the way the route's `select()` asks for it. */
const mockScreenDocs = () =>
  [...mockState.screens.values()].map((screen) =>
    snapshotOf(screen.id, screen as Record<string, unknown>),
  )

const mockScreensCollection = () => {
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    get: async () => ({ docs: mockScreenDocs() }),
    doc: (id: string) => ({
      id,
      get: async () => {
        const screen = mockState.screens.get(id)
        return snapshotOf(id, (screen as Record<string, unknown>) ?? null)
      },
      update: async (payload: Record<string, unknown>) => {
        const current = mockState.screens.get(id)
        // Firestore's `update` FAILS on a missing document rather than
        // creating one. Modelled, so a route updating the wrong ref reads as a
        // failure here instead of silently minting a screen.
        if (!current) {
          throw Object.assign(new Error('NOT_FOUND'), { code: 5 })
        }
        mockState.screens.set(id, { ...current, ...payload })
      },
    }),
  }
  return api
}

const mockHostRef: any = {
  id: 'host-1',
  get: async () => snapshotOf('host-1', mockState.host),
  update: async (payload: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(payload)) {
      // Dotted field paths are how the route writes `errorScreens.{slot}`;
      // flattening them would let a route that clobbered the whole map pass.
      if (key.includes('.')) {
        const [head, tail] = key.split('.')
        const branch = { ...((mockState.host[head] ?? {}) as any) }
        if (value === '__field_deleted__') delete branch[tail]
        else branch[tail] = value
        mockState.host[head] = branch
      } else if (value === '__field_deleted__') {
        delete mockState.host[key]
      } else {
        mockState.host[key] = value
      }
    }
  },
  collection: (name: string) =>
    name === 'screens' ? mockScreensCollection() : mockScreensCollection(),
}

/**
 * A transaction that SERIALIZES and defers its writes, which is what the fix
 * leans on.
 *
 * One global lock stands in for the per-collection pessimistic lock: this route
 * touches one host and its one screens collection per request, so a
 * finer-grained model would be more code for the same verdict. Each body runs
 * to completion — reads, then decision, then the buffered writes applied on
 * commit — before the next begins. The serialization is what makes the second
 * body's COUNT see the first body's write, which is the property under test.
 */
let mockLock: Promise<unknown> = Promise.resolve()
const mockRunTransaction = async (body: (tx: any) => Promise<any>) => {
  const attempt = mockLock.then(async () => {
    mockState.attempts += 1
    const buffered: Array<() => unknown> = []
    const result = await body({
      get: async (ref: any) => {
        if (buffered.length) {
          throw new Error('Firestore transactions cannot read after a write')
        }
        return ref.get()
      },
      update: (ref: any, payload: unknown) => {
        buffered.push(() => ref.update(payload))
      },
    })
    for (const write of buffered) await write()
    return result
  })
  // The lock must advance even when a body rejects, or one failure deadlocks
  // every later request in the suite.
  mockLock = attempt.catch(() => undefined)
  return attempt
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  Timestamp: { now: () => ({ seconds: 0 }) },
  FieldValue: { delete: () => '__field_deleted__' },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        runTransaction: (body: (tx: any) => Promise<any>) =>
          mockRunTransaction(body),
        batch: () => {
          const queued: Array<() => Promise<unknown>> = []
          return {
            update: (ref: any, payload: Record<string, unknown>) => {
              queued.push(() => ref.update(payload))
            },
            commit: async () => {
              for (const write of queued) await write()
            },
          }
        },
        collection: (name: string) => ({
          doc: (id: string) =>
            name === 'orgs'
              ? { id, get: async () => snapshotOf(id, mockState.org) }
              : mockHostRef,
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockState.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  getLockdownVerdict: async () => null,
  lockdownJsonResponse: (verdict: Record<string, unknown>) =>
    Response.json({ error: 'locked', ...verdict }, { status: 423 }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL plan table, the REAL page-claim rule and the REAL error-slot list.
  // Stubbing any of them would let this suite pass against a route enforcing
  // nothing — which IS the bug.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/platform.types',
  ),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { ERROR_SCREEN_MAX_PER_HOST } from '@aglyn/aglyn/app-utils/screen-route'
// The slot LIST lives in `foundation`, not `app-utils` — importing it from
// `screen-route` yields `undefined` and every slot index reads as a TypeError.
import { HOST_ERROR_SCREEN_SLOTS } from '@aglyn/aglyn/foundation/definitions/platform.types'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { POST } from '../app/api/hosts/screens/route'

const FREE_SCREENS = PLAN_ENTITLEMENTS.free.screensPerHost

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/hosts/screens', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1', ...body }),
    }),
  )

const promote = (id: string) =>
  post({ action: 'convert', id, kind: 'page' })

const assignError = (id: string, slot: string) =>
  post({ action: 'error-screen', id, slot })

/**
 * `pages` live billable pages plus `templates` demoted ones, as the server sees
 * them.
 *
 * Pages are ROUTED by default, which is how a real site's pages look and which
 * keeps the routing-map override (AGL-1383) in the picture rather than mocked
 * out. `routed: false` is for the error-slot cases: **the map outranks the
 * document**, so stamping `kind: 'error'` on a screen still published at an
 * address takes nothing off the plan's count — the discount arrives when the
 * site unpublishes the address. A suite that seeded routed pages there would
 * assert the bound while measuring a saving that cannot happen.
 *
 * `orgId` is not decoration: the route resolves entitlements from
 * `orgs/{host.orgId}`, so a host without it leaves `orgData` null and EVERY
 * plan silently resolves to Free. The paid-plan cases below caught exactly that
 * and would otherwise have passed against a route reading no plan at all.
 */
const seed = (
  pages: number,
  templates: number,
  options?: { routed?: boolean },
) => {
  const routed = options?.routed ?? true
  mockState.screens = new Map()
  const routing: Record<string, string> = {}
  for (let index = 0; index < pages; index += 1) {
    const id = `page-${index}`
    mockState.screens.set(id, { id, displayName: `Page ${index}` })
    if (routed) routing[id] = `/p${index}`
  }
  for (let index = 0; index < templates; index += 1) {
    const id = `tpl-${index}`
    mockState.screens.set(id, {
      id,
      kind: 'template',
      displayName: `Template ${index}`,
    })
  }
  mockState.host = {
    orgId: 'org-1',
    screens: routing,
    memberRoles: mockState.memberRoles,
  }
}

/** Live screens the plan is charged for, by the product's own rule. */
const billable = () =>
  [...mockState.screens.values()].filter(
    (screen) =>
      screen.kind !== 'template' &&
      (Object.prototype.hasOwnProperty.call(
        (mockState.host['screens'] ?? {}) as object,
        screen.id,
      ) ||
        (screen.deletedAt == null &&
          screen.kind !== 'email' &&
          screen.kind !== 'template' &&
          screen.kind !== 'error')),
  ).length

beforeEach(() => {
  jest.clearAllMocks()
  mockLock = Promise.resolve()
  mockState.memberRoles = { 'user-1': 'admin' }
  mockState.org = { plan: 'free' }
  mockState.host = {}
  mockState.screens = new Map()
  mockState.attempts = 0
  mockState.staff = false
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
})

describe('the premise', () => {
  it('free includes a small, FINITE number of screens', () => {
    // If this ever became UNLIMITED the whole suite would go vacuous — every
    // promotion would succeed and every assertion below would still pass.
    expect(FREE_SCREENS).toBe(5)
    expect(Number.isFinite(FREE_SCREENS)).toBe(true)
  })

  it('the error-slot bound is small and finite', () => {
    expect(ERROR_SCREEN_MAX_PER_HOST).toBe(4)
    expect(HOST_ERROR_SCREEN_SLOTS).toHaveLength(4)
  })
})

describe('SEQUENTIALLY: promotion admits the last slot and refuses the next', () => {
  it('promotes into the 5th slot', async () => {
    seed(FREE_SCREENS - 1, 1)
    const response = await promote('tpl-0')
    expect(response.status).toBe(200)
    expect(billable()).toBe(FREE_SCREENS)
    expect(mockState.screens.get('tpl-0')?.kind).toBe('page')
  })

  it('refuses the 6th', async () => {
    seed(FREE_SCREENS, 1)
    const response = await promote('tpl-0')
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: expect.stringContaining(`${FREE_SCREENS + 1} of ${FREE_SCREENS}`),
    })
    // The refusal must not have written: a 403 that still stamped the screen
    // would leave the site over its cap with a refusal in the log.
    expect(mockState.screens.get('tpl-0')?.kind).toBe('template')
    expect(billable()).toBe(FREE_SCREENS)
  })

  it('always allows DEMOTION, which lowers the count', async () => {
    seed(FREE_SCREENS, 0)
    const response = await post({
      action: 'convert',
      id: 'page-0',
      kind: 'template',
    })
    expect(response.status).toBe(200)
    expect(mockState.screens.get('page-0')?.kind).toBe('template')
  })
})

describe('CONCURRENTLY: promotion cannot be laundered', () => {
  /**
   * FORCED RED (2026-08-19). Hoisting the reads and the decision back outside
   * `runTransaction` in `convertScreenKind` — i.e. restoring
   * `const [screensSnapshot, target] = await Promise.all([...get(), ...])`
   * ahead of the body and leaving only `screenRef.update()` inside — lands
   * **20 of 20** promotions on a plan that includes 5, with `billable()` at 24.
   * The double is UNCHANGED between the two runs: serializing a transaction
   * body cannot save a count that was taken before it opened.
   */
  it('lands exactly the free allowance from a site one slot short', async () => {
    const attempts = 20
    seed(FREE_SCREENS - 1, attempts)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        promote(`tpl-${index}`),
      ),
    )
    const created = responses.filter((response) => response.status === 200)
    const refused = responses.filter((response) => response.status === 403)

    // BOTH halves. Exactly one promotion fits the remaining slot, and the rest
    // are refused — not "some", not "all".
    expect(created).toHaveLength(1)
    expect(refused).toHaveLength(attempts - 1)
    expect(created.length + refused.length).toBe(attempts)
    expect(billable()).toBe(FREE_SCREENS)
    // Every request really ran a transaction; a suite where the route stopped
    // transacting would otherwise still pass on the counts above.
    expect(mockState.attempts).toBe(attempts)
  })

  it('lands nothing at all from a site already at its cap', async () => {
    const attempts = 20
    seed(FREE_SCREENS, attempts)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        promote(`tpl-${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 403)).toHaveLength(
      attempts,
    )
    expect(billable()).toBe(FREE_SCREENS)
  })

  it('an UNLIMITED plan lands all of them', async () => {
    // The other half of every cap assertion above: a gate that refused
    // everything would pass all of them and fail only this.
    expect(PLAN_ENTITLEMENTS.business.screensPerHost).toBe(
      Number.POSITIVE_INFINITY,
    )
    const attempts = 20
    mockState.org = { plan: 'business' }
    seed(0, attempts)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        promote(`tpl-${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      attempts,
    )
    expect(billable()).toBe(attempts)
  })

  it('a PAID finite plan is enforced at ITS number, not free’s', async () => {
    // A gate that only refuses free orgs is the same defect wearing a
    // different number, so the paid cap gets the identical concurrent proof.
    const limit = PLAN_ENTITLEMENTS.starter.screensPerHost
    expect(limit).toBe(25)
    mockState.org = { plan: 'starter' }
    const attempts = 20
    seed(limit - 1, attempts)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        promote(`tpl-${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      1,
    )
    expect(billable()).toBe(limit)
  })

  it('a DEAD subscription is enforced at the free number it resolves to', async () => {
    // The production shape behind the 8-of-5 email: a canceled subscription
    // downgrades a paid plan to free (`resolveEffectivePlan`). The cap must
    // follow the EFFECTIVE plan, or a canceled org keeps the cap it stopped
    // paying for.
    mockState.org = { plan: 'pro', billingStatus: 'canceled' }
    const attempts = 20
    seed(FREE_SCREENS - 1, attempts)
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        promote(`tpl-${index}`),
      ),
    )
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      1,
    )
    expect(billable()).toBe(FREE_SCREENS)
  })
})

describe('SEQUENTIALLY: the error-slot bound admits its last slot', () => {
  it('assigns the 4th error screen', async () => {
    seed(ERROR_SCREEN_MAX_PER_HOST + 1, 0, { routed: false })
    for (let index = 0; index < ERROR_SCREEN_MAX_PER_HOST; index += 1) {
      const response = await assignError(
        `page-${index}`,
        HOST_ERROR_SCREEN_SLOTS[index],
      )
      expect(response.status).toBe(200)
    }
    expect(
      [...mockState.screens.values()].filter(
        (screen) => screen.kind === 'error',
      ),
    ).toHaveLength(ERROR_SCREEN_MAX_PER_HOST)
  })

  it('refuses the 5th', async () => {
    seed(ERROR_SCREEN_MAX_PER_HOST + 1, 0, { routed: false })
    for (let index = 0; index < ERROR_SCREEN_MAX_PER_HOST; index += 1) {
      await assignError(`page-${index}`, HOST_ERROR_SCREEN_SLOTS[index])
    }
    const response = await assignError(
      `page-${ERROR_SCREEN_MAX_PER_HOST}`,
      HOST_ERROR_SCREEN_SLOTS[0],
    )
    expect(response.status).toBe(403)
    expect(
      mockState.screens.get(`page-${ERROR_SCREEN_MAX_PER_HOST}`)?.kind,
    ).toBeUndefined()
  })
})

describe('CONCURRENTLY: the error-slot bound cannot be laundered', () => {
  /**
   * FORCED RED (2026-08-19). Hoisting the screens/target reads and the bound
   * check back outside `runTransaction` in `assignErrorScreen` and committing
   * the two writes through `firestore.batch()` — the code as it shipped —
   * stamps **20 of 20** screens `kind: 'error'` and drops `billable()` from 20
   * to 0 on a plan that includes 5. That is the free-screen generator the
   * four-slot bound exists to prevent.
   */
  it('stamps at most the four slots, however many requests arrive at once', async () => {
    const attempts = 20
    seed(attempts, 0, { routed: false })
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_unused, index) =>
        assignError(`page-${index}`, HOST_ERROR_SCREEN_SLOTS[index % 4]),
      ),
    )
    const stamped = [...mockState.screens.values()].filter(
      (screen) => screen.kind === 'error',
    )

    // BOTH halves: the bound is reached, and it is not exceeded.
    expect(stamped).toHaveLength(ERROR_SCREEN_MAX_PER_HOST)
    expect(responses.filter((response) => response.status === 200)).toHaveLength(
      ERROR_SCREEN_MAX_PER_HOST,
    )
    expect(responses.filter((response) => response.status === 403)).toHaveLength(
      attempts - ERROR_SCREEN_MAX_PER_HOST,
    )
    // The point of the bound: at most four screens leave the plan's count.
    expect(billable()).toBe(attempts - ERROR_SCREEN_MAX_PER_HOST)
    expect(mockState.attempts).toBe(attempts)
  })

  it('a CLEAR is never refused, even under the same concurrency', async () => {
    // AGL-1390's rule. A clear lowers nothing and raises nothing, so it stays
    // outside the transaction and must stay unconditional.
    seed(1, 0, { routed: false })
    await assignError('page-0', HOST_ERROR_SCREEN_SLOTS[0])
    const responses = await Promise.all(
      HOST_ERROR_SCREEN_SLOTS.map((slot) => post({ action: 'error-screen', slot })),
    )
    expect(responses.every((response) => response.status === 200)).toBe(true)
  })
})
