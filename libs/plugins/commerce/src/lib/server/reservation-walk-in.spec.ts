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
 */

/**
 * `POST /api/commerce/reservations/walk-in` (AGL-4046).
 *
 * Firestore is the in-memory double `reserve-idempotency.spec.ts` uses for the
 * same race: a version per COLLECTION, so a transaction that read the
 * availability QUERY is retried when a NEW reservation lands under it. A
 * double that versioned only the documents read would let both walk-ins
 * commit, since the conflicting write is a document neither read.
 */

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
  getLockdownVerdict: jest.fn(),
  getOrgForHost: jest.fn(),
  isImpersonationSession: (decoded: { impersonatedBy?: string }) =>
    Boolean(decoded.impersonatedBy),
}))

import {
  createReservationWalkInHandler,
  WALK_IN_GONE,
  WALK_IN_ID_CONFLICT,
  WALK_IN_PLAN_REFUSAL,
  WALK_IN_PLUGIN_OFF,
  WALK_IN_PERMISSION_REFUSAL,
  WALK_IN_TAKEN_EVERY_UNIT,
  WALK_IN_TAKEN_ONE_UNIT,
} from './reservation-walk-in'

// ---------------------------------------------------------------------------
// In-memory Firestore (the reserve-idempotency.spec.ts double)
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()
const collectionVersions = new Map<string, number>()
let autoIdCounter = 0
let afterRead: (() => Promise<void>) | null = null
let abortedRetries = 0

function bumpCollection(docPath: string): void {
  const collection = docPath.slice(0, docPath.lastIndexOf('/'))
  collectionVersions.set(collection, (collectionVersions.get(collection) ?? 0) + 1)
}

function writeDoc(path: string, value: Record<string, any>, merge: boolean): void {
  docs.set(path, merge ? { ...(docs.get(path) ?? {}), ...value } : value)
  bumpCollection(path)
}

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>) => writeDoc(path, value, false),
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

interface Filter {
  field: string
  op: string
  value: any
}

function applyFilter(data: any, filter: Filter): boolean {
  const actual = data?.[filter.field]
  switch (filter.op) {
    case '==':
      return actual === filter.value
    case '>':
      return Number(actual) > Number(filter.value)
    default:
      throw new Error(`Unmodelled operator: ${filter.op}`)
  }
}

function makeQuery(path: string, filters: Filter[], order: string | null, limit: number | null): any {
  return {
    collectionPath: path,
    filters,
    order,
    limitCount: limit,
    where: (field: string, op: string, value: any) =>
      makeQuery(path, [...filters, { field, op, value }], order, limit),
    orderBy: (field: string) => makeQuery(path, filters, field, limit),
    limit: (count: number) => makeQuery(path, filters, order, count),
    get: async () => {
      let keys = childPaths(path).filter((key) =>
        filters.every((filter) => applyFilter(docs.get(key), filter)),
      )
      if (order) {
        keys = keys
          .filter((key) => (docs.get(key) as any)?.[order] !== undefined)
          .sort((a, b) => Number((docs.get(a) as any)[order]) - Number((docs.get(b) as any)[order]))
      }
      if (limit != null) keys = keys.slice(0, limit)
      return { docs: keys.map(makeSnapshot) }
    },
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id?: string) => makeDocRef(`${path}/${id ?? `auto-${++autoIdCounter}`}`),
    where: (field: string, op: string, value: any) => makeQuery(path, [{ field, op, value }], null, null),
  }
}

