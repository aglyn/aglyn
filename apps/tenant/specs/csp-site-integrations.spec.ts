/**
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
 * A plugin integration's hosts reach a published page's policy only while the
 * integration is on (AGL-3700).
 *
 * Weglot is the first: its script fetches translations from its own API, and
 * `connect-src` enforces (AGL-1152), so a policy that did not name the API
 * would leave a merchant's switched-on translation silently refusing every
 * request — and a policy that named it for every site would hand every site's
 * injected script a new place to send data. Three layers carry it, and each
 * is read here as it really runs: the verdict route decides, the middleware
 * carries the answer into the header, and `security-origins.js` parses it.
 */

import { SITE_INTEGRATIONS_DECLARED } from '@aglyn/aglyn/plugin-manager/first-party-plugins.generated'
import { NextRequest } from 'next/server'

const mockGetPluginConfig = jest.fn()
const mockGetHost = jest.fn()
const mockGetOrgBilling = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getPlatformLockdown: async () => null,
  getDomainLockdown: async () => null,
  getPluginConfig: (...args: unknown[]) => mockGetPluginConfig(...args),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: (...args: unknown[]) => mockGetHost(...args),
  default: (...args: unknown[]) => mockGetHost(...args),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  getOrgBilling: (...args: unknown[]) => mockGetOrgBilling(...args),
  default: (...args: unknown[]) => mockGetOrgBilling(...args),
}))

const {
  tenantConnectSrcDirective,
  tenantImgSrcDirective,
  // Root-level CommonJS, outside the nx graph (AGL-523).
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @nx/enforce-module-boundaries
} = require('../../../security-origins.js')

// Read from the compiled declarations, not restated: the plugin's own spec
// holds the declaration to the hosts its loader reaches.
const [INTEGRATION] = SITE_INTEGRATIONS_DECLARED
const PLUGIN = INTEGRATION.pluginId
const CONNECT = [...INTEGRATION.connectHosts]
const IMAGES = [...INTEGRATION.imageHosts]

const host = (overrides: Record<string, unknown> = {}) => ({
  $id: 'host-1',
  orgId: 'org-1',
  subdomain: 'acme',
  enabledPlugins: [PLUGIN],
  ...overrides,
})

async function verdict(): Promise<Record<string, unknown>> {
  const { GET } = await import('../app/api/lockdown-verdict/route')
  const response = await GET(
    new Request('https://tenant.example/api/lockdown-verdict?host=acme'),
  )
  return (await response.json()) as Record<string, unknown>
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetHost.mockResolvedValue({ host: host() })
  mockGetOrgBilling.mockResolvedValue({ org: { plan: 'business' } })
  mockGetPluginConfig.mockResolvedValue({ enabled: true })
})

describe('the verdict route', () => {
  it('names Weglot’s hosts for a site that switched it on, on a plan with multilingual, enabled', async () => {
    const answer = await verdict()
    expect(answer['integrationConnectHosts']).toEqual(CONNECT)
    expect(answer['integrationImageHosts']).toEqual(IMAGES)
    expect(mockGetPluginConfig).toHaveBeenCalledWith('org-1', PLUGIN, {
      hostId: 'host-1',
    })
  })

  it('names nothing, and reads no settings, for a site that never switched it on', async () => {
    mockGetHost.mockResolvedValue({ host: host({ enabledPlugins: [] }) })
    const answer = await verdict()
    expect(answer['integrationConnectHosts']).toEqual([])
    expect(answer['integrationImageHosts']).toEqual([])
    expect(mockGetPluginConfig).not.toHaveBeenCalled()
  })

  it('names nothing on a plan without multilingual', async () => {
    mockGetOrgBilling.mockResolvedValue({ org: { plan: 'pro' } })
    expect((await verdict())['integrationConnectHosts']).toEqual([])
    expect(mockGetPluginConfig).not.toHaveBeenCalled()
  })

  it('names nothing while the setting is off, or when it cannot be read', async () => {
    mockGetPluginConfig.mockResolvedValue({ enabled: false })
    expect((await verdict())['integrationConnectHosts']).toEqual([])
    mockGetPluginConfig.mockRejectedValue(new Error('unavailable'))
    expect((await verdict())['integrationConnectHosts']).toEqual([])
  })
})

describe('the directives', () => {
  it('admit the integration hosts as https origins, in connect-src and img-src', () => {
    const connect = tenantConnectSrcDirective(true, [], false, [], CONNECT)
    for (const name of CONNECT) expect(connect).toContain(`https://${name}`)
    for (const name of IMAGES) {
      expect(tenantImgSrcDirective(true, [], false, [], IMAGES)).toContain(
        `https://${name}`,
      )
    }
  })

  it('are unchanged for a site with no integration', () => {
    expect(tenantConnectSrcDirective(true, [], false, [])).toBe(
      tenantConnectSrcDirective(true, [], false, [], []),
    )
    for (const name of CONNECT) {
      expect(tenantConnectSrcDirective(true, [], false, [])).not.toContain(name)
    }
  })

  it('refuse anything that is not a bare hostname', () => {
    const connect = tenantConnectSrcDirective(true, [], false, [], [
      'evil.com; script-src *',
      '*',
      'https://cdn.example.com/path',
    ])
    expect(connect).not.toContain('evil.com')
    expect(connect).not.toContain('script-src')
    expect(connect).not.toContain('cdn.example.com')
  })
})

describe('the header the middleware sends', () => {
  const HOST = 'demo.localhost:4500'
  const realFetch = global.fetch

  afterEach(() => {
    global.fetch = realFetch
  })

  async function policyFor(answer: Record<string, unknown>): Promise<string> {
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ locked: false, ...answer }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as never
    let middleware: (typeof import('../middleware'))['middleware'] | undefined
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      middleware = require('../middleware').middleware
    })
    const response = await middleware!(
      new NextRequest(new URL('/', `https://${HOST}`), { headers: { host: HOST } }),
      {} as never,
    )
    if (!response || !('headers' in response)) throw new Error('no response')
    return response.headers.get('Content-Security-Policy') ?? ''
  }

  const directive = (policy: string, name: string) =>
    policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? ''

  it('carries the verdict’s integration hosts into connect-src and img-src', async () => {
    const policy = await policyFor({
      integrationConnectHosts: CONNECT,
      integrationImageHosts: IMAGES,
    })
    for (const name of CONNECT) {
      expect(directive(policy, 'connect-src')).toContain(`https://${name}`)
    }
    for (const name of IMAGES) {
      expect(directive(policy, 'img-src')).toContain(`https://${name}`)
    }
  })

  it('names no integration host for a site whose verdict names none', async () => {
    const policy = await policyFor({
      integrationConnectHosts: [],
      integrationImageHosts: [],
    })
    for (const name of CONNECT) expect(policy).not.toContain(name)
  })
})
