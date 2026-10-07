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
 *
 * @jest-environment node
 */

/**
 * CHECK-IN AND RESCHEDULE (AGL-3621). The two member routes the native Aglyn
 * app and the console call to act on a booking: who may, what state allows it, that a
 * move never double-books, that a retry changes nothing twice, and that the
 * guest is told when their booking moves.
 */

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({}) },
  getOrgForHost: async () => null,
  hostSendingIdentity: async () => null,
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))
jest.mock('@aglyn/tenant-data-admin/server/tenant-write-lockdown', () => ({ getSiteLockdown: async () => null }))
jest.mock('@aglyn/aglyn/server', () => ({ resolveBrandingProfile: () => ({ fromName: 'Shop' }) }))
jest.mock('@aglyn/shared-util-email', () => ({ isEmailConfigured: () => true, sendEmail: async () => undefined }))

import type { HostBookingService } from '../model/bookings'
import {
  type BookingManageDeps,
  createBookingCheckInHandler,
  createBookingRescheduleHandler,
  type ManageFirestore,
  type ManageQuery,
  type RescheduleNotice,
} from './booking-manage'

type Doc = Record<string, unknown>

const HOUR = 60 * 60_000
// Monday 2026-06-01 00:00 UTC.
const MONDAY = Date.UTC(2026, 5, 1)
const NOW = MONDAY - 24 * HOUR

const service: HostBookingService = {
  name: 'Haircut',
  durationMinutes: 60,
  timezone: 'UTC',
  // Monday 9:00–17:00 UTC.
  windows: { 1: [{ start: 9 * 60, end: 17 * 60 }] },
}

/** An in-memory Firestore with the semantics the routes rely on. */
function store(initial: Record<string, Doc>) {
  const docs = new Map<string, Doc>(Object.entries(initial).map(([path, data]) => [path, { ...data }]))
  const snapshot = (path: string) => {
    const data = docs.get(path)
    return {
      exists: data !== undefined,
      id: path.split('/').pop(),
      get: (field: string) => data?.[field],
      data: () => (data ? { ...data } : undefined),
    }
  }
  const query = (path: string, filters: Array<[string, string, unknown]> = []): ManageQuery & { run(): unknown } => ({
    where: (field, op, value) => query(path, [...filters, [field, op, value]]),
    limit: () => query(path, filters),
    run: () => ({
      docs: [...docs.keys()]
        .filter((key) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
        .filter((key) =>
          filters.every(([field, op, value]) => {
            const actual = docs.get(key)?.[field] as number
            return op === '==' ? actual === value : op === '>=' ? actual >= (value as number) : actual < (value as number)
          }),
        )
        .map(snapshot),
    }),
  })
  const firestore: ManageFirestore = {
    doc: (path) => ({ id: path, get: async () => snapshot(path) }),
    collection: (path) => query(path),
    runTransaction: async (fn) =>
      fn({
        get: (async (target: { id: string; run?: () => unknown }) =>
          target.run ? target.run() : snapshot(target.id)) as never,
        update: (ref, data) => {
          docs.set(ref.id, { ...(docs.get(ref.id) ?? {}), ...data })
        },
      }),
  }
  return { docs, firestore }
}

function deps(firestore: ManageFirestore, overrides: Partial<BookingManageDeps> = {}) {
  const notices: RescheduleNotice[] = []
  const value: BookingManageDeps = {
    firestore: () => firestore,
    verifyIdToken: async (token) => {
      if (token !== 'good') throw Object.assign(new Error('Firebase ID token has expired.'), { code: 'auth/id-token-expired' })
      return { uid: 'editor-1' }
    },
    siteLocked: async () => false,
    timeZoneFor: async () => 'UTC',
    notifyRescheduled: async (notice) => {
      notices.push(notice)
    },
    now: () => NOW,
    ...overrides,
  }
  return { value, notices }
}

const res = () => {
  const out = {
    statusCode: 0,
    body: undefined as any,
    status(code: number) {
      out.statusCode = code
      return out
    },
    json(body: unknown) {
      out.body = body
    },
  }
  return out
}

const req = (body: Record<string, unknown>, token = 'good') =>
  ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { hostId: 'h1', ...body }, query: {}, cookies: {}, socket: {} }) as never

const booking = (startsAtMs: number, extra: Doc = {}): Doc => ({
  serviceId: 's1',
  serviceName: 'Haircut',
  name: 'Alex',
  email: 'alex@example.com',
  status: 'confirmed',
  startsAtMs,
  endsAtMs: startsAtMs + HOUR,
  timezone: 'UTC',
  ...extra,
})

const base = (bookings: Record<string, Doc>, roles: Record<string, string> = { 'editor-1': 'editor' }) =>
  store({
    'hosts/h1': { memberRoles: roles },
    'hosts/h1/services/s1': service as unknown as Doc,
    ...Object.fromEntries(Object.entries(bookings).map(([id, data]) => [`hosts/h1/bookings/${id}`, data])),
  })

