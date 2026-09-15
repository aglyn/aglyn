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

import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import {
  projectHostMemberPermissions,
  resolveCollaboratorHostPermissions,
  resolveMemberHostPermissions,
} from '@aglyn/aglyn/app-utils/host-permissions'
import {
  DEFAULT_ROLE_PERMISSIONS,
  ORG_PERMISSION_KEYS,
  orgPermissionLabel,
  pluginPermissionChanges,
} from '@aglyn/aglyn/app-utils/org-permissions'
// The plugin's declarations register at module scope, as both apps load them.
import '../declarations'
import {
  AI_ORG_PERMISSIONS,
  AI_PERMISSION_KEYS,
  aiPermissionsOf,
  HOST_ROLE_AI_PERMISSIONS,
} from './ai-permissions'

const HOST = 'host-1'
const OTHER_HOST = 'host-2'

/**
 * The AI keys on both membership axes (AGL-2927), as this plugin declares
 * them into the org catalog (AGL-2984).
 *
 * The load-bearing cases are the ones about documents that PREDATE the keys:
 * an org created before `ai.use` existed carries members with no explicit
 * value for it, and a collaborator granted before `hostPermissions` existed
 * carries no map at all. Both must resolve exactly as their role default
 * says, or the permission locks paying customers out of a feature nobody
 * switched off.
 */
