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

import type { AglynOrgMember } from '../foundation'
import {
  listPluginOrgPermissions,
  registerPluginEntitlements,
  resetPluginEntitlementsForTests,
  type PluginOrgPermissionDeclaration,
} from '../plugin-manager/plugin-entitlements'
import {
  hostPermissionKeys,
  hostRolePermissionDefaults,
  projectHostMemberPermissions,
  resolveCollaboratorHostPermissions,
  resolveMemberHostPermissions,
} from './host-permissions'
import {
  DEFAULT_ROLE_PERMISSIONS,
  explicitPluginPermissionValues,
  ORG_PERMISSION_KEYS,
  ORG_PERMISSIONS,
  orgPermissionLabel,
  pluginOrgPermissionKeys,
  pluginPermissionChanges,
  resolveOrgPermissions,
} from './org-permissions'

const HOST = 'host-1'

/**
 * Plugin-declared catalog permissions (AGL-2984), proven with two unrelated
 * plugins: a review inbox whose reply key a collaborator holds per site and
 * whose export key they never hold, and a bookings plugin with one org-wide
 * key. Neither is a real plugin; the seam is what is under test.
 */
const REVIEWS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'reviews.reply',
    label: 'Reply to reviews',
    description: 'Publish a reply under a customer review.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { admin: true, editor: true, author: false, viewer: false },
  },
  {
    key: 'reviews.export',
    label: 'Export reviews',
    description: 'Download every review as a spreadsheet.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
  },
]

const BOOKINGS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'bookings.refund',
    label: 'Refund bookings',
    description: 'Refund a paid booking.',
    roleDefaults: { owner: true, admin: false, editor: false, viewer: false },
  },
]

beforeEach(() => {
  resetPluginEntitlementsForTests()
  registerPluginEntitlements({ pluginId: 'acme-reviews', orgPermissions: REVIEWS })
  registerPluginEntitlements({ pluginId: 'acme-bookings', orgPermissions: BOOKINGS })
})

afterAll(() => resetPluginEntitlementsForTests())

describe('the org catalog carries the keys plugins declare', () => {
  it('lists them after the core keys, in plugin order, with their owner', () => {
    const keys = [...ORG_PERMISSION_KEYS]
    expect(keys.slice(0, 10)).not.toContain('reviews.reply')
    // Neither plugin is first-party, so they order by id.
    expect(keys.slice(10)).toEqual(['bookings.refund', 'reviews.reply', 'reviews.export'])
    expect(pluginOrgPermissionKeys()).toEqual(keys.slice(10))
    expect(ORG_PERMISSIONS.find((entry) => entry.key === 'reviews.reply')).toMatchObject({
      label: 'Reply to reviews',
      pluginId: 'acme-reviews',
    })
    expect(orgPermissionLabel('bookings.refund')).toBe('Refund bookings')
  })

  it('resolves a declared key by role default, custom role and override, like a core key', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.editor['reviews.reply']).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.editor['reviews.export']).toBe(false)
    expect(DEFAULT_ROLE_PERMISSIONS.admin['bookings.refund']).toBe(false)
    expect(DEFAULT_ROLE_PERMISSIONS.owner['bookings.refund']).toBe(true)
    const editor = { role: 'editor', allHosts: true, roleId: 'support' } as const
    const support = { permissions: { 'reviews.export': true, 'reviews.reply': false } }
    expect(resolveOrgPermissions(editor, support)).toMatchObject({
      'reviews.export': true,
      'reviews.reply': false,
      'data.manage': true,
    })
    expect(
      resolveOrgPermissions({ ...editor, permissions: { 'reviews.reply': true } }, support)[
        'reviews.reply'
      ],
    ).toBe(true)
  })

  it('leaves a declared key to the catalog in the rules stamp', () => {
    // The stamp's explicit half is for keys OUTSIDE the catalog; a declared
    // catalog key is resolved with its default instead.
    expect(
      explicitPluginPermissionValues({ permissions: { 'reviews.reply': false, 'other.key': true } }),
    ).toEqual({ 'other.key': true })
  })

  it('a key never outlives its registration', () => {
    resetPluginEntitlementsForTests()
    expect(ORG_PERMISSION_KEYS).toHaveLength(10)
    expect(DEFAULT_ROLE_PERMISSIONS.editor['reviews.reply']).toBeUndefined()
    expect(hostPermissionKeys()).toEqual([])
  })

  it('refuses a key another plugin declared, and one the core catalog owns', () => {
    expect(() =>
      registerPluginEntitlements({
        pluginId: 'acme-bookings',
        orgPermissions: [{ ...REVIEWS[0] }],
      }),
    ).toThrow(/already declared by "acme-reviews"/)
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginEntitlements({
      pluginId: 'acme-greedy',
      orgPermissions: [
        {
          key: 'billing.manage',
          label: 'Manage billing',
          description: 'A core key, redefined.',
          roleDefaults: { owner: true, admin: true, editor: true, viewer: true },
        },
      ],
    })
    expect(DEFAULT_ROLE_PERMISSIONS.viewer['billing.manage']).toBe(false)
    expect(ORG_PERMISSIONS.filter((entry) => entry.key === 'billing.manage')).toHaveLength(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining('refused catalog permission "billing.manage"'))
    expect(listPluginOrgPermissions().map((entry) => entry.pluginId)).toContain('acme-greedy')
    error.mockRestore()
  })
})

