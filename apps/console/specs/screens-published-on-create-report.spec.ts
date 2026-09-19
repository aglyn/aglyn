/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor.
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
 * THE MIGRATION LIST FOR AGL-3021 — and the things it must not do.
 *
 * Creating a screen used to publish it in the same second, so every site
 * built through `CREATE NEW SCREEN` has live pages nobody chose to publish.
 * The fix stops new ones; it cannot answer for the existing ones, and the one
 * remedy that must never be applied is the automatic one — the overwhelming
 * majority of these pages were built out afterwards and are load-bearing.
 * Unpublishing them by sweep would be an outage caused by tidying up.
 *
 * So the route reports and stops, and what this suite pins is the SHAPE of
 * the question rather than an answer to it:
 *
 * - A row is only a row if the page is actually LIVE — named by the host's
 *   routing map. A `publishedAt` on a screen the map does not name is a
 *   leftover, not a decision anybody has to make.
 * - A publish that came minutes or days after the create is somebody
 *   publishing, which is the behavior the whole issue is asking for. It is
 *   not in the list.
 * - A page that has been edited since is REPORTED, not hidden — a person may
 *   still want to know — but it is counted apart from the blank ones, because
 *   "a blank page is live on the public internet" is the actual harm and
 *   burying it under a hundred finished pages would waste the list.
 */

export {}

const mockVerifyIdToken = jest.fn()

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: Object.fromEntries(new URL(request.url).searchParams.entries()),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
}))

/** Screens keyed by host id; versions keyed by `${screenId}/${versionId}`. */
const state: {
  hosts: Array<Record<string, unknown> & { id: string }>
  screens: Record<string, Array<Record<string, unknown> & { id: string }>>
  versions: Record<string, Record<string, unknown>>
} = { hosts: [], screens: {}, versions: {} }

const snapshot = (row: Record<string, unknown> & { id: string }) => ({
  id: row.id,
  exists: true,
  get: (field: string) => row[field],
})

function versionsCollection(screenId: string) {
  return {
    doc: (versionId: string) => ({
      get: async () => {
        const data = state.versions[`${screenId}/${versionId}`]
        return data
          ? { exists: true, get: (field: string) => data[field] }
          : { exists: false, get: () => undefined }
      },
    }),
  }
}

function screensCollection(hostId: string) {
  const rows = state.screens[hostId] ?? []
  return {
    limit: () => ({
      get: async () => ({
        size: rows.length,
        docs: rows.map((row) => ({
          ...snapshot(row),
          ref: { collection: () => versionsCollection(row.id) },
        })),
      }),
    }),
  }
}

const firestore = {
  collection: (name: string) => {
    if (name !== 'hosts') throw new Error(`unexpected collection ${name}`)
    return {
      limit: () => ({
        get: async () => ({
          size: state.hosts.length,
          docs: state.hosts.map((host) => ({
            ...snapshot(host),
            ref: { collection: () => screensCollection(host.id) },
          })),
        }),
      }),
    }
  },
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      // Arrow, not a value: the factory is hoisted above `firestore`.
      firestore: () => firestore,
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

import { GET } from '../app/api/admin/screens-published-on-create/route'

const CREATED = '2026-09-03T18:16:07.000Z'
/** The measured gap: the row came back Updated 1:16:07, Published 1:16:08. */
const PUBLISHED_SAME_SECOND = '2026-09-03T18:16:08.000Z'
const BLANK_CANVAS = {
  'canvas-root': { $id: 'canvas-root', componentId: 'div', nodes: [] },
}

function request(url = 'https://app.aglyn.com/api/admin/screens-published-on-create') {
  return new Request(url, {
    method: 'GET',
    headers: { Authorization: 'Bearer token' },
  })
}

const asStaff = () =>
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email: 'staff@aglyn.com',
    email_verified: true,
    staff: true,
  })

