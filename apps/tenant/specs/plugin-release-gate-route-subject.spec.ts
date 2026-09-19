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
 * The tenant dispatcher honors a route-declared release subject on the same
 * terms as the console's (AGL-2978).
 *
 * Both dispatchers resolve routes from ONE registry, so a subject a plugin
 * declares on a route must mean the same thing whichever app serves it: asked
 * only when the request names no site, and a null answer is the anonymous
 * reading. The console half, and the argument, is
 * `apps/console/specs/plugin-release-gate-route-subject.spec.ts`.
 */

let mockFlagOn: boolean
let mockGateCalls: Array<{ orgId?: string | null; subjectUid?: string | null }>
let mockHandlerCalls: number

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(
    async (pluginIds: string[], options: { orgId?: string | null; subjectUid?: string | null }) => {
      mockGateCalls.push(options)
      return mockFlagOn ? [...pluginIds] : []
    },
  ),
  getHostDisabledPlugins: jest.fn(async () => []),
  getOrgForHost: jest.fn(async () => ({ orgId: 'org-of-host', org: { enabledPlugins: ['events-calendar'] } })),
  visitorWriteRefusal: jest.fn(async () => null),
  visitorWriteRateLimitRefusal: jest.fn(async () => null),
}))

jest.mock('@aglyn/aglyn/server', () => {
  const registry = jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
  return {
    __esModule: true,
    ...jest.requireActual('../../../libs/aglyn/src/lib/plugin-manager/enabled-plugins'),
    ...jest.requireActual('../../../libs/aglyn/src/lib/app-utils/plugin-api-cross-origin'),
    lockdownPausedSurfaceForPluginApiPath: jest.fn(() => undefined),
    pluginIdForRegisteredApiPath: jest.fn(() => 'events-calendar'),
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
    pluginIdForApiPath: jest.fn(() => 'events-calendar'),
  },
}))

import {
  registerPluginApiRoute,
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { GET } from '../app/api/[...pluginApi]/route'

const ROUTE = 'events/example-subject'
const params = Promise.resolve({ pluginApi: ROUTE.split('/') })

beforeEach(() => {
  mockFlagOn = true
  mockGateCalls = []
  mockHandlerCalls = 0
  registerPluginApiRoute(
    ROUTE,
    {
      web: async () => {
        mockHandlerCalls += 1
        return Response.json({ ok: true })
      },
    },
    {
      subject: (request) => {
        const orgId = new URL(request.url).searchParams.get('orgId')
        return orgId ? { orgId } : null
      },
    },
  )
})

afterEach(() => {
  unregisterPluginApiRoute(ROUTE)
})

describe('tenant plugin API dispatcher — a route-declared release subject (AGL-2978)', () => {
  it('asks the gate about the org a site-less request names', async () => {
    const response = await GET(
      new Request(`https://site.aglyn.app/api/${ROUTE}?orgId=org-1`),
      { params },
    )

    expect(response.status).toBe(200)
    expect(mockGateCalls[0].orgId).toBe('org-1')
    expect(mockHandlerCalls).toBe(1)
  })

  it('still refuses when the gate refuses that org', async () => {
    mockFlagOn = false
    const response = await GET(
      new Request(`https://site.aglyn.app/api/${ROUTE}?orgId=org-1`),
      { params },
    )

    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
  })

  it('lets a named site decide the org, without consulting the route', async () => {
    await GET(
      new Request(`https://site.aglyn.app/api/${ROUTE}?hostId=host-1&orgId=org-1`),
      { params },
    )

    expect(mockGateCalls[0].orgId).toBe('org-of-host')
    expect(mockGateCalls[0].subjectUid).toBeNull()
  })
})
