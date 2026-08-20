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

import { resolveRolePermissions } from './org-roles'
import { registerPluginPermissions } from '../plugin-manager/plugin-permissions'

describe('tenant roles', () => {
  it('resolves built-in role defaults', () => {
    expect(resolveRolePermissions('admin').editBilling).toBe(true)
    expect(resolveRolePermissions('editor')).toMatchObject({
      createHosts: false,
      editHosts: true,
      editBilling: false,
      publishToMarketplace: true,
    })
    expect(resolveRolePermissions('viewer').installPlugins).toBe(false)
  })

  it('treats unknown or missing roles as viewer', () => {
    expect(resolveRolePermissions(undefined).editHosts).toBe(false)
    expect(resolveRolePermissions('superuser').manageMembers).toBe(false)
  })

  it('applies boolean overrides key-by-key, ignoring junk', () => {
    const resolved = resolveRolePermissions('viewer', {
      editBilling: true,
      createHosts: 'yes' as any,
    })
    expect(resolved.editBilling).toBe(true)
    expect(resolved.createHosts).toBe(false)
    // Overrides can also revoke from a permissive role.
    expect(
      resolveRolePermissions('admin', { manageMembers: false }).manageMembers,
    ).toBe(false)
  })

  it('resolves custom roles from the map, viewer otherwise (AGL-133)', () => {
    const customRoles = {
      marketer: {
        name: 'Marketer',
        permissions: { publishToMarketplace: true, installPlugins: true },
      },
    }
    const resolved = resolveRolePermissions('marketer', null, customRoles)
    expect(resolved.publishToMarketplace).toBe(true)
    expect(resolved.installPlugins).toBe(true)
    expect(resolved.createHosts).toBe(false)
    // Per-user overrides still win over the custom role.
    expect(
      resolveRolePermissions('marketer', { installPlugins: false }, customRoles)
        .installPlugins,
    ).toBe(false)
    // Unknown custom id stays least-privilege viewer.
    expect(
      resolveRolePermissions('ghost', null, customRoles).publishToMarketplace,
    ).toBe(false)
  })
})

/**
 * PLUGIN-DECLARED KEYS ARE GRANTABLE AND REVOCABLE (AGL-2474).
 *
 * `pluginPermissionDefaults` always spread a declared key into the resolved
 * map, so `managePos` LOOKED wired: it was present, and it held the right tier
 * verdict. But both override loops iterated `ORG_ROLE_PERMISSION_KEYS` — the
 * hardcoded six — so the value that got spread in was the only value the key
 * could ever hold. It could not be granted and it could not be taken away,
 * which is the whole of what a permission is.
 */
describe('plugin-declared permissions resolve like any other key (AGL-2474)', () => {
  beforeAll(() => {
    registerPluginPermissions([
      {
        key: 'testPluginPerm',
        pluginId: 'test-plugin',
        label: 'Test plugin permission',
        defaults: { admin: true, editor: true, viewer: false },
      },
    ])
  })

  it('carries the tier default (the part that already worked)', () => {
    expect(resolveRolePermissions('admin').testPluginPerm).toBe(true)
    expect(resolveRolePermissions('editor').testPluginPerm).toBe(true)
    expect(resolveRolePermissions('viewer').testPluginPerm).toBe(false)
  })

  it('a per-member override can REVOKE it from an admin', () => {
    expect(
      resolveRolePermissions('admin', { testPluginPerm: false })
        .testPluginPerm,
    ).toBe(false)
  })

  it('a per-member override can GRANT it to a viewer', () => {
    expect(
      resolveRolePermissions('viewer', { testPluginPerm: true }).testPluginPerm,
    ).toBe(true)
  })

  it('ignores junk override values, like every other key', () => {
    expect(
      resolveRolePermissions('viewer', { testPluginPerm: 'yes' as any })
        .testPluginPerm,
    ).toBe(false)
  })

  it('a custom role can set it, and an override still wins', () => {
    const customRoles = {
      cashier: { name: 'Cashier', permissions: { testPluginPerm: true } },
    }
    expect(
      resolveRolePermissions('cashier', null, customRoles).testPluginPerm,
    ).toBe(true)
    expect(
      resolveRolePermissions(
        'cashier',
        { testPluginPerm: false },
        customRoles,
      ).testPluginPerm,
    ).toBe(false)
  })

  it('a custom role that says nothing about it keeps the DEFAULT, not undefined', () => {
    // The custom-role branch used to rebuild its base from the viewer tier
    // alone, dropping every plugin key off the map. `undefined` reads as
    // denied at a call site and as "no opinion" everywhere else — and it made
    // `'testPluginPerm' in permissions` false, so a UI enumerating the map
    // could not even show the control.
    const customRoles = {
      marketer: { name: 'Marketer', permissions: { installPlugins: true } },
    }
    const resolved = resolveRolePermissions('marketer', null, customRoles)
    expect(resolved.testPluginPerm).toBe(false)
    expect('testPluginPerm' in resolved).toBe(true)
  })
})