/** Optimistic concurrency over query reads, as the reserve spec models it. */
async function runTransaction(body: (transaction: any) => Promise<any>): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const readVersions = new Map<string, number>()
    const writes: { path: string; value: Record<string, any> }[] = []
    const transaction = {
      get: async (target: any) => {
        if (target?.collectionPath) {
          readVersions.set(target.collectionPath, collectionVersions.get(target.collectionPath) ?? 0)
          return target.get()
        }
        const collection = target.path.slice(0, target.path.lastIndexOf('/'))
        readVersions.set(collection, collectionVersions.get(collection) ?? 0)
        return makeSnapshot(target.path)
      },
      set: (ref: any, value: Record<string, any>) => {
        writes.push({ path: ref.path, value })
      },
    }
    const result = await body(transaction)
    if (afterRead && attempt === 0) {
      const hook = afterRead
      afterRead = null
      await hook()
    }
    const stale = [...readVersions.entries()].some(
      ([collection, version]) => (collectionVersions.get(collection) ?? 0) !== version,
    )
    if (stale) {
      abortedRetries++
      continue
    }
    for (const write of writes) writeDoc(write.path, write.value, false)
    return result
  }
  throw Object.assign(new Error('ABORTED: too much contention'), { code: 10 })
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
  runTransaction,
}

// ---------------------------------------------------------------------------
// The handler, with its gate's boundaries injected
// ---------------------------------------------------------------------------

const DAY = 86_400_000
const IN = Date.UTC(2026, 10, 6)
const NOW = IN - 3 * DAY

const TOKENS: Record<string, Record<string, unknown> & { uid: string }> = {
  editor: { uid: 'u-editor', email_verified: true },
  author: { uid: 'u-author', email_verified: true },
  admin: { uid: 'u-admin', email_verified: true },
  viewer: { uid: 'u-viewer', email_verified: true },
  stranger: { uid: 'u-stranger', email_verified: true },
  unverified: { uid: 'u-editor', email_verified: false },
  staff: { uid: 'u-staff', staff: true },
}

let org: Record<string, unknown> = { plan: 'business' }
let locked = false

