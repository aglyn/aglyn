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
 * A machine's route judges the plugin's gates itself (AGL-3080).
 *
 * A scheduler's sweep and a provider's webhook name no site and no member,
 * so the dispatcher has no subject to gate them on before they have verified
 * their caller — gated anonymously, a plugin on a partial rollout would
 * refuse every run. A route registered with `machine: true` skips the
 * per-site enablement and release gates, and lockdown still applies; every
 * other route of the same plugin is still refused while its flag is off.
 *
 * The registry is REAL, as in `plugin-recipient-link-release-gate.spec.ts`;
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
  isPluginMachineRoute,
  isPluginPortabilityRoute,
  registerPluginApiRoute,
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { isMachinePluginApiPath } from '@aglyn/aglyn/app-utils/plugin-api-rate-limit'
import { GET, POST } from '../app/api/[...pluginApi]/route'

const SWEEP_ROUTE = 'acme-mail/nightly-sweep'
const DOOR_ROUTE = 'acme-mail/settings'
const EXPORT_ROUTE = 'acme-mail/export'

const params = (path: string) => Promise.resolve({ pluginApi: path.split('/') })

beforeEach(() => {
  mockFlagOn = false
  mockGateCalls = 0
  mockLockdownCalls = 0
  mockRateLimitCalls = 0
  mockLocked = false
  registerPluginApiRoute(
    SWEEP_ROUTE,
    { web: async (request) => Response.json({ ok: true, method: request.method }) },
    { machine: true },
  )
  registerPluginApiRoute(DOOR_ROUTE, { web: async () => Response.json({ ok: true }) })
  registerPluginApiRoute(
    EXPORT_ROUTE,
    { web: async () => new Response('email\n', { status: 200 }) },
    { portability: true },
  )
})

afterEach(() => {
  unregisterPluginApiRoute(SWEEP_ROUTE)
  unregisterPluginApiRoute(DOOR_ROUTE)
  unregisterPluginApiRoute(EXPORT_ROUTE)
})

describe('console plugin API dispatcher — a machine’s route (AGL-3080)', () => {
  it('knows which routes are a machine’s, by what the route registered', () => {
    expect(isPluginMachineRoute(SWEEP_ROUTE)).toBe(true)
    expect(isPluginMachineRoute(`/${SWEEP_ROUTE}/`)).toBe(true)
    expect(isPluginMachineRoute(DOOR_ROUTE)).toBe(false)
    expect(isPluginMachineRoute('acme-mail/nothing-here')).toBe(false)
  })

  it('is exempt from the write limit because it registered as a machine’s, and only then', () => {
    expect(isMachinePluginApiPath(SWEEP_ROUTE)).toBe(true)
    expect(isMachinePluginApiPath(DOOR_ROUTE)).toBe(false)
  })

  it('answers the scheduler’s POST and the plan’s GET while the plugin is released to nobody', async () => {
    const post = await POST(
      new Request(`https://app.example.com/api/${SWEEP_ROUTE}`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'checked-by-the-route' },
      }),
      { params: params(SWEEP_ROUTE) },
    )
    const get = await GET(new Request(`https://app.example.com/api/${SWEEP_ROUTE}`), {
      params: params(SWEEP_ROUTE),
    })
    expect([post.status, get.status]).toEqual([200, 200])
    expect(mockGateCalls).toBe(0)
  })

  it('still refuses every other route of the same plugin while its flag is off', async () => {
    const response = await GET(new Request(`https://app.example.com/api/${DOOR_ROUTE}`), {
      params: params(DOOR_ROUTE),
    })
    expect(response.status).toBe(404)
    expect(mockGateCalls).toBe(1)
  })

  it('skips only the plugin’s gates: lockdown still stands', async () => {
    mockLocked = true
    const locked = await POST(
      new Request(`https://app.example.com/api/${SWEEP_ROUTE}`, { method: 'POST' }),
      { params: params(SWEEP_ROUTE) },
    )
    expect(locked.status).toBe(423)
    expect(mockLockdownCalls).toBe(1)
  })

  it('stops being a machine’s when the route registers again without the flag', async () => {
    registerPluginApiRoute(SWEEP_ROUTE, { web: async () => Response.json({ ok: true }) })
    expect(isPluginMachineRoute(SWEEP_ROUTE)).toBe(false)
    expect(isMachinePluginApiPath(SWEEP_ROUTE)).toBe(false)
    const response = await POST(
      new Request(`https://app.example.com/api/${SWEEP_ROUTE}`, { method: 'POST' }),
      { params: params(SWEEP_ROUTE) },
    )
    expect(response.status).toBe(404)
  })
})

describe('console plugin API dispatcher — a workspace’s own records, exported (AGL-3080)', () => {
  it('knows the portability route by what it registered, and nothing else', () => {
    expect(isPluginPortabilityRoute(EXPORT_ROUTE)).toBe(true)
    expect(isPluginPortabilityRoute(DOOR_ROUTE)).toBe(false)
    expect(isPluginPortabilityRoute(SWEEP_ROUTE)).toBe(false)
    // A member's export is not a machine's: the write limit still counts it.
    expect(isMachinePluginApiPath(EXPORT_ROUTE)).toBe(false)
  })

  it('answers while the plugin is released to nobody, and asks no gate', async () => {
    const response = await GET(
      new Request(`https://app.example.com/api/${EXPORT_ROUTE}?orgId=org-1&resource=contacts`, {
        headers: { authorization: 'Bearer member' },
      }),
      { params: params(EXPORT_ROUTE) },
    )
    expect(response.status).toBe(200)
    expect(mockGateCalls).toBe(0)
  })

  it('skips only the plugin’s gates: lockdown still stands', async () => {
    mockLocked = true
    const locked = await GET(new Request(`https://app.example.com/api/${EXPORT_ROUTE}`), {
      params: params(EXPORT_ROUTE),
    })
    expect(locked.status).toBe(423)
  })
})
