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
 * A site narrows a workspace-wide member (AGL-4047): an editor of the whole
 * workspace given Viewer or Author access to one site loses that site's
 * `narrowsPerSite` keys there, unless the site grants them, and keeps them
 * everywhere else. Proven with an invented plugin shaped like a register: a
 * broad key, two finer keys that refine it, a shop key that only follows it
 * and is not narrowed, and an unrelated key a site's front desk needs.
 */

import type { AglynOrgMember } from '../foundation'
import { registerPluginPermissions } from '../plugin-manager/plugin-permissions'
import {
  narrowPermissionsToSite,
  projectHostMemberPermissions,
  resolveMemberHostPermissions,
  siteNarrowedPermissionKeys,
  siteNarrowingFor,
} from './host-permissions'
import { resolveOrgPermissions, type AglynOrgCustomRole } from './org-permissions'

const A = 'host-a'
const B = 'host-b'
const TIER = { admin: true, editor: true, viewer: false } as const

beforeAll(() => {
  registerPluginPermissions([
    { key: 'till.open', pluginId: 'acme-till', label: 'Open the till', defaults: { ...TIER }, narrowsPerSite: true },
    {
      key: 'till.sell',
      pluginId: 'acme-till',
      label: 'Sell',
      defaults: { ...TIER },
      refines: 'till.open',
      narrowsPerSite: true,
    },
    {
      key: 'till.refund',
      pluginId: 'acme-till',
      label: 'Refund',
      defaults: { ...TIER },
      refines: 'till.open',
      narrowsPerSite: true,
    },
    { key: 'till.shop', pluginId: 'acme-till', label: 'Buy tills', defaults: { ...TIER }, follows: 'till.open' },
    { key: 'desk.collect', pluginId: 'acme-desk', label: 'Collect forms', defaults: { ...TIER }, narrowsPerSite: true },
  ])
})

/** The verdict on one site, as every resolver computes it. */
function onSite(
  member: Partial<AglynOrgMember>,
  hostId: string,
  customRole: AglynOrgCustomRole | null = null,
): Record<string, boolean> {
  return narrowPermissionsToSite(resolveOrgPermissions(member, customRole), siteNarrowingFor(member, hostId))
}

const NARROWED: Partial<AglynOrgMember> = { role: 'editor', allHosts: true, hostAccess: { [A]: 'viewer' } }

describe('the keys a site narrows', () => {
  it('are the declarations that say so, in catalog order', () => {
    expect(siteNarrowedPermissionKeys()).toEqual(['desk.collect', 'till.open', 'till.sell', 'till.refund'])
  })
})

describe('a workspace editor narrowed to Viewer on one site', () => {
  it('holds no till and collects nothing on that site', () => {
    const granted = onSite(NARROWED, A)
    expect(granted['till.open']).toBe(false)
    expect(granted['till.sell']).toBe(false)
    expect(granted['till.refund']).toBe(false)
    expect(granted['desk.collect']).toBe(false)
  })

  it('keeps all of it on every other site, and with no site named', () => {
    for (const granted of [onSite(NARROWED, B), resolveOrgPermissions(NARROWED, null)]) {
      expect(granted['till.open']).toBe(true)
      expect(granted['till.sell']).toBe(true)
      expect(granted['till.refund']).toBe(true)
      expect(granted['desk.collect']).toBe(true)
    }
  })

  it('keeps a key the site does not narrow, the shop among them', () => {
    expect(onSite(NARROWED, A)['till.shop']).toBe(true)
    expect(onSite(NARROWED, A)['hosts.create']).toBe(resolveOrgPermissions(NARROWED, null)['hosts.create'])
  })

  it('narrowed to Author, holds what Author holds: the Viewer tier', () => {
    const author = { ...NARROWED, hostAccess: { [A]: 'author' as const } }
    expect(siteNarrowingFor(author, A)).toEqual({ role: 'author', grants: {} })
    expect(onSite(author, A)['till.open']).toBe(false)
    expect(onSite(author, A)['desk.collect']).toBe(false)
  })
})

