/**
 * @jest-environment node
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
 * `POST /api/hosts/starter` (AGL-3594): the starter a site born for the
 * guided AI start gets when the person leaves the start for a blank site.
 * Held here: the site's own admins and editors, and staff, may ask; nobody
 * else; the lockdown verdict stands; and the route reports what
 * `provisionStarterSite` did, dropping the cached holding page only when it
 * wrote something.
 */

const mockProvision = jest.fn()
const mockDropCache = jest.fn(async () => undefined)
const mockLockdown = jest.fn(async () => null as Response | null)
const mockVerify = jest.fn()
const mockHosts = new Map<string, Record<string, unknown>>()

const mockRegisterDeclarations = jest.fn(async () => undefined)
const mockLook = jest.fn(async (_style: string): Promise<Record<string, unknown> | null> => null)
let mockLooksRegistered = true
jest.mock('../constants/plugins.declarations.server.generated', () => ({
  registerPluginServerDeclarations: () => mockRegisterDeclarations(),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-style-looks', () => ({
  resolveSiteStyleLooks: () => (mockLooksRegistered ? { look: (style: string) => mockLook(style) } : null),
}))

jest.mock('../utils/server/provision-host', () => ({
  __esModule: true,
  provisionStarterSite: (...args: unknown[]) => mockProvision(...args),
}))
jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({
  __esModule: true,
  dropPluginSiteCache: (...args: unknown[]) => mockDropCache(...(args as [])),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: Object.fromEntries(request.headers.entries()),
  }),
}))
jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () => Response.json({ error: 'verify' }, { status: 403 }),
  getOrgForHost: async () => ({ org: { plan: 'free' } }),
  isImpersonationSession: () => false,
  lockdownRefusal: (...args: unknown[]) => mockLockdown(...(args as [])),
  logHostActivity: async () => undefined,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => mockVerify(token) }),
      firestore: () => ({
        collection: () => ({
          doc: (id: string) => ({
            get: async () => ({
              exists: mockHosts.has(id),
              get: (field: string) => mockHosts.get(id)?.[field],
              data: () => mockHosts.get(id),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { POST } from '../app/api/hosts/starter/route'

const ask = (body: Record<string, unknown>, token: string | null = 'tok') =>
  POST(
    new Request('https://console.test/api/hosts/starter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  mockLooksRegistered = true
  mockLook.mockReset()
  mockLook.mockResolvedValue(null)
  mockRegisterDeclarations.mockClear()
  mockProvision.mockReset()
  mockDropCache.mockClear()
  mockLockdown.mockReset()
  mockLockdown.mockResolvedValue(null)
  mockVerify.mockReset()
  mockVerify.mockResolvedValue({ uid: 'editor-1', email_verified: true })
  mockHosts.clear()
  mockHosts.set('host-1', { memberRoles: { 'editor-1': 'editor', 'viewer-1': 'viewer' } })
})

describe('POST /api/hosts/starter (AGL-3594)', () => {
  it('writes the starter for a site editor and drops the cached holding page', async () => {
    mockProvision.mockResolvedValue({ provisioned: true, screenId: 'scrHome' })
    const response = await ask({ hostId: 'host-1' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ provisioned: true, screenId: 'scrHome' })
    expect(mockProvision).toHaveBeenCalledWith(expect.anything(), 'host-1', {})
    // No style asked, so no look is read.
    expect(mockRegisterDeclarations).not.toHaveBeenCalled()
    expect(mockDropCache).toHaveBeenCalledTimes(1)
  })

  it('answers a site that already has a page with provisioned: false, and drops nothing', async () => {
    mockProvision.mockResolvedValue({ provisioned: false })
    const response = await ask({ hostId: 'host-1' })
    expect(await response.json()).toEqual({ provisioned: false, screenId: null })
    expect(mockDropCache).not.toHaveBeenCalled()
  })

  it('refuses anyone who is not a site admin or editor, before anything is written', async () => {
    mockVerify.mockResolvedValue({ uid: 'viewer-1', email_verified: true })
    expect((await ask({ hostId: 'host-1' })).status).toBe(403)
    mockVerify.mockResolvedValue({ uid: 'stranger', email_verified: true })
    expect((await ask({ hostId: 'host-1' })).status).toBe(403)
    expect(mockProvision).not.toHaveBeenCalled()
  })

  it('lets staff ask, and the lockdown verdict refuse', async () => {
    mockVerify.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    mockProvision.mockResolvedValue({ provisioned: false })
    expect((await ask({ hostId: 'host-1' })).status).toBe(200)
    mockLockdown.mockResolvedValueOnce(Response.json({ error: 'locked' }, { status: 423 }))
    expect((await ask({ hostId: 'host-1' })).status).toBe(423)
    expect(mockProvision).toHaveBeenCalledTimes(1)
  })

  it('needs a signed-in caller, a site and a site that exists', async () => {
    expect((await ask({ hostId: 'host-1' }, null)).status).toBe(401)
    expect((await ask({})).status).toBe(400)
    expect((await ask({ hostId: 'nope' })).status).toBe(404)
  })
})

describe('POST /api/hosts/starter with a style (AGL-4049)', () => {
  const LOOK = { kind: 'builtin', base: 'bootstrap', brand: { light: { primary: '#B3261E' } }, fonts: 'oswald' }

  it('gives the starter the chosen style\'s look, read from the plugin that has it', async () => {
    mockLook.mockResolvedValue(LOOK)
    mockProvision.mockResolvedValue({ provisioned: true, screenId: 'scrHome' })
    const response = await ask({ hostId: 'host-1', style: 'trades' })
    expect(response.status).toBe(200)
    expect(mockLook).toHaveBeenCalledWith('trades')
    expect(mockProvision).toHaveBeenCalledWith(expect.anything(), 'host-1', {
      style: { id: 'trades', theme: LOOK },
    })
  })

  it('records the style with no look when no plugin answers it', async () => {
    mockLooksRegistered = false
    mockProvision.mockResolvedValue({ provisioned: true, screenId: 'scrHome' })
    const response = await ask({ hostId: 'host-1', style: 'yoga' })
    expect(response.status).toBe(200)
    expect(mockProvision).toHaveBeenCalledWith(expect.anything(), 'host-1', {
      style: { id: 'yoga', theme: null },
    })
  })

  it('refuses a style that is not one, and "Pick for me", before anything is read or written', async () => {
    for (const style of ['nope', 'auto', '']) {
      const response = await ask({ hostId: 'host-1', style })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'Unknown style' })
    }
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockProvision).not.toHaveBeenCalled()
  })
})
