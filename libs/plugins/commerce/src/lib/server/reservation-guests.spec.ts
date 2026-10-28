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

import type { PluginApiRequest } from '@aglyn/aglyn/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckInRow } from '../model/commerce-check-in'
import { posOpsHarness, type PosOpsHarness } from '../testing/pos-ops-harness'
import { CHECK_IN_RECONCILE_MS, handlePosCheckIn } from './pos-check-in'
import {
  createReservationGuestsHandler,
  RESERVATION_GUESTS_CLOSED,
  RESERVATION_GUESTS_GONE,
  RESERVATION_GUESTS_ROLE_REFUSAL,
} from './reservation-guests'
import { WALK_IN_PLAN_REFUSAL } from './reservation-walk-in'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'server-timestamp' },
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {},
  logHostActivity: jest.fn(),
  getLockdownVerdict: jest.fn(),
  getOrgForHost: jest.fn(),
  isImpersonationSession: () => false,
}))
jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({ resolveOrgPermissions: jest.fn() }))

/**
 * `POST /api/commerce/reservations/guests` (AGL-4043): a stay's guest count
 * after it is booked, and the day's check-ins brought in line with it. The
 * site is the check-in route's in-memory one in Chicago, read by both routes:
 * the clock reads 2027-01-15 08:00Z, the 15th there.
 */

const DAY = 86_400_000
const JAN_14 = Date.UTC(2027, 0, 14)

let h: PosOpsHarness
let org: Record<string, unknown>
let activity: jest.Mock

const TOKENS: Record<string, Record<string, unknown> & { uid: string }> = {
  editor: { uid: 'cashier', email_verified: true, email: 'cal@example.com' },
  viewer: { uid: 'viewer', email_verified: true },
  unverified: { uid: 'cashier', email_verified: false },
}

function handler() {
  return createReservationGuestsHandler({
    firestore: () => h.memory.firestore as never,
    verifyIdToken: async (token: string) => {
      const decoded = TOKENS[token]
      if (!decoded) throw Object.assign(new Error('bad token'), { code: 'auth/argument-error' })
      return decoded
    },
    orgForHost: async () => ({ org }),
    lockdown: async () => null,
    now: () => h.clock.now,
    logActivity: activity as never,
  })
}

async function change(
  body: Record<string, unknown>,
  token: string | null = 'editor',
  method = 'POST',
): Promise<{ statusCode: number; body: any }> {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (code: number) => ((res.statusCode = code), res)
  res.json = (value: unknown) => ((res.body = value), res)
  await handler()(
    { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: { hostId: 'shop', ...body } } as never,
    res,
  )
  return res
}

const guests = (reservationId: string, count: unknown, token?: string | null) =>
  change({ reservationId, guests: count }, token)

/** The check-in route, as the window works it. */
const checkIn = (ids: string[]) =>
  handlePosCheckIn(h.deps, h.request('cashier', { hostId: 'shop', action: 'check_in', checkIns: ids.map((id) => ({ id })) }))

async function dayList(day?: string): Promise<CheckInRow[]> {
  h.clock.now += CHECK_IN_RECONCILE_MS + 1
  const outcome = await handlePosCheckIn(h.deps, {
    method: 'GET',
    headers: { authorization: 'Bearer token-cashier' },
    body: {},
    query: { hostId: 'shop', ...(day ? { day } : {}) },
  } as unknown as PluginApiRequest)
  if ('csv' in outcome) throw new Error('expected JSON')
  return (outcome.body['checkIns'] as CheckInRow[]) ?? []
}

/** One stay's check-ins on a day, as `id status`, straight from storage. */
function stored(reservationId: string, dayKey = '2027-01-15'): string[] {
  const prefix = `r_${reservationId}_${dayKey}_`
  return [...h.memory.docs.entries()]
    .filter(([path]) => path.startsWith(`hosts/shop/checkIns/${prefix}`))
    .map(([path, data]) => `${path.split('/').pop()!.slice(prefix.length)} ${(data as { status: string }).status}`)
    .sort()
}

const unitCounts = (reservationId: string, dayKey = '2027-01-15') =>
  [...h.memory.docs.entries()]
    .filter(([path]) => path.startsWith(`hosts/shop/checkIns/r_${reservationId}_${dayKey}_`))
    .map(([, data]) => (data as { unitCount: number }).unitCount)

