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
 * AGL-2092: a designed error screen does not spend the plan's screen allowance.
 *
 * Zach's decision, 2026-08-18, against the rule `count-billable-screens.ts`
 * already states — `screenClaimsToBeAPage`, which asks whether the screen
 * occupies a URL OF ITS OWN. A collection's entry template does not and is
 * excluded (AGL-1173); its LIST template does (`/{collectionSlug}` renders that
 * exact screen) and still counts (AGL-1387). A 404 body renders on paths that
 * matched nothing, so by the same rule it is excluded.
 *
 * That exclusion has been bypassed four times in one arc, so the shape here is
 * the settled one and this suite pins the three properties that make it safe:
 *
 *  1. **The routing map outranks the document.** The same screen, assigned and
 *     unrouted, does not count; assigned and STILL published at an address, it
 *     does. This is what makes the migration story "there isn't one": the three
 *     error screens that exist on the marketing host today are published pages,
 *     and assigning them takes nothing off the plan and breaks no link until
 *     somebody removes the address.
 *  2. **The stamp is BOUNDED.** Four error slots, so at most four exempt
 *     screens — an unbounded exemption the metered party can ask for is a
 *     free-screen generator, which is the AGL-1439 sentence one value over.
 *  3. **Clearing a slot is never refused, and mints nothing.** AGL-1390 had to
 *     refuse a clear and that was the bug; here the clear is free because it
 *     moves no count, and the way back to being a page is `convert`, which is
 *     checked exactly like a create.
 *
 * Driven through the ROUTES against one mutable store, because a function
 * called once per assignment cannot see a loop.
 */

/** Screen ids the create route hands out, in order. */
let mockNextUid = 0

const mockVerifyIdToken = jest.fn()

interface Store {
  host: Record<string, unknown>
  screens: Record<string, Record<string, unknown>>
  collections: Record<string, Record<string, unknown>>
  org: Record<string, unknown>
}
let mockStore: Store

/** The sentinel our `FieldValue.delete()` mock returns, made observable. */
const DELETED = '__field_deleted__'

const snapshotOf = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: data !== null,
  data: () => data ?? undefined,
  get: (field: string) => (data ?? {})[field],
  ref: { id },
})

/**
 * Applies one `update()` payload the way Firestore does, which this suite
 * depends on being exact:
 *
 *  - a DOTTED key writes into the nested map and leaves its siblings alone
 *    (`errorScreens.notFound` must not clobber `errorScreens.unavailable`),
 *    and creates the parent map when it is absent;
 *  - `FieldValue.delete()` removes the key rather than storing a sentinel;
 *  - `undefined` is rejected outright.
 *
 * A fake that merged `{'errorScreens.notFound': x}` as a flat key would report
 * a green for a route that had silently stopped writing the binding at all.
 */
function applyUpdate(
  target: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) {
      throw new Error(`Cannot use "undefined" as a Firestore value (${key})`)
    }
    const path = key.split('.')
    let node = target
    for (const segment of path.slice(0, -1)) {
      if (typeof node[segment] !== 'object' || node[segment] === null) {
        node[segment] = {}
      }
      node = node[segment] as Record<string, unknown>
    }
    const leaf = path[path.length - 1]
    if (value === DELETED) delete node[leaf]
    else node[leaf] = value
  }
}

function fakeCollection(bucket: Record<string, Record<string, unknown>>) {
  const api: any = {
    select: () => api,
    where: () => api,
    limit: () => api,
    orderBy: () => api,
    count: () => ({
      get: async () => ({ data: () => ({ count: Object.keys(bucket).length }) }),
    }),
    get: async () => ({
      docs: Object.entries(bucket).map(([id, data]) => snapshotOf(id, data)),
      get empty() {
        return !Object.keys(bucket).length
      },
      get size() {
        return Object.keys(bucket).length
      },
    }),
    doc: (id: string) => ({
      id,
      get: async () => snapshotOf(id, bucket[id] ?? null),
      create: async (payload: Record<string, unknown>) => {
        if (bucket[id]) throw Object.assign(new Error('exists'), { code: 6 })
        bucket[id] = { ...payload }
      },
      set: async (payload: Record<string, unknown>) => {
        // `set(merge)` conjures a missing document; `update` below does not.
        bucket[id] = { ...(bucket[id] ?? {}) }
        applyUpdate(bucket[id], payload)
      },
      update: async (payload: Record<string, unknown>) => {
        if (!bucket[id]) {
          throw Object.assign(new Error('NOT_FOUND: no such document'), {
            code: 5,
          })
        }
        applyUpdate(bucket[id], payload)
      },
      collection: () => fakeCollection({}),
    }),
  }
  return api
}

