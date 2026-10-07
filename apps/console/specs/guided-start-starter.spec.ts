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
 * The starter only when the guided start is not taken (AGL-3594).
 *
 *  - CREATION: a site is born without the starter only when its creator will
 *    be offered the guided AI start — every fact the zone gates on holds —
 *    and with it otherwise;
 *  - SKIP: leaving the start for a blank site asks for the starter and
 *    reports the site's first publish once, only when one was written;
 *  - THE ZONE: a bare site is blank, a site that took the starter is not (so
 *    the start does not come back), and a site born with the starter still is.
 */

const mockFlag = jest.fn(async () => true)
const mockPermission = jest.fn(async () => true)
const mockFetch = jest.fn()
const mockTrack = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: (...args: unknown[]) => mockFlag(...(args as [])),
  memberHasOrgPermission: (...args: unknown[]) => mockPermission(...(args as [])),
}))
const mockRegisterDeclarations = jest.fn(async () => undefined)
jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: () => mockRegisterDeclarations(),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/app-utils/analytics-events'),
  trackEvent: (...args: unknown[]) => mockTrack(...args),
}))

import { guidedStartOffered } from '../utils/server/guided-start-offered'
import { NEW_SITE_ENABLED_PLUGINS } from '../utils/server/provision-host'
import { hostIsBlankSite, requestStarterSite } from '../utils/host-first-run'

const OWNER = { role: 'owner' } as const
const ask = (patch: Partial<Parameters<typeof guidedStartOffered>[0]> = {}) =>
  guidedStartOffered({
    orgId: 'org-1',
    org: { plan: 'free' },
    host: { enabledPlugins: [...NEW_SITE_ENABLED_PLUGINS] },
    member: OWNER,
    staff: false,
    ...patch,
  })

beforeEach(() => {
  mockFlag.mockReset()
  mockFlag.mockResolvedValue(true)
  mockPermission.mockReset()
  mockPermission.mockResolvedValue(true)
  mockFetch.mockReset()
  mockTrack.mockReset()
  mockRegisterDeclarations.mockReset()
  mockRegisterDeclarations.mockResolvedValue(undefined)
})

describe('a site is born without the starter only for a creator the guided start will be offered to', () => {
  it('offers it when the plan, the release flag, the site’s AI switch and the creator’s ai.generate all hold', async () => {
    await expect(ask()).resolves.toBe(true)
    expect(mockFlag).toHaveBeenCalledWith('release_ai_generative', 'org-1')
    expect(mockPermission).toHaveBeenCalledWith('org-1', OWNER, 'ai.generate')
  })

  it('does not when any one fails, so that site is born with the starter', async () => {
    mockFlag.mockResolvedValueOnce(false)
    await expect(ask()).resolves.toBe(false)
    mockPermission.mockResolvedValueOnce(false)
    await expect(ask()).resolves.toBe(false)
    // A site with AI switched off.
    await expect(ask({ host: { enabledPlugins: [...NEW_SITE_ENABLED_PLUGINS], disabledPlugins: ['ai'] } })).resolves.toBe(false)
    // A read that throws is a "no", never an empty site.
    mockFlag.mockRejectedValueOnce(new Error('down'))
    await expect(ask()).resolves.toBe(false)
  })

  it('decides ai.generate from a core-only context: an owner is offered it (AGL-3596)', async () => {
    // The production failure: the AI plugin's catalog key was registered in
    // the boot step's module graph and the create route's own copy of the
    // catalog never heard of it, so an owner's `ai.generate` read `undefined`
    // and every guided start was born with the starter. Here the route asks
    // the real core catalog, and the declaration registers in another copy.
    const { resolveOrgPermissions } = jest.requireActual<typeof import('@aglyn/aglyn/app-utils/org-permissions')>(
      '@aglyn/aglyn/app-utils/org-permissions',
    )
    mockRegisterDeclarations.mockImplementationOnce(async () => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const boot = require('@aglyn/aglyn/plugin-manager/plugin-entitlements') as typeof import('@aglyn/aglyn/plugin-manager/plugin-entitlements')
        boot.registerPluginEntitlements({
          pluginId: 'ai',
          orgPermissions: [
            {
              key: 'ai.generate',
              label: 'Generate with AI',
              description: 'Run AI generation jobs.',
              roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
            },
          ],
        })
      })
    })
    mockPermission.mockImplementation(async (...args: unknown[]) => {
      const [, member, permission] = args as [string, never, string]
      return resolveOrgPermissions(member)[permission] === true
    })
    const member = { role: 'owner', allHosts: true, consoleUserType: 'manager' } as never
    await expect(ask({ member })).resolves.toBe(true)
    expect(mockRegisterDeclarations).toHaveBeenCalled()
  })

  it('lets staff through the flag and the permission, as the jobs route does', async () => {
    mockFlag.mockResolvedValue(false)
    mockPermission.mockResolvedValue(false)
    await expect(ask({ staff: true })).resolves.toBe(true)
  })
})

describe('leaving the guided start for a blank site asks for the starter', () => {
  const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

  it('posts the site to the starter route and reports the first publish once, when the starter was written', async () => {
    mockFetch.mockResolvedValueOnce(json({ provisioned: true, screenId: 'scrHome' }))
    await expect(requestStarterSite({ uid: 'u1' } as never, 'host-1')).resolves.toBe(true)
    const [, url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/hosts/starter')
    expect(JSON.parse(init.body)).toEqual({ hostId: 'host-1' })
    expect(mockTrack).toHaveBeenCalledTimes(1)
    expect(mockTrack).toHaveBeenCalledWith('site_published', { first_publish: true })
  })

  it('reports nothing when the route wrote nothing, refused, or could not be reached', async () => {
    mockFetch.mockResolvedValueOnce(json({ provisioned: false, screenId: null }))
    await expect(requestStarterSite({ uid: 'u1' } as never, 'host-1')).resolves.toBe(false)
    mockFetch.mockResolvedValueOnce(json({ error: 'no' }, 403))
    await expect(requestStarterSite({ uid: 'u1' } as never, 'host-1')).resolves.toBe(false)
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    await expect(requestStarterSite({ uid: 'u1' } as never, 'host-1')).resolves.toBe(false)
    expect(mockTrack).not.toHaveBeenCalled()
  })
})

describe('which sites the guided start is offered on', () => {
  it('a bare site is blank; one that took the starter is not; one born with the starter still is', () => {
    expect(hostIsBlankSite({ screens: {} })).toBe(true)
    expect(
      hostIsBlankSite({ screens: { scrHome: '/' }, defaultHomeScreenId: 'scrHome', starterProvisionedAt: 'NOW' }),
    ).toBe(false)
    expect(hostIsBlankSite({ screens: { scrHome: '/' }, defaultHomeScreenId: 'scrHome' })).toBe(true)
  })
})
