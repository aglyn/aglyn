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
 * The date-picker and the booking door apply the SAME hold rule.
 *
 * A `pending` reservation is written before the Stripe session opens and
 * nothing ever clears one — `process-abandoned.ts` sweeps `checkouts`, not
 * `reservations`. `reserve.ts` therefore lapses an unpaid hold after 30
 * minutes, so an abandoned checkout releases the dates. The public
 * availability handler carried its own dead-status set that knew nothing about
 * that lapse, so the two disagreed permanently: the calendar greyed out dates
 * the booking door would have sold, and every guest who reached that resource
 * afterwards saw them as taken.
 *
 * Asserted against the handler's `unavailable` ranges AND against
 * `isRangeAvailable` over the same rows, because the defect was the two
 * answering differently — a test that only asked one of them could pass while
 * the disagreement stood.
 */

interface Row {
  id: string
  data: Record<string, unknown>
}

const mockRows: Row[] = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const reservationsQuery = () => {
    const applied: Array<[string, string, unknown]> = []
    const api: Record<string, unknown> = {
      where: (field: string, op: string, value: unknown) => {
        applied.push([field, op, value])
        return api
      },
      orderBy: () => api,
      limit: () => api,
      get: async () => {
        const kept = mockRows.filter((row) =>
          applied.every(([field, op, value]) => {
            const held = row.data[field]
            if (op === '==') return held === value
            if (op === '>=') return Number(held) >= Number(value)
            if (op === '>') return Number(held) > Number(value)
            return true
          }),
        )
        return {
          docs: kept.map((row) => ({
            id: row.id,
            get: (field: string) => row.data[field],
            data: () => row.data,
          })),
        }
      },
    }
    return api
  }
  return {
    firebaseAdmin: {
      app: () => ({
        firestore: () => ({
          collection: () => ({
            doc: () => ({
              collection: (name: string) =>
                name === 'reservations'
                  ? reservationsQuery()
                  : {
                      doc: () => ({
                        get: async () => ({
                          data: () => ({
                            name: 'Cottage',
                            nightlyRateUsd: 100,
                            blocks: [],
                          }),
                        }),
                      }),
                    },
            }),
          }),
        }),
      }),
    },
  }
})

import {
  PENDING_RESERVATION_HOLD_MS,
  isRangeAvailable,
  type ReservationStatus,
} from '../model'
import { reservationAvailabilityHandler } from './reservation-availability'

const DAY = 24 * 60 * 60_000
const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
/** The stay every case below competes for: two nights, a week out. */
const CHECK_IN = todayMs + 7 * DAY
const CHECK_OUT = CHECK_IN + 2 * DAY

const stay = (
  id: string,
  status: ReservationStatus,
  ageMs: number,
): Row => ({
  id,
  data: {
    resourceId: 'r1',
    status,
    checkInDayMs: CHECK_IN,
    checkOutDayMs: CHECK_OUT,
    createdAtMs: Date.now() - ageMs,
  },
})

function makeResponse() {
  const result = { status: 0, body: undefined as any, headers: {} as any }
  const res: any = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: unknown) {
      result.body = body
    },
    send(body: unknown) {
      result.body = body
    },
    setHeader(name: string, value: unknown) {
      result.headers[name] = value
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  }
  return { res, result }
}

const run = async () => {
  const { res, result } = makeResponse()
  await reservationAvailabilityHandler(
    {
      method: 'GET',
      query: { hostId: 'h1', resourceId: 'r1' },
      body: {},
      headers: {},
      cookies: {},
      socket: {},
    } as never,
    res,
  )
  return result
}

/** `isRangeAvailable` over the same rows the handler just read. */
const bookingDoorSaysAvailable = () =>
  isRangeAvailable(
    { blocks: [] },
    mockRows.map((row) => ({
      checkInDayMs: Number(row.data['checkInDayMs']),
      checkOutDayMs: Number(row.data['checkOutDayMs']),
      status: row.data['status'] as ReservationStatus,
      createdAtMs: Number(row.data['createdAtMs']),
    })),
    CHECK_IN,
    CHECK_OUT,
  )

describe('the calendar and the booking door lapse a pending hold together', () => {
  beforeEach(() => {
    mockRows.length = 0
  })

  it('releases an abandoned checkout instead of holding the dates forever', async () => {
    mockRows.push(
      stay('abandoned', 'pending', PENDING_RESERVATION_HOLD_MS + 60_000),
    )

    const result = await run()

    expect(result.status).toBe(200)
    expect(result.body.unavailable).toEqual([])
    // The two surfaces agree, which is the point — the calendar cannot say
    // "taken" about dates the booking door would sell.
    expect(bookingDoorSaysAvailable()).toBe(true)
  })

  it('still holds a checkout that is in flight — the control', async () => {
    // Without this the fix could be satisfied by ignoring `pending` entirely,
    // which would let a second guest book over a card that is being charged.
    mockRows.push(stay('in-flight', 'pending', 60_000))

    const result = await run()

    expect(result.body.unavailable).toEqual([
      { fromDayMs: CHECK_IN, toDayMs: CHECK_OUT },
    ])
    expect(bookingDoorSaysAvailable()).toBe(false)
  })

  it('holds a confirmed stay however old it is — the second control', async () => {
    // The lapse is about an UNPAID hold. A paid stay booked a year ago still
    // occupies its dates, and a rule keyed on age alone would release it.
    mockRows.push(stay('paid', 'confirmed', 365 * DAY))

    const result = await run()

    expect(result.body.unavailable).toEqual([
      { fromDayMs: CHECK_IN, toDayMs: CHECK_OUT },
    ])
    expect(bookingDoorSaysAvailable()).toBe(false)
  })

  it('still drops a cancelled stay, as it always did', async () => {
    mockRows.push(stay('called-off', 'cancelled', 60_000))

    const result = await run()

    expect(result.body.unavailable).toEqual([])
    expect(bookingDoorSaysAvailable()).toBe(true)
  })
})
