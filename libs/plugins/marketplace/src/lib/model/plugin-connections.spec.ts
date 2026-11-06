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
 * The declared-connections contract (AGL-4193): the site key, the publisher
 * key and the plan feature, as the marketplace really declares them. The site
 * key's preset is the site Admin, who connected a business's own accounts
 * before (sales channels' "Connect Google and Meta"); the publisher key's is
 * the workspace's owners and admins, like every other publisher act.
 */

import {
  holdsStampedSiteKey,
  siteRolePresetPermissionKeys,
} from '@aglyn/aglyn/app-utils/host-permissions'
import { ORG_PERMISSIONS, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { listPluginFeatures } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { registerMarketplaceDeclarations } from '../declarations'
import {
  PLUGIN_CONNECTIONS_API_ROUTES,
  PLUGIN_CONNECTIONS_BY_PLAN,
  PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION,
  PLUGIN_CONNECTIONS_FEATURE,
  PLUGIN_CONNECTIONS_SITE_PERMISSION,
  PLUGIN_CONNECTIONS_SITE_ROLE_PRESET,
  pluginConnectionDocId,
  pluginConnectionsPermissionRefusal,
} from './plugin-connections'

beforeAll(() => registerMarketplaceDeclarations())

describe('declared connections’ keys and plan feature (AGL-4193)', () => {
  it('files the site key under Marketplace, preset from the site Admin', () => {
    expect(siteRolePresetPermissionKeys()).toContain(PLUGIN_CONNECTIONS_SITE_PERMISSION)
    expect(ORG_PERMISSIONS.find((entry) => entry.key === PLUGIN_CONNECTIONS_SITE_PERMISSION)).toMatchObject({
      pluginId: 'marketplace',
      scope: 'site',
    })
    const host = { memberRoles: { admin: 'admin', editor: 'editor', author: 'author', viewer: 'viewer' } }
    for (const role of ['admin', 'editor', 'author', 'viewer'] as const) {
      expect([role, holdsStampedSiteKey(host, role, PLUGIN_CONNECTIONS_SITE_PERMISSION, PLUGIN_CONNECTIONS_SITE_ROLE_PRESET)]).toEqual([
        role,
        role === 'admin',
      ])
    }
    // The site's stamp decides over the preset, either way.
    const stamped = { ...host, memberPermissions: { editor: { [PLUGIN_CONNECTIONS_SITE_PERMISSION]: true } } }
    expect(holdsStampedSiteKey(stamped, 'editor', PLUGIN_CONNECTIONS_SITE_PERMISSION, PLUGIN_CONNECTIONS_SITE_ROLE_PRESET)).toBe(true)
  })

  it('gives the publisher key to the workspace’s owners and admins by default', () => {
    expect(ORG_PERMISSIONS.find((entry) => entry.key === PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION)).toMatchObject({
      pluginId: 'marketplace',
      scope: 'org',
    })
    for (const [role, held] of [['owner', true], ['admin', true], ['editor', false], ['viewer', false]] as const) {
      expect([role, resolveOrgPermissions({ role, allHosts: true }, null)[PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION]]).toEqual([role, held])
    }
  })

  it('names the permission in a refusal, never a role', () => {
    expect(pluginConnectionsPermissionRefusal(PLUGIN_CONNECTIONS_SITE_PERMISSION)).toBe(
      'Your role does not include "Manage a site’s plugin connections" — ask an organization admin',
    )
    expect(pluginConnectionsPermissionRefusal(PLUGIN_CONNECTIONS_CREDENTIALS_PERMISSION)).toBe(
      'Your role does not include "Set a listing’s connection credentials" — ask an organization admin',
    )
  })

  it('declares the plan feature: Starter, Pro and Custom on, Free off', () => {
    expect(listPluginFeatures().find((feature) => feature.key === PLUGIN_CONNECTIONS_FEATURE)).toMatchObject({
      label: 'Plugin connections',
      defaultByPlan: PLUGIN_CONNECTIONS_BY_PLAN,
    })
    expect(PLUGIN_CONNECTIONS_BY_PLAN).toMatchObject({ free: false, starter: true, pro: true, enterprise: true })
  })

  it('keeps the callback path the providers have registered', () => {
    expect(PLUGIN_CONNECTIONS_API_ROUTES.connectCallback).toBe('plugin-connections/connect/callback')
    expect(pluginConnectionDocId('abc_DEF-1', 'reviews')).toBe('abc_DEF-1__reviews')
  })
})
