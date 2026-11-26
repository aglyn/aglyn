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
 * The calendar v2 doors (AGL-4252): a range of dates with recurring events
 * expanded, categories and ticket offers resolved, the `.ics` feed, all
 * behind `release_events_calendar_v2`; and the events search source.
 */

import { registerPluginSiteOffer } from '@aglyn/aglyn/plugin-manager/plugin-site-offers'
import { zonedWallTimeToInstant } from '@aglyn/shared-util-timestamp/zoned-time'

const ZONE = 'America/Chicago'
const HOUR = 60 * 60 * 1000
const at = (year: number, month: number, day: number, hour = 18) =>
  zonedWallTimeToInstant({ year, month, day, hour }, ZONE)

let flagOn = true
let hostDoc: Record<string, unknown> = { subdomain: 'park', name: 'Park' }
let eventDocs: Array<{ id: string; data: Record<string, unknown> }> = []
let categoryDocs: Array<{ id: string; data: Record<string, unknown> }> = []

/** A collection query, answered the way Firestore would for `==`, `>=`, `<`. */
function collectionOf(
  rows: () => Array<{ id: string; data: Record<string, unknown> }>,
) {
  const make = (
    wheres: Array<[string, string, unknown]>,
    order: [string, string] | null,
    cap: number,
  ): any => ({
    where: (path: string, op: string, value: unknown) =>
      make([...wheres, [path, op, value]], order, cap),
    orderBy: (path: string, direction: string) =>
      make(wheres, [path, direction], cap),
    limit: (count: number) => make(wheres, order, count),
    doc: (id: string) => ({
      get: async () => {
        const row = rows().find((one) => one.id === id)
        return { exists: Boolean(row), data: () => row?.data }
      },
    }),
    get: async () => {
      const passes = (data: Record<string, unknown>) =>
        wheres.every(([path, op, value]) => {
          const field = data[path] as any
          if (field === undefined) return false
          if (op === '==') return field === value
          if (op === '>=') return field >= (value as any)
          if (op === '<') return field < (value as any)
          throw new Error(op)
        })
      const found = rows().filter((row) => passes(row.data))
      if (order)
        found.sort(
          (a, b) => (a.data[order[0]] as number) - (b.data[order[0]] as number),
        )
      return {
        docs: found
          .slice(0, cap)
          .map((row) => ({
            id: row.id,
            data: () => row.data,
            get: (key: string) => row.data[key],
          })),
      }
    },
  })
  return make([], null, Number.POSITIVE_INFINITY)
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => hostDoc }),
            collection: (name: string) =>
              collectionOf(() =>
                name === 'events'
                  ? eventDocs
                  : name === 'eventCategories'
                    ? categoryDocs
                    : [],
              ),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({
    orgId: 'org-1',
    org: {
      timeZone: ZONE,
      entitlements: { features: { eventCalendar: true } },
    },
  }),
  getPluginConfig: async () => ({ calendarPath: '/events', eventPagePath: '' }),
}))

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForLoadedOrg: async () => flagOn,
  filterEnabledPluginsByReleaseFlags: async (ids: string[]) => ids,
}))

import { eventsSiteSearch } from './event-site-search'
import {
  eventsIcsHandler,
  eventsOccurrencesHandler,
  rangeBound,
} from './event-calendar.server'

function call(
  handler: typeof eventsOccurrencesHandler,
  query: Record<string, string>,
) {
  const out: { status: number; body: any; headers: Record<string, unknown> } = {
    status: 0,
    body: null,
    headers: {},
  }
  const res: any = {
    status: (code: number) => {
      out.status = code
      return res
    },
    json: (body: unknown) => {
      out.body = body
    },
    send: (body: unknown) => {
      out.body = body
    },
    setHeader: (name: string, value: unknown) => {
      out.headers[name] = value
    },
  }
  return Promise.resolve(
    handler(
      {
        method: 'GET',
        query,
        body: null,
        headers: {},
        cookies: {},
        socket: {},
      },
      res,
    ),
  ).then(() => out)
}

const practice = {
  id: 'practice',
  data: {
    title: 'Thursday night training',
    status: 'published',
    startsAtMs: at(2026, 1, 8),
    endsAtMs: at(2026, 1, 8) + 3 * HOUR,
    timeZone: ZONE,
    recurrence: { freq: 'weekly', exceptDayKeys: ['2026-11-26'] },
    seriesEndsAtMs: 8_640_000_000_000_000,
    categoryIds: ['mx'],
    ticket: { kind: 'product', id: 'night-pass' },
  },
}
const camp = {
  id: 'camp',
  data: {
    title: 'Kids camp',
    status: 'published',
    startsAtMs: at(2026, 11, 21, 9),
    endsAtMs: at(2026, 11, 21, 15),
    categoryIds: ['kids'],
  },
}
const draft = {
  id: 'draft',
  data: { title: 'Secret', status: 'draft', startsAtMs: at(2026, 11, 10) },
}

beforeAll(() => {
  registerPluginSiteOffer(
    'product',
    {
      resolve: async ({ id, dayKey }) => ({
        title: id,
        caption: '$20',
        action: {
          kind: 'post',
          endpoint: '/api/commerce/cart',
          body: { productId: id, useDayKey: dayKey },
          notify: 'aglyn:cart-updated',
        },
      }),
    },
    { pluginId: 'commerce' },
  )
})

