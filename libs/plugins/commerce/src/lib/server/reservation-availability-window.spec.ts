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
 * The public availability calendar reads only stays that have not ended
 * (AGL-2159).
 *
 * `reserve.ts` — the authoritative overlap check — was narrowed from "500
 * documents of this resource's entire history, in `__name__` order" to "the
 * stays that could still overlap, nearest first". The handler that draws the
 * calendar the visitor picks from reads the same collection and kept the old
 * shape, so the two could disagree: the calendar offering a day the booking
 * path then refuses, or worse, a resource past 500 lifetime stays leaving a
 * LIVE booking out of its own greyed-out days.
 *
 * These assert the CONSTRAINTS the query carries and the documents it reads
 * back, never the rendered `unavailable` list alone. An unbounded query
 * returns the live stay too — it just returns several hundred dead ones
 * beside it — so an assertion that only checked "the live stay is blocked"
 * would pass on the shape it exists to reject.
 */

interface Row {
  id: string
  data: Record<string, unknown>
}

const mockRows: Row[] = []
/** Constraints the handler actually put on the reservations query. */
const mockConstraints: Array<[string, string, unknown]> = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const reservationsQuery = () => {
    const applied: Array<[string, string, unknown]> = []
    const api: Record<string, unknown> = {
      where: (field: string, op: string, value: unknown) => {
        applied.push([field, op, value])
        mockConstraints.push([field, op, value])
        return api
      },
      orderBy: (field: string) => {
        applied.push([field, 'orderBy', null])
        mockConstraints.push([field, 'orderBy', null])
        return api
      },
      limit: (value: number) => {
        applied.push(['__limit__', 'limit', value])
        mockConstraints.push(['__limit__', 'limit', value])
        return api
      },
      get: async () => {
        // The double actually ENFORCES the constraints. A stub that ignored
        // them would hand every row back whatever the query said, and the
        // read-count assertions below could never fail.
        const kept = mockRows.filter((row) =>
          applied.every(([field, op, value]) => {
            if (op === 'orderBy' || op === 'limit') return true
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

import { reservationAvailabilityHandler } from './reservation-availability'

const DAY = 24 * 60 * 60_000
const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)

const stay = (id: string, checkOutDayMs: number): Row => ({
  id,
  data: {
    resourceId: 'r1',
    status: 'confirmed',
    checkInDayMs: checkOutDayMs - 2 * DAY,
    checkOutDayMs,
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

describe('reservation availability window (AGL-2159)', () => {
  beforeEach(() => {
    mockRows.length = 0
    mockConstraints.length = 0
  })

  /**
   * The read-count assertion. Three stays ended before today and one is still
   * ahead; only the live one may be read.
   *
   * Forced red by removing `.where('checkOutDayMs','>=',todayMs)` from the
   * handler: `unavailable` then carries 4 entries instead of 1, which is the
   * unbounded history read that fills the 500 on a busy resource.
   */
  it('reads only the stays that have not ended', async () => {
    mockRows.push(
      stay('old-1', todayMs - 90 * DAY),
      stay('old-2', todayMs - 30 * DAY),
      stay('old-3', todayMs - 1 * DAY),
      stay('live', todayMs + 5 * DAY),
    )

    const result = await run()

    expect(result.status).toBe(200)
    expect(result.body.unavailable).toHaveLength(1)
    expect(result.body.unavailable[0].toDayMs).toBe(todayMs + 5 * DAY)
  })

  /**
   * A stay ending TODAY still blocks today, so the bound is inclusive.
   * Forced red by using `>` instead of `>=`: the checkout-today stay
   * disappears from the calendar and its day is offered to a second guest.
   */
  it('keeps a stay that ends today', async () => {
    mockRows.push(stay('ends-today', todayMs))

    expect((await run()).body.unavailable).toHaveLength(1)
  })

  /**
   * Ordering is what puts the nearest stays inside the limit. Without it
   * Firestore answers in `__name__` order and the 500 are an arbitrary slice.
   *
   * Forced red by dropping `.orderBy('checkOutDayMs')`: no `orderBy`
   * constraint is recorded and this reports undefined.
   */
  it('orders by checkOutDayMs so the limit takes the nearest stays', () => {
    return run().then(() => {
      expect(
        mockConstraints.find(([field, op]) => field === 'checkOutDayMs' && op === 'orderBy'),
      ).toBeDefined()
      // The equality stays first — it is what makes the composite index
      // `reservations (resourceId ASC, checkOutDayMs ASC)` answer this query.
      expect(mockConstraints[0]).toEqual(['resourceId', '==', 'r1'])
    })
  })

  /** A cancelled stay must not block a day, bound or no bound. */
  it('still drops cancelled stays', async () => {
    const cancelled = stay('gone', todayMs + 3 * DAY)
    cancelled.data.status = 'cancelled'
    mockRows.push(cancelled, stay('live', todayMs + 5 * DAY))

    expect((await run()).body.unavailable).toHaveLength(1)
  })
})
