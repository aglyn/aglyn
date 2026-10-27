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
  DEFAULT_ROLE_PERMISSIONS,
  ORG_PERMISSION_GROUPS,
  ORG_PERMISSION_KEYS,
  ORG_PERMISSIONS,
  projectMemberResolvedPermissions,
  resolveOrgPermissions,
  TIER_PERMISSION_KEYS,
  tierPermissionsOf,
  type AglynOrgCustomRole,
} from './org-permissions'
import { orgRoleTier, resolveRolePermissions } from './org-roles'
import {
  explainOrgPermissions,
  groupOrgPermissions,
  offeredOrgPermissions,
  overrideChangesBetween,
  overrideWriteRefusal,
  parsePermissionOverrides,
  permissionChoice,
  permissionChoiceCounts,
  searchOrgPermissions,
  withPermissionChoice,
} from './org-permission-editor'
import {
  assembleOrgRoleGrants,
  ORG_ROLE_GRANTS,
  rolePermissions,
} from './org-role-grants'
import {
  listPluginCatalogPermissions,
  registerPluginEntitlements,
} from '../plugin-manager/plugin-entitlements'
import { registerPluginPermissions, type PluginPermission } from '../plugin-manager/plugin-permissions'

/**
 * ONE permission catalog (AGL-4047). Two declaration APIs feed it:
 * `registerPluginEntitlements({ orgPermissions })` and
 * `registerPluginPermissions`. Before this, the second API's keys
 * (`managePos`, `accounting.manage`, `outreach.use`) were outside the
 * catalog, so the roles route dropped them from every custom role and the
 * role editor never listed them.
 *
 * The back-compat half is the point of the fixtures below: every member and
 * custom role document that exists today resolves exactly as it did, key
 * for key, once the second API's keys join the catalog.
 */

const SITE_ROLES = { admin: true, editor: true, author: true, viewer: false }

const CATALOG_DECLARATION = {
  pluginId: 'ai',
  orgPermissions: [
    {
      key: 'ai.use',
      label: 'Use AI assistance',
      description: 'Ask the assistant.',
      roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
      hostRoleDefaults: SITE_ROLES,
      group: 'ai',
      groupLabel: 'AI',
    },
  ],
}

const TIER_KEYS: PluginPermission[] = [
  {
    key: 'managePos',
    pluginId: 'commerce',
    label: 'Use the point of sale',
    description: 'Open the POS page and record in-person sales.',
    defaults: { admin: true, editor: true, viewer: false },
  },
  {
    key: 'outreach.use',
    pluginId: 'outreach',
    label: 'Use Sequences',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'Sequences',
  },
]

/** Member and custom role documents shaped as the console stores them today. */
const MEMBERS: Array<[string, Record<string, unknown>, AglynOrgCustomRole | null]> = [
  ['an owner', { role: 'owner' }, null],
  ['an admin', { role: 'admin' }, null],
  ['an editor', { role: 'editor' }, null],
  ['a viewer', { role: 'viewer' }, null],
  ['a member with no role', {}, null],
  ['an editor on a billing role', { role: 'editor', roleId: 'r1' }, { permissions: { 'billing.view': true, 'data.manage': false } }],
  ['an admin on a narrowed role', { role: 'admin', roleId: 'r2' }, { permissions: { 'members.manage': false, 'ai.use': false } }],
  ['a viewer with overrides', { role: 'viewer', permissions: { 'billing.view': true, managePos: true } }, null],
  ['an admin with a revoked plugin key', { role: 'admin', permissions: { managePos: false, 'outreach.use': false } }, null],
  ['a member with a dangling role id', { role: 'editor', roleId: 'gone' }, null],
]

/** What each fixture resolved to BEFORE the tier keys joined the catalog. */
const before = new Map<string, Record<string, boolean>>()

beforeAll(() => {
  registerPluginEntitlements(CATALOG_DECLARATION)
  // The old answers: the catalog knew nothing of the tier keys, which the
  // per-tier resolver answered from the role's tier and the member override.
  registerPluginPermissions(TIER_KEYS)
  for (const [name, member] of MEMBERS) {
    const tier = resolveRolePermissions(
      orgRoleTier(member['role'] as string | undefined),
      member['permissions'] as Record<string, boolean> | undefined,
    )
    before.set(name, Object.fromEntries(TIER_KEYS.map((permission) => [permission.key, tier[permission.key]])))
  }
})

