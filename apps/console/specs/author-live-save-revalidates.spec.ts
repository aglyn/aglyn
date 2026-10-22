/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored, and this suite needs `Request`/`Response`.
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
 * An author's save on a live screen reaches the live page (AGL-2934).
 *
 * The rules let an `author` save a live screen's SEO and its password, and the
 * tenant renders both. The announce after each save went to a route that
 * admitted only the publish roles and answered the author with a 404, and the
 * client read that 404 as nothing to report. So the live page kept its old
 * `<title>`, or went on serving a page that had just been protected, for the
 * whole cache window, and nobody was told.
 *
 * ## Real on both sides of the hop
 *
 * Save SEO and the password Save both announce through
 * `announceLiveScreenChange`, which calls `revalidateLivePages`, which calls
 * the console route. The route and the client each have specs of their own,
 * and the defect lived BETWEEN them — a refusal on one side that the other
 * read as silence — so this suite runs the real announce, the real client
 * helper, the real `authorizedFetch` and the real route handler together.
 * Only the edges are doubles: the browser's `fetch` hands the console route's
 * request to its handler in-process and the tenant's to a recorder, and
 * Firebase Admin and the org roster answer from fixtures.
 */

const mockVerifyIdToken = jest.fn()
const mockResolveOrgPermissions = jest.fn()
const mockLockdownRefusal = jest.fn()

const mockHosts: Record<string, Record<string, unknown>> = {}

const mockHostSnapshot = (id: string) => {
  const data = mockHosts[id]
  return {
    id,
    exists: Boolean(data),
    data: () => data,
    get: (field: string) => (data ?? {})[field],
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({ get: async () => mockHostSnapshot(id) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => false,
  getOrgForHost: async () => null,
  lockdownRefusal: (...args: unknown[]) => mockLockdownRefusal(...args),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: (...args: unknown[]) =>
    mockResolveOrgPermissions(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
    },
  }),
  // The real ones: what the author is admitted by, and the address the drop
  // names, are both part of what is asserted.
  hostRoleCanWrite: jest.requireActual('@aglyn/aglyn/app-utils/organizations')
    .hostRoleCanWrite,
  screenRoutePathToUrl: jest.requireActual('@aglyn/aglyn/app-utils/screen-route')
    .screenRoutePathToUrl,
  decodeStoredNodes: () => [],
  TENANT_APEX: 'aglyn.app',
}))

import { POST } from '../app/api/screens/revalidate/route'
import { announceLiveScreenChange } from '../constants/screen-live-announce'

/** Each drop the tenant was asked for, as its request body. */
const tenantDrops: Array<Record<string, unknown>> = []

/**
 * The browser's network. The console route is answered by its own handler,
 * and the tenant by a recorder that accepts every path it is given.
 */
const browserFetch = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const url = String(input)
  if (url === '/api/screens/revalidate') {
    return POST(new Request(`https://app.aglyn.com${url}`, init))
  }
  if (url === 'https://shop.aglyn.app/api/revalidate') {
    const body = JSON.parse(String(init?.body)) as { paths: string[] }
    tenantDrops.push(body)
    return Response.json({ revalidated: body.paths })
  }
  throw new Error(`unexpected request: ${url}`)
}

/** One held user per role, each able to mint the token the route verifies. */
const userFor = (uid: string) => ({ uid, getIdToken: async () => `token:${uid}` })
const AUTHOR = userFor('site-author')
const VIEWER = userFor('site-viewer')

const nextTurn = () => new Promise((resolve) => setImmediate(resolve))

/**
 * Lets the unawaited announce run to its end — token, route, tenant, verdict.
 *
 * Until `reached` holds, and then a margin past it, so the steps after the
 * observable one have run too: a success is asserted by what did NOT happen
 * after the drop, and that is only worth asserting once the chain is done.
 * Nothing on the path waits on a timer, so turns of the event loop drain it.
 */