describe('a collaborator holds a declared key per site', () => {
  const collaborator = (over: Partial<AglynOrgMember> = {}) =>
    ({
      role: 'editor',
      allHosts: false,
      hostAccess: { [HOST]: 'editor' },
      ...over,
    }) as Partial<AglynOrgMember>

  it('only the keys declared with host-role defaults are per-site keys', () => {
    expect(hostPermissionKeys()).toEqual(['reviews.reply'])
    expect(hostRolePermissionDefaults('author')).toEqual({ 'reviews.reply': false })
  })

  it('the host role decides, a toggle refines, and org layers do not apply', () => {
    expect(resolveCollaboratorHostPermissions(collaborator(), HOST)).toEqual({
      'reviews.reply': true,
    })
    expect(
      resolveCollaboratorHostPermissions(
        collaborator({ hostPermissions: { [HOST]: { 'reviews.reply': false } } }),
        HOST,
      ),
    ).toEqual({ 'reviews.reply': false })
    expect(
      resolveMemberHostPermissions({
        member: collaborator({ hostAccess: { [HOST]: 'author' }, permissions: { 'reviews.reply': true } }),
        hostId: HOST,
      }),
    ).toEqual({ 'reviews.reply': false })
  })

  it('no site named, or a site out of reach, is nothing', () => {
    expect(resolveMemberHostPermissions({ member: collaborator() })).toEqual({
      'reviews.reply': false,
    })
    expect(resolveCollaboratorHostPermissions(collaborator(), 'host-2')).toBeNull()
  })

  it('the host projection carries the per-site keys for everyone who reaches the site', () => {
    const members = [
      { $id: 'owner', role: 'owner' },
      { $id: 'client', ...collaborator({ hostAccess: { [HOST]: 'author' } }) },
      { $id: 'elsewhere', ...collaborator({ hostAccess: { 'host-2': 'editor' } }) },
    ] as Array<Partial<AglynOrgMember> & { $id: string }>
    expect(projectHostMemberPermissions(members, HOST, new Map())).toEqual({
      owner: { 'reviews.reply': true },
      client: { 'reviews.reply': false },
    })
  })
})

describe('the changes a membership write raises an event for', () => {
  it('names declared keys only, never a core or legacy key', () => {
    expect(
      pluginPermissionChanges(
        { 'reviews.reply': true, 'members.manage': false, createHosts: false },
        { 'reviews.reply': false, 'members.manage': true, createHosts: true },
      ),
    ).toEqual([{ permission: 'reviews.reply', granted: false }])
  })
})
