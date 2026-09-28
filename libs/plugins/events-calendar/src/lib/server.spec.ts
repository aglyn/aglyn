/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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
 * `events/list` hands out covers a crawler can fetch (AGL-1351).
 *
 * The resolution happens HERE, not in the block that renders the markup,
 * because this is the only place that knows which site the events belong to:
 * `EventList` reads a `hostId` off `useSite()` and no origin, and on Preview
 * the page origin is the console's. So the payload is where "absolute" has to
 * become true, and this asserts it at that boundary.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  dispatchHostAutomation: jest.fn(),
}))

const hostDoc: Record<string, unknown> = {
  cname: 'custom.example',
  subdomain: 'acme',
}
let eventDocs: Array<{ id: string; data: Record<string, unknown> }> = []
/** The constraints the last listing put on its query, in order. */
let asked: unknown[][] = []

/**
 * The events query, answered the way Firestore would: its `where`s, its one
 * `orderBy` and its `limit` applied to `eventDocs` in that order, so a
 * condition left off the query shows up as rows the limit let through.
 */
const query = () => {
  const wheres: Array<[string, string, unknown]> = []
  let order: [string, 'asc' | 'desc'] | null = null
  let cap = Number.POSITIVE_INFINITY
  asked = []
  const chain: any = {
    where: (path: string, op: string, value: unknown) => {
      asked.push(['where', path, op, value])
      wheres.push([path, op, value])
      return chain
    },
    orderBy: (path: string, direction: 'asc' | 'desc') => {
      asked.push(['orderBy', path, direction])
      order = [path, direction]
      return chain
    },
    limit: (count: number) => {
      asked.push(['limit', count])
      cap = count
      return chain
    },
    get: async () => {
      const passes = (data: Record<string, unknown>) =>
        wheres.every(([path, op, value]) => {
          const field = data[path] as any
          if (op === '==') return field === value
          if (op === '<') return field < (value as any)
          if (op === '>=') return field >= (value as any)
          throw new Error(`the fake does not answer ${op}`)
        })
      const rows = eventDocs.filter((row) => passes(row.data))
      if (order) {
        const [path, direction] = order
        rows.sort(
          (a, b) =>
            ((a.data[path] as number) - (b.data[path] as number)) *
            (direction === 'asc' ? 1 : -1),
        )
      }
      return {
        docs: rows.slice(0, cap).map((row) => ({
          id: row.id,
          get: (field: string) => row.data[field],
        })),
      }
    },
  }
  return chain
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              get: (field: string) => hostDoc[field],
            }),
            collection: () => query(),
          }),
        }),
      }),
    }),
  },
  // The paid add-on gate; a purchased seat switches the feature on.
  getOrgForHost: async () => ({ org: { seatAddons: { eventCalendar: 1 } } }),
}))

import { resolvePluginApiRoute } from '@aglyn/aglyn/server'
import { registerEventsCalendarApi } from './server'

registerEventsCalendarApi()

const listEvents = async () => {
  const handler = resolvePluginApiRoute('events/list')
  expect(handler).toBeDefined()
  let body: any
  const res: any = {
    setHeader: () => res,
    status: () => res,
    json: (value: unknown) => {
      body = value
      return res
    },
  }
  await handler?.({ method: 'GET', query: { hostId: 'host-1' } } as never, res)
  return body
}

/** Far enough ahead to stay "upcoming" whenever the suite runs. */
const FUTURE_MS = Date.UTC(2100, 7, 20, 18)

const givenEvent = (coverImage: unknown) => {
  eventDocs = [
    {
      id: 'e1',
      data: {
        title: 'Launch party',
        status: 'published',
        startsAtMs: FUTURE_MS,
        endsAtMs: FUTURE_MS + 3 * 60 * 60 * 1000,
        coverImage,
      },
    },
  ]
}

beforeEach(() => {
  hostDoc['cname'] = 'custom.example'
  hostDoc['subdomain'] = 'acme'
})

