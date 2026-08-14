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
 * The plugin release gate does not depend on the caller naming a site
 * (AGL-1689).
 *
 * The tenant dispatcher resolved `hostId` from `?hostId=` or a JSON body, then
 * ran BOTH the per-site enablement check and the release-flag check inside
 * `if (hostId)`. Per-site enablement genuinely needs a site. A release flag
 * does not — it is documented as the switch that kills a plugin PLATFORM-WIDE.
 * Nested together, the kill switch became opt-in from the caller's side: omit
 * the query parameter, or post a body that does not parse as JSON, and the
 * flagged-off handler ran.
 *
 * The assertion surface is `runLegacyHandler`, not the status code. A 404 on
 * its own would not distinguish "the gate refused" from "no route matched";
 * the claim is that THE PLUGIN HANDLER NEVER RUNS, so every case asserts the
 * handler call count as well.
 *
 * Both halves are pinned, because a gate that refuses everything is not a fix:
 * with the flag ON the same hostId-less requests must reach the handler, and
 * the per-site enablement check must STAY conditional on a host — a
 * hostId-less request may not start paying Firestore reads to look one up.
 */

/** What `filterEnabledPluginsByReleaseFlags` should answer. */
let mockFlagOn: boolean
/** Every options object the dispatcher passed to the release gate. */
let mockGateCalls: Array<{ orgId?: string | null }>
/** Requests that reached the plugin handler. */
let mockHandlerCalls: number
/** Host lookups the dispatcher performed. */
let mockOrgLookups: string[]

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(
    async (pluginIds: string[], options: { orgId?: string | null }) => {
      mockGateCalls.push(options)
      return mockFlagOn ? [...pluginIds] : []
    },
  ),
  getHostDisabledPlugins: jest.fn(async () => []),
  getOrgForHost: jest.fn(async (hostId: string) => {
    mockOrgLookups.push(hostId)
    return { orgId: 'org-1', org: { enabledPlugins: ['bookings'] } }
  }),
  // Nothing is locked in these scenarios; the verdict logic is unit-tested in
  // the tenant-data-admin lockdown suite.
  visitorWriteRefusal: jest.fn(async () => null),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  lockdownPausedSurfaceForPluginApiPath: jest.fn(() => undefined),
  pluginIdForRegisteredApiPath: jest.fn(() => 'bookings'),
  // The REAL enablement resolver, so "past the enablement check" means the
  // org's set genuinely contained the plugin rather than a stub saying so.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins',
  ),
  resolvePluginApiRoute: jest.fn(() => ({ path: 'bookings/reserve' })),
  runLegacyHandler: jest.fn(async () => {
    mockHandlerCalls += 1
    return Response.json({ reserved: true }, { status: 200 })
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

const params = Promise.resolve({ pluginApi: ['bookings', 'reserve'] })

beforeEach(() => {
  mockFlagOn = false
  mockGateCalls = []
  mockHandlerCalls = 0
  mockOrgLookups = []
})

describe('tenant plugin API dispatcher — release gate without a hostId', () => {
  it('refuses a flagged-off plugin when the body is not JSON', async () => {
    // The exact hole the `catch` comment described as "fall through to handler
    // self-gating": a body the dispatcher cannot parse yields no hostId.
    const response = await POST(
      new Request('https://site.aglyn.app/api/bookings/reserve', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not json at all',
      }),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
  })

  it('refuses a flagged-off plugin on a GET with no hostId query', async () => {
    const response = await GET(
      new Request('https://site.aglyn.app/api/bookings/reserve'),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
  })

  it('refuses a flagged-off plugin when a JSON body simply omits hostId', async () => {
    const response = await POST(
      new Request('https://site.aglyn.app/api/bookings/reserve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ serviceId: 'svc-1' }),
      }),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
  })

  it('asks the gate with a null org rather than inventing a subject', async () => {
    await GET(new Request('https://site.aglyn.app/api/bookings/reserve'), {
      params,
    })

    // AGL-1656: a subject-less request gets the fully-enabled flags only,
    // never a partial rollout. Passing anything non-null here would put a
    // hostId or a guess back into the rollout bucket.
    expect(mockGateCalls).toHaveLength(1)
    expect(mockGateCalls[0].orgId).toBeNull()
  })

  it('still refuses a flagged-off plugin when a hostId IS named', async () => {
    const response = await GET(
      new Request('https://site.aglyn.app/api/bookings/reserve?hostId=host-1'),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
    expect(mockGateCalls[0].orgId).toBe('org-1')
  })

  it('lets a hostId-less request through while the flag is ON', async () => {
    mockFlagOn = true

    const response = await GET(
      new Request('https://site.aglyn.app/api/bookings/reserve'),
      { params },
    )

    // The other half of the claim: this is a gate, not a blanket refusal of
    // every request that declines to name a site.
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
  })

  it('does not look up a host it was never given', async () => {
    mockFlagOn = true

    await GET(new Request('https://site.aglyn.app/api/bookings/reserve'), {
      params,
    })

    // Per-site enablement stays conditional on a host. Hoisting THAT out of
    // the block alongside the release gate would spend a Firestore read on
    // every hostId-less request to answer a question with no subject.
    expect(mockOrgLookups).toEqual([])
  })
})
