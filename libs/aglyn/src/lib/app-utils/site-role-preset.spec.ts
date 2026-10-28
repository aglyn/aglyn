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
 * A key whose preset is the member's role ON THE SITE (AGL-4047).
 *
 * A gate that asked "is their role on this site Admin, Editor or Author?"
 * becomes a key, and nobody's access may move when it does. Proven with an
 * invented plugin shaped like reservations: a broad key and a narrower one
 * that follows it, both with the content-write roles as their preset, beside
 * a register shaped like the point of sale (tier keys a site narrows) and an
 * assistant shaped like AI (a site key that keeps its workspace verdict), so
 * the new keys are shown to leave every older key exactly where it was.
 *
 * For every built-in role, on two sites and on none, with custom roles,
 * overrides, site toggles and narrowing choices that do not name the new
 * keys: the new keys answer exactly what the role gate answered
 * (`canWriteHost`), through the resolver, through the site's projected stamp
 * and through the stamp's fallback; and every other key resolves the same
 * before and after the new keys were declared.
 *
 * A third key, shaped like a refund, replaces a gate that asked for an admin
 * of the WHOLE workspace who is also the site's admin
 * (`workspaceMembersOnly`): for the same members it answers exactly that
 * gate, and someone added to one site as its admin holds it only when the
 * site grants it.
 */

import type { AglynOrgMember, HostAccessRole } from '../foundation'
import {
  registerPluginEntitlements,
  resetPluginEntitlementsForTests,
  type PluginOrgPermissionDeclaration,
} from '../plugin-manager/plugin-entitlements'
import { registerPluginPermissions } from '../plugin-manager/plugin-permissions'
import {
  applySiteRolePresets,
  hostRolePermissionDefaults,
  hostStampedSitePermission,
  hostStampedWorkspaceSitePermission,
  isSiteRolePresetPermission,
  narrowPermissionsToSite,
  projectHostMemberPermissions,
  resolveCollaboratorHostPermissions,
  resolveMemberHostPermissions,
  resolveSiteRolePresetPermissions,
  siteNarrowedPermissionKeys,
  siteNarrowingFor,
  siteRolePresetPermissionKeys,
} from './host-permissions'
import { ORG_PERMISSION_KEYS, ORG_PERMISSIONS, resolveOrgPermissions, type AglynOrgCustomRole } from './org-permissions'
import { CORE_SITE_ROLE_PRESETS } from './org-role-grants'
import { canPublishHost, canWriteHost, hostRoleFor, isOrgWideMember, projectHostMemberRoles } from './organizations'

const A = 'host-a'
const B = 'host-b'
const SITES: Array<string | undefined> = [A, B, undefined]
const TIER = { admin: true, editor: true, viewer: false } as const
const CONTENT_WRITE: Record<HostAccessRole, boolean> = { admin: true, editor: true, author: true, viewer: false }
const ORG_CONTENT_WRITE = { owner: true, admin: true, editor: true, viewer: false } as const
const SITE_ADMIN: Record<HostAccessRole, boolean> = { admin: true, editor: false, author: false, viewer: false }
const ORG_ADMIN = { owner: true, admin: true, editor: false, viewer: false } as const

/** The keys under test: today's content-write gate, as two keys. */
const STAYS: PluginOrgPermissionDeclaration[] = [
  {
    key: 'stays.manage',
    label: 'Manage stays',
    description: 'Edit and cancel stays.',
    roleDefaults: { ...ORG_CONTENT_WRITE },
    hostRoleDefaults: { ...CONTENT_WRITE },
    presetFromSiteRole: true,
    // Declared, and ignored: the site role is the preset already.
    narrowsPerSite: true,
  },
  {
    key: 'stays.walkIn',
    label: 'Book walk-ins',
    description: 'Book a walk-in.',
    roleDefaults: { ...ORG_CONTENT_WRITE },
    hostRoleDefaults: { ...CONTENT_WRITE },
    presetFromSiteRole: true,
    follows: 'stays.manage',
  },
  {
    key: 'stays.refund',
    label: 'Refund stays',
    description: 'Refund a stay.',
    roleDefaults: { ...ORG_ADMIN },
    hostRoleDefaults: { ...SITE_ADMIN },
    presetFromSiteRole: true,
    workspaceMembersOnly: true,
  },
]