beforeEach(() => {
  h = posOpsHarness()
  h.clock.now = Date.UTC(2027, 0, 15, 8)
  org = { plan: 'business' }
  activity = jest.fn()
  h.memory.seed('hosts/shop', {
    memberRoles: { owner: 'admin', cashier: 'editor', viewer: 'viewer' },
    timeZone: 'America/Chicago',
  })
  // A cabin that sleeps 6, checked in one guest at a time; a tent site that
  // sleeps 4, checked in once per stay.
  h.memory.seed('hosts/shop/resources/cabin', { name: 'Cabin 3', nightlyRateUsd: 90, capacity: 6, checkInPerGuest: true })
  h.memory.seed('hosts/shop/resources/tent', { name: 'Tent site', nightlyRateUsd: 20, capacity: 4 })
  // The family arrived on the 14th and leaves on the 17th.
  h.memory.seed('hosts/shop/reservations/family', {
    resourceId: 'cabin',
    status: 'confirmed',
    checkInDayMs: JAN_14,
    checkOutDayMs: JAN_14 + 3 * DAY,
    guestName: 'Pat Lee',
    guests: 3,
    createdAtMs: JAN_14 - DAY,
  })
  h.memory.seed('hosts/shop/reservations/campers', {
    resourceId: 'tent',
    status: 'confirmed',
    checkInDayMs: JAN_14 + DAY,
    checkOutDayMs: JAN_14 + 2 * DAY,
    guestName: 'Jordan Rivera',
    createdAtMs: JAN_14 - DAY,
  })
})

describe('who may change a stay’s guests', () => {
  it.each([
    ['no token', null, 401],
    ['an unknown token', 'nobody', 401],
    ['an unverified email', 'unverified', 403],
    ['a viewer, who cannot write the site', 'viewer', 403],
  ])('refuses %s, and changes nothing', async (_case, token, status) => {
    const res = await guests('family', 4, token)
    expect(res.statusCode).toBe(status)
    expect(h.memory.read('hosts/shop/reservations/family')).toMatchObject({ guests: 3 })
    expect(activity).not.toHaveBeenCalled()
  })

  it('names the roles it takes, as the walk-in does', async () => {
    expect(await guests('family', 4, 'viewer')).toMatchObject({
      statusCode: 403,
      body: { error: RESERVATION_GUESTS_ROLE_REFUSAL },
    })
  })

  it('refuses a store whose plan does not take reservations', async () => {
    org = { plan: 'free' }
    expect(await guests('family', 4)).toMatchObject({ statusCode: 403, body: { error: WALK_IN_PLAN_REFUSAL } })
    expect(h.memory.read('hosts/shop/reservations/family')).toMatchObject({ guests: 3 })
  })

  it('answers POST only', async () => {
    expect((await change({ reservationId: 'family', guests: 4 }, 'editor', 'GET')).statusCode).toBe(405)
  })
})

describe('the count it takes', () => {
  it.each([
    ['none', undefined, 'Missing guest details'],
    ['zero', 0, 'Guests must be a whole number from 1 to 6'],
    ['more than the cabin sleeps', 7, 'Guests must be a whole number from 1 to 6'],
    ['a fraction', 2.5, 'Guests must be a whole number from 1 to 6'],
    ['a word', 'four', 'Guests must be a whole number from 1 to 6'],
  ])('refuses %s with a 400', async (_case, count, error) => {
    expect(await guests('family', count)).toMatchObject({ statusCode: 400, body: { error } })
    expect(h.memory.read('hosts/shop/reservations/family')).toMatchObject({ guests: 3 })
  })

  it('takes up to what the resource sleeps', async () => {
    expect(await guests('family', 6)).toMatchObject({ statusCode: 200, body: { guests: 6, previousGuests: 3 } })
    expect(await guests('campers', 5)).toMatchObject({ statusCode: 400, body: { error: 'Guests must be a whole number from 1 to 4' } })
  })

  it('refuses a stay that is gone, and one that has ended or was cancelled', async () => {
    expect(await guests('nobody', 2)).toMatchObject({ statusCode: 404, body: { error: RESERVATION_GUESTS_GONE } })
    for (const status of ['cancelled', 'no_show', 'checked_out']) {
      await h.memory.firestore.collection('hosts').doc('shop').collection('reservations').doc('family').set({ status }, { merge: true })
      expect(await guests('family', 4)).toMatchObject({ statusCode: 409, body: { error: RESERVATION_GUESTS_CLOSED } })
    }
  })

  it('writes nothing for the count the stay already has, so a retried tap is harmless', async () => {
    expect(await guests('family', 3)).toMatchObject({ statusCode: 200, body: { guests: 3, unchanged: true } })
    expect(h.memory.read('hosts/shop/reservations/family')).not.toHaveProperty('guestsChangedAtMs')
    expect(activity).not.toHaveBeenCalled()
  })

  it('stamps who changed it and when, and writes an activity line', async () => {
    await guests('family', 4)
    expect(h.memory.read('hosts/shop/reservations/family')).toMatchObject({
      guests: 4,
      guestsChangedAtMs: Date.UTC(2027, 0, 15, 8),
      guestsChangedBy: 'cashier',
    })
    expect(activity).toHaveBeenCalledWith(
      'shop',
      { uid: 'cashier', email: 'cal@example.com' },
      'Changed a stay’s guests from 3 to 4',
      { type: 'commerce:reservation', id: 'family', name: 'Cabin 3 · 2027-01-14' },
    )
  })
})

