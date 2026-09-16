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
 * Every AI door, against a site that switched AI off (AGL-3028).
 *
 * AI is on for every workspace and switchable for one site. The console
 * plugin API dispatcher is where a site-disabled plugin's doors stop: a
 * request naming the site as `hostId` — in the query, or at the top of a JSON
 * body — is answered 404 before the handler runs. This drives the REAL
 * dispatcher, the REAL route registry and the REAL catalog resolver, so a
 * regression in any of the three — AI slipping back into the set a site's
 * deny-list cannot touch, say — turns a row here red.
 *
 * The door list is read out of the AI plugin's own registration file rather
 * than restated, and every registered path must be classified below: a door
 * added without saying how its site is carried fails the first test instead
 * of shipping ungated.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The site each request names, keyed to what its host document stores. */
const mockHosts: Record<string, string[]> = {
  // Switched AI off for itself.
  'host-off': ['ai'],
  // Written before the switch existed: its deny-list names another plugin.
  'host-old': ['commerce'],
}
/** Handler invocations, by registered path. */
const mockCalls: string[] = []

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  emailUnverifiedResponse: () => Response.json({ error: 'unverified' }, { status: 403 }),
  isEmailVerified: () => true,
  isImpersonationSession: () => false,
  filterEnabledPluginsByReleaseFlags: jest.fn(async (ids: string[]) => [...ids]),
  featureLockdownRefusal: jest.fn(async () => null),
  lockdownRefusal: jest.fn(async () => null),
  consoleApiRateLimitRefusal: jest.fn(async () => null),
  getHostDisabledPlugins: jest.fn(async (hostId: string) => mockHosts[hostId] ?? []),
  getHostDocAdmin: jest.fn(async (hostId: string) => ({
    disabledPlugins: mockHosts[hostId] ?? [],
  })),
  // A workspace whose stored switchboard never listed AI: the catalog must
  // union it back in, or every door below would 404 for the WORKSPACE.
  getOrgForHost: jest.fn(async () => ({
    orgId: 'org-1',
    org: { enabledPlugins: ['mui', 'commerce'] },
  })),
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'uid-1', staff: false, email_verified: true }),
      }),
    }),
  },
}))

jest.mock('@aglyn/aglyn/server', () => {
  const registry = jest.requireActual('@aglyn/aglyn/app-utils/api-plugins')
  const catalog = jest.requireActual('@aglyn/aglyn/plugin-manager/enabled-plugins')
  return {
    __esModule: true,
    lockdownFeaturesForPluginApiPath: () => [],
    pluginIdForRegisteredApiPath: registry.pluginIdForRegisteredApiPath,
    resolvePluginApiMatch: registry.resolvePluginApiMatch,
    runPluginApiMatch: registry.runPluginApiMatch,
    runLegacyHandler: jest.fn(async () => Response.json({ ok: true })),
    resolveHostEnabledPlugins: catalog.resolveHostEnabledPlugins,
  }
})

jest.mock('../utils/remote-server-bundles', () => ({
  __esModule: true,
  ensureRemoteServerBundles: jest.fn(async () => undefined),
}))

// The REAL prefix map from the generated server manifest. A `:jobId` door is
// not an exact registration, so `pluginIdForRegisteredApiPath` cannot name its
// owner and the dispatcher falls back to the manifest's `apiPrefixes` — which
// is the only thing putting those doors behind the per-site gate at all.
jest.mock('../utils/server-plugin-loader', () => {
  const { createPluginLoader } = jest.requireActual(
    '@aglyn/aglyn/plugin-manager/plugin-loader',
  )
  const { CONSOLE_PLUGIN_SERVER_MANIFEST } = jest.requireActual(
    '../constants/plugins.server.generated',
  )
  const real = createPluginLoader(CONSOLE_PLUGIN_SERVER_MANIFEST)
  return {
    __esModule: true,
    serverPluginLoader: {
      ensureAll: jest.fn(async () => undefined),
      pluginIdForApiPath: real.pluginIdForApiPath,
    },
  }
})

import {
  registerPluginApiRoute,
  setRegisteringPluginId,
} from '@aglyn/aglyn/app-utils/api-plugins'
import { DELETE, GET, PATCH, POST } from '../app/api/[...pluginApi]/route'

/** The paths the AI plugin registers, read from its registration file. */
const AI_SERVER = join(__dirname, '../../../libs/plugins/ai/src/lib/server.ts')
const REGISTERED = [
  ...readFileSync(AI_SERVER, 'utf8').matchAll(/registerPluginApiRoute\(\s*'([^']+)'/g),
].map((match) => match[1])

/**
 * Doors that name their site as a top-level `hostId`, so the dispatcher's
 * per-site gate refuses them. `method` is how the door is called; a GET names
 * the site in the query, everything else in the body.
 */