const fakeHostRef = {
  id: 'host-1',
  get: async () => snapshotOf('host-1', mockStore.host),
  update: async (payload: Record<string, unknown>) =>
    applyUpdate(mockStore.host, payload),
  collection: (name: string) =>
    name === 'screens'
      ? fakeCollection(mockStore.screens)
      : name === 'collections'
        ? fakeCollection(mockStore.collections)
        : fakeCollection({}),
}

const fakeFirestore = {
  collection: (name: string) => ({
    doc: (id: string) =>
      name === 'orgs'
        ? { id, get: async () => snapshotOf(id, mockStore.org) }
        : fakeHostRef,
  }),
  runTransaction: async (body: (transaction: any) => Promise<unknown>) =>
    body({
      get: async (ref: any) =>
        typeof ref?.get === 'function' ? ref.get() : { docs: [], empty: true },
      create: () => undefined,
      set: () => undefined,
    }),
  // The `kind: 'error'` stamp and the slot binding land together or not at
  // all, so the route batches them; the fake applies them in order on commit.
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
      firestore: () => fakeFirestore,
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: mockStore.org }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
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
  // The REAL plan limits, the REAL page-claim rule and the REAL slot list. A
  // suite that stubbed the entitlements would pass against a route enforcing
  // nothing, and one that stubbed the slot list would not be testing the bound.
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plan-entitlements'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/screen-route'),
  ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/collection-kind'),
  // `/server` re-exports `foundation`, so the slot list reaches the route from
  // the same barrel — stubbed to `undefined`, `errorSlotBoundTo` would throw
  // and every assertion here would be reading a 500.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/platform.types',
  ),
  createResourceUid: () => `made-${++mockNextUid}`,
  nameSearchKey: (value: string) => value.toLowerCase(),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

import { HOST_ERROR_SCREEN_SLOTS } from '@aglyn/aglyn'
import { ERROR_SCREEN_MAX_PER_HOST } from '@aglyn/aglyn/server'
import { POST as RESOURCES_POST } from '../app/api/hosts/resources/route'
import { POST as SCREENS_POST } from '../app/api/hosts/screens/route'
import { billableScreenIds } from '../app/api/hosts/resources/count-billable-screens'

function seed(
  options: { plan?: string; screens?: string[]; routed?: string[] } = {},
) {
  const ids = options.screens ?? ['s1', 's2', 's3', 's4', 's5']
  const routed = options.routed ?? ids
  mockStore = {
    host: {
      memberRoles: { 'user-1': 'admin' },
      orgId: 'org-1',
      screens: Object.fromEntries(routed.map((id) => [id, id])),
    },
    screens: Object.fromEntries(
      ids.map((id) => [id, { displayName: `Page ${id}`, kind: 'page' }]),
    ),
    collections: {},
    org: { plan: options.plan ?? 'free' },
  }
  mockNextUid = 0
}

/** What the enforcement points count for the host right now. */
function billableNow(): number {
  return billableScreenIds(
    Object.entries(mockStore.screens).map(([id, data]) => ({ id, ...data })),
    mockStore.host.screens as Record<string, unknown>,
  ).size
}

const kindOf = (id: string) => mockStore.screens[id]?.kind
const slotOf = (slot: string) =>
  (mockStore.host.errorScreens as Record<string, unknown>)?.[slot]

/** Remove a screen's routing entry, as `unpublishScreenRoute` does. */
function unpublish(id: string) {
  delete (mockStore.host.screens as Record<string, unknown>)[id]
}

