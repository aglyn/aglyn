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
 * The public slot listing reads only the bookings inside its own horizon.
 *
 * `computeOpenSlots` is handed `fromMs`/`toMs` and ignores everything outside
 * them, but the query carried only the LOWER bound — so every booking past
 * the horizon was read, billed and discarded. That is not merely wasteful:
 * the read is capped at 500, so the far-future bookings competed for those
 * places with the near-term ones, and a service booked a year out could push
 * next week's bookings out of its own availability check and offer a slot
 * that is already taken.
 *
 * These assert which documents the query READS, not which slots come back.
 * A booking outside the horizon changes no slot — `computeOpenSlots` would
 * discard it either way — so a slot assertion passes on the unbounded query
 * that this exists to reject. The read count is the only thing that moves.
 */

/** Booking horizon the mocked plugin config reports, in days. */
let mockHorizonDays = 30

/** The service the handler reads; no windows unless a case sets them. */
const CONSULT = { name: 'Consult', durationMinutes: 30, priceUsd: 50 }
let mockService: Record<string, unknown> = CONSULT
/** The services the public directory lists. */
let mockDirectory: Array<Record<string, unknown>> = []

const mockRows: Array<{ id: string; data: Record<string, unknown> }> = []
/** Constraints applied to the `bookings` query, in order. */
let mockBookingConstraints: Array<[string, string, unknown]> = []
/** How many booking documents the query actually handed back. */
let mockBookingDocsRead = 0

jest.mock('@aglyn/tenant-data-admin', () => {
  const bookingsQuery = () => {
    const applied: Array<[string, string, unknown]> = []
    const api: Record<string, unknown> = {
      where: (field: string, op: string, value: unknown) => {
        applied.push([field, op, value])
        mockBookingConstraints.push([field, op, value])
        return api
      },
      orderBy: () => api,
      limit: () => api,
      get: async () => {
        // The double ENFORCES the constraints rather than ignoring them; a
        // stub that returned every row regardless could not fail these.
        const kept = mockRows.filter((row) =>
          applied.every(([field, op, value]) => {
            const held = Number(row.data[field])
            if (op === '==') return row.data[field] === value
            if (op === '>=') return held >= Number(value)
            if (op === '<=') return held <= Number(value)
            return true
          }),
        )
        mockBookingDocsRead = kept.length
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
                name === 'bookings'
                  ? bookingsQuery()
                  : {
                      doc: () => ({
                        get: async () => ({
                          data: () => mockService,
                          get: () => undefined,
                        }),
                      }),
                      limit: () => ({
                        get: async () => ({
                          docs: mockDirectory.map((data, index) => ({
                            id: `svc-${index}`,
                            data: () => data,
                            get: (field: string) => data[field],
                          })),
                        }),
                      }),
                    },
            }),
          }),
        }),
      }),
    },
    // Module-level exports, NOT properties of `firebaseAdmin`. The handler
    // imports these as named bindings, so nesting them one level deeper
    // leaves them undefined and every case fails as a 500 rather than on its
    // own assertion.
    getPluginConfig: async () => ({ maxDaysAhead: mockHorizonDays }),
    resolveOrgIdForHost: async () => 'org1',
    // Unused by the slots path, but the module is imported wholesale.
    getOrgForHost: async () => undefined,
    addHostLead: async () => undefined,
    meterHostEmail: async () => undefined,
    notifyHostManagers: async () => undefined,
    upsertHostContact: async () => undefined,
    renderHostEmailWithTokens: () => ({}),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/payment-provider', () => ({
  merchantAccountIsReady: () => false,
}))
jest.mock('@aglyn/tenant-runtime', () => ({ emitHostEvent: async () => undefined }))
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  loadHostEmail: async () => null,
  renderLoadedHostEmail: () => ({}),
  sendEmail: async () => undefined,
}))

import { BOOKING_SLOT_PAGE_DAYS } from './model'
import { slotsHandler } from './server'

const DAY = 24 * 60 * 60_000