describe('the site grants a key back', () => {
  it('granting the sell key on the site brings the till, and not refunds', () => {
    const granted = onSite({ ...NARROWED, hostPermissions: { [A]: { 'till.sell': true } } }, A)
    expect(granted['till.sell']).toBe(true)
    expect(granted['till.open']).toBe(true)
    expect(granted['till.refund']).toBe(false)
    expect(granted['desk.collect']).toBe(false)
  })

  it('granting the till on the site brings its finer keys, as the workspace holds them', () => {
    const granted = onSite({ ...NARROWED, hostPermissions: { [A]: { 'till.open': true } } }, A)
    expect(granted['till.open']).toBe(true)
    expect(granted['till.sell']).toBe(true)
    expect(granted['till.refund']).toBe(true)
  })

  it('a finer key the workspace refuses stays refused when only the till is granted back', () => {
    const noRefunds: AglynOrgCustomRole = { name: 'No refunds', permissions: { 'till.refund': false } }
    const granted = onSite(
      { ...NARROWED, roleId: 'no-refunds', hostPermissions: { [A]: { 'till.open': true } } },
      A,
      noRefunds,
    )
    expect(granted['till.sell']).toBe(true)
    expect(granted['till.refund']).toBe(false)
  })

  it('a site that grants the sell key and refuses the till leaves neither', () => {
    const granted = onSite({ ...NARROWED, hostPermissions: { [A]: { 'till.sell': true, 'till.open': false } } }, A)
    expect(granted['till.open']).toBe(false)
    expect(granted['till.sell']).toBe(false)
  })

  it('granting one key on a site grants it nowhere else', () => {
    const member = { ...NARROWED, hostAccess: { [A]: 'viewer' as const, [B]: 'viewer' as const }, hostPermissions: { [A]: { 'desk.collect': true } } }
    expect(onSite(member, A)['desk.collect']).toBe(true)
    expect(onSite(member, B)['desk.collect']).toBe(false)
  })
})

describe('members no site narrows resolve exactly as before', () => {
  const cases: Array<[string, Partial<AglynOrgMember>, AglynOrgCustomRole | null]> = [
    ['an owner given Viewer access somewhere', { role: 'owner', hostAccess: { [A]: 'viewer' } }, null],
    ['an admin given Viewer access somewhere', { role: 'admin', allHosts: true, hostAccess: { [A]: 'viewer' } }, null],
    ['a workspace editor with no site access set', { role: 'editor', allHosts: true }, null],
    ['a workspace editor with Editor access on the site', { role: 'editor', allHosts: true, hostAccess: { [A]: 'editor' } }, null],
    ['a workspace editor with Admin access on the site', { role: 'editor', allHosts: true, hostAccess: { [A]: 'admin' } }, null],
    ['a workspace viewer given Author access on the site', { role: 'viewer', allHosts: true, hostAccess: { [A]: 'author' } }, null],
    [
      'a workspace viewer a custom role hands the till',
      { role: 'viewer', allHosts: true, roleId: 'cashier', hostAccess: { [A]: 'viewer' } },
      { name: 'Cashier', permissions: { 'till.open': true } },
    ],
    [
      'a workspace editor with stray site toggles and no narrower access',
      { role: 'editor', allHosts: true, hostPermissions: { [A]: { 'till.open': false } } },
      null,
    ],
    ['a site collaborator', { role: 'editor', allHosts: false, hostAccess: { [A]: 'viewer' } }, null],
  ]
  it.each(cases)('%s', (_label, member, customRole) => {
    expect(siteNarrowingFor(member, A)).toBeNull()
    expect(onSite(member, A, customRole)).toEqual(resolveOrgPermissions(member, customRole))
  })

  it('with no narrowing the map comes back as given', () => {
    const granted = resolveOrgPermissions(NARROWED, null)
    expect(narrowPermissionsToSite(granted, null)).toBe(granted)
  })
})

describe('the site projection carries the narrowed verdict (rules)', () => {
  it('stamps a narrowed member the site’s verdict, and an unnarrowed one the workspace’s', () => {
    const members = [
      { $id: 'narrowed', ...NARROWED },
      { $id: 'granted', ...NARROWED, hostPermissions: { [A]: { 'till.sell': true } } },
      { $id: 'editor', role: 'editor' as const, allHosts: true },
      { $id: 'contractor', role: 'viewer' as const, allHosts: false, hostAccess: { [A]: 'editor' as const } },
    ]
    const stamp = projectHostMemberPermissions(members, A, new Map())
    expect(stamp['narrowed']).toMatchObject({ 'till.open': false, 'till.sell': false, 'desk.collect': false })
    expect(stamp['granted']).toMatchObject({ 'till.open': true, 'till.sell': true, 'till.refund': false })
    expect(stamp['editor']).toMatchObject({ 'till.open': true, 'till.sell': true, 'desk.collect': true })
    // A collaborator's register keys come from their site role on the server,
    // and the rules read their member document for them, as before.
    expect(stamp['contractor']).not.toHaveProperty('till.open')
    // On the other site the narrowed member is an editor again.
    expect(projectHostMemberPermissions(members, B, new Map())['narrowed']).toMatchObject({ 'till.sell': true })
  })

  it('resolveMemberHostPermissions answers the same verdict the projection stamps', () => {
    expect(resolveMemberHostPermissions({ member: NARROWED, hostId: A })).toMatchObject({
      'till.open': false,
      'desk.collect': false,
    })
    expect(resolveMemberHostPermissions({ member: NARROWED, hostId: B })).toMatchObject({
      'till.open': true,
      'desk.collect': true,
    })
  })
})