describe('bookings/check-in', () => {
  it('checks a confirmed guest in, stamping who and when, and a retry changes nothing', async () => {
    const { docs, firestore } = base({ b1: booking(MONDAY + 10 * HOUR) })
    const handler = createBookingCheckInHandler(deps(firestore).value)
    const first = res()
    await handler(req({ bookingId: 'b1' }), first as never)
    expect(first.statusCode).toBe(200)
    expect(docs.get('hosts/h1/bookings/b1')).toMatchObject({ checkedInAtMs: NOW, checkedInBy: 'editor-1' })

    const later = createBookingCheckInHandler(deps(firestore, { now: () => NOW + 5000 }).value)
    const again = res()
    await later(req({ bookingId: 'b1' }), again as never)
    expect(again.statusCode).toBe(200)
    expect(docs.get('hosts/h1/bookings/b1')?.['checkedInAtMs']).toBe(NOW)
  })

  it('undoes a check-in', async () => {
    const { docs, firestore } = base({ b1: booking(MONDAY + 10 * HOUR, { checkedInAtMs: NOW - 1, checkedInBy: 'x' }) })
    const out = res()
    await createBookingCheckInHandler(deps(firestore).value)(req({ bookingId: 'b1', checkedIn: false }), out as never)
    expect(out.statusCode).toBe(200)
    expect(docs.get('hosts/h1/bookings/b1')).toMatchObject({ checkedInAtMs: null, checkedInBy: null })
  })

  it.each([
    ['canceled', { status: 'canceled' }, 'This booking was canceled'],
    ['unpaid', { status: 'pendingPayment', expiresAtMs: NOW + HOUR }, 'This booking is not paid yet'],
  ])('refuses a %s booking', async (_label, extra, message) => {
    const { firestore } = base({ b1: booking(MONDAY + 10 * HOUR, extra) })
    const out = res()
    await createBookingCheckInHandler(deps(firestore).value)(req({ bookingId: 'b1' }), out as never)
    expect(out.statusCode).toBe(409)
    expect(out.body).toEqual({ error: message })
  })

  it('refuses a viewer, a stranger, a bad token and a locked site', async () => {
    const viewer = base({ b1: booking(MONDAY + 10 * HOUR) }, { 'editor-1': 'viewer' })
    const a = res()
    await createBookingCheckInHandler(deps(viewer.firestore).value)(req({ bookingId: 'b1' }), a as never)
    expect(a.statusCode).toBe(403)

    const stranger = base({ b1: booking(MONDAY + 10 * HOUR) }, {})
    const b = res()
    await createBookingCheckInHandler(deps(stranger.firestore).value)(req({ bookingId: 'b1' }), b as never)
    expect(b.statusCode).toBe(403)

    const ok = base({ b1: booking(MONDAY + 10 * HOUR) })
    const c = res()
    await createBookingCheckInHandler(deps(ok.firestore).value)(req({ bookingId: 'b1' }, 'bad'), c as never)
    expect(c.statusCode).toBe(401)

    const d = res()
    await createBookingCheckInHandler(deps(ok.firestore, { siteLocked: async () => true }).value)(req({ bookingId: 'b1' }), d as never)
    expect(d.statusCode).toBe(423)
    expect(ok.docs.get('hosts/h1/bookings/b1')?.['checkedInAtMs']).toBeUndefined()
  })

  it('answers 404 for a booking that does not exist', async () => {
    const { firestore } = base({})
    const out = res()
    await createBookingCheckInHandler(deps(firestore).value)(req({ bookingId: 'nope' }), out as never)
    expect(out.statusCode).toBe(404)
  })
})

