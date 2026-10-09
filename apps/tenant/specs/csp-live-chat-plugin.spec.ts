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
 * A live chat's vendor hosts reach the site's policy, and only its (AGL-3698).
 *
 * The plugin declares each vendor's hosts (`siteCsp` in plugins.config.json);
 * the lockdown verdict reads the settings of each declared plugin the SITE
 * runs and puts the chosen vendor's hosts in front of the owner's own lists;
 * the middleware turns those lists into the enforced directives. Asserted at
 * both ends: the verdict's lists, and the header they become.
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
  tenantFrameSrcDirective,
  tenantImgSrcDirective,
} from '../../../security-origins'

const TIDIO = {
  enabled: true,
  provider: 'tidio',
  publicKey: 'abcdefghijklmnopqrstuvwxyz123456',
  pages: 'all',
  paths: [],
  position: 'right',
  loadWithPage: false,
}

const siteWithChat = {
  $id: 'host-1',
  subdomain: 'acme',
  enabledPlugins: ['live-chat'],
  approvedConnectHosts: ['api.owner.test'],
}

const verdict = async () => {
  const response = await GET(new Request('https://tenant.example/api/lockdown-verdict?host=acme'))
  return (await response.json()) as Record<string, string[]>
}

beforeEach(() => {
  mockSettingsReads.length = 0
  mockSettings = TIDIO
  mockGetHost.mockResolvedValue({ host: siteWithChat })
  mockGetOrgBilling.mockResolvedValue({ org: null })
})

describe('the live chat widens its own site’s policy, only while on (AGL-3698)', () => {
  it('admits Tidio’s hosts, ahead of the owner’s own list, for a site running Tidio', async () => {
    const body = await verdict()
    expect(mockSettingsReads).toEqual(['host-1/live-chat'])
    expect(body['approvedConnectHosts']).toEqual([
      'socket.tidio.co',
      'api-v2.tidio.co',
      'uploads.tidio.com',
      'sentry-new.tidio.co',
      'widget-v4.tidiochat.com',
      'api.owner.test',
    ])
    expect(body['approvedImageHosts']).toContain('avatars.tidiochat.com')
    expect(body['approvedMediaHosts']).toContain('widget-v4.tidiochat.com')
    expect(body['approvedFontHosts']).toEqual(['code.tidio.co'])
    // Tidio draws in a frame of its own document, which frame-src does not govern.
    expect(body['approvedFrameHosts']).toEqual([])
    // And nothing of LiveChat's.
    expect(JSON.stringify(body)).not.toContain('livechatinc')
  })

  it('admits LiveChat’s frame and hosts instead for a LiveChat site', async () => {
    mockSettings = { ...TIDIO, provider: 'livechat', publicKey: '12345678' }
    const body = await verdict()
    expect(body['approvedFrameHosts']).toEqual([
      'api.livechatinc.com',
      'cdn.livechatinc.com',
      'secure.livechatinc.com',
    ])
    expect(body['approvedConnectHosts']).toContain('secure.livechatinc.com')
    expect(JSON.stringify(body)).not.toContain('tidio')
  })

  it('admits nothing while the chat is switched off or has no key', async () => {
    for (const settings of [{ ...TIDIO, enabled: false }, { ...TIDIO, publicKey: '' }, null]) {
      mockSettings = settings
      const body = await verdict()
      expect(body['approvedConnectHosts']).toEqual(['api.owner.test'])
      expect(body['approvedImageHosts']).toEqual([])
    }
  })

  it('reads nothing for a site that has not turned Live chat on — every other site', async () => {
    mockGetHost.mockResolvedValue({ host: { ...siteWithChat, enabledPlugins: [] } })
    const body = await verdict()
    expect(mockSettingsReads).toEqual([])
    expect(body['approvedConnectHosts']).toEqual(['api.owner.test'])
  })

  it('reads nothing when the workspace switched the plugin off for the site', async () => {
    mockGetHost.mockResolvedValue({ host: { ...siteWithChat, disabledPlugins: ['live-chat'] } })
    await verdict()
    expect(mockSettingsReads).toEqual([])
  })

  it('becomes https sources in the enforced directives, the websocket host included', async () => {
    const body = await verdict()
    const connect = tenantConnectSrcDirective(true, body['approvedConnectHosts'], false, [])
    // CSP Level 3 matches `wss://socket.tidio.co` against this `https://` source.
    expect(connect.split(' ')).toContain('https://socket.tidio.co')
    expect(tenantImgSrcDirective(true, body['approvedImageHosts'], false, []).split(' ')).toContain(
      'https://avatars.tidiochat.com',
    )
    mockSettings = { ...TIDIO, provider: 'livechat', publicKey: '12345678' }
    const livechat = await verdict()
    expect(tenantFrameSrcDirective(true, livechat['approvedFrameHosts'], []).split(' ')).toContain(
      'https://secure.livechatinc.com',
    )
  })
})