const booking = (id: string, startsAtMs: number) => ({
  id,
  data: {
    serviceId: 's1',
    status: 'confirmed',
    startsAtMs,
    endsAtMs: startsAtMs + 30 * 60_000,
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

const run = async (query: Record<string, string> = {}) => {
  const { res, result } = makeResponse()
  await slotsHandler(
    {
      method: 'GET',
      query: { hostId: 'h1', serviceId: 's1', ...query },
      body: {},
      headers: {},
      cookies: {},
      socket: {},
    } as never,
    res,
  )
  return result
}

describe('booking slot window', () => {
  beforeEach(() => {
    mockRows.length = 0
    mockBookingConstraints = []
    mockBookingDocsRead = 0
    mockHorizonDays = 30
    mockService = CONSULT
  })

  /**
   * The read-count assertion. The horizon is 30 days (mocked config); three
   * bookings sit beyond it and one inside.
   *
   * Forced red by removing `.where('startsAtMs','<=',toMs)` from the handler:
   * `mockBookingDocsRead` then reports 4 instead of 1 — the far-future
   * bookings the 500-cap has to make room for.
   */
  it('reads only bookings inside the horizon', async () => {
    const now = Date.now()
    mockRows.push(
      booking('soon', now + 2 * DAY),
      booking('far-1', now + 90 * DAY),
      booking('far-2', now + 200 * DAY),
      booking('far-3', now + 400 * DAY),
    )

    const result = await run()

    expect(result.status).toBe(200)
    expect(mockBookingDocsRead).toBe(1)
  })

  /**
   * Both ends of the range are present and on the same field, which is what
   * lets this reuse the existing `startsAtMs` index rather than needing a new
   * one.
   *
   * Forced red by dropping either bound: the matching constraint disappears
   * and its expectation reports undefined.
   */
  it('bounds startsAtMs at both ends', async () => {
    await run()

    const ranges = mockBookingConstraints.filter(
      ([field]) => field === 'startsAtMs',
    )
    expect(ranges.map(([, op]) => op).sort()).toEqual(['<=', '>='])
    // The service equality is what the composite index leads on.
    expect(mockBookingConstraints[0]).toEqual(['serviceId', '==', 's1'])
  })

  /**
   * The lower bound keeps a day of slack so an in-progress booking still
   * blocks its slot. Narrowing it to `now` would free a slot someone is
   * currently sitting in.
   */
  it('keeps a booking that started within the last day', async () => {
    mockRows.push(booking('running', Date.now() - 2 * 60 * 60_000))

    await run()

    expect(mockBookingDocsRead).toBe(1)
  })
})

/**
 * The listing is a page of whole DAYS, not a flat count of slots (AGL-3492).
 *
 * Found live: a 60-minute estimate open 8 to 5 on weekdays and 8 to noon on
 * Saturday answered exactly 120 slots — Monday, Tuesday and Wednesday whole,
 * Thursday cut at 1 PM, nothing after, under a 60-day horizon. At 15-minute
 * steps 120 slots is three and a half days.
 */
describe('booking slot pages', () => {
  const MONDAY = Date.UTC(2026, 9, 5, 5) // Monday 00:00 in Chicago.
  const weekday = [{ start: 8 * 60, end: 17 * 60 }]
  const ESTIMATE = {
    name: 'Free on-site estimate',
    durationMinutes: 60,
    priceUsd: 0,
    timezone: 'America/Chicago',
    windows: {
      1: weekday,
      2: weekday,
      3: weekday,
      4: weekday,
      5: weekday,
      6: [{ start: 8 * 60, end: 12 * 60 }],
    },
  }
  const chicagoDay = (ms: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(ms)

  beforeEach(() => {
    mockRows.length = 0
    mockService = ESTIMATE
    mockHorizonDays = 60
    jest.spyOn(Date, 'now').mockReturnValue(MONDAY)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  /** Forced red by restoring `computeOpenSlots(…, 120)`: 120 slots, 4 days. */
  it('answers every open time of the strip of days, past the old 120', async () => {
    const result = await run()

    expect(result.status).toBe(200)
    const slots = result.body.slots as Array<{ startsAtMs: number }>
    const days = new Set(slots.map((slot) => chicagoDay(slot.startsAtMs)))
    expect(days.size).toBe(BOOKING_SLOT_PAGE_DAYS)
    expect(slots.length).toBe(12 * 33 + 2 * 13)
    expect(typeof result.body.nextFromMs).toBe('number')
    // The configured horizon rides along for the widget's empty state.
    expect(result.body.horizonDays).toBe(60)
  })

  it('answers the next page from `from`, starting where the last one stopped', async () => {
    const first = await run()
    const second = await run({ from: String(first.body.nextFromMs) })

    expect(second.status).toBe(200)
    const firstStarts = first.body.slots.map((slot: { startsAtMs: number }) => slot.startsAtMs)
    const secondStarts = second.body.slots.map((slot: { startsAtMs: number }) => slot.startsAtMs)
    expect(secondStarts[0]).toBe(first.body.nextFromMs)
    expect(Math.min(...secondStarts)).toBeGreaterThan(Math.max(...firstStarts))
  })

  it('never lists a passed time for a `from` in the past, nor past the horizon', async () => {
    const stale = await run({ from: String(MONDAY - 10 * 24 * 60 * 60_000) })
    expect(stale.body.slots[0].startsAtMs).toBeGreaterThanOrEqual(MONDAY)

    const beyond = await run({ from: String(MONDAY + 400 * 24 * 60 * 60_000) })
    expect(beyond.body.slots).toEqual([])
    expect(beyond.body.nextFromMs).toBeNull()

    const junk = await run({ from: 'tomorrow' })
    expect(junk.body.slots[0].startsAtMs).toBeGreaterThanOrEqual(MONDAY)
  })

  it('pages to the horizon and then says there is no more', async () => {
    mockHorizonDays = 20
    let fromMs: number | null = null
    let pages = 0
    let last = 0
    do {
      const page = await run(fromMs === null ? {} : { from: String(fromMs) })
      for (const slot of page.body.slots) last = Math.max(last, slot.startsAtMs)
      fromMs = page.body.nextFromMs
      pages += 1
    } while (fromMs !== null && pages < 10)

    expect(fromMs).toBeNull()
    expect(pages).toBe(2)
    expect(last).toBeLessThanOrEqual(MONDAY + 20 * 24 * 60 * 60_000)
  })
})

/**
 * The public directory names what each service asks for beyond a name and an
 * email (AGL-3493), so the widget renders the fields the route will hold the
 * request to — read the same way the route reads them.
 */
describe('the public service directory', () => {
  it('says what each service asks for, off unless it says otherwise', async () => {
    mockDirectory = [
      { ...CONSULT, askPhone: 'required', askAddress: 'optional' },
      { ...CONSULT, askPhone: 'sometimes' },
    ]
    const { res, result } = makeResponse()
    await slotsHandler(
      { method: 'GET', query: { hostId: 'h1' }, body: {}, headers: {}, cookies: {}, socket: {} } as never,
      res,
    )
    expect(result.body.services).toEqual([
      expect.objectContaining({ $id: 'svc-0', askPhone: 'required', askAddress: 'optional' }),
      expect.objectContaining({ $id: 'svc-1', askPhone: 'off', askAddress: 'off' }),
    ])
  })
})

