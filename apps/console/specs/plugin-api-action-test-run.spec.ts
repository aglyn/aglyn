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
 * The Automation hub's Test button reaches a door the CONSOLE serves
 * (AGL-3309).
 *
 * A plugin API path exists in an app only if that app's generated server
 * manifest loads the plugin surface that registers it. `events/dispatch`, the
 * page runtime's door, is registered by the events-calendar plugin's TENANT
 * surface, and the console's manifest carries no events-calendar entry — so a
 * console component posting there is answered 404.
 *
 * This drives the REAL console dispatcher and the REAL route registry, with
 * the workflows plugin's console surface loaded from the console's OWN
 * generated manifest by the real loader, so what is asserted is what the
 * console resolves in production: the Test button's path reaches the workflows
 * plugin's handler, and a site that switched Automation off has no such door.
 * Only the org, host and gate reads are doubles.
 */

/** The plugins each site has switched off for itself. */
const mockDisabledPlugins: Record<string, string[]> = {
  'host-on': [],
  'host-off': ['workflows'],
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  isEmailVerified: () => true,
  isImpersonationSession: () => false,
  filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => [...ids]),
  featureLockdownRefusal: jest.fn(async () => null),
  lockdownRefusal: jest.fn(async () => null),
  consoleApiRateLimitRefusal: jest.fn(async () => null),
  getHostDisabledPlugins: jest.fn(
    async (hostId: string) => mockDisabledPlugins[hostId] ?? [],
  ),
  getHostDocAdmin: jest.fn(async (hostId: string) => ({
    disabledPlugins: mockDisabledPlugins[hostId] ?? [],
  })),
  getOrgForHost: jest.fn(async () => ({
    orgId: 'org-1',
    org: { enabledPlugins: ['workflows'] },
  })),
  firebaseAdmin: { app: () => ({}) },
}))

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

// The console's own manifest entry for the plugin, loaded by the real loader.
// Every other entry is left out: loading all of them costs minutes and
// answers nothing more about this door.
jest.mock('../utils/server-plugin-loader', () => {
  const { createPluginLoader } = jest.requireActual(
    '@aglyn/aglyn/plugin-manager/plugin-loader',
  )
  const { CONSOLE_PLUGIN_SERVER_MANIFEST } = jest.requireActual(
    '../constants/plugins.server.generated',
  )
  return {
    __esModule: true,
    serverPluginLoader: createPluginLoader(
      CONSOLE_PLUGIN_SERVER_MANIFEST.filter(
        (entry: { id: string }) => entry.id === 'workflows',
      ),
    ),
  }
})

import { pluginIdForRegisteredApiPath } from '@aglyn/aglyn/app-utils/api-plugins'
import { POST } from '../app/api/[...pluginApi]/route'

/** The path the Actions card posts to. */
const TEST_RUN_PATH = 'automations/actions/test-run'

function testRun(body: Record<string, unknown>) {
  return POST(
    new Request(`https://app.aglyn.test/api/${TEST_RUN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ pluginApi: TEST_RUN_PATH.split('/') }) },
  )
}

describe('the Actions card’s test run, through the console dispatcher', () => {
  it('reaches the workflows plugin’s handler, which asks who is calling', async () => {
    const response = await testRun({ hostId: 'host-on', actionId: 'act-1' })
    // The handler's own refusal of an unsigned request — not the
    // dispatcher's 404 for a path nothing registered.
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthenticated' })
    expect(pluginIdForRegisteredApiPath(TEST_RUN_PATH)).toBe('workflows')
  })

  it('has no such door for a site that switched Automation off', async () => {
    const response = await testRun({ hostId: 'host-off', actionId: 'act-1' })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Not found' })
  })
})
