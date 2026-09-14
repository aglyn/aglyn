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
  AI_PERMISSION_KEYS,
  aiPermissionLabel,
  HOST_ROLE_AI_PERMISSIONS,
  projectHostMemberAiPermissions,
  resolveAiPermissions,
  resolveCollaboratorAiPermissions,
} from './ai-permissions'
import { DEFAULT_ROLE_PERMISSIONS, ORG_PERMISSION_KEYS } from './org-permissions'

const HOST = 'host-1'
const OTHER_HOST = 'host-2'

/**
 * The AI keys on both membership axes (AGL-2927).
 *
 * The load-bearing cases are the ones about documents that PREDATE the
 * change: an org created before `ai.use` existed carries members with no
 * explicit value for it, and a collaborator granted before `hostPermissions`
 * existed carries no map at all. Both must resolve exactly as their role
 * default says, or shipping the permission locks paying customers out of a
 * feature nobody switched off.
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

  it('a member document written BEFORE the keys existed resolves by role default', () => {
    // Exactly the documents an org created before this change carries: a
    // role, `allHosts`, and no `permissions` map naming either key.
    const legacyEditor = { role: 'editor', allHosts: true } as Partial<AglynOrgMember>
    const legacyAdmin = { role: 'admin' } as Partial<AglynOrgMember>
    const legacyViewer = { role: 'viewer', allHosts: true } as Partial<AglynOrgMember>
    // The pre-`allHosts` legacy shape: no flag, no host map — org-wide.
    const preAllHosts = { role: 'editor' } as Partial<AglynOrgMember>
    expect(resolveAiPermissions({ member: legacyEditor })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    expect(resolveAiPermissions({ member: legacyAdmin })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    expect(resolveAiPermissions({ member: legacyViewer })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
    expect(resolveAiPermissions({ member: preAllHosts, hostId: HOST })).toEqual({
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
    expect(resolveAiPermissions({ member, customRole: writers })).toEqual({
      'ai.use': true,
      'ai.generate': false,
    })
    expect(
      resolveAiPermissions({
        member: { ...member, permissions: { 'ai.generate': true } },
        customRole: writers,
      })['ai.generate'],
    ).toBe(true)
    expect(
      resolveAiPermissions({
        member: { ...member, permissions: { 'ai.use': false } },
        customRole: writers,
      }),
    ).toEqual({ 'ai.use': false, 'ai.generate': false })
  })

  it('an org-wide member resolves the same on every site and with none named', () => {
    const admin = { role: 'admin' } as Partial<AglynOrgMember>
    expect(resolveAiPermissions({ member: admin })).toEqual(
      resolveAiPermissions({ member: admin, hostId: HOST }),
    )
    // A per-site override on an org-wide member's doc is inert: their org
    // standing decides, and nothing should be able to reach around it.
    const viewer = {
      role: 'viewer',
      allHosts: true,
      hostPermissions: { [HOST]: { 'ai.use': true } },
    } as Partial<AglynOrgMember>
    expect(resolveAiPermissions({ member: viewer, hostId: HOST })['ai.use']).toBe(false)
  })

  it('no member is no permission', () => {
    expect(resolveAiPermissions({ member: null })).toEqual({
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
    expect(resolveAiPermissions({ member: collaborator(), hostId: HOST })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    expect(
      resolveAiPermissions({
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
    expect(resolveAiPermissions({ member, hostId: HOST })).toEqual({
      'ai.use': true,
      'ai.generate': false,
    })
    expect(resolveAiPermissions({ member, hostId: OTHER_HOST })).toEqual({
      'ai.use': true,
      'ai.generate': true,
    })
    // A viewer can be switched ON for one site, too.
    expect(
      resolveAiPermissions({
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
      resolveAiPermissions({
        member,
        customRole: { permissions: { 'ai.use': true, 'ai.generate': true } },
        hostId: HOST,
      }),
    ).toEqual({ 'ai.use': false, 'ai.generate': false })
  })

  it('a request naming NO site, or a site the collaborator cannot reach, is nothing', () => {
    expect(resolveAiPermissions({ member: collaborator() })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
    expect(resolveAiPermissions({ member: collaborator(), hostId: '' })).toEqual({
      'ai.use': false,
      'ai.generate': false,
    })
    expect(resolveCollaboratorAiPermissions(collaborator(), OTHER_HOST)).toBeNull()
    expect(
      resolveAiPermissions({ member: collaborator(), hostId: OTHER_HOST }),
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
    expect(projectHostMemberAiPermissions(members, HOST, roles)).toEqual({
      owner: { 'ai.use': true, 'ai.generate': true },
      writer: { 'ai.use': true, 'ai.generate': false },
      client: { 'ai.use': true, 'ai.generate': false },
    })
  })

  it('a dangling custom role falls back to the role default, never to a denial', () => {
    const members = [
      { $id: 'writer', role: 'editor', allHosts: true, roleId: 'deleted' },
    ] as Array<Partial<AglynOrgMember> & { $id: string }>
    expect(projectHostMemberAiPermissions(members, HOST, new Map([['deleted', null]]))).toEqual({
      writer: { 'ai.use': true, 'ai.generate': true },
    })
  })
})

describe('the label a refusal names', () => {
  it('comes from the catalog, so the sentence and the role editor agree', () => {
    expect(aiPermissionLabel('ai.use')).toBe('Use AI assistance')
    expect(aiPermissionLabel('ai.generate')).toBe('Generate with AI')
  })
})