/** The older keys beside them: a register a site narrows, and an assistant that keeps its workspace verdict. */
function registerOlderKeys(): void {
  registerPluginPermissions([
    { key: 'till.open', pluginId: 'acme-till', label: 'Open the till', defaults: { ...TIER }, narrowsPerSite: true },
    { key: 'till.sell', pluginId: 'acme-till', label: 'Sell', defaults: { ...TIER }, refines: 'till.open', narrowsPerSite: true },
    { key: 'till.shop', pluginId: 'acme-till', label: 'Buy tills', defaults: { ...TIER }, follows: 'till.open' },
  ])
  registerPluginEntitlements({
    pluginId: 'acme-assist',
    orgPermissions: [
      {
        key: 'assist.use',
        label: 'Ask the assistant',
        description: 'Ask it.',
        roleDefaults: { ...ORG_CONTENT_WRITE },
        hostRoleDefaults: { ...CONTENT_WRITE },
        narrowsPerSite: false,
      },
    ],
  })
}

type Fixture = [name: string, member: Partial<AglynOrgMember> & { $id: string; roleId?: string }]

/**
 * Every shape a membership takes: each built-in role across the workspace,
 * narrowed on one site, WIDENED on one site (a site's Members card can give
 * a workspace viewer Editor access there), the legacy shape with neither
 * `allHosts` nor `hostAccess`, site collaborators of every site role, a
 * member with no valid role, and members whose custom role, overrides,
 * toggles and narrowing choices name only OLDER keys.
 */
const FIXTURES: Fixture[] = [
  ['owner', { $id: 'u-owner', role: 'owner', allHosts: true }],
  ['admin', { $id: 'u-admin', role: 'admin' }],
  ['workspace editor', { $id: 'u-editor', role: 'editor', allHosts: true }],
  ['editor narrowed to Author on A', { $id: 'u-ed-author', role: 'editor', allHosts: true, hostAccess: { [A]: 'author' } }],
  ['editor narrowed to Viewer on A', { $id: 'u-ed-viewer', role: 'editor', allHosts: true, hostAccess: { [A]: 'viewer' } }],
  ['editor made Admin of A', { $id: 'u-ed-admin', role: 'editor', allHosts: true, hostAccess: { [A]: 'admin' } }],
  ['workspace viewer', { $id: 'u-viewer', role: 'viewer', allHosts: true }],
  ['viewer made Editor of A', { $id: 'u-vw-editor', role: 'viewer', allHosts: true, hostAccess: { [A]: 'editor' } }],
  ['viewer made Author of A', { $id: 'u-vw-author', role: 'viewer', allHosts: true, hostAccess: { [A]: 'author' } }],
  ['viewer made Admin of A', { $id: 'u-vw-admin', role: 'viewer', allHosts: true, hostAccess: { [A]: 'admin' } }],
  ['legacy editor (no allHosts, no hostAccess)', { $id: 'u-legacy-ed', role: 'editor' }],
  ['legacy viewer', { $id: 'u-legacy-vw', role: 'viewer' }],
  ['collaborator, Admin of A', { $id: 'u-co-admin', role: 'viewer', allHosts: false, hostAccess: { [A]: 'admin' } }],
  ['collaborator, Editor of A', { $id: 'u-co-editor', role: 'viewer', allHosts: false, hostAccess: { [A]: 'editor' } }],
  ['collaborator, Author of A', { $id: 'u-co-author', role: 'viewer', allHosts: false, hostAccess: { [A]: 'author' } }],
  ['collaborator, Viewer of A', { $id: 'u-co-viewer', role: 'viewer', allHosts: false, hostAccess: { [A]: 'viewer' } }],
  ['collaborator on both, Author of B', { $id: 'u-co-two', role: 'editor', allHosts: false, hostAccess: { [A]: 'viewer', [B]: 'author' } }],
  ['no valid role', { $id: 'u-no-role', allHosts: true } as never],
  ['an unknown role', { $id: 'u-odd', role: 'superuser' as never, allHosts: true }],
  ['editor with a custom role on older keys', { $id: 'u-ed-custom', role: 'editor', allHosts: true, roleId: 'desk' }],
  ['viewer with a custom role granting the till', { $id: 'u-vw-custom', role: 'viewer', allHosts: true, roleId: 'cashier' }],
  ['editor with a dangling custom role', { $id: 'u-ed-dangling', role: 'editor', allHosts: true, roleId: 'gone' }],
  ['editor whose overrides name older keys', { $id: 'u-ed-over', role: 'editor', allHosts: true, permissions: { 'till.open': false, 'hosts.create': true } }],
  ['viewer whose overrides name older keys', { $id: 'u-vw-over', role: 'viewer', allHosts: true, permissions: { 'till.open': true, 'assist.use': true } }],
  ['narrowed editor keeping the till', { $id: 'u-ed-keep', role: 'editor', allHosts: true, hostAccess: { [A]: 'viewer' }, siteNarrowing: { 'till.open': false } }],
  ['collaborator with an older toggle', { $id: 'u-co-toggle', role: 'viewer', allHosts: false, hostAccess: { [A]: 'editor' }, hostPermissions: { [A]: { 'assist.use': false } } }],
  ['narrowed editor the site granted the till', { $id: 'u-ed-granted', role: 'editor', allHosts: true, hostAccess: { [A]: 'viewer' }, hostPermissions: { [A]: { 'till.open': true } } }],
]

