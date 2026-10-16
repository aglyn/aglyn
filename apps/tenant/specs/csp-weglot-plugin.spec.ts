/**
 * @jest-environment node
 *
 * The pragma must stay in the FIRST block comment (see
 * `consent-disclosure-route.spec.ts`).
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
 * Weglot's hosts reach the policy of a site that runs it, and only that site's.
 *
 * Weglot declares the hosts its script reaches (`siteCsp` in plugins.config.json,
 * the same list as the plugin's constants): the language switcher calls
 * `cdn.weglot.com`, `cdn-api-weglot.com` and `api.weglot.com`, and draws flags
 * from `cdn.weglot.com`. A site with Weglot switched on must admit them, or the
 * browser blocks every translation request; any other site must not. Asserted
 * at both ends, the verdict's lists and the directives they become, as the live
 * chat's policy is.
 */

const mockGetHost = jest.fn()
const mockGetOrgBilling = jest.fn(async (): Promise<unknown> => ({ org: null }))
const mockSettingsReads: string[] = []
let mockSettings: Record<string, unknown> | null = null

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getPlatformLockdown: async () => null,
  getDomainLockdown: async () => null,
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: () => ({
          doc: (hostId: string) => ({
            collection: () => ({
              doc: (pluginId: string) => ({
                get: async () => {
                  mockSettingsReads.push(`${hostId}/${pluginId}`)
                  return { exists: mockSettings !== null, data: () => mockSettings }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: (...args: unknown[]) => mockGetHost(...(args as [])),
  default: (...args: unknown[]) => mockGetHost(...(args as [])),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  getOrgBilling: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
  default: (...args: unknown[]) => mockGetOrgBilling(...(args as [])),
}))

import { GET } from '../app/api/lockdown-verdict/route'
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  tenantConnectSrcDirective,
  tenantImgSrcDirective,
} from '../../../security-origins'

const WEGLOT = {
  enabled: true,
  apiKey: 'wg_0123456789abcdef0123',
  originalLanguage: 'en',
  languages: ['fr', 'es'],
}

const siteWithWeglot = {
  $id: 'host-1',
  subdomain: 'acme',
  enabledPlugins: ['weglot'],
  approvedConnectHosts: ['api.owner.test'],
}

const verdict = async () => {
  const response = await GET(new Request('https://tenant.example/api/lockdown-verdict?host=acme'))
  return (await response.json()) as Record<string, string[]>
}

const WEGLOT_CONNECT = ['cdn.weglot.com', 'cdn-api-weglot.com', 'api.weglot.com']

beforeEach(() => {
  mockSettingsReads.length = 0
  mockSettings = WEGLOT
  mockGetHost.mockResolvedValue({ host: siteWithWeglot })
  mockGetOrgBilling.mockResolvedValue({ org: null })
})

describe('Weglot widens its own site’s policy, only while on', () => {
  it('admits Weglot’s hosts ahead of the owner’s own list on a site running it', async () => {
    const body = await verdict()
    expect(mockSettingsReads).toEqual(['host-1/weglot'])
    expect(body['approvedConnectHosts']).toEqual([...WEGLOT_CONNECT, 'api.owner.test'])
    expect(body['approvedImageHosts']).toEqual(['cdn.weglot.com'])
    expect(body['approvedFrameHosts']).toEqual([])
  })

  it('admits nothing while Weglot is switched off or has no settings', async () => {
    for (const settings of [{ ...WEGLOT, enabled: false }, null]) {
      mockSettings = settings
      const body = await verdict()
      expect(body['approvedConnectHosts']).toEqual(['api.owner.test'])
      expect(body['approvedImageHosts']).toEqual([])
    }
  })

  it('reads nothing for a site that has not turned Weglot on', async () => {
    mockGetHost.mockResolvedValue({ host: { ...siteWithWeglot, enabledPlugins: [] } })
    const body = await verdict()
    expect(mockSettingsReads).toEqual([])
    expect(JSON.stringify(body)).not.toContain('weglot')
  })

  it('becomes https sources in the enforced connect-src and img-src', async () => {
    const body = await verdict()
    const connect = tenantConnectSrcDirective(true, body['approvedConnectHosts'], false, []).split(' ')
    for (const host of WEGLOT_CONNECT) expect(connect).toContain(`https://${host}`)
    expect(tenantImgSrcDirective(true, body['approvedImageHosts'], false, []).split(' ')).toContain(
      'https://cdn.weglot.com',
    )
  })
})
