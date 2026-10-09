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

import {
  siteIntegrationHosts,
  type SiteIntegrationConfigReader,
  type SiteIntegrationDeclaration,
} from './site-integrations'
import { SITE_INTEGRATIONS_DECLARED } from './first-party-plugins.generated'

/**
 * Site integrations widen a published page's policy (AGL-3700), so the hosts
 * are admitted only while the script they serve can be on the page.
 */
const declared: SiteIntegrationDeclaration[] = [
  {
    pluginId: 'translator',
    configSwitch: 'enabled',
    entitlement: 'multilingual',
    connectHosts: ['cdn.vendor.test', 'api.vendor.test'],
    imageHosts: ['cdn.vendor.test'],
  },
]

const on = { enabledPlugins: ['translator'] }
// The site opt-in sits on top of the workspace's list, so the workspace has it on.
const business = { plan: 'business', enabledPlugins: ['translator'] } as never

describe('siteIntegrationHosts', () => {
  it('admits the declared hosts for a switched-on, entitled, enabled site', async () => {
    const readConfig = jest.fn(async () => ({ enabled: true }))
    await expect(
      siteIntegrationHosts({ org: business, host: on, readConfig }, declared),
    ).resolves.toEqual({
      connectHosts: ['cdn.vendor.test', 'api.vendor.test'],
      imageHosts: ['cdn.vendor.test'],
    })
    expect(readConfig).toHaveBeenCalledWith('translator')
  })

  it('admits nothing, and reads nothing, for a site that did not switch it on', async () => {
    const readConfig = jest.fn(async () => ({ enabled: true }))
    // Off for the workspace (whatever the site says), or switched off here.
    const offForWorkspace = { plan: 'business' } as never
    const cases = [
      { org: offForWorkspace, host: {} },
      { org: offForWorkspace, host: null },
      { org: offForWorkspace, host: on },
      { org: business, host: { ...on, disabledPlugins: ['translator'] } },
    ]
    for (const { org, host } of cases) {
      await expect(
        siteIntegrationHosts({ org, host, readConfig }, declared),
      ).resolves.toEqual({ connectHosts: [], imageHosts: [] })
    }
    expect(readConfig).not.toHaveBeenCalled()
  })

  it('admits nothing, and reads nothing, on a plan without the entitlement', async () => {
    const readConfig = jest.fn(async () => ({ enabled: true }))
    await expect(
      siteIntegrationHosts(
        {
          org: { plan: 'pro', enabledPlugins: ['translator'] } as never,
          host: on,
          readConfig,
        },
        declared,
      ),
    ).resolves.toEqual({ connectHosts: [], imageHosts: [] })
    expect(readConfig).not.toHaveBeenCalled()
  })

  it('admits nothing while the setting is off, not exactly true, or unreadable', async () => {
    const readers: SiteIntegrationConfigReader[] = [
      async () => ({ enabled: false }),
      async () => ({ enabled: 'true' }),
      async () => null,
      async (): Promise<null> => {
        throw new Error('unavailable')
      },
    ]
    for (const readConfig of readers) {
      await expect(
        siteIntegrationHosts({ org: business, host: on, readConfig }, declared),
      ).resolves.toEqual({ connectHosts: [], imageHosts: [] })
    }
  })

  it('does not repeat a host two integrations share', async () => {
    const twice: SiteIntegrationDeclaration[] = [
      ...declared,
      { ...declared[0], pluginId: 'translator', entitlement: undefined },
    ]
    const result = await siteIntegrationHosts(
      { org: business, host: on, readConfig: async () => ({ enabled: true }) },
      twice,
    )
    expect(result.connectHosts).toEqual(['cdn.vendor.test', 'api.vendor.test'])
  })
})

describe('the compiled declarations', () => {
  it('name bare hostnames only — each one widens a published page’s policy', () => {
    for (const integration of SITE_INTEGRATIONS_DECLARED) {
      for (const host of [...integration.connectHosts, ...integration.imageHosts]) {
        expect(host).toMatch(/^([a-z0-9-]+\.)+[a-z]{2,63}$/)
      }
    }
  })
})