const handler = createReservationWalkInHandler({
  firestore: () => fakeFirestore as never,
  verifyIdToken: async (token: string) => {
    const decoded = TOKENS[token]
    if (!decoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
    return decoded
  },
  orgForHost: async () => ({ org }),
  lockdown: async () => (locked ? { scope: 'platform' } : null),
  now: () => NOW,
})

function call(token: string | null, body: Record<string, unknown>, method = 'POST') {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (code: number) => ((res.statusCode = code), res)
  res.json = (value: unknown) => ((res.body = value), res)
  return Promise.resolve(
    handler(
      { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body } as never,
      res,
    ),
  ).then(() => res as { statusCode: number; body: any })
}

const stays = () =>
  [...docs.entries()]
    .filter(([path]) => path.startsWith('hosts/h1/reservations/'))
    .map(([path, value]): Record<string, any> => ({ id: path.split('/').pop(), ...value }))

const seedStay = (id: string, resourceId: string, fromDay: number, toDay: number, status = 'confirmed') =>
  writeDoc(
    `hosts/h1/reservations/${id}`,
    {
      resourceId,
      status,
      checkInDayMs: IN + fromDay * DAY,
      checkOutDayMs: IN + toDay * DAY,
      createdAtMs: NOW - DAY,
    },
    false,
  )

const walkIn = (extra: Record<string, unknown> = {}) => ({
  hostId: 'h1',
  resourceId: 'cabin',
  checkInDayMs: IN,
  checkOutDayMs: IN + 2 * DAY,
  guestName: '  Jordan Lee  ',
  ...extra,
})

beforeEach(() => {
  docs.clear()
  collectionVersions.clear()
  autoIdCounter = 0
  afterRead = null
  abortedRetries = 0
  org = { plan: 'business' }
  locked = false
  writeDoc(
    'hosts/h1',
    {
      memberRoles: { 'u-editor': 'editor', 'u-author': 'author', 'u-admin': 'admin', 'u-viewer': 'viewer' },
    },
    false,
  )
  writeDoc('hosts/h1/resources/cabin', { name: 'Cabin', nightlyRateUsd: 120 }, false)
  writeDoc('hosts/h1/resources/hookups', { name: 'RV hookups', nightlyRateUsd: 60, units: 3 }, false)
  writeDoc('hosts/h1/resources/lodge', { name: 'Lodge', nightlyRateUsd: 200, minNights: 3 }, false)
})

describe('who may book a walk-in', () => {
  it.each([
    ['no token', null, 401],
    ['an unknown token', 'nobody', 401],
    ['an unverified email', 'unverified', 403],
    ['a viewer, who cannot write the site', 'viewer', 403],
    ['someone who is not a member of the site', 'stranger', 403],
  ])('refuses %s, and books nothing', async (_case, token, status) => {
    const res = await call(token, walkIn())
    expect(res.statusCode).toBe(status)
    expect(stays()).toEqual([])
  })

  it.each(['editor', 'author', 'admin', 'staff'])('lets %s book, as the rules do', async (token) => {
    const res = await call(token, walkIn())
    expect(res.statusCode).toBe(200)
    expect(stays()).toHaveLength(1)
  })

  it('names the permission booking a walk-in needs, never a role (AGL-4047)', async () => {
    const res = await call('viewer', walkIn())
    expect(res).toMatchObject({ statusCode: 403, body: { error: WALK_IN_PERMISSION_REFUSAL } })
    expect(res.body.error).toBe(
      'Your role does not include "Book walk-ins and change guests" — ask an organization admin',
    )
    expect(res.body.error).not.toMatch(/\b(admin, editor|editor role|author role)\b/i)
  })

  describe('the site’s stamp decides once the projection wrote it (AGL-4047)', () => {
    const stamp = (memberPermissions: Record<string, Record<string, boolean>>) =>
      writeDoc('hosts/h1', { ...docs.get('hosts/h1'), memberPermissions }, false)

    it('lets a viewer a custom role or override granted walk-ins book one', async () => {
      stamp({ 'u-viewer': { 'commerce.walkIns': true, 'commerce.reservations': false } })
      const res = await call('viewer', walkIn())
      expect(res.statusCode).toBe(200)
      expect(stays()).toHaveLength(1)
    })

    it('refuses an editor whose walk-ins a role or the site took away', async () => {
      stamp({ 'u-editor': { 'commerce.walkIns': false, 'commerce.reservations': true } })
      const res = await call('editor', walkIn())
      expect(res).toMatchObject({ statusCode: 403, body: { error: WALK_IN_PERMISSION_REFUSAL } })
      expect(stays()).toEqual([])
    })

    it('reads the site role’s preset for a member the stamp does not carry the key for', async () => {
      // A stamp written before the key existed carries other keys only.
      stamp({ 'u-author': { 'ai.use': true }, 'u-viewer': { 'ai.use': false } })
      expect((await call('author', walkIn())).statusCode).toBe(200)
      expect((await call('viewer', walkIn({ reservationId: 'other-attempt' }))).statusCode).toBe(403)
    })

    it('staff are still let through whatever the stamp says', async () => {
      stamp({ 'u-staff': { 'commerce.walkIns': false } })
      expect((await call('staff', walkIn())).statusCode).toBe(200)
    })
  })

  it('refuses a store whose plan does not take reservations, as the booking door does', async () => {
    org = { plan: 'free' }
    const res = await call('editor', walkIn())
    expect(res).toMatchObject({ statusCode: 403, body: { error: WALK_IN_PLAN_REFUSAL } })
    expect(stays()).toEqual([])
  })

  it('refuses a lapsed paid plan too (the sticky downgrade)', async () => {
    org = { plan: 'business', billingStatus: 'canceled' }
    const res = await call('admin', walkIn())
    expect(res.statusCode).toBe(403)
    expect(stays()).toEqual([])
  })

  it('refuses staff on a store whose plan does not take reservations', async () => {
    org = { plan: 'free' }
    const res = await call('staff', walkIn())
    expect(res).toMatchObject({ statusCode: 403, body: { error: WALK_IN_PLAN_REFUSAL } })
  })

  it('refuses while the site is locked down (423)', async () => {
    locked = true
    const res = await call('editor', walkIn())
    expect(res.statusCode).toBe(423)
    expect(stays()).toEqual([])
  })

  it('refuses a site that does not exist (404)', async () => {
    const res = await call('editor', walkIn({ hostId: 'h2' }))
    expect(res.statusCode).toBe(404)
  })

  it('refuses when commerce is turned off for the site (403)', async () => {
    writeDoc('hosts/h1', { ...docs.get('hosts/h1'), disabledPlugins: ['commerce'] }, false)
    const res = await call('editor', walkIn())
    expect(res).toMatchObject({ statusCode: 403, body: { error: WALK_IN_PLUGIN_OFF } })
    expect(stays()).toEqual([])
  })

  it('answers 405 to anything but POST', async () => {
    const res = await call('editor', walkIn(), 'GET')
    expect(res.statusCode).toBe(405)
  })

  it('answers 400 to a body missing its dates', async () => {
    const res = await call('editor', walkIn({ checkOutDayMs: undefined }))
    expect(res.statusCode).toBe(400)
  })
})

describe('what is checked before the write', () => {
  it('answers 404 "That resource is gone." for a deleted resource', async () => {
    const res = await call('editor', walkIn({ resourceId: 'gone' }))
    expect(res).toMatchObject({ statusCode: 404, body: { error: WALK_IN_GONE } })
    expect(stays()).toEqual([])
  })

  it('answers 400 with the quote’s problem', async () => {
    const res = await call('editor', walkIn({ resourceId: 'lodge' }))
    expect(res).toMatchObject({ statusCode: 400, body: { error: 'Minimum stay is 3 nights' } })
    expect(stays()).toEqual([])
  })

  it('answers 400 for a check-out on the arrival day', async () => {
    const res = await call('editor', walkIn({ checkOutDayMs: IN }))
    expect(res).toMatchObject({ statusCode: 400, body: { error: 'Choose at least one night' } })
  })

  it('books the guest count, up to what the resource sleeps (AGL-4043)', async () => {
    writeDoc('hosts/h1/resources/cabin', { name: 'Cabin', nightlyRateUsd: 120, capacity: 4 }, false)
    const tooMany = await call('editor', walkIn({ guests: 5 }))
    expect(tooMany).toMatchObject({ statusCode: 400, body: { error: 'Guests must be a whole number from 1 to 4' } })
    expect(stays()).toEqual([])
    const res = await call('editor', walkIn({ guests: 4 }))
    expect(res.statusCode).toBe(200)
    expect(stays()[0]).toMatchObject({ guests: 4 })
  })
})

describe('a one-unit resource, as before', () => {
  it('writes the card’s walk-in fields and answers the id', async () => {
    const res = await call('editor', walkIn())
    expect(res.statusCode).toBe(200)
    const [stay] = stays()
    expect(res.body).toEqual({ reservationId: stay.id })
    expect(stay).toEqual({
      id: stay.id,
      resourceId: 'cabin',
      status: 'confirmed',
      checkInDayMs: IN,
      checkOutDayMs: IN + 2 * DAY,
      guestName: 'Jordan Lee',
      guestEmail: null,
      nights: 2,
      totalCents: 24_000,
      depositCents: 0,
      paidCents: 0,
      createdAtMs: NOW,
    })
  })

  it('refuses overlapping dates with "Those dates are taken" (409)', async () => {
    seedStay('s1', 'cabin', 1, 3)
    const res = await call('editor', walkIn())
    expect(res).toMatchObject({ statusCode: 409, body: { error: WALK_IN_TAKEN_ONE_UNIT } })
    expect(stays()).toHaveLength(1)
  })

  it('books over a cancelled stay and a lapsed pending hold', async () => {
    seedStay('s1', 'cabin', 0, 2, 'cancelled')
    writeDoc(
      'hosts/h1/reservations/s2',
      { resourceId: 'cabin', status: 'pending', checkInDayMs: IN, checkOutDayMs: IN + DAY, createdAtMs: NOW - 31 * 60_000 },
      false,
    )
    const res = await call('editor', walkIn())
    expect(res.statusCode).toBe(200)
  })

  it('writes a guest name left out as null', async () => {
    const res = await call('editor', walkIn({ guestName: undefined }))
    expect(res.statusCode).toBe(200)
    expect(stays()[0].guestName).toBeNull()
  })
})

describe('a several-unit resource (AGL-4044)', () => {
  it('books the third unit beside two overlapping stays', async () => {
    seedStay('s1', 'hookups', 0, 2)
    seedStay('s2', 'hookups', 1, 3)
    const res = await call('editor', walkIn({ resourceId: 'hookups' }))
    expect(res.statusCode).toBe(200)
    expect(stays()).toHaveLength(3)
  })

  it('refuses when one night has no unit left, worded for units (409)', async () => {
    seedStay('s1', 'hookups', 0, 2)
    seedStay('s2', 'hookups', 1, 3)
    seedStay('s3', 'hookups', 1, 2)
    const res = await call('editor', walkIn({ resourceId: 'hookups' }))
    expect(res).toMatchObject({ statusCode: 409, body: { error: WALK_IN_TAKEN_EVERY_UNIT } })
    expect(stays()).toHaveLength(3)
  })
})

describe('two staff racing for the last unit', () => {
  it('THE CONTROL: the last unit is free to each of them on its own', async () => {
    seedStay('s1', 'hookups', 0, 2)
    seedStay('s2', 'hookups', 0, 2)
    const res = await call('editor', walkIn({ resourceId: 'hookups' }))
    expect(res.statusCode).toBe(200)
  })

  it('books one and refuses the other when the second lands between the first’s read and commit', async () => {
    seedStay('s1', 'hookups', 0, 2)
    seedStay('s2', 'hookups', 0, 2)
    let second: { statusCode: number; body: any } | null = null
    afterRead = async () => {
      second = await call('author', walkIn({ resourceId: 'hookups', guestName: 'Pat Lee' }))
    }

    const first = await call('editor', walkIn({ resourceId: 'hookups' }))

    expect(second).toMatchObject({ statusCode: 200 })
    expect(first).toMatchObject({ statusCode: 409, body: { error: WALK_IN_TAKEN_EVERY_UNIT } })
    // The first transaction re-ran on the second's write: that is the guard.
    expect(abortedRetries).toBe(1)
    expect(stays().filter((stay) => stay.resourceId === 'hookups')).toHaveLength(3)
  })

  it('gives one 200 and one 409 to two walk-ins sent at once', async () => {
    seedStay('s1', 'hookups', 0, 2)
    seedStay('s2', 'hookups', 0, 2)

    const answers = await Promise.all([
      call('editor', walkIn({ resourceId: 'hookups' })),
      call('author', walkIn({ resourceId: 'hookups' })),
    ])

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409])
    expect(stays().filter((stay) => stay.resourceId === 'hookups')).toHaveLength(3)
  })

  it('the same race on a one-unit resource says "Those dates are taken"', async () => {
    let second: { statusCode: number; body: any } | null = null
    afterRead = async () => {
      second = await call('author', walkIn())
    }
    const first = await call('editor', walkIn())
    expect(second).toMatchObject({ statusCode: 200 })
    expect(first).toMatchObject({ statusCode: 409, body: { error: WALK_IN_TAKEN_ONE_UNIT } })
    expect(stays()).toHaveLength(1)
  })
})

describe('a retried walk-in', () => {
  it('finds its own stay under the same id instead of booking a second unit', async () => {
    const first = await call('editor', walkIn({ resourceId: 'hookups', reservationId: 'attempt-1' }))
    const again = await call('editor', walkIn({ resourceId: 'hookups', reservationId: 'attempt-1' }))
    expect(first).toMatchObject({ statusCode: 200, body: { reservationId: 'attempt-1' } })
    expect(again).toMatchObject({ statusCode: 200, body: { reservationId: 'attempt-1', replayed: true } })
    expect(stays()).toHaveLength(1)
  })

  it('refuses an id that belongs to a different stay (409)', async () => {
    seedStay('attempt-1', 'cabin', 5, 6)
    const res = await call('editor', walkIn({ reservationId: 'attempt-1' }))
    expect(res).toMatchObject({ statusCode: 409, body: { error: WALK_IN_ID_CONFLICT } })
  })

  it('answers 400 to a malformed id', async () => {
    const res = await call('editor', walkIn({ reservationId: 'not/an/id' }))
    expect(res.statusCode).toBe(400)
  })
})