describe('AI permissions on the org axis', () => {
  it('the two keys are in the catalog, and the role defaults say who holds them', () => {
    for (const key of AI_PERMISSION_KEYS) expect(ORG_PERMISSION_KEYS).toContain(key)
    expect(DEFAULT_ROLE_PERMISSIONS.owner['ai.use']).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.owner['ai.generate']).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.admin['ai.use']).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.admin['ai.generate']).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.editor['ai.use']).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.editor['ai.generate']).toBe(true)
    expect(DEFAULT_ROLE_PERMISSIONS.viewer['ai.use']).toBe(false)
    expect(DEFAULT_ROLE_PERMISSIONS.viewer['ai.generate']).toBe(false)
  })

  it('declares only the two keys, both per-site for a collaborator', () => {
    expect(AI_ORG_PERMISSIONS.map((permission) => permission.key)).toEqual([
      'ai.use',
      'ai.generate',
    ])
    for (const permission of AI_ORG_PERMISSIONS) {
      expect(permission.hostRoleDefaults).toBeDefined()
    }
  })

  it('a member document written BEFORE the keys existed resolves by role default', () => {
    const legacyEditor = { role: 'editor', allHosts: true } as Partial<AglynOrgMember>
    const legacyAdmin = { role: 'admin' } as Partial<AglynOrgMember>
    const legacyViewer = { role: 'viewer', allHosts: true } as Partial<AglynOrgMember>
    // The pre-`allHosts` legacy shape: no flag, no host map — org-wide.
    const preAllHosts = { role: 'editor' } as Partial<AglynOrgMember>
    expect(resolveMemberHostPermissions({ member: legacyEditor })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    expect(resolveMemberHostPermissions({ member: legacyAdmin })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    expect(resolveMemberHostPermissions({ member: legacyViewer })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
    expect(resolveMemberHostPermissions({ member: preAllHosts, hostId: HOST })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
  })

  it('a custom role narrows, and a per-member override wins over it', () => {
    const member = {
      role: 'editor',
      allHosts: true,
      roleId: 'writers',
    } as Partial<AglynOrgMember>
    const writers = { name: 'Writers', permissions: { 'ai.generate': false } }
    expect(resolveMemberHostPermissions({ member, customRole: writers })).toEqual({
      'ai.use': true,
      'ai.generate': false,
    })
    expect(
      resolveMemberHostPermissions({
        member: { ...member, permissions: { 'ai.generate': true } },
        customRole: writers,
      })['ai.generate'],
    ).toBe(true)
    expect(
      resolveMemberHostPermissions({
        member: { ...member, permissions: { 'ai.use': false } },
        customRole: writers,
      }),
    ).toEqual({ 'ai.use': false, 'ai.generate': false })
  })

  it('an org-wide member resolves the same on every site and with none named', () => {
    const admin = { role: 'admin' } as Partial<AglynOrgMember>
    expect(resolveMemberHostPermissions({ member: admin })).toEqual(
      resolveMemberHostPermissions({ member: admin, hostId: HOST }),
    )
    // A per-site override on an org-wide member's doc is inert: their org
    // standing decides, and nothing should be able to reach around it.
    const viewer = {
      role: 'viewer',
      allHosts: true,
      hostPermissions: { [HOST]: { 'ai.use': true } },
    } as Partial<AglynOrgMember>
    expect(resolveMemberHostPermissions({ member: viewer, hostId: HOST })['ai.use']).toBe(false)
  })

  it('no member is no permission', () => {
    expect(resolveMemberHostPermissions({ member: null })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
  })
})

describe('AI permissions on the collaborator axis', () => {
  const collaborator = (over: Partial<AglynOrgMember> = {}) =>
    ({
      role: 'editor',
      allHosts: false,
      hostAccess: { [HOST]: 'author' },
      ...over,
    }) as Partial<AglynOrgMember>

  it('the host role decides the default: admin, editor and author both; viewer neither', () => {
    expect(HOST_ROLE_AI_PERMISSIONS.admin).toEqual({ 'ai.use': true, 'ai.generate': true })
    expect(HOST_ROLE_AI_PERMISSIONS.editor).toEqual({ 'ai.use': true, 'ai.generate': true })
    expect(HOST_ROLE_AI_PERMISSIONS.author).toEqual({ 'ai.use': true, 'ai.generate': true })
    expect(HOST_ROLE_AI_PERMISSIONS.viewer).toEqual({ 'ai.use': false, 'ai.generate': false })
  })

  it('a collaborator granted BEFORE `hostPermissions` existed resolves by host role', () => {
    expect(resolveMemberHostPermissions({ member: collaborator(), hostId: HOST })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    expect(
      resolveMemberHostPermissions({
        member: collaborator({ hostAccess: { [HOST]: 'viewer' } }),
        hostId: HOST,
      }),
    ).toEqual({ 'ai.use': false, 'ai.generate': false })
  })

  it('the per-site toggle refines the host default, per site', () => {
    const member = collaborator({
      hostAccess: { [HOST]: 'editor', [OTHER_HOST]: 'editor' },
      hostPermissions: { [HOST]: { 'ai.generate': false } },
    })
    expect(resolveMemberHostPermissions({ member, hostId: HOST })).toEqual({
      'ai.use': true,
      'ai.generate': false,
    })
    expect(resolveMemberHostPermissions({ member, hostId: OTHER_HOST })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    // A viewer can be switched ON for one site, too.
    expect(
      resolveMemberHostPermissions({
        member: collaborator({
          hostAccess: { [HOST]: 'viewer' },
          hostPermissions: { [HOST]: { 'ai.use': true } },
        }),
        hostId: HOST,
      }),
    ).toEqual({ 'ai.use': true, 'ai.generate': false })
  })

  it('the org role and its refinements do NOT apply to a collaborator', () => {
    // An editor-role collaborator whose custom role and override both say
    // yes is still decided by the site: the org layers are seat accounting
    // for them, not grants.
    const member = collaborator({
      hostAccess: { [HOST]: 'viewer' },
      roleId: 'writers',
      permissions: { 'ai.use': true, 'ai.generate': true },
    })
    expect(
      resolveMemberHostPermissions({
        member,
        customRole: { permissions: { 'ai.use': true, 'ai.generate': true } },
        hostId: HOST,
      }),
    ).toEqual({ 'ai.use': false, 'ai.generate': false })
  })

  it('a request naming NO site, or a site the collaborator cannot reach, is nothing', () => {
    expect(resolveMemberHostPermissions({ member: collaborator() })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
    expect(resolveMemberHostPermissions({ member: collaborator(), hostId: '' })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
    expect(resolveCollaboratorHostPermissions(collaborator(), OTHER_HOST)).toBeNull()
    expect(
      resolveMemberHostPermissions({ member: collaborator(), hostId: OTHER_HOST }),
    ).toEqual({ 'ai.use': false, 'ai.generate': false })
  })
})

describe('the host projection', () => {
  it('carries every member who can reach the site, with the verdict they hold on it', () => {
    const members = [
      { $id: 'owner', role: 'owner' },
      { $id: 'writer', role: 'editor', allHosts: true, roleId: 'writers' },
      {
        $id: 'client',
        role: 'viewer',
        allHosts: false,
        hostAccess: { [HOST]: 'author' },
        hostPermissions: { [HOST]: { 'ai.generate': false } },
      },
      { $id: 'elsewhere', role: 'editor', allHosts: false, hostAccess: { [OTHER_HOST]: 'editor' } },
    ] as Array<Partial<AglynOrgMember> & { $id: string }>
    const roles = new Map([['writers', { permissions: { 'ai.generate': false } }]])
    expect(projectHostMemberPermissions(members, HOST, roles)).toEqual({
      owner: { 'ai.use': true, 'ai.generate': true },
      writer: { 'ai.use': true, 'ai.generate': false },
      client: { 'ai.use': true, 'ai.generate': false },
    })
  })

  it('a dangling custom role falls back to the role default, never to a denial', () => {
    const members = [
      { $id: 'writer', role: 'editor', allHosts: true, roleId: 'deleted' },
    ] as Array<Partial<AglynOrgMember> & { $id: string }>
    expect(projectHostMemberPermissions(members, HOST, new Map([['deleted', null]]))).toEqual({
      writer: { 'ai.use': true, 'ai.generate': true },
    })
  })
})

describe('the label a refusal names', () => {
  it('comes from the catalog, so the sentence and the role editor agree', () => {
    expect(orgPermissionLabel('ai.use')).toBe('Use AI assistance')
    expect(orgPermissionLabel('ai.generate')).toBe('Generate with AI')
  })
})

describe('the changes one activity row each is written for (AGL-2929)', () => {
  it('names every AI key that moved, in catalog order, with its direction', () => {
    expect(
      pluginPermissionChanges(
        { 'ai.use': true, 'ai.generate': true },
        { 'ai.use': false, 'ai.generate': false },
      ),
    ).toEqual([
      { permission: 'ai.use', granted: false },
      { permission: 'ai.generate', granted: false },
    ])
    expect(
      pluginPermissionChanges(
        { 'ai.use': true, 'ai.generate': false },
        { 'ai.use': true, 'ai.generate': false },
      ),
    ).toEqual([])
  })

  it('a key set for the first time is a change; an unset one is not', () => {
    expect(pluginPermissionChanges(null, { 'ai.generate': false })).toEqual([
      { permission: 'ai.generate', granted: false },
    ])
    expect(pluginPermissionChanges({ 'ai.generate': false }, {})).toEqual([])
    expect(pluginPermissionChanges({ 'ai.generate': false }, null)).toEqual([])
  })
})

describe('the AI half of a verdict the shell resolved', () => {
  it('reads both keys and refuses an absent one', () => {
    expect(aiPermissionsOf({ 'ai.use': true, 'reviews.reply': true })).toEqual({
      'ai.use': true,
      'ai.generate': false,
    })
    expect(aiPermissionsOf(null)).toEqual({ 'ai.use': false, 'ai.generate': false })
  })
})