const ROLES: Record<string, AglynOrgCustomRole> = {
  desk: { name: 'Desk', permissions: { 'till.open': false, 'hosts.create': true, 'assist.use': false } },
  cashier: { name: 'Cashier', permissions: { 'till.open': true, 'till.sell': true }, siteNarrowing: { 'till.open': false } },
}

const roleOf = (member: { roleId?: string }): AglynOrgCustomRole | null =>
  member.roleId ? (ROLES[member.roleId] ?? null) : null

/** Every resolver's answer for one member on one site (or none), as a flat record. */
function snapshot(member: Fixture[1], site: string | undefined): Record<string, unknown> {
  const customRole = roleOf(member)
  return {
    org: resolveOrgPermissions(member, customRole),
    narrowed: narrowPermissionsToSite(resolveOrgPermissions(member, customRole), siteNarrowingFor(member, site, customRole)),
    host: resolveMemberHostPermissions({ member, customRole, hostId: site }),
    collaborator: resolveCollaboratorHostPermissions(member, site),
  }
}

/** A snapshot with every key of the new declarations taken out, so before and after compare the older keys. */
function withoutNewKeys(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !STAYS.some((entry) => entry.key === key))
      .map(([key, inner]) => [key, withoutNewKeys(inner)]),
  )
}

const BEFORE = new Map<string, Record<string, unknown>>()
const CATALOG_BEFORE: string[] = []

beforeAll(() => {
  resetPluginEntitlementsForTests()
  registerOlderKeys()
  CATALOG_BEFORE.push(...ORG_PERMISSION_KEYS)
  for (const [name, member] of FIXTURES) {
    for (const site of SITES) BEFORE.set(`${name}@${site}`, snapshot(member, site))
  }
  registerPluginEntitlements({ pluginId: 'acme-stays', orgPermissions: STAYS })
})

const today = (member: Partial<AglynOrgMember>, site: string | undefined): boolean =>
  site ? canWriteHost(member, site) : false

/**
 * Every key whose preset is the site role, and the gate it replaced (AGL-4047):
 * the core's four (the rules' `canWriteHostContent`, `canPublishHostContent`,
 * `canReadHostSensitive` and the site-admin checks) and the invented pair.
 */