describe('one permission catalog (AGL-4047)', () => {
  it('lists the keys of BOTH declaration APIs after the core keys', () => {
    expect(ORG_PERMISSION_KEYS).toEqual(
      expect.arrayContaining(['org.settings', 'ai.use', 'managePos', 'outreach.use']),
    )
    expect(ORG_PERMISSION_KEYS.indexOf('plugins.install')).toBeLessThan(ORG_PERMISSION_KEYS.indexOf('ai.use'))
    expect([...TIER_PERMISSION_KEYS]).toEqual(['managePos', 'outreach.use'])
  })

  it('gives every key a group, a scope and per-role defaults', () => {
    const byKey = new Map(ORG_PERMISSIONS.map((definition) => [definition.key, definition]))
    expect(byKey.get('hosts.create')).toMatchObject({ group: 'sites', scope: 'org' })
    expect(byKey.get('ai.use')).toMatchObject({ group: 'ai', scope: 'site', pluginId: 'ai' })
    expect(byKey.get('managePos')).toMatchObject({
      group: 'commerce',
      scope: 'org',
      pluginId: 'commerce',
      // The owner holds the admin tier's verdict.
      roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    })
    for (const definition of ORG_PERMISSIONS) {
      expect(ORG_PERMISSION_GROUPS.some((group) => group.id === definition.group)).toBe(true)
    }
    expect(ORG_PERMISSION_GROUPS.find((group) => group.id === 'outreach')?.label).toBe('Sequences')
  })

  it('defaults each role to what the per-tier resolver answered', () => {
    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      const tier = resolveRolePermissions(orgRoleTier(role))
      for (const key of TIER_PERMISSION_KEYS) {
        expect([role, key, DEFAULT_ROLE_PERMISSIONS[role][key]]).toEqual([role, key, tier[key]])
      }
    }
  })

  it.each(MEMBERS)('resolves %s exactly as before for every stored document', (name, member, customRole) => {
    const granted = resolveOrgPermissions(member as never, customRole)
    // The tier keys: the same verdict the per-tier resolver gave, because no
    // stored custom role carries one (the roles route dropped them).
    expect(tierPermissionsOf(granted)).toEqual(before.get(name))
    // And the server's composition (tier map, then the catalog's tier keys)
    // answers what the tier map alone answered.
    const tier = resolveRolePermissions(
      orgRoleTier(member['role'] as string | undefined),
      member['permissions'] as Record<string, boolean> | undefined,
    )
    const composed = { ...tier, ...tierPermissionsOf(granted) }
    for (const key of TIER_PERMISSION_KEYS) expect(composed[key]).toBe(tier[key])
  })

  it.each(MEMBERS)('stamps %s with the same verdict for every key the rules read', (_name, member, customRole) => {
    const stamp = projectMemberResolvedPermissions(member as never, customRole)
    const granted = resolveOrgPermissions(member as never, customRole)
    for (const key of ORG_PERMISSION_KEYS) expect(stamp[key]).toBe(granted[key])
  })

  it('lets a custom role grant and revoke a key the second API declared', () => {
    const cashier = resolveOrgPermissions({ role: 'viewer', roleId: 'cashier' }, { permissions: { managePos: true } })
    expect(cashier['managePos']).toBe(true)
    const noRegister = resolveOrgPermissions({ role: 'admin', roleId: 'r' }, { permissions: { managePos: false } })
    expect(noRegister['managePos']).toBe(false)
    // A per-member override still wins over the custom role.
    const overridden = resolveOrgPermissions(
      { role: 'viewer', roleId: 'cashier', permissions: { managePos: false } },
      { permissions: { managePos: true } },
    )
    expect(overridden['managePos']).toBe(false)
  })

  it('refuses a key a different plugin already declared through the other API', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() =>
      registerPluginEntitlements({
        pluginId: 'thief',
        orgPermissions: [
          {
            key: 'managePos',
            label: 'Stolen',
            description: 'x',
            roleDefaults: { owner: true, admin: true, editor: true, viewer: true },
          },
        ],
      }),
    ).toThrow(/already declared by "commerce"/)
    registerPluginPermissions([
      { key: 'ai.use', pluginId: 'thief', label: 'Stolen', defaults: { admin: true, editor: true, viewer: true } },
    ])
    expect(listPluginCatalogPermissions().filter((entry) => entry.key === 'ai.use')).toHaveLength(1)
    expect(DEFAULT_ROLE_PERMISSIONS.viewer['ai.use']).toBe(false)
    error.mockRestore()
  })

  it('assembles the native contracts’ grants from both declaration shapes as the console does', () => {
    const grants = assembleOrgRoleGrants(ORG_ROLE_GRANTS, CATALOG_DECLARATION.orgPermissions, TIER_KEYS)
    expect(grants.permissions.map((entry) => entry.key)).toEqual([...ORG_PERMISSION_KEYS])
    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      expect(rolePermissions(grants, role)).toEqual({ ...DEFAULT_ROLE_PERMISSIONS[role] })
    }
    expect(grants.groups?.map((group) => group.id)).toEqual(ORG_PERMISSION_GROUPS.map((group) => group.id))
  })

  it('offers a plugin’s keys only while the plugin is on and released for the workspace', () => {
    const keys = (subject: Parameters<typeof offeredOrgPermissions>[0]) =>
      offeredOrgPermissions(subject).map((definition) => definition.key)
    // Every core key, always.
    expect(keys({ org: { enabledPlugins: [] } })).toEqual(expect.arrayContaining(['org.settings', 'hosts.create']))
    // A workspace that switched Sequences off is not offered its key.
    expect(keys({ org: { enabledPlugins: ['commerce'] } })).not.toContain('outreach.use')
    expect(keys({ org: { enabledPlugins: ['commerce', 'outreach'] } })).toContain('outreach.use')
    // A release flag that is off holds the key back, unless staff preview it.
    const flagOff = (flag: string) => flag !== 'release_outreach'
    expect(keys({ org: { enabledPlugins: ['outreach'] }, isFlagOn: flagOff })).not.toContain('outreach.use')
    expect(keys({ org: { enabledPlugins: ['outreach'] }, isFlagOn: flagOff, staffBypass: true })).toContain('outreach.use')
  })

  it('files the offered keys under their groups, in the groups’ order, leaving empty ones out', () => {
    const sections = groupOrgPermissions(ORG_PERMISSIONS)
    expect(sections.map((section) => section.group.id)).toEqual(
      ORG_PERMISSION_GROUPS.map((group) => group.id),
    )
    expect(sections.find((section) => section.group.id === 'sites')?.permissions.map((d) => d.key)).toEqual([
      'hosts.create',
      'hosts.delete',
    ])
    const onlyBilling = groupOrgPermissions(ORG_PERMISSIONS.filter((d) => d.group === 'billing'))
    expect(onlyBilling.map((section) => section.group.id)).toEqual(['billing'])
  })

  it('searches labels, descriptions, keys and group headings, every word', () => {
    const keys = (query: string) => searchOrgPermissions(ORG_PERMISSIONS, query).map((d) => d.key)
    expect(keys('')).toHaveLength(ORG_PERMISSIONS.length)
    expect(keys('point of sale')).toEqual(['managePos'])
    expect(keys('MANAGEPOS')).toEqual(['managePos'])
    expect(keys('billing')).toEqual(expect.arrayContaining(['billing.view', 'billing.manage']))
    expect(keys('sequences')).toEqual(['outreach.use'])
    expect(keys('delete sites')).toEqual(['hosts.delete'])
    expect(keys('no such thing')).toEqual([])
  })

  it('reads and writes the three states, keeping keys the editor does not offer', () => {
    const stored = { managePos: true, 'billing.view': false, 'hidden.key': true }
    expect(permissionChoice(stored, 'managePos')).toBe('grant')
    expect(permissionChoice(stored, 'billing.view')).toBe('deny')
    expect(permissionChoice(stored, 'hosts.create')).toBe('inherit')
    expect(permissionChoice({ odd: 'yes' }, 'odd')).toBe('inherit')
    expect(withPermissionChoice(stored, 'managePos', 'inherit')).toEqual({ 'billing.view': false, 'hidden.key': true })
    expect(withPermissionChoice(stored, ['hosts.create', 'hosts.delete'], 'deny')).toEqual({
      ...stored,
      'hosts.create': false,
      'hosts.delete': false,
    })
    // Never mutates what it was given.
    expect(stored).toEqual({ managePos: true, 'billing.view': false, 'hidden.key': true })
    expect(permissionChoiceCounts(stored, ['managePos', 'billing.view', 'hosts.create'])).toEqual({
      grant: 1,
      deny: 1,
      inherit: 1,
    })
  })

  it('explains each verdict with the layer that produced it', () => {
    const explained = explainOrgPermissions(
      { role: 'editor', roleId: 'r1', permissions: { 'hosts.create': true } },
      { permissions: { 'billing.view': true, managePos: false } },
    )
    expect(explained['data.manage']).toEqual({ granted: true, source: 'role', roleDefault: true })
    expect(explained['billing.view']).toEqual({ granted: true, source: 'customRole', roleDefault: false, customRole: true })
    expect(explained['managePos']).toMatchObject({ granted: false, source: 'customRole', roleDefault: true })
    expect(explained['hosts.create']).toEqual({ granted: true, source: 'override', roleDefault: false, override: true })
    // A custom role the member does not carry decides nothing.
    expect(explainOrgPermissions({ role: 'editor' }, { permissions: { managePos: false } })['managePos'].granted).toBe(true)
  })

  it('reads a request’s override changes over the keys a scope may store, refusing the rest', () => {
    const keys = ['hosts.create', 'managePos']
    expect(parsePermissionOverrides({ 'hosts.create': true, managePos: null }, keys)).toEqual({
      changes: { 'hosts.create': true, managePos: null },
    })
    expect(parsePermissionOverrides({ 'billing.view': true }, keys).error).toMatch(/Unknown permission/)
    expect(parsePermissionOverrides({ managePos: 'yes' }, keys).error).toMatch(/true, false or null/)
    expect(parsePermissionOverrides({}, keys).error).toMatch(/No permission/)
    expect(parsePermissionOverrides(['x'], keys).error).toBeTruthy()
  })

  it('writes only what changed, null where a key goes back to inherit', () => {
    expect(
      overrideChangesBetween({ managePos: true, 'billing.view': false }, { 'billing.view': true, 'hosts.create': false }),
    ).toEqual({ managePos: null, 'billing.view': true, 'hosts.create': false })
    expect(overrideChangesBetween({ managePos: true }, { managePos: true })).toEqual({})
  })

  it('refuses an override on the owner, on oneself, and a grant beyond the actor’s own', () => {
    const base = {
      targetUid: 'm1',
      targetIsOwner: false,
      actorUid: 'a1',
      isStaff: false,
      actorGranted: { 'hosts.create': true, 'billing.manage': false },
    }
    expect(overrideWriteRefusal({ ...base, changes: { 'hosts.create': true } })).toBeNull()
    expect(overrideWriteRefusal({ ...base, targetIsOwner: true, changes: { 'hosts.create': false } })).toEqual({
      status: 400,
      error: 'The owner keeps every permission',
    })
    // Not even staff restricts the owner.
    expect(overrideWriteRefusal({ ...base, targetIsOwner: true, isStaff: true, changes: { 'hosts.create': false } })?.status).toBe(400)
    expect(overrideWriteRefusal({ ...base, targetUid: 'a1', changes: { 'hosts.create': false } })?.status).toBe(403)
    const beyond = overrideWriteRefusal({
      ...base,
      changes: { 'billing.manage': true },
      labelOf: () => 'Manage billing',
    })
    expect(beyond).toEqual({ status: 403, error: 'You can only grant permissions you hold yourself: Manage billing' })
    // Denying a key the actor lacks narrows, and is allowed; so is clearing one.
    expect(overrideWriteRefusal({ ...base, changes: { 'billing.manage': false } })).toBeNull()
    expect(overrideWriteRefusal({ ...base, changes: { 'billing.manage': null } })).toBeNull()
    // The owner and staff grant anything.
    expect(overrideWriteRefusal({ ...base, actorIsOwner: true, changes: { 'billing.manage': true } })).toBeNull()
    expect(overrideWriteRefusal({ ...base, isStaff: true, targetUid: 'a1', changes: { 'billing.manage': true } })).toBeNull()
  })
})