beforeEach(() => {
  jest.clearAllMocks()
  state.hosts = []
  state.screens = {}
  state.versions = {}
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('who may read it', () => {
  it('refuses a caller with no token', async () => {
    const response = await GET(
      new Request('https://app.aglyn.com/api/admin/screens-published-on-create'),
    )
    expect(response.status).toBe(401)
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
  })

  it('refuses a signed-in caller who is not staff', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    expect((await GET(request())).status).toBe(403)
  })
})

describe('what it reports', () => {
  beforeEach(asStaff)

  it('finds a live page whose publish landed in the same second as its create', async () => {
    state.hosts = [
      {
        id: 'host-1',
        orgId: 'org-1',
        displayName: 'Marketing',
        screens: { 'screen-1': 'alternatives' },
      },
    ]
    state.screens['host-1'] = [
      {
        id: 'screen-1',
        displayName: 'Alternatives',
        slug: 'alternatives',
        versionId: 'v1',
        createdAt: CREATED,
        updatedAt: CREATED,
        publishedAt: PUBLISHED_SAME_SECOND,
        createdBy: 'uid-author',
      },
    ]
    state.versions['screen-1/v1'] = {
      updatedAt: CREATED,
      nodes: BLANK_CANVAS,
    }

    const body = await (await GET(request())).json()
    expect(body.total).toBe(1)
    expect(body.blankAndUntouched).toBe(1)
    expect(body.untouchedSincePublish).toBe(1)
    expect(body.truncated).toBe(false)
    expect(body.rows[0]).toMatchObject({
      orgId: 'org-1',
      hostId: 'host-1',
      hostName: 'Marketing',
      screenId: 'screen-1',
      displayName: 'Alternatives',
      routePath: 'alternatives',
      gapMs: 1000,
      createdBy: 'uid-author',
      screenTouched: false,
      contentTouched: false,
      blankCanvas: true,
    })
  })

  it('leaves out a publish somebody actually chose', async () => {
    state.hosts = [
      { id: 'host-1', screens: { 'screen-1': 'about' } },
    ]
    state.screens['host-1'] = [
      {
        id: 'screen-1',
        displayName: 'About',
        versionId: 'v1',
        createdAt: CREATED,
        updatedAt: '2026-09-04T10:00:00.000Z',
        // A day later, after the page was built: the behavior the issue asks
        // for, not the one it is about.
        publishedAt: '2026-09-04T11:00:00.000Z',
      },
    ]
    const body = await (await GET(request())).json()
    expect(body.rows).toEqual([])
  })

  it('leaves out a screen the routing map does not name, however it is stamped', async () => {
    // A leftover `publishedAt` on a screen nothing resolves to is not a live
    // page, so there is no decision to put in front of anybody.
    state.hosts = [{ id: 'host-1', screens: { other: 'home' } }]
    state.screens['host-1'] = [
      {
        id: 'screen-1',
        displayName: 'Orphan',
        versionId: 'v1',
        createdAt: CREATED,
        publishedAt: PUBLISHED_SAME_SECOND,
      },
      { id: 'other', displayName: 'Home', createdAt: CREATED },
    ]
    const body = await (await GET(request())).json()
    expect(body.rows).toEqual([])
  })

  it('leaves out a deleted screen', async () => {
    state.hosts = [{ id: 'host-1', screens: { 'screen-1': 'gone' } }]
    state.screens['host-1'] = [
      {
        id: 'screen-1',
        displayName: 'Gone',
        versionId: 'v1',
        createdAt: CREATED,
        publishedAt: PUBLISHED_SAME_SECOND,
        deletedAt: '2026-09-05T00:00:00.000Z',
      },
    ]
    expect((await (await GET(request())).json()).rows).toEqual([])
  })

  it('reports a page that was built out, and counts it apart from the blank ones', async () => {
    state.hosts = [
      {
        id: 'host-1',
        subdomain: 'acme',
        screens: { blank: 'draft-page', built: 'pricing' },
      },
    ]
    state.screens['host-1'] = [
      {
        id: 'built',
        displayName: 'Pricing',
        versionId: 'v1',
        createdAt: CREATED,
        updatedAt: CREATED,
        publishedAt: PUBLISHED_SAME_SECOND,
      },
      {
        id: 'blank',
        displayName: 'Untitled',
        versionId: 'v1',
        createdAt: CREATED,
        updatedAt: CREATED,
        publishedAt: PUBLISHED_SAME_SECOND,
      },
    ]
    state.versions['built/v1'] = {
      // Somebody opened the besigner and saved a real page.
      updatedAt: '2026-09-10T12:00:00.000Z',
      nodes: {
        'canvas-root': { $id: 'canvas-root', componentId: 'div', nodes: ['a'] },
        a: { $id: 'a', componentId: 'h1' },
      },
    }
    state.versions['blank/v1'] = { updatedAt: CREATED, nodes: BLANK_CANVAS }

    const body = await (await GET(request())).json()
    expect(body.total).toBe(2)
    // Both are reported — a person may want to know about either — but only
    // the blank one is in the count that says "look here first".
    expect(body.blankAndUntouched).toBe(1)
    expect(body.untouchedSincePublish).toBe(1)
    // And it sorts first, for the same reason.
    expect(body.rows.map((row: { screenId: string }) => row.screenId)).toEqual([
      'blank',
      'built',
    ])
    expect(body.rows[1]).toMatchObject({
      screenId: 'built',
      hostName: 'acme',
      contentTouched: true,
      blankCanvas: false,
    })
  })

  it('says it cannot tell rather than guessing when the version is missing', async () => {
    state.hosts = [{ id: 'host-1', screens: { 'screen-1': 'mystery' } }]
    state.screens['host-1'] = [
      {
        id: 'screen-1',
        displayName: 'Mystery',
        versionId: 'v-missing',
        createdAt: CREATED,
        updatedAt: CREATED,
        publishedAt: PUBLISHED_SAME_SECOND,
      },
    ]
    const body = await (await GET(request())).json()
    // Null, not false: "not known to have been edited" and "known not to have
    // been edited" are different answers, and only one of them is honest.
    expect(body.rows[0]).toMatchObject({
      contentTouched: null,
      blankCanvas: null,
      contentUpdatedAt: null,
    })
    expect(body.blankAndUntouched).toBe(0)
  })

  it('carries the caveat in the payload, not only in the docs', async () => {
    const body = await (await GET(request())).json()
    expect(body.scope).toContain('routing map')
    expect(body.caveat).toContain('not a verdict')
    expect(body.caveat).toContain('outage')
    expect(typeof body.generatedAt).toBe('string')
  })
})