describe('the events payload absolutizes each cover (AGL-1351)', () => {
  it('resolves an author-typed site-relative path against the site’s own origin', async () => {
    // The case the console's free-text "Cover image URL" field invites, and
    // the one that reached the Event JSON-LD unfetchable.
    givenEvent('/uploads/party.jpg')

    const body = await listEvents()

    expect(body.events[0].coverImage).toBe(
      'https://custom.example/uploads/party.jpg',
    )
  })

  it('passes an already-absolute URL through untouched', async () => {
    givenEvent('https://cdn.example/party.jpg')

    const body = await listEvents()

    expect(body.events[0].coverImage).toBe('https://cdn.example/party.jpg')
  })

  it('falls back to the platform subdomain when the site has no custom domain', async () => {
    hostDoc['cname'] = null
    givenEvent('/uploads/party.jpg')

    const body = await listEvents()

    expect(body.events[0].coverImage).toBe(
      'https://acme.aglyn.app/uploads/party.jpg',
    )
  })

  it('resolves a media reference through the CDN route', async () => {
    // Not reachable from today's console field, which has no picker — but the
    // shared resolver handles it, so a picker can be added later without this
    // surface needing to learn anything.
    givenEvent('media:host-1/cover')

    const body = await listEvents()

    expect(body.events[0].coverImage).toBe(
      'https://custom.example/api/media/cdn/host-1/cover',
    )
  })

  it('sends null rather than a half-resolved value for a missing or junk cover', async () => {
    givenEvent(undefined)
    expect((await listEvents()).events[0].coverImage).toBeNull()

    givenEvent('')
    expect((await listEvents()).events[0].coverImage).toBeNull()

    givenEvent('media:junk')
    expect((await listEvents()).events[0].coverImage).toBeNull()
  })

  it('leaves the rest of the event untouched', async () => {
    givenEvent('/uploads/party.jpg')

    const body = await listEvents()

    expect(body.events[0]).toMatchObject({
      $id: 'e1',
      title: 'Launch party',
      startsAtMs: FUTURE_MS,
      endsAtMs: FUTURE_MS + 3 * 60 * 60 * 1000,
    })
  })
})

describe('the listing asks for published events on its query', () => {
  const event = (id: string, at: number, data: Record<string, unknown>) => ({
    id,
    data: { title: id, startsAtMs: FUTURE_MS + at * 60_000, ...data },
  })

  it('returns fifty published events when drafts start sooner than all of them', async () => {
    /*
     * Sixty drafts and a deleted event start before any published one. Read
     * by start time with the status left for after the read, the limit of
     * fifty filled with drafts and the page came back empty.
     */
    eventDocs = [
      ...Array.from({ length: 60 }, (_unused, at) => event(`draft-${at}`, at, { status: 'draft' })),
      event('deleted', 61, { status: 'deleted', deletedAt: 1 }),
      ...Array.from({ length: 55 }, (_unused, at) =>
        event(`published-${at}`, 100 + at, { status: 'published' }),
      ),
    ]

    const body = await listEvents()

    expect(asked).toContainEqual(['where', 'status', '==', 'published'])
    expect(body.events).toHaveLength(50)
    expect(body.events[0].$id).toBe('published-0')
    expect(body.events.every((row: any) => row.$id.startsWith('published-'))).toBe(true)
  })

  it('keeps an event deleted before the delete wrote its status off the page', async () => {
    eventDocs = [
      event('deleted-long-ago', 0, { status: 'published', deletedAt: 1 }),
      event('live', 1, { status: 'published' }),
    ]

    expect((await listEvents()).events.map((row: any) => row.$id)).toEqual(['live'])
  })

  it('has the composite each direction needs', () => {
    const { indexes } = JSON.parse(
      readFileSync(join(__dirname, '../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
    ) as { indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> }> }
    const shapes = indexes
      .filter((index) => index.collectionGroup === 'events' && index.queryScope === 'COLLECTION')
      .map((index) => index.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','))
    expect(shapes).toEqual(
      expect.arrayContaining([
        'status:ASCENDING,startsAtMs:ASCENDING',
        'status:ASCENDING,startsAtMs:DESCENDING',
      ]),
    )
  })
})
