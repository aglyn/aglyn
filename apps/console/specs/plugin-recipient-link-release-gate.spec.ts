/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * A link mailed to a recipient answers whatever the release flag says now
 * (AGL-2981).
 *
 * An unsubscribe in a message's `List-Unsubscribe` header has to keep
 * working after the plugin that sent the message is paused for the
 * workspace: CAN-SPAM holds an opt-out open for thirty days after the send.
 * A route registered with `recipientLink: true` skips the dispatcher's
 * per-site enablement and release gates — and ONLY those: lockdown and the
 * rate limit still run, and every other route of the same plugin is still
 * refused while its flag is off.
 *
 * The registry is REAL, as in `plugin-release-gate-route-subject.spec.ts`;
 * the gate and the other refusals are recorders.
 */

let mockFlagOn: boolean
let mockGateCalls: number
let mockLockdownCalls: number
let mockRateLimitCalls: number
let mockLocked: boolean

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(async (pluginIds: string[]) => {
    mockGateCalls += 1
    return mockFlagOn ? [...pluginIds] : []
  }),
  featureLockdownRefusal: jest.fn(async () => null),
  lockdownRefusal: jest.fn(async () => {
    mockLockdownCalls += 1
    return mockLocked ? Response.json({ error: 'locked' }, { status: 423 }) : null
  }),
  consoleApiRateLimitRefusal: jest.fn(async () => {
    mockRateLimitCalls += 1
    return null
  }),
  emailUnverifiedResponse: jest.fn(() => Response.json({}, { status: 403 })),
  isEmailVerified: jest.fn(() => true),
  isImpersonationSession: jest.fn(() => false),
  firebaseAdmin: { app: () => ({ auth: () => ({ verifyIdToken: async () => ({ uid: 'member-1' }) }) }) },
  getHostDisabledPlugins: jest.fn(async () => ['acme-mail']),
  getHostDocAdmin: jest.fn(async () => ({ id: 'host-1' })),
  getOrgForHost: jest.fn(async () => ({ orgId: 'org-of-host', org: { enabledPlugins: ['acme-mail'] } })),
}))

jest.mock('@aglyn/aglyn/server', () => {
  const registry = jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
  return {
    __esModule: true,
    ...jest.requireActual('../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins'),
    lockdownFeaturesForPluginApiPath: jest.fn(() => []),
    pluginIdForRegisteredApiPath: jest.fn(() => 'acme-mail'),
    resolvePluginApiMatch: registry.resolvePluginApiMatch,
    resolvePluginApiRequestSubject: registry.resolvePluginApiRequestSubject,
    runPluginApiMatch: registry.runPluginApiMatch,
    runLegacyHandler: jest.fn(),
  }
})

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async () => undefined),
    pluginIdForApiPath: jest.fn(() => 'acme-mail'),
  },
}))

import {
  isPluginRecipientLinkRoute,
  registerPluginApiRoute,
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { GET, POST } from '../app/api/[...pluginApi]/route'

const LINK_ROUTE = 'acme-mail/unsubscribe'
const DOOR_ROUTE = 'acme-mail/settings'

const params = (path: string) => Promise.resolve({ pluginApi: path.split('/') })

beforeEach(() => {
  mockFlagOn = false
  mockGateCalls = 0
  mockLockdownCalls = 0
  mockRateLimitCalls = 0
  mockLocked = false
  registerPluginApiRoute(
    LINK_ROUTE,
    { web: async (request) => Response.json({ ok: true, method: request.method }) },
    { recipientLink: true },
  )
  registerPluginApiRoute(DOOR_ROUTE, { web: async () => Response.json({ ok: true }) })
})

afterEach(() => {
  unregisterPluginApiRoute(LINK_ROUTE)
  unregisterPluginApiRoute(DOOR_ROUTE)
})

describe('console plugin API dispatcher — a recipient link (AGL-2981)', () => {
  it('knows which routes are recipient links, by what the route registered', () => {
    expect(isPluginRecipientLinkRoute(LINK_ROUTE)).toBe(true)
    expect(isPluginRecipientLinkRoute(`/${LINK_ROUTE}/`)).toBe(true)
    expect(isPluginRecipientLinkRoute(DOOR_ROUTE)).toBe(false)
    expect(isPluginRecipientLinkRoute('acme-mail/nothing-here')).toBe(false)
  })

  it('answers a GET and the one-click POST while the plugin is released to nobody', async () => {
    const get = await GET(new Request(`https://app.example.com/api/${LINK_ROUTE}?t=signed`), {
      params: params(LINK_ROUTE),
    })
    const post = await POST(
      new Request(`https://app.example.com/api/${LINK_ROUTE}?t=signed`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      { params: params(LINK_ROUTE) },
    )
    expect([get.status, post.status]).toEqual([200, 200])
    expect(mockGateCalls).toBe(0)
  })

  it('answers even when the site it names switched the plugin off', async () => {
    const response = await GET(
      new Request(`https://app.example.com/api/${LINK_ROUTE}?hostId=host-1&t=signed`),
      { params: params(LINK_ROUTE) },
    )
    expect(response.status).toBe(200)
  })

  it('still refuses every other route of the same plugin while its flag is off', async () => {
    const response = await GET(new Request(`https://app.example.com/api/${DOOR_ROUTE}`), {
      params: params(DOOR_ROUTE),
    })
    expect(response.status).toBe(404)
    expect(mockGateCalls).toBe(1)
  })

  it('skips only those gates: lockdown and the rate limit still stand', async () => {
    mockLocked = true
    const locked = await GET(new Request(`https://app.example.com/api/${LINK_ROUTE}?t=signed`), {
      params: params(LINK_ROUTE),
    })
    expect(locked.status).toBe(423)

    mockLocked = false
    await GET(new Request(`https://app.example.com/api/${LINK_ROUTE}?t=signed`), {
      params: params(LINK_ROUTE),
    })
    expect(mockLockdownCalls).toBe(2)
    expect(mockRateLimitCalls).toBe(1)
  })

  it('stops being a recipient link when the route registers again without the flag', async () => {
    registerPluginApiRoute(LINK_ROUTE, { web: async () => Response.json({ ok: true }) })
    expect(isPluginRecipientLinkRoute(LINK_ROUTE)).toBe(false)
    const response = await GET(new Request(`https://app.example.com/api/${LINK_ROUTE}?t=signed`), {
      params: params(LINK_ROUTE),
    })
    expect(response.status).toBe(404)
  })
})
