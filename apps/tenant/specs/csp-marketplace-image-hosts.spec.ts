/**
 * @jest-environment node
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
 * A plugin's declared image hosts reach the policy of the sites that run it,
 * and only theirs (AGL-4195).
 *
 * The marketplace answers, per site, the `capabilities.imageHosts` of the
 * signed plugins the site runs, through core's per-site CSP source seam
 * (`registerPluginSiteCspSource`). The lockdown verdict asks every source
 * beside the first-party declarations and puts the answer in front of the
 * owner's own image list; the middleware turns the list into the enforced
 * `img-src`. A stand-in source plays the marketplace here (an app spec
 * reaches no plugin); `site-records.spec.ts` in the marketplace holds its
 * half.
 */

const mockGetHost = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  getPlatformLockdown: async () => null,
  getDomainLockdown: async () => null,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  getHost: (...args: unknown[]) => mockGetHost(...(args as [])),
  default: (...args: unknown[]) => mockGetHost(...(args as [])),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  getOrgBilling: async () => ({ org: null }),
  default: async () => ({ org: null }),
}))

import {
  registerPluginSiteCspSource,
  pluginSiteCspHosts,
} from '@aglyn/aglyn/plugin-manager/plugin-site-csp'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { GET } from '../app/api/lockdown-verdict/route'
// eslint-disable-next-line @nx/enforce-module-boundaries
import { tenantImgSrcDirective } from '../../../security-origins'

/** What each site's installed plugins declare, as the marketplace would answer it. */
const DECLARED: Record<string, string[]> = {
  'host-reviews': ['lh3.googleusercontent.com', '*.ggpht.com'],
}
const asked: Array<{ hostId: string; orgId: string | null }> = []
let failing = false

const verdict = async (subdomain: string) => {
  const response = await GET(new Request(`https://tenant.example/api/lockdown-verdict?host=${subdomain}`))
  return (await response.json()) as Record<string, string[]>
}

const imgSrc = (hosts: string[]) => tenantImgSrcDirective(true, hosts, false, []).split(' ')

beforeAll(() => {
  registerPluginSiteCspSource(
    {
      hosts: async (input) => {
        asked.push(input)
        if (failing) throw new Error('installs unreadable')
        const img = DECLARED[input.hostId]
        return img ? { img } : {}
      },
    },
    { pluginId: 'store-of-plugins' },
  )
})

afterAll(() => unregisterPluginServices('store-of-plugins'))

beforeEach(() => {
  asked.length = 0
  failing = false
  mockGetHost.mockImplementation(async ({ host: alias }: { host: string }) => ({
    host:
      alias === 'reviews'
        ? { $id: 'host-reviews', subdomain: 'reviews', orgId: 'org-1', approvedImageHosts: ['cdn.owner.test'] }
        : { $id: 'host-plain', subdomain: 'plain', orgId: 'org-1', approvedImageHosts: ['cdn.owner.test'] },
  }))
})

describe('declared plugin image hosts in the tenant CSP (AGL-4195)', () => {
  it('admits a plugin’s declared hosts, ahead of the owner’s list, on a site that runs it', async () => {
    const body = await verdict('reviews')
    expect(asked).toEqual([{ hostId: 'host-reviews', orgId: 'org-1' }])
    expect(body['approvedImageHosts']).toEqual(['lh3.googleusercontent.com', '*.ggpht.com', 'cdn.owner.test'])
    const directive = imgSrc(body['approvedImageHosts'])
    expect(directive).toContain('https://lh3.googleusercontent.com')
    expect(directive).toContain('https://*.ggpht.com')
    expect(directive).toContain('https://cdn.owner.test')
  })

  it('refuses a host nobody declared, on the same site', async () => {
    const directive = imgSrc((await verdict('reviews'))['approvedImageHosts'])
    expect(directive.some((source) => source.includes('evil.example.com'))).toBe(false)
    expect(directive).not.toContain('https://*.googleusercontent.com')
    expect(directive).not.toContain('*')
  })

  it('leaves every other site’s policy exactly as it was', async () => {
    const body = await verdict('plain')
    expect(body['approvedImageHosts']).toEqual(['cdn.owner.test'])
    expect(imgSrc(body['approvedImageHosts'])).toEqual(imgSrc(['cdn.owner.test']))
  })

  it('adds nothing, and still answers, when the source fails', async () => {
    failing = true
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const body = await verdict('reviews')
    spy.mockRestore()
    expect(body['approvedImageHosts']).toEqual(['cdn.owner.test'])
    expect(body['locked']).toBe(false)
  })

  it('a declared host still has to pass the owner-list parse to reach the header', () => {
    // A source cannot smuggle a scheme, a path or a bare wildcard past `security-origins.js`.
    const directive = imgSrc(['data:', 'http://x.example.com', '*', 'a.example.com/x', 'ok.example.com'])
    expect(directive.filter((source) => source.includes('example.com'))).toEqual(['https://ok.example.com'])
    expect(pluginSiteCspHosts([], {}).img).toEqual([])
  })
})
