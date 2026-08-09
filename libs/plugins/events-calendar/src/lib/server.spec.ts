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

jest.mock('@aglyn/tenant-runtime', () => ({
  __esModule: true,
  runSingleAction: jest.fn(),
}))

const hostDoc: Record<string, unknown> = {
  cname: 'custom.example',
  subdomain: 'acme',
}
let eventDocs: Array<{ id: string; data: Record<string, unknown> }> = []

const query = () => {
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    get: async () => ({
      docs: eventDocs.map((row) => ({
        id: row.id,
        get: (field: string) => row.data[field],
      })),
    }),
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

const givenEvent = (coverImage: unknown) => {
  eventDocs = [
    {
      id: 'e1',
      data: {
        title: 'Launch party',
        status: 'published',
        startsAtMs: Date.UTC(2026, 7, 20, 18),
        endsAtMs: Date.UTC(2026, 7, 20, 21),
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
      startsAtMs: Date.UTC(2026, 7, 20, 18),
      endsAtMs: Date.UTC(2026, 7, 20, 21),
    })
  })
})