describe('bookings/reschedule', () => {
  it('moves a booking to an open slot, keeps its length, owes the reminder again and tells the guest', async () => {
    const { docs, firestore } = base({ b1: booking(MONDAY + 10 * HOUR, { reminderSentAt: 'sent' }) })
    const wired = deps(firestore)
    const out = res()
    await createBookingRescheduleHandler(wired.value)(req({ bookingId: 'b1', startsAtMs: MONDAY + 14 * HOUR }), out as never)
    expect(out.statusCode).toBe(200)
    expect(out.body).toMatchObject({ ok: true, startsAtMs: MONDAY + 14 * HOUR, endsAtMs: MONDAY + 15 * HOUR, notified: true })
    expect(docs.get('hosts/h1/bookings/b1')).toMatchObject({
      startsAtMs: MONDAY + 14 * HOUR,
      endsAtMs: MONDAY + 15 * HOUR,
      rescheduledFromMs: MONDAY + 10 * HOUR,
      rescheduledBy: 'editor-1',
      reminderSentAt: null,
    })
    expect(wired.notices).toHaveLength(1)
    expect(wired.notices[0]).toMatchObject({ to: 'alex@example.com', serviceName: 'Haircut', timezone: 'UTC' })
    expect(wired.notices[0].when).toContain('2:00')
    expect(wired.notices[0].previousWhen).toContain('10:00')
  })

  it('never double-books: a slot another live booking holds is refused', async () => {
    const { docs, firestore } = base({
      b1: booking(MONDAY + 10 * HOUR),
      b2: booking(MONDAY + 14 * HOUR, { email: 'sam@example.com' }),
    })
    const out = res()
    await createBookingRescheduleHandler(deps(firestore).value)(req({ bookingId: 'b1', startsAtMs: MONDAY + 14 * HOUR }), out as never)
    expect(out.statusCode).toBe(409)
    expect(docs.get('hosts/h1/bookings/b1')?.['startsAtMs']).toBe(MONDAY + 10 * HOUR)
  })

  it('counts its own old slot as free, and a canceled or lapsed booking as free', async () => {
    const { firestore } = base({
      b1: booking(MONDAY + 10 * HOUR),
      b2: booking(MONDAY + 11 * HOUR, { status: 'canceled' }),
      b3: booking(MONDAY + 12 * HOUR, { status: 'pendingPayment', expiresAtMs: NOW - 1 }),
    })
    for (const target of [MONDAY + 10.5 * HOUR, MONDAY + 11 * HOUR, MONDAY + 12 * HOUR]) {
      const out = res()
      await createBookingRescheduleHandler(deps(firestore).value)(req({ bookingId: 'b1', startsAtMs: target }), out as never)
      expect(out.statusCode).toBe(200)
    }
  })

  it('refuses a time outside the service hours and a time that has passed', async () => {
    const { firestore } = base({ b1: booking(MONDAY + 10 * HOUR) })
    const closed = res()
    await createBookingRescheduleHandler(deps(firestore).value)(req({ bookingId: 'b1', startsAtMs: MONDAY + 20 * HOUR }), closed as never)
    expect(closed.statusCode).toBe(409)
    const past = res()
    await createBookingRescheduleHandler(deps(firestore).value)(req({ bookingId: 'b1', startsAtMs: NOW - HOUR }), past as never)
    expect(past.statusCode).toBe(409)
    expect(past.body).toEqual({ error: 'Pick a time that has not passed' })
  })

  it('a retried move writes nothing and does not email twice', async () => {
    const { firestore } = base({ b1: booking(MONDAY + 10 * HOUR) })
    const wired = deps(firestore)
    const handler = createBookingRescheduleHandler(wired.value)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const out = res()
      await handler(req({ bookingId: 'b1', startsAtMs: MONDAY + 13 * HOUR }), out as never)
      expect(out.statusCode).toBe(200)
    }
    expect(wired.notices).toHaveLength(1)
  })

  it('keeps the move when the email fails, and says the guest was not told', async () => {
    const { docs, firestore } = base({ b1: booking(MONDAY + 10 * HOUR) })
    const out = res()
    const failing = deps(firestore, {
      notifyRescheduled: async () => {
        throw new Error('mail down')
      },
    })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    await createBookingRescheduleHandler(failing.value)(req({ bookingId: 'b1', startsAtMs: MONDAY + 13 * HOUR }), out as never)
    spy.mockRestore()
    expect(out.statusCode).toBe(200)
    expect(out.body).toMatchObject({ notified: false })
    expect(docs.get('hosts/h1/bookings/b1')?.['startsAtMs']).toBe(MONDAY + 13 * HOUR)
  })

  it('refuses a checked-in, canceled or unpaid booking, and a deleted service', async () => {
    const cases: Array<[Doc, number]> = [
      [booking(MONDAY + 10 * HOUR, { checkedInAtMs: NOW }), 409],
      [booking(MONDAY + 10 * HOUR, { status: 'canceled' }), 409],
      [booking(MONDAY + 10 * HOUR, { status: 'pendingPayment', expiresAtMs: NOW + HOUR }), 409],
    ]
    for (const [data, status] of cases) {
      const { firestore } = base({ b1: data })
      const out = res()
      await createBookingRescheduleHandler(deps(firestore).value)(req({ bookingId: 'b1', startsAtMs: MONDAY + 13 * HOUR }), out as never)
      expect(out.statusCode).toBe(status)
    }
    const gone = store({
      'hosts/h1': { memberRoles: { 'editor-1': 'editor' } },
      'hosts/h1/services/s1': { ...(service as unknown as Doc), deletedAt: 1 },
      'hosts/h1/bookings/b1': booking(MONDAY + 10 * HOUR),
    })
    const out = res()
    await createBookingRescheduleHandler(deps(gone.firestore).value)(req({ bookingId: 'b1', startsAtMs: MONDAY + 13 * HOUR }), out as never)
    expect(out.statusCode).toBe(409)
  })

  it('refuses a missing time and a non-POST', async () => {
    const { firestore } = base({ b1: booking(MONDAY + 10 * HOUR) })
    const out = res()
    await createBookingRescheduleHandler(deps(firestore).value)(req({ bookingId: 'b1' }), out as never)
    expect(out.statusCode).toBe(400)
    const get = res()
    await createBookingRescheduleHandler(deps(firestore).value)({ method: 'GET', headers: {}, body: {} } as never, get as never)
    expect(get.statusCode).toBe(405)
  })
})