describe('the day’s check-ins, one per guest', () => {
  it('gives added guests their own waiting check-in, and updates the count on each', async () => {
    await dayList()
    expect(stored('family')).toEqual(['0 expected', '1 expected', '2 expected'])
    expect(await guests('family', 5)).toMatchObject({ statusCode: 200, body: { checkIns: { added: 2, removed: 0 } } })
    expect(stored('family')).toEqual(['0 expected', '1 expected', '2 expected', '3 expected', '4 expected'])
    expect(unitCounts('family')).toEqual([5, 5, 5, 5, 5])
  })

  it('takes away only waiting check-ins, never a guest already checked in', async () => {
    await dayList()
    // The third guest got here first.
    await checkIn(['r_family_2027-01-15_2'])
    expect(await guests('family', 2)).toMatchObject({ statusCode: 200, body: { checkIns: { added: 0, removed: 1 } } })
    expect(stored('family')).toEqual(['0 expected', '2 checked_in'])
    expect(unitCounts('family')).toEqual([2, 2])
    // The day's own reconcile reads the new count the same way.
    await dayList()
    expect(stored('family')).toEqual(['0 expected', '2 checked_in'])
  })

  it('refuses a count below how many are checked in, and changes nothing', async () => {
    await dayList()
    await checkIn(['r_family_2027-01-15_0', 'r_family_2027-01-15_1', 'r_family_2027-01-15_2'])
    expect(await guests('family', 2)).toMatchObject({
      statusCode: 409,
      body: { error: '3 of this stay’s guests are already checked in today. Undo a check-in first, or keep 3 or more.' },
    })
    expect(h.memory.read('hosts/shop/reservations/family')).toMatchObject({ guests: 3 })
    expect(stored('family')).toEqual(['0 checked_in', '1 checked_in', '2 checked_in'])
    expect(activity).not.toHaveBeenCalled()
    // Keeping all three is fine, and so is adding a fourth.
    expect(await guests('family', 4)).toMatchObject({ statusCode: 200 })
    expect(stored('family')).toEqual(['0 checked_in', '1 checked_in', '2 checked_in', '3 expected'])
  })

  it('brings later days in line too, and leaves earlier days as they were checked in', async () => {
    await dayList('2027-01-14')
    await dayList('2027-01-16')
    await dayList()
    expect(await guests('family', 4)).toMatchObject({ statusCode: 200, body: { checkIns: { added: 2, removed: 0 } } })
    expect(stored('family', '2027-01-14')).toEqual(['0 expected', '1 expected', '2 expected'])
    expect(stored('family', '2027-01-15')).toHaveLength(4)
    expect(stored('family', '2027-01-16')).toHaveLength(4)
  })

  it('names the day a later check-in floor is on', async () => {
    await dayList('2027-01-16')
    await checkIn(['r_family_2027-01-16_0', 'r_family_2027-01-16_1'])
    expect((await guests('family', 1)).body.error).toBe(
      '2 of this stay’s guests are already checked in on Sat, Jan 16. Undo a check-in first, or keep 2 or more.',
    )
  })

  it('leaves a day with no check-ins yet to its own reconcile, which reads the new count', async () => {
    expect(await guests('family', 2)).toMatchObject({ statusCode: 200, body: { checkIns: { added: 0, removed: 0 } } })
    await dayList()
    expect(stored('family')).toEqual(['0 expected', '1 expected'])
  })
})

describe('a stay checked in once per stay', () => {
  it('changes the count and leaves its one check-in alone', async () => {
    await dayList()
    await checkIn(['r_campers_2027-01-15_0'])
    expect(await guests('campers', 3)).toMatchObject({
      statusCode: 200,
      body: { guests: 3, previousGuests: 1, checkIns: { added: 0, removed: 0 } },
    })
    expect(stored('campers')).toEqual(['0 checked_in'])
  })
})

describe('the index its query needs', () => {
  it('declares checkIns (reservationId, dayKey)', () => {
    const config: { indexes: Array<{ collectionGroup: string; queryScope: string; fields: unknown[] }> } = JSON.parse(
      readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
    )
    expect(
      config.indexes.some(
        (index) =>
          index.collectionGroup === 'checkIns' &&
          index.queryScope === 'COLLECTION' &&
          JSON.stringify(index.fields) ===
            JSON.stringify([
              { fieldPath: 'reservationId', order: 'ASCENDING' },
              { fieldPath: 'dayKey', order: 'ASCENDING' },
            ]),
      ),
    ).toBe(true)
  })
})