const GATES: Record<string, (member: Partial<AglynOrgMember>, site: string) => boolean> = {
  'site.edit': (member, site) => canWriteHost(member, site),
  'site.publish': (member, site) => canPublishHost(member, site),
  'site.sensitive': (member, site) => ['admin', 'editor'].includes(hostRoleFor(member, site) ?? ''),
  'site.manage': (member, site) => hostRoleFor(member, site) === 'admin',
  'stays.manage': (member, site) => canWriteHost(member, site),
  'stays.walkIn': (member, site) => canWriteHost(member, site),
  // An admin of the whole workspace who is also this site's admin: the
  // refund gate (AGL-2372), `orgWide && hostRole === admin`.
  'stays.refund': (member, site) => isOrgWideMember(member) && hostRoleFor(member, site) === 'admin',
}
/** The preset table each key's stamp falls back to. */
const presetOf = (key: string) =>
  key.startsWith('site.') ? CORE_SITE_ROLE_PRESETS[key] : key === 'stays.refund' ? SITE_ADMIN : CONTENT_WRITE
const GATE_KEYS = Object.keys(GATES)
const gateAnswers = (member: Partial<AglynOrgMember>, site: string | undefined) =>
  Object.fromEntries(GATE_KEYS.map((key) => [key, site ? GATES[key](member, site) : false]))
const pick = (map: Record<string, boolean>) => Object.fromEntries(GATE_KEYS.map((key) => [key, map[key]]))

describe('the catalog', () => {
  it('lists the new keys as site-role presets, after the older keys, beside the core’s site keys', () => {
    expect(siteRolePresetPermissionKeys()).toEqual([
      ...Object.keys(CORE_SITE_ROLE_PRESETS),
      'stays.manage',
      'stays.walkIn',
      'stays.refund',
    ])
    expect([...ORG_PERMISSION_KEYS].filter((key) => !CATALOG_BEFORE.includes(key))).toEqual([
      'stays.manage',
      'stays.walkIn',
      'stays.refund',
    ])
    expect(isSiteRolePresetPermission('stays.manage')).toBe(true)
    expect(isSiteRolePresetPermission('assist.use')).toBe(false)
    expect(isSiteRolePresetPermission('till.open')).toBe(false)
  })

  it('drops a site-role preset key’s narrowing control: the site role is its preset already', () => {
    const manage = ORG_PERMISSIONS.find((definition) => definition.key === 'stays.manage')
    expect(manage?.presetFromSiteRole).toBe(true)
    expect(manage?.narrowsPerSite).toBeUndefined()
    expect(siteNarrowedPermissionKeys()).not.toContain('stays.manage')
    expect(manage?.scope).toBe('site')
  })
})

describe.each(FIXTURES)('%s', (_name, member) => {
  const customRole = roleOf(member)

  it.each(SITES.map((site) => [site ?? 'no site']))('on %s, every site-role preset key answers what its role gate answered', (label) => {
    const site = label === 'no site' ? undefined : label
    const resolved = resolveSiteRolePresetPermissions(member, site, customRole)
    expect(Object.keys(resolved).sort()).toEqual([...GATE_KEYS].sort())
    expect(pick(resolved)).toEqual(gateAnswers(member, site))
  })

  it.each([A, B])('on %s, the projected stamp, its fallback and the full resolver agree with the role gate', (site) => {
    const members = FIXTURES.map(([, fixture]) => fixture)
    const customRoles = new Map(Object.entries(ROLES) as Array<[string, AglynOrgCustomRole | null]>)
    const host = {
      memberRoles: projectHostMemberRoles(members, site),
      memberPermissions: projectHostMemberPermissions(members, site, customRoles),
    }
    const unstamped = { memberRoles: host.memberRoles }
    // What the doors of a workspace-members-only key resolve fresh beside the stamp.
    const membership = { orgWide: isOrgWideMember(member), hostRole: hostRoleFor(member, site) }
    for (const key of GATE_KEYS) {
      const preset = presetOf(key)
      const expected = GATES[key](member, site)
      if (key === 'stays.refund') {
        expect(hostStampedWorkspaceSitePermission(host, member.$id, key, preset, membership)).toBe(expected)
        expect(hostStampedWorkspaceSitePermission(unstamped, member.$id, key, preset, membership)).toBe(expected)
      } else {
        expect(hostStampedSitePermission(host, member.$id, key, preset)).toBe(expected)
        expect(hostStampedSitePermission(unstamped, member.$id, key, preset)).toBe(expected)
      }
      expect(resolveMemberHostPermissions({ member, customRole, hostId: site })[key]).toBe(expected)
    }
    // The stamp carries the keys for everyone who reaches the site, and for no one else.
    expect(Object.keys(host.memberPermissions[member.$id] ?? {}).includes('stays.manage')).toBe(
      hostRoleFor(member, site) !== null,
    )
  })

  it('with no site named, the workspace verdict is the workspace role’s own site role preset', () => {
    const org = resolveOrgPermissions(member, customRole)
    const role = member.role as string
    const siteRole = role === 'owner' || role === 'admin' ? 'admin' : role === 'editor' || role === 'viewer' ? role : null
    for (const key of GATE_KEYS) {
      const preset = presetOf(key)
      // A custom role or an override that names the key decides; these fixtures name only older keys.
      expect(org[key]).toBe(siteRole ? preset[siteRole] === true : false)
    }
  })

  it.each(SITES.map((site) => [site ?? 'no site']))('on %s, every older key resolves as it did before', (label) => {
    const site = label === 'no site' ? undefined : label
    expect(withoutNewKeys(snapshot(member, site))).toEqual(BEFORE.get(`${_name}@${site}`))
  })
})