beforeEach(() => {
  flagOn = true
  hostDoc = { subdomain: 'park', name: 'Park' }
  eventDocs = [practice, camp, draft]
  categoryDocs = [
    { id: 'mx', data: { name: 'MX Training', color: '#1e88e5', order: 0 } },
    { id: 'kids', data: { name: 'Kids Camp', color: '#43a047', order: 1 } },
  ]
})

describe('events/occurrences', () => {
  it('answers enabled: false and nothing else where the flag is off', async () => {
    flagOn = false
    const out = await call(eventsOccurrencesHandler, {
      hostId: 'host-1',
      from: '2026-11-01',
      to: '2026-12-01',
    })
    expect(out.status).toBe(200)
    expect(out.body).toEqual({
      enabled: false,
      timeZone: ZONE,
      categories: [],
      occurrences: [],
    })
  })

  it('expands a series begun months earlier, skips its skipped day, and leaves drafts out', async () => {
    const out = await call(eventsOccurrencesHandler, {
      hostId: 'host-1',
      from: '2026-11-01',
      to: '2026-12-01',
    })
    expect(out.status).toBe(200)
    expect(out.body.enabled).toBe(true)
    expect(out.body.categories.map((category: any) => category.name)).toEqual([
      'MX Training',
      'Kids Camp',
    ])
    const days = out.body.occurrences.map(
      (one: any) => `${one.eventId}:${one.dayKey}`,
    )
    expect(days).toEqual([
      'practice:2026-11-05',
      'practice:2026-11-12',
      'practice:2026-11-19',
      'camp:2026-11-21',
    ])
    const first = out.body.occurrences[0]
    expect(first.repeatText).toBe('Every week on Thursday')
    expect(first.ticket).toEqual({
      label: 'Get tickets',
      caption: '$20',
      action: {
        kind: 'post',
        endpoint: '/api/commerce/cart',
        body: { productId: 'night-pass', useDayKey: '2026-11-05' },
        notify: 'aglyn:cart-updated',
      },
    })
  })

  it('filters by category and by the words searched', async () => {
    const kids = await call(eventsOccurrencesHandler, {
      hostId: 'host-1',
      from: '2026-11-01',
      to: '2026-12-01',
      category: 'kids',
    })
    expect(kids.body.occurrences.map((one: any) => one.eventId)).toEqual([
      'camp',
    ])
    const searched = await call(eventsOccurrencesHandler, {
      hostId: 'host-1',
      from: '2026-11-01',
      to: '2026-12-01',
      q: 'mx training',
    })
    expect(
      new Set(searched.body.occurrences.map((one: any) => one.eventId)),
    ).toEqual(new Set(['practice']))
  })

  it('refuses a range that ends before it starts and a host id that is a path', async () => {
    expect(
      (
        await call(eventsOccurrencesHandler, {
          hostId: 'host-1',
          from: '2026-12-01',
          to: '2026-11-01',
        })
      ).status,
    ).toBe(400)
    expect(
      (await call(eventsOccurrencesHandler, { hostId: 'a/b' })).status,
    ).toBe(400)
  })
})

describe('rangeBound', () => {
  it('reads a day on the site clock or epoch ms', () => {
    expect(rangeBound('2026-11-05', ZONE)).toBe(at(2026, 11, 5, 0))
    expect(rangeBound('1700000000000', ZONE)).toBe(1_700_000_000_000)
    expect(rangeBound('soon', ZONE)).toBeNull()
  })
})

describe('events/ics', () => {
  it('serves the published calendar with the series kept as a rule', async () => {
    const out = await call(eventsIcsHandler, { hostId: 'host-1' })
    expect(out.status).toBe(200)
    expect(out.headers['Content-Type']).toBe('text/calendar; charset=utf-8')
    expect(out.body).toContain('RRULE:FREQ=WEEKLY')
    expect(out.body).toContain('EXDATE;TZID=America/Chicago:20261126T180000')
    expect(out.body).toContain('SUMMARY:Kids camp')
    expect(out.body).not.toContain('Secret')
  })

  it('downloads one date of a series as one event', async () => {
    const out = await call(eventsIcsHandler, {
      hostId: 'host-1',
      event: 'practice',
      on: '2026-11-12',
    })
    expect(out.body).not.toContain('RRULE')
    expect(out.body).toContain('DTSTART:20261113T000000Z')
    expect(out.headers['Content-Disposition']).toContain('attachment')
  })

  it('is not there where the flag is off', async () => {
    flagOn = false
    expect((await call(eventsIcsHandler, { hostId: 'host-1' })).status).toBe(
      404,
    )
  })
})

describe('events in site search', () => {
  it('answers each event once, at its next date, linked to the calendar', async () => {
    jest.useFakeTimers({
      now: at(2026, 11, 10, 12),
      doNotFake: ['nextTick', 'setImmediate'],
    })
    try {
      const items = await eventsSiteSearch.items({
        hostId: 'host-1',
        query: 'camp',
        limit: 10,
      })
      expect(items.map((item) => item.title)).toEqual([
        'Thursday night training',
        'Kids camp',
      ])
      expect(items[0].url).toBe('/events?event=practice&on=2026-11-12')
      expect(items[0].terms).toContain('MX Training')
      expect(items[0].caption).toContain('Every week on Thursday')
    } finally {
      jest.useRealTimers()
    }
  })

  it('answers nothing where the flag is off', async () => {
    flagOn = false
    expect(
      await eventsSiteSearch.items({
        hostId: 'host-1',
        query: 'camp',
        limit: 10,
      }),
    ).toEqual([])
  })
})
