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
 * A route may name the subject the console release gate asks about (AGL-2978).
 *
 * The gate reads per-org overrides and rollout buckets off an org id, and the
 * dispatcher learned that id only from a `hostId`. An organization-level
 * surface names no site, and a provider's OAuth redirect carries no bearer
 * token, so both reached the gate as anonymous: a plugin released to one
 * organization by override 404'd that organization's own requests, and a
 * staff member previewing a dark plugin could not come back from Google.
 *
 * The registry is REAL here — the route is registered with its resolver and
 * the dispatcher finds it the way it finds any route — and only the gate and
 * the handler are recorders, so what is asserted is what the gate was ASKED.
 * `plugin-release-gate-without-hostid.spec.ts` keeps pinning the undeclared
 * case, where the answer is still a null org.
 */

let mockFlagOn: boolean
let mockGateCalls: Array<{
  orgId?: string | null
  authorization?: string | null
  subjectUid?: string | null
}>
let mockHandlerBodies: string[]

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(
    async (pluginIds: string[], options: Record<string, string | null>) => {
      mockGateCalls.push(options)
      return mockFlagOn ? [...pluginIds] : []
    },
  ),
  featureLockdownRefusal: jest.fn(async () => null),
  lockdownRefusal: jest.fn(async () => null),
  consoleApiRateLimitRefusal: jest.fn(async () => null),
  emailUnverifiedResponse: jest.fn(() => Response.json({}, { status: 403 })),
  isEmailVerified: jest.fn(() => true),
  isImpersonationSession: jest.fn(() => false),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'member-1', email_verified: true }),
      }),
    }),
  },
  getHostDisabledPlugins: jest.fn(async () => []),
  getHostDocAdmin: jest.fn(async () => ({ id: 'host-1' })),
  getOrgForHost: jest.fn(async () => ({
    orgId: 'org-of-host',
    org: { enabledPlugins: ['outreach'] },
  })),
}))

jest.mock('@aglyn/aglyn/server', () => {
  const registry = jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
  return {
    __esModule: true,
    ...jest.requireActual('../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins'),
    lockdownFeaturesForPluginApiPath: jest.fn(() => []),
    pluginIdForRegisteredApiPath: jest.fn(() => 'outreach'),
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
    pluginIdForApiPath: jest.fn(() => 'outreach'),
  },
}))

import {
  registerPluginApiRoute,
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { GET, POST } from '../app/api/[...pluginApi]/route'

const ORG_ROUTE = 'outreach/example-org-route'
const REDIRECT_ROUTE = 'outreach/example-redirect'

const params = (path: string) =>
  Promise.resolve({ pluginApi: path.split('/') })

beforeEach(() => {
  mockFlagOn = true
  mockGateCalls = []
  mockHandlerBodies = []
  // A web route that records the body it was handed, so a resolver that
  // consumed the stream instead of a clone would show up as an empty body.
  registerPluginApiRoute(
    ORG_ROUTE,
    {
      web: async (request) => {
        mockHandlerBodies.push(await request.text())
        return Response.json({ ok: true })
      },
    },
    {
      subject: async (request) => {
        const url = new URL(request.url)
        const fromQuery = url.searchParams.get('orgId')
        if (fromQuery) return { orgId: fromQuery }
        const body = (await request.json().catch(() => null)) as { orgId?: string } | null
        return body?.orgId ? { orgId: body.orgId } : null
      },
    },
  )
  registerPluginApiRoute(
    REDIRECT_ROUTE,
    { web: async () => new Response(null, { status: 303, headers: { Location: '/' } }) },
    {
      // Stands in for a signed state: the route vouches for org AND account.
      subject: (request) =>
        new URL(request.url).searchParams.get('state') === 'signed'
          ? { orgId: 'org-from-state', uid: 'staff-1' }
          : null,
    },
  )
})

afterEach(() => {
  unregisterPluginApiRoute(ORG_ROUTE)
  unregisterPluginApiRoute(REDIRECT_ROUTE)
})

describe('console plugin API dispatcher — a route-declared release subject (AGL-2978)', () => {
  it('asks the gate about the org an organization-level request names', async () => {
    const response = await GET(
      new Request(`https://app.aglyn.com/api/${ORG_ROUTE}?orgId=org-1`, {
        headers: { authorization: 'Bearer member-token' },
      }),
      { params: params(ORG_ROUTE) },
    )

    expect(response.status).toBe(200)
    expect(mockGateCalls).toHaveLength(1)
    expect(mockGateCalls[0].orgId).toBe('org-1')
    expect(mockGateCalls[0].authorization).toBe('Bearer member-token')
  })

  it('reads a JSON body through a clone, so the handler still receives it whole', async () => {
    const body = JSON.stringify({ orgId: 'org-2', note: 'kept' })
    const response = await POST(
      new Request(`https://app.aglyn.com/api/${ORG_ROUTE}`, {
        method: 'POST',
        headers: { authorization: 'Bearer member-token', 'content-type': 'application/json' },
        body,
      }),
      { params: params(ORG_ROUTE) },
    )

    expect(response.status).toBe(200)
    expect(mockGateCalls[0].orgId).toBe('org-2')
    expect(mockHandlerBodies).toEqual([body])
  })

  it('still refuses when the gate refuses that org — a subject is no bypass', async () => {
    mockFlagOn = false
    const response = await GET(
      new Request(`https://app.aglyn.com/api/${ORG_ROUTE}?orgId=org-1`),
      { params: params(ORG_ROUTE) },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerBodies).toEqual([])
  })

  it('lets a tokenless redirect name the account its signed state was minted for', async () => {
    const response = await GET(
      new Request(`https://app.aglyn.com/api/${REDIRECT_ROUTE}?state=signed&code=abc`),
      { params: params(REDIRECT_ROUTE) },
    )

    expect(response.status).toBe(303)
    expect(mockGateCalls[0]).toEqual(
      expect.objectContaining({ orgId: 'org-from-state', subjectUid: 'staff-1', authorization: null }),
    )
  })

  it('names no subject for a redirect whose state does not verify', async () => {
    mockFlagOn = false
    const response = await GET(
      new Request(`https://app.aglyn.com/api/${REDIRECT_ROUTE}?state=forged`),
      { params: params(REDIRECT_ROUTE) },
    )

    expect(response.status).toBe(404)
    expect(mockGateCalls[0].orgId).toBeNull()
    expect(mockGateCalls[0].subjectUid).toBeNull()
  })

  it('lets a named site decide the org, without consulting the route', async () => {
    await GET(
      new Request(`https://app.aglyn.com/api/${ORG_ROUTE}?hostId=host-1&orgId=org-1`),
      { params: params(ORG_ROUTE) },
    )

    expect(mockGateCalls[0].orgId).toBe('org-of-host')
    expect(mockGateCalls[0].subjectUid).toBeNull()
  })
})