describe('the new keys can be granted and refused like any other (AGL-4047)', () => {
  const viewer = { $id: 'u-v', role: 'viewer' as const, allHosts: true }
  const editor = { $id: 'u-e', role: 'editor' as const, allHosts: true }

  it('a custom role grants a workspace viewer walk-ins on every site they reach, without the broad key', () => {
    const role: AglynOrgCustomRole = { name: 'Front desk', permissions: { 'stays.walkIn': true } }
    const member = { ...viewer, roleId: 'front-desk' }
    expect(resolveSiteRolePresetPermissions(member, A, role)).toMatchObject({ 'stays.manage': false, 'stays.walkIn': true })
    // A collaborator's custom role is a seat fact, not a grant.
    const collaborator = { $id: 'u-c', role: 'viewer' as const, allHosts: false, hostAccess: { [A]: 'viewer' as const }, roleId: 'front-desk' }
    expect(resolveSiteRolePresetPermissions(collaborator, A, role)).toMatchObject({ 'stays.manage': false, 'stays.walkIn': false })
  })

  it('refusing the broad key takes the one that follows it, unless that one is set', () => {
    expect(resolveSiteRolePresetPermissions({ ...editor, permissions: { 'stays.manage': false } }, A)).toMatchObject({
      'stays.manage': false,
      'stays.walkIn': false,
    })
    expect(
      resolveSiteRolePresetPermissions({ ...editor, permissions: { 'stays.manage': false, 'stays.walkIn': true } }, A),
    ).toMatchObject({ 'stays.manage': false, 'stays.walkIn': true })
  })

  it('the member’s own permissions win over their custom role, and the site’s toggle over both', () => {
    const role: AglynOrgCustomRole = { name: 'No stays', permissions: { 'stays.manage': false } }
    const member = { ...editor, roleId: 'no-stays', permissions: { 'stays.manage': true } }
    expect(resolveSiteRolePresetPermissions(member, A, role)['stays.manage']).toBe(true)
    const toggled = { ...member, hostPermissions: { [A]: { 'stays.manage': false } } }
    expect(resolveSiteRolePresetPermissions(toggled, A, role)['stays.manage']).toBe(false)
    expect(resolveSiteRolePresetPermissions(toggled, B, role)['stays.manage']).toBe(true)
  })

  it('a collaborator’s site toggle refuses the broad key, and the following key with it', () => {
    const collaborator = {
      $id: 'u-c',
      role: 'viewer' as const,
      allHosts: false,
      hostAccess: { [A]: 'author' as const },
      hostPermissions: { [A]: { 'stays.manage': false } },
    }
    const expected = { 'stays.manage': false, 'stays.walkIn': false }
    expect(resolveSiteRolePresetPermissions(collaborator, A)).toMatchObject(expected)
    expect(resolveCollaboratorHostPermissions(collaborator, A)).toMatchObject(expected)
    expect(resolveMemberHostPermissions({ member: collaborator, hostId: A })).toMatchObject(expected)
  })

  it('nobody holds them on a site they cannot reach, whatever a layer says', () => {
    const member = { $id: 'u-c', role: 'viewer' as const, allHosts: false, hostAccess: { [A]: 'editor' as const }, permissions: { 'stays.manage': true } }
    expect(resolveSiteRolePresetPermissions(member, B)).toMatchObject({ 'stays.manage': false, 'stays.walkIn': false })
  })

  it('a key for members of the whole workspace only: a site’s admin collaborator holds it only when the site grants it', () => {
    const contractor = { $id: 'u-c', role: 'viewer' as const, allHosts: false, hostAccess: { [A]: 'admin' as const } }
    expect(resolveSiteRolePresetPermissions(contractor, A)['stays.refund']).toBe(false)
    expect(resolveCollaboratorHostPermissions(contractor, A)?.['stays.refund']).toBe(false)
    expect(hostRolePermissionDefaults('admin')['stays.refund']).toBe(false)
    // `memberRoles` alone says Admin, as for an owner; the fresh resolution says collaborator.
    expect(
      hostStampedWorkspaceSitePermission({ memberRoles: { 'u-c': 'admin' } }, 'u-c', 'stays.refund', SITE_ADMIN, {
        orgWide: false,
        hostRole: 'admin',
      }),
    ).toBe(false)
    const granted = { ...contractor, hostPermissions: { [A]: { 'stays.refund': true } } }
    expect(resolveSiteRolePresetPermissions(granted, A)['stays.refund']).toBe(true)
    expect(resolveMemberHostPermissions({ member: granted, hostId: A })['stays.refund']).toBe(true)
    // A workspace admin keeps it everywhere, and a custom role or the site's toggle takes it.
    const admin = { $id: 'u-a', role: 'admin' as const, allHosts: true }
    expect(resolveSiteRolePresetPermissions(admin, A)['stays.refund']).toBe(true)
    const role: AglynOrgCustomRole = { name: 'No refunds', permissions: { 'stays.refund': false } }
    expect(resolveSiteRolePresetPermissions({ ...admin, roleId: 'no-refunds' }, A, role)['stays.refund']).toBe(false)
    expect(
      resolveSiteRolePresetPermissions({ ...admin, hostPermissions: { [B]: { 'stays.refund': false } } }, B)['stays.refund'],
    ).toBe(false)
    // The fallback asks the projection and the fresh role both, as the gate did.
    const admins = { memberRoles: { 'u-a': 'admin' } }
    expect(hostStampedWorkspaceSitePermission(admins, 'u-a', 'stays.refund', SITE_ADMIN, { orgWide: true, hostRole: 'editor' })).toBe(false)
    expect(hostStampedWorkspaceSitePermission({ memberRoles: { 'u-a': 'editor' } }, 'u-a', 'stays.refund', SITE_ADMIN, { orgWide: true, hostRole: 'admin' })).toBe(false)
    expect(hostStampedWorkspaceSitePermission(admins, 'u-a', 'stays.refund', SITE_ADMIN, { orgWide: true, hostRole: 'admin' })).toBe(true)
    // The stamp decides either way.
    const stamped = { memberRoles: { 'u-c': 'admin', 'u-a': 'admin' }, memberPermissions: { 'u-c': { 'stays.refund': true }, 'u-a': { 'stays.refund': false } } }
    expect(hostStampedWorkspaceSitePermission(stamped, 'u-c', 'stays.refund', SITE_ADMIN, { orgWide: false, hostRole: 'admin' })).toBe(true)
    expect(hostStampedWorkspaceSitePermission(stamped, 'u-a', 'stays.refund', SITE_ADMIN, { orgWide: true, hostRole: 'admin' })).toBe(false)
  })

  it('applySiteRolePresets leaves a map alone with no site named', () => {
    const granted = { 'stays.manage': true, 'till.open': true }
    expect(applySiteRolePresets(granted, { role: 'viewer', allHosts: true }, undefined)).toBe(granted)
    expect(applySiteRolePresets(granted, { role: 'viewer', allHosts: true }, A)).toMatchObject({
      'stays.manage': false,
      'stays.walkIn': false,
      'stays.refund': false,
      'site.edit': false,
      'till.open': true,
    })
  })
})
