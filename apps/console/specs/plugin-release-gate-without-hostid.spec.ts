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
 * The console dispatcher's half of AGL-1689 — the same nesting, the same fix.
 *
 * See `apps/tenant/specs/plugin-release-gate-without-hostid.spec.ts` for the
 * argument. Pinned separately rather than shared because the two dispatchers
 * are separate files that have drifted before: the console one also carries
 * the org/host lockdown reads and the bearer decode, so a change there could
 * re-nest this gate without the tenant suite noticing.
 *
 * Asserted at `runLegacyHandler`, not the status code: a 404 could equally
 * mean no route matched, and the claim is that the handler does not run.
 */

/** What `filterEnabledPluginsByReleaseFlags` should answer. */
let mockFlagOn: boolean
/** Every options object the dispatcher passed to the release gate. */
let mockGateCalls: Array<{ orgId?: string | null; authorization?: string | null }>
/** Requests that reached the plugin handler. */
let mockHandlerCalls: number

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(
    async (
      pluginIds: string[],
      options: { orgId?: string | null; authorization?: string | null },
    ) => {
      mockGateCalls.push(options)
      return mockFlagOn ? [...pluginIds] : []
    },
  ),
  // Nothing is locked in these scenarios; both lockdown verdicts are
  // unit-tested in the tenant-data-admin lockdown suite. Returning null here
  // means a 404 can only have come from the release gate.
  featureLockdownRefusal: jest.fn(async () => null),
  lockdownRefusal: jest.fn(async () => null),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'user-1', staff: false }),
      }),
    }),
  },
  getHostDisabledPlugins: jest.fn(async () => []),
  getHostDocAdmin: jest.fn(async () => ({ id: 'host-1' })),
  getOrgForHost: jest.fn(async () => ({
    orgId: 'org-1',
    org: { enabledPlugins: ['bookings'] },
  })),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  lockdownFeaturesForPluginApiPath: jest.fn(() => []),
  pluginIdForRegisteredApiPath: jest.fn(() => 'bookings'),
  // The REAL enablement resolver, so "past the enablement check" means the
  // org's set genuinely contained the plugin rather than a stub saying so.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins',
  ),
  resolvePluginApiRoute: jest.fn(() => ({ path: 'bookings/services' })),
  runLegacyHandler: jest.fn(async () => {
    mockHandlerCalls += 1
    return Response.json({ services: [] }, { status: 200 })
  }),
}))

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: {
    ensureAll: jest.fn(async () => undefined),
    pluginIdForApiPath: jest.fn(() => 'bookings'),
  },
}))

import { GET, POST } from '../app/api/[...pluginApi]/route'

const params = Promise.resolve({ pluginApi: ['bookings', 'services'] })

beforeEach(() => {
  mockFlagOn = false
  mockGateCalls = []
  mockHandlerCalls = 0
})

describe('console plugin API dispatcher — release gate without a hostId', () => {
  it('refuses a flagged-off plugin on a GET with no hostId query', async () => {
    const response = await GET(
      new Request('https://app.aglyn.com/api/bookings/services'),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
  })

  it('refuses a flagged-off plugin when the body is not JSON', async () => {
    const response = await POST(
      new Request('https://app.aglyn.com/api/bookings/services', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not json at all',
      }),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
  })

  it('asks the gate with a null org, and forwards the bearer token', async () => {
    await GET(
      new Request('https://app.aglyn.com/api/bookings/services', {
        headers: { authorization: 'Bearer staff-token' },
      }),
      { params },
    )

    expect(mockGateCalls).toHaveLength(1)
    // Null subject, so no partial rollout can apply (AGL-1656) — and the
    // header still travels, because the staff preview bypass lives inside the
    // gate and a hostId-less request is exactly how staff reach a dark
    // feature's API while previewing it.
    expect(mockGateCalls[0].orgId).toBeNull()
    expect(mockGateCalls[0].authorization).toBe('Bearer staff-token')
  })

  it('still refuses a flagged-off plugin when a hostId IS named', async () => {
    const response = await GET(
      new Request('https://app.aglyn.com/api/bookings/services?hostId=host-1'),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
    expect(mockGateCalls[0].orgId).toBe('org-1')
  })

  it('lets a hostId-less request through while the flag is ON', async () => {
    mockFlagOn = true

    const response = await GET(
      new Request('https://app.aglyn.com/api/bookings/services'),
      { params },
    )

    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })
})