async function post(path: string, body: unknown) {
  const handler = path === 'screens' ? SCREENS_POST : RESOURCES_POST
  const response = await handler(
    new Request(`https://app.aglyn.com/api/hosts/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: JSON.stringify(body),
    }),
  )
  return { status: response.status, body: await response.json() }
}

/** Assign (or, with `null`, clear) one of the host's four error slots. */
const assign = (slot: string, id: string | null) =>
  post('screens', { hostId: 'host-1', action: 'error-screen', slot, id })

/** Convert one screen between page and template. */
const convert = (id: string, kind: string) =>
  post('screens', { hostId: 'host-1', id, action: 'convert', kind })

const createScreen = (data: Record<string, unknown> = {}) =>
  post('resources', {
    hostId: 'host-1',
    resource: 'screen',
    data: { displayName: 'New page', ...data },
  })

beforeEach(() => {
  mockVerifyIdToken.mockResolvedValue({ uid: 'user-1', email_verified: true })
  seed()
})

describe('an assigned error screen does not spend the allowance (AGL-2092)', () => {
  it('stops counting once it has no address of its own', async () => {
    expect(billableNow()).toBe(5)
    // Assigning alone changes nothing, because s1 is still published at `/s1`.
    expect((await assign('notFound', 's1')).status).toBe(200)
    expect(kindOf('s1')).toBe('error')
    expect(slotOf('notFound')).toBe('s1')
    expect(billableNow()).toBe(5)
    // Removing the address is what frees the slot.
    unpublish('s1')
    expect(billableNow()).toBe(4)
    // …and the freed slot admits a page, which is the point of the decision.
    expect((await createScreen()).status).toBe(200)
  })

  it('writes the legacy flat field too, for older tenant builds', async () => {
    await assign('notFound', 's1')
    expect(mockStore.host.notFoundScreenId).toBe('s1')
    await assign('notFound', null)
    expect('notFoundScreenId' in mockStore.host).toBe(false)
  })

  it('binds each slot without clobbering its siblings', async () => {
    await assign('notFound', 's1')
    await assign('unavailable', 's2')
    expect(slotOf('notFound')).toBe('s1')
    expect(slotOf('unavailable')).toBe('s2')
  })

  // THE OTHER DIRECTION, which is the property that keeps the count and the
  // serve path from disagreeing: the routing map outranks the document.
  it('counts the SAME screen again the moment it is routed', async () => {
    await assign('notFound', 's1')
    unpublish('s1')
    expect(billableNow()).toBe(4)
    // Re-publishing it at an address makes it a page somebody is using as a
    // page, whatever its `kind` says.
    ;(mockStore.host.screens as Record<string, unknown>)['s1'] = 'oops'
    expect(kindOf('s1')).toBe('error')
    expect(billableNow()).toBe(5)
  })

  it('refuses to overwrite an email document or an entry template', async () => {
    mockStore.screens.s1 = { displayName: 'Welcome', kind: 'email' }
    mockStore.screens.s2 = { displayName: 'Entry', kind: 'template' }
    expect((await assign('notFound', 's1')).status).toBe(400)
    expect(kindOf('s1')).toBe('email')
    expect((await assign('notFound', 's2')).status).toBe(400)
    expect(kindOf('s2')).toBe('template')
    expect(slotOf('notFound')).toBeUndefined()
  })

  it('refuses an unknown or deleted screen', async () => {
    expect((await assign('notFound', 'nope')).status).toBe(404)
    mockStore.screens.s1 = { displayName: 'Old', deletedAt: { seconds: 1 } }
    expect((await assign('notFound', 's1')).status).toBe(404)
  })

  it('refuses a slot that is not one of the four', async () => {
    expect((await assign('teapot', 's1')).status).toBe(400)
    expect(kindOf('s1')).toBe('page')
  })
})

describe('the bound: four slots, four exemptions (AGL-2092)', () => {
  it('refuses the fifth error screen', async () => {
    seed({ screens: ['s1', 's2', 's3', 's4', 's5', 's6'] })
    for (const [index, slot] of HOST_ERROR_SCREEN_SLOTS.entries()) {
      expect((await assign(slot, `s${index + 1}`)).status).toBe(200)
    }
    expect(ERROR_SCREEN_MAX_PER_HOST).toBe(4)
    // Every slot is taken, so a fifth can only be minted by re-using one —
    // which is where the bound bites, because the screen it displaces KEEPS
    // its `kind: 'error'` (clearing is free, by design).
    const fifth = await assign('notFound', 's5')
    expect(fifth.status).toBe(403)
    expect(fifth.body.error).toContain('already has 4 error screens')
    expect(kindOf('s5')).toBe('page')
  })

  it('counts LIVE error screens only, so deleting one frees the bound', async () => {
    seed({ screens: ['s1', 's2', 's3', 's4', 's5'] })
    for (const [index, slot] of HOST_ERROR_SCREEN_SLOTS.entries()) {
      await assign(slot, `s${index + 1}`)
    }
    expect((await assign('notFound', 's5')).status).toBe(403)
    // Soft-delete is the give-up: the screen is gone, so it holds no exemption.
    mockStore.screens.s4.deletedAt = { seconds: 1 }
    expect((await assign('notFound', 's5')).status).toBe(200)
    expect(kindOf('s5')).toBe('error')
  })

  it('re-assigning a screen that is ALREADY an error screen is free', async () => {
    seed({ screens: ['s1', 's2', 's3', 's4', 's5'] })
    for (const [index, slot] of HOST_ERROR_SCREEN_SLOTS.entries()) {
      await assign(slot, `s${index + 1}`)
    }
    // Moving s1 from the 404 slot to the 403 slot mints nothing, so the bound
    // must not read it as a fifth stamp.
    expect((await assign('forbidden', 's1')).status).toBe(200)
    expect(slotOf('forbidden')).toBe('s1')
  })

  // THE HOLE THE BOUND EXISTS FOR. `convert` is the only other writer of
  // `kind`, and if it accepted `'error'` as a target the four slots would bound
  // nothing at all — a site could stamp every screen it owns.
  it('gives `convert` no way to stamp an error screen', async () => {
    const refused = await convert('s1', 'error')
    expect(refused.status).toBe(400)
    expect(kindOf('s1')).toBe('page')
  })

  /**
   * THE SAME HOLE ON THE CREATE PATH, which this arc's own comment predicted:
   * `/api/hosts/resources` refused `kind: 'template'` by NAME, and AGL-1439's
   * neighbouring cap says in as many words that enumerating the values "would
   * leave the next non-page kind unbounded again". `kind: 'error'` was the next
   * non-page kind, and it would have walked straight through — a screen created
   * already exempt, no slot, no bound, no stamp anybody counted.
   *
   * Refused by the PREDICATE now, with `email` the one named exception (the
   * composer must send it on the create it owns). Seeded with room, so the
   * refusal can only be about the kind and not about the quota.
   */
  it('gives the create path no way to mint one either', async () => {
    seed({ screens: ['s1', 's2'] })
    expect((await createScreen()).status).toBe(200)
    const created = await createScreen({ kind: 'error' })
    expect(created.status).toBe(403)
    expect(created.body.error).toContain('error')
    expect(Object.keys(mockStore.screens)).toHaveLength(3)
    // The exception survives the rewrite: the Emails page still creates its
    // documents, which is what the `kind` allow-list was opened for.
    expect((await createScreen({ kind: 'email' })).status).toBe(200)
  })
})

describe('clearing a slot is never refused, and mints nothing (AGL-1390)', () => {
  it('lets the clear succeed with the screen still excluded', async () => {
    await assign('notFound', 's1')
    unpublish('s1')
    expect(billableNow()).toBe(4)
    expect((await createScreen()).status).toBe(200)
    expect(billableNow()).toBe(5)

    // The clear that AGL-1390 had to REFUSE. It succeeds, and moves no count:
    // s1 is still an error screen — not a page, not routed, not billed.
    const cleared = await assign('notFound', null)
    expect(cleared.status).toBe(200)
    expect(slotOf('notFound')).toBeUndefined()
    expect(kindOf('s1')).toBe('error')
    expect(billableNow()).toBe(5)

    // And the loop's second turn buys nothing: s1 is already stamped, so
    // re-binding it is not a fifth exemption, and there is no page to free.
    expect((await assign('notFound', 's1')).status).toBe(200)
    expect(billableNow()).toBe(5)
    expect((await createScreen()).status).toBe(403)
  })

  it('clears a slot on a host that never had one', async () => {
    // `update` on a nested path Firestore has never seen: the delete must not
    // throw, and must not conjure an `errorScreens` map full of sentinels.
    expect((await assign('unavailable', null)).status).toBe(200)
    expect(slotOf('unavailable')).toBeUndefined()
  })

  it('is the only way back, and the way back is checked like a create', async () => {
    await assign('notFound', 's1')
    unpublish('s1')
    await createScreen()
    expect(billableNow()).toBe(5)

    // A bound screen cannot be converted in either direction — the assignment
    // would be left pointing at a page, or at a document the error-render path
    // refuses to serve.
    expect((await convert('s1', 'page')).status).toBe(400)
    expect((await convert('s1', 'template')).status).toBe(400)

    // Unassign (free), then promote — and the promotion meets the same
    // arithmetic a create does, which is where the laundering loop is closed.
    expect((await assign('notFound', null)).status).toBe(200)
    const promoted = await convert('s1', 'page')
    expect(promoted.status).toBe(403)
    expect(promoted.body.error).toContain('6 of 5')
    expect(kindOf('s1')).toBe('error')
  })

  it('promotes once there is room', async () => {
    seed({ screens: ['s1', 's2'] })
    await assign('notFound', 's1')
    unpublish('s1')
    expect(billableNow()).toBe(1)
    await assign('notFound', null)
    expect((await convert('s1', 'page')).status).toBe(200)
    expect(kindOf('s1')).toBe('page')
    // Promotion does not restore the address; the site republishes when it
    // wants one. Until then it is an ordinary unrouted page, and counts.
    expect(billableNow()).toBe(2)
  })
})

describe('the write is the server\'s (AGL-1383)', () => {
  it('refuses an editor without the writer role', async () => {
    mockStore.host.memberRoles = { 'user-1': 'viewer' }
    expect((await assign('notFound', 's1')).status).toBe(403)
    expect(kindOf('s1')).toBe('page')
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await SCREENS_POST(
      new Request('https://app.aglyn.com/api/hosts/screens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hostId: 'host-1',
          action: 'error-screen',
          slot: 'notFound',
          id: 's1',
        }),
      }),
    )
    expect(response.status).toBe(401)
    expect(kindOf('s1')).toBe('page')
  })

  it('refuses a suspended site (AGL-1501)', async () => {
    mockStore.host.suspendedAt = 1
    expect((await assign('notFound', 's1')).status).toBe(423)
    expect(kindOf('s1')).toBe('page')
  })
})
