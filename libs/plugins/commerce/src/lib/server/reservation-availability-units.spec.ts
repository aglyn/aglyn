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
 * @jest-environment node
 */

/**
 * The calendar of a several-unit resource (AGL-4044) closes only the nights
 * with no unit left, and names the nights with only a few left.
 *
 * The widget checks the range a guest picks against `unavailable` as if each
 * range were one stay on a one-unit resource, so on twelve RV hookups the
 * endpoint has to send the FULL nights, not every booking: sending each stay
 * would grey out a night the moment one hookup on it sold. One unit keeps the
 * old payload exactly.
 */

interface Row {
  id: string
  data: Record<string, unknown>
}

const mockRows: Row[] = []
const mockResource: { data: Record<string, unknown> } = { data: {} }

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
                        get: async () => ({ data: () => mockResource.data }),
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
  DAY_MS,
  PENDING_RESERVATION_HOLD_MS,
  isRangeAvailable,
  type ReservationStatus,
} from '../model'
import {
  AVAILABILITY_HORIZON_NIGHTS,
  reservationAvailabilityHandler,
  resourceNightsAvailability,
} from './reservation-availability'

const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
const night = (n: number) => todayMs + n * DAY_MS

let counter = 0
const stay = (
  from: number,
  to: number,
  status: ReservationStatus = 'confirmed',
  ageMs = 60_000,
): Row => ({
  id: `stay-${++counter}`,
  data: {
    resourceId: 'r1',
    status,
    checkInDayMs: night(from),
    checkOutDayMs: night(to),
    createdAtMs: Date.now() - ageMs,
  },
})

function makeResponse() {
  const result = { status: 0, body: undefined as any }
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
    setHeader() {
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

/** The widget's own conflict check over what the endpoint sent. */
const widgetSaysFree = (body: any, from: number, to: number) =>
  isRangeAvailable(
    body.resource,
    body.unavailable.map((range: any) => ({
      checkInDayMs: range.fromDayMs,
      checkOutDayMs: range.toDayMs,
      status: 'confirmed' as const,
    })),
    night(from),
    night(to),
  )

beforeEach(() => {
  mockRows.length = 0
  counter = 0
  mockResource.data = { name: 'RV hookups', nightlyRateUsd: 60, blocks: [] }
})

describe('one unit: the payload is what it always was', () => {
  it('sends every live stay as a range, and no fewLeft', async () => {
    mockRows.push(stay(2, 4), stay(3, 5), stay(6, 7, 'cancelled'))

    const result = await run()

    expect(result.status).toBe(200)
    expect(result.body.unavailable).toEqual([
      { fromDayMs: night(2), toDayMs: night(4) },
      { fromDayMs: night(3), toDayMs: night(5) },
    ])
    expect(result.body).not.toHaveProperty('fewLeft')
    expect(result.body.resource).not.toHaveProperty('units')
  })
})

describe('several units: only the full nights close', () => {
  beforeEach(() => {
    mockResource.data = { ...mockResource.data, units: 3 }
  })

  it('closes the nights at the limit and merges the run', async () => {
    // Nights 1..4: 1, 3, 3, 2 stays.
    mockRows.push(stay(1, 5), stay(2, 4), stay(2, 5), stay(3, 4))

    const result = await run()

    expect(result.status).toBe(200)
    expect(result.body.unavailable).toEqual([
      { fromDayMs: night(2), toDayMs: night(4) },
    ])
    expect(result.body.fewLeft).toEqual([
      { dayMs: night(1), unitsLeft: 2 },
      { dayMs: night(4), unitsLeft: 1 },
    ])
    expect(result.body.resource).not.toHaveProperty('units')
    // The widget refuses exactly what the booking door would.
    expect(widgetSaysFree(result.body, 1, 2)).toBe(true)
    expect(widgetSaysFree(result.body, 1, 3)).toBe(false)
    expect(widgetSaysFree(result.body, 4, 6)).toBe(true)
  })

  it('names no night with plenty left', async () => {
    mockResource.data = { ...mockResource.data, units: 12 }
    mockRows.push(stay(1, 3), stay(1, 3))

    const result = await run()

    expect(result.body.unavailable).toEqual([])
    expect(result.body.fewLeft).toEqual([])
  })

  it('still closes a block outright', async () => {
    mockResource.data = {
      ...mockResource.data,
      units: 12,
      blocks: [{ fromDayMs: night(8), toDayMs: night(9) }],
    }

    const result = await run()

    expect(result.body.unavailable).toEqual([
      { fromDayMs: night(8), toDayMs: night(9) },
    ])
    expect(widgetSaysFree(result.body, 7, 9)).toBe(false)
  })

  it('lets an abandoned checkout give its unit back', async () => {
    mockRows.push(
      stay(1, 2),
      stay(1, 2),
      stay(1, 2, 'pending', PENDING_RESERVATION_HOLD_MS + 60_000),
    )

    const result = await run()

    expect(result.body.unavailable).toEqual([])
    expect(result.body.fewLeft).toEqual([{ dayMs: night(1), unitsLeft: 1 }])
  })

  it('holds a checkout still in flight', async () => {
    mockRows.push(stay(1, 2), stay(1, 2), stay(1, 2, 'pending', 60_000))

    const result = await run()

    expect(result.body.unavailable).toEqual([
      { fromDayMs: night(1), toDayMs: night(2) },
    ])
  })
})

describe('resourceNightsAvailability', () => {
  it('stops drawing at the horizon', () => {
    const held = [
      {
        checkInDayMs: night(0),
        checkOutDayMs: night(5000),
        status: 'confirmed' as const,
      },
    ]
    const { full } = resourceNightsAvailability({ units: 1.5 }, held, todayMs, Date.now())
    expect(full).toEqual([
      { fromDayMs: night(0), toDayMs: night(AVAILABILITY_HORIZON_NIGHTS) },
    ])
  })
})
