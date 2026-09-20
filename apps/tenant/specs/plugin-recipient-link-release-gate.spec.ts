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
 * The tenant dispatcher lets a recipient link past its enablement and
 * release gates on the same terms as the console's (AGL-2981).
 *
 * Both dispatchers resolve routes from ONE registry, so a route registered
 * with `recipientLink: true` must mean the same thing whichever app serves
 * it. The argument is the console half's,
 * `apps/console/specs/plugin-recipient-link-release-gate.spec.ts`.
 */

let mockFlagOn: boolean
let mockGateCalls: number
let mockHandlerCalls: number

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  filterEnabledPluginsByReleaseFlags: jest.fn(async (pluginIds: string[]) => {
    mockGateCalls += 1
    return mockFlagOn ? [...pluginIds] : []
  }),
  // The site switched the plugin off.
  getHostDisabledPlugins: jest.fn(async () => ['events-calendar']),
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

const LINK_ROUTE = 'events/leave'
const DOOR_ROUTE = 'events/door'

beforeEach(() => {
  mockFlagOn = false
  mockGateCalls = 0
  mockHandlerCalls = 0
  const handler = {
    web: async () => {
      mockHandlerCalls += 1
      return Response.json({ ok: true })
    },
  }
  registerPluginApiRoute(LINK_ROUTE, handler, { recipientLink: true })
  registerPluginApiRoute(DOOR_ROUTE, handler)
})

afterEach(() => {
  unregisterPluginApiRoute(LINK_ROUTE)
  unregisterPluginApiRoute(DOOR_ROUTE)
})

describe('tenant plugin API dispatcher — a recipient link (AGL-2981)', () => {
  it('answers while the plugin is released to nobody and switched off for the site', async () => {
    const response = await GET(
      new Request(`https://site.aglyn.app/api/${LINK_ROUTE}?hostId=host-1&t=signed`),
      { params: Promise.resolve({ pluginApi: LINK_ROUTE.split('/') }) },
    )
    expect(response.status).toBe(200)
    expect(mockHandlerCalls).toBe(1)
    expect(mockGateCalls).toBe(0)
  })

  it('still refuses every other route of the plugin', async () => {
    const response = await GET(
      new Request(`https://site.aglyn.app/api/${DOOR_ROUTE}?hostId=host-1`),
      { params: Promise.resolve({ pluginApi: DOOR_ROUTE.split('/') }) },
    )
    expect(response.status).toBe(404)
    expect(mockHandlerCalls).toBe(0)
  })
})