const settle = async (reached: () => boolean): Promise<void> => {
  for (let turn = 0; turn < 200 && !reached(); turn += 1) await nextTurn()
  for (let turn = 0; turn < 25; turn += 1) await nextTurn()
}

/** What Save SEO and the password Save both call once their write lands. */
const announceSave = (user: { getIdToken: () => Promise<string> }) => {
  const notify = jest.fn()
  announceLiveScreenChange({
    user,
    hostId: 'host-1' as never,
    screenId: 'screen-careers' as never,
    livePath: 'careers',
    notify,
  })
  return notify
}

const STALE_WARNING =
  'Saved. The live pages could not be refreshed just now, so they may show ' +
  'the previous version for up to an hour.'

describe("a live screen's save announce, end to end (AGL-2934)", () => {
  const previousSecret = process.env['REVALIDATE_SECRET']
  const previousFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    tenantDrops.length = 0
    // Without it the route answers `not-configured` before calling the
    // tenant, and a success case could pass without a drop being made.
    process.env['REVALIDATE_SECRET'] = 'secret'
    global.fetch = browserFetch as unknown as typeof fetch
    // The production shape: the rules only let an author's or a viewer's own
    // write land because this projection names them.
    for (const id of Object.keys(mockHosts)) delete mockHosts[id]
    mockHosts['host-1'] = {
      subdomain: 'shop',
      memberRoles: { 'site-author': 'author', 'site-viewer': 'viewer' },
      screens: { 'screen-careers': 'careers' },
    }
    mockVerifyIdToken.mockImplementation(async (token: string) => ({
      uid: token.replace(/^token:/, ''),
      email_verified: true,
    }))
    mockResolveOrgPermissions.mockImplementation(async (uid: string) => ({
      hostRole: (mockHosts['host-1']['memberRoles'] as Record<string, string>)[
        uid
      ] ?? null,
    }))
    mockLockdownRefusal.mockResolvedValue(null)
    // The route's one-line telemetry per announce; not what is under test.
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  afterAll(() => {
    global.fetch = previousFetch
    if (previousSecret === undefined) delete process.env['REVALIDATE_SECRET']
    else process.env['REVALIDATE_SECRET'] = previousSecret
  })

  it("drops an AUTHOR's live page, and says nothing more", async () => {
    const notify = announceSave(AUTHOR)
    await settle(() => tenantDrops.length > 0)

    // The screen's own address, on the site's cache key, with the host tag.
    expect(tenantDrops).toEqual([
      { host: 'shop', hostId: 'host-1', paths: ['/careers'] },
    ])
    // A complete drop is a success, and a success is silent.
    expect(notify).not.toHaveBeenCalled()
  })

  it('refuses a VIEWER, and the refusal reaches them as a warning', async () => {
    const notify = announceSave(VIEWER)
    await settle(() => notify.mock.calls.length > 0)

    expect(tenantDrops).toEqual([])
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(STALE_WARNING, {
      variant: 'warning',
      persist: false,
    })
  })

  it('warns an author whose drop a LOCKED site refuses', async () => {
    // The 423 body carries a `reason` of its own. The client must not read
    // it as the drop's.
    mockLockdownRefusal.mockResolvedValue(
      Response.json({ error: 'locked', reason: 'billing' }, { status: 423 }),
    )
    const notify = announceSave(AUTHOR)
    await settle(() => notify.mock.calls.length > 0)

    expect(tenantDrops).toEqual([])
    expect(notify).toHaveBeenCalledWith(STALE_WARNING, {
      variant: 'warning',
      persist: false,
    })
  })

  it('warns when the sign-in behind the save cannot be confirmed', async () => {
    // `authorizedFetch` answers a token it could not mint with a 401 of its
    // own rather than sending the request, and that is a refusal too.
    const notify = announceSave({
      getIdToken: () => Promise.reject(new Error('network-request-failed')),
    })
    await settle(() => notify.mock.calls.length > 0)

    expect(tenantDrops).toEqual([])
    expect(mockVerifyIdToken).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(STALE_WARNING, {
      variant: 'warning',
      persist: false,
    })
  })
})