const SITE_DOORS: Record<string, 'GET' | 'POST' | 'PATCH'> = {
  'assist/edit-applied': 'POST',
  'ai/host-permissions': 'PATCH',
  'ai/assist': 'POST',
  'ai/jobs': 'POST',
  'ai/jobs/:jobId/resume': 'POST',
  'ai/seo/apply': 'POST',
  'ai/generate/component': 'POST',
  'ai/usage': 'GET',
  'ai/allotments': 'GET',
  'ai/models': 'GET',
}

/**
 * Doors that carry their site somewhere the dispatcher does not read, and so
 * refuse a switched-off site in their own handler — pinned in
 * `assist-chat.spec.ts` and `ai-jobs-batch.spec.ts`.
 */
const HANDLER_GATED_DOORS = ['assist/chat', 'ai/jobs/batch']

/**
 * Doors that name a job rather than a site. Neither spends: reading a job's
 * progress and canceling it stay open, so a job the switch failed can still
 * be read and a queued one stopped. The beat fails the job itself.
 */
const JOB_DOORS = ['ai/jobs/:jobId/cancel', 'ai/jobs/:jobId/events']

/**
 * The workspace half of AI: billing, credits, feedback and the staff doors.
 * None names a site, so no site's switch reaches them.
 */
const WORKSPACE_DOORS = [
  'assist/feedback',
  'ai/billing/credits',
  'ai/billing/overage',
  'ai/admin/org',
  'ai/admin/orgs-spend',
  'ai/admin/user',
  'ai/admin/signals',
  'ai/admin/overage',
]

const HANDLERS = { GET, POST, PATCH, DELETE }

/** A concrete request path for a registered pattern. */
const concrete = (path: string) => path.replace(':jobId', 'job-1')

function call(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  site: string | null,
): Promise<Response> {
  const url = new URL(`https://app.aglyn.com/api/${concrete(path)}`)
  url.searchParams.set('orgId', 'org-1')
  if (site && method === 'GET') url.searchParams.set('hostId', site)
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify({ orgId: 'org-1', ...(site ? { hostId: site } : {}) }) }),
  })
  return HANDLERS[method](request, {
    params: Promise.resolve({ pluginApi: concrete(path).split('/') }),
  })
}

beforeAll(() => {
  // Registered as the loader registers them: under the AI plugin's id, which
  // is what the dispatcher gates on.
  setRegisteringPluginId('ai')
  try {
    for (const path of REGISTERED) {
      registerPluginApiRoute(path, {
        web: async () => {
          mockCalls.push(path)
          return Response.json({ ok: true })
        },
      })
    }
  } finally {
    setRegisteringPluginId(undefined)
  }
})

beforeEach(() => {
  mockCalls.length = 0
})

describe('every AI door is classified by how it carries its site', () => {
  it('reads a real door list', () => {
    expect(REGISTERED.length).toBeGreaterThan(15)
  })

  it('classifies every registered door exactly once', () => {
    const classified = [
      ...Object.keys(SITE_DOORS),
      ...HANDLER_GATED_DOORS,
      ...JOB_DOORS,
      ...WORKSPACE_DOORS,
    ]
    expect(new Set(classified).size).toBe(classified.length)
    expect([...classified].sort()).toEqual([...new Set(REGISTERED)].sort())
  })
})

describe('the dispatcher refuses a door naming a site that switched AI off', () => {
  it.each(Object.entries(SITE_DOORS))('%s (%s) answers 404 and never runs', async (path, method) => {
    const response = await call(path, method, 'host-off')
    expect(response.status).toBe(404)
    expect(mockCalls).toEqual([])
  })

  it.each(Object.entries(SITE_DOORS))(
    '%s (%s) runs for a site whose document predates the switch',
    async (path, method) => {
      const response = await call(path, method, 'host-old')
      expect(response.status).toBe(200)
      expect(mockCalls).toEqual([path])
    },
  )
})

describe('the workspace half keeps running whatever a site decided', () => {
  it.each(WORKSPACE_DOORS)('%s runs with no site named', async (path) => {
    const method = path.startsWith('ai/admin/') && path !== 'ai/admin/overage' ? 'GET' : 'POST'
    const response = await call(path, method, null)
    expect(response.status).toBe(200)
    expect(mockCalls).toEqual([path])
  })

  it.each(['ai/usage', 'ai/allotments', 'ai/models'])(
    '%s answers the WORKSPACE when no site is named',
    async (path) => {
      // The same doors that refuse a switched-off site: the workspace's usage
      // table, its allotments card and its model switch name none.
      const response = await call(path, 'GET', null)
      expect(response.status).toBe(200)
      expect(mockCalls).toEqual([path])
    },
  )

  it.each(JOB_DOORS)('%s runs: it names a job, not a site', async (path) => {
    const method = path.endsWith('/events') ? 'GET' : 'POST'
    const response = await call(path, method, null)
    expect(response.status).toBe(200)
    expect(mockCalls).toEqual([path])
  })

  it('the batch door is not refused by the dispatcher for one of its sites', async () => {
    // Its sites ride in `sites[]`; the door refuses a switched-off one itself
    // and starts the rest, which a blanket 404 here would prevent.
    const response = await call('ai/jobs/batch', 'POST', null)
    expect(response.status).toBe(200)
  })
})
