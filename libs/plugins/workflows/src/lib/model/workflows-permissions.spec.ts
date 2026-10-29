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
 * Workflows' keys (AGL-4047), as the plugin really declares them: each must
 * answer exactly what its role gate answered for every built-in role.
 */

import {
  holdsStampedSiteKey,
  resolveSiteRolePresetPermissions,
} from '@aglyn/aglyn/app-utils/host-permissions'
import { ORG_PERMISSIONS, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { hostRoleFor, isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember, HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { registerWorkflowsDeclarations } from '../declarations'
import { WORKFLOWS_PERMISSIONS, WORKFLOWS_SITE_PAUSE_PRESET, workflowsPermissionRefusal } from './workflows-permissions'

const SITE = 'site-1'

beforeAll(() => registerWorkflowsDeclarations())

describe('"Manage org automations" (AGL-4047)', () => {
  it('defaults to the owner, admins and editors `ORG_MANAGE_ROLES` named, as a workspace key', () => {
    expect(WORKFLOWS_PERMISSIONS[0]).toMatchObject({
      key: 'workflows.orgAutomations',
      roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    })
    expect(WORKFLOWS_PERMISSIONS[0].hostRoleDefaults).toBeUndefined()
    expect(ORG_PERMISSIONS.find((entry) => entry.key === 'workflows.orgAutomations')).toMatchObject({
      pluginId: 'workflows',
      scope: 'org',
    })
  })

  it.each(['owner', 'admin', 'editor', 'viewer'] as const)('a workspace %s holds it as `ORG_MANAGE_ROLES` admitted', (role) => {
    expect(resolveOrgPermissions({ role, allHosts: true }, null)['workflows.orgAutomations']).toBe(role !== 'viewer')
  })

  it('a member’s own permissions grant or refuse it', () => {
    expect(resolveOrgPermissions({ role: 'viewer', allHosts: true, permissions: { 'workflows.orgAutomations': true } }, null)['workflows.orgAutomations']).toBe(true)
    expect(resolveOrgPermissions({ role: 'admin', allHosts: true, permissions: { 'workflows.orgAutomations': false } }, null)['workflows.orgAutomations']).toBe(false)
  })
})

describe('"Pause org automations on a site" (AGL-4047)', () => {
  /** The pause door before: the site Admin or Editor, or an org-wide owner, admin or editor. */
  const before = (member: Partial<AglynOrgMember>) =>
    ['admin', 'editor'].includes(hostRoleFor(member, SITE) ?? '') ||
    (isOrgWideMember(member) && ['owner', 'admin', 'editor'].includes(String(member.role)))
  /** The door now: the site key, or the workspace key for a member of the whole workspace. */
  const after = (member: Partial<AglynOrgMember>) =>
    resolveSiteRolePresetPermissions(member, SITE)['workflows.sitePause'] === true ||
    (isOrgWideMember(member) && resolveOrgPermissions(member, null)['workflows.orgAutomations'] === true)

  it('keeps the site Admin and Editor as its preset', () => {
    expect(WORKFLOWS_SITE_PAUSE_PRESET).toEqual({ admin: true, editor: true, author: false, viewer: false })
    expect(WORKFLOWS_PERMISSIONS[1]).toMatchObject({
      key: 'workflows.sitePause',
      presetFromSiteRole: true,
      hostRoleDefaults: WORKFLOWS_SITE_PAUSE_PRESET,
    })
  })

  const MEMBERS: Array<[string, Partial<AglynOrgMember>]> = [
    ['owner', { role: 'owner', allHosts: true }],
    ['admin', { role: 'admin' }],
    ['workspace editor', { role: 'editor', allHosts: true }],
    ['editor narrowed to Viewer here', { role: 'editor', allHosts: true, hostAccess: { [SITE]: 'viewer' } }],
    ['workspace viewer', { role: 'viewer', allHosts: true }],
    ['viewer made Editor here', { role: 'viewer', allHosts: true, hostAccess: { [SITE]: 'editor' } }],
    ['collaborator, Editor here', { role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'editor' } }],
    ['collaborator, Author here', { role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'author' } }],
    ['collaborator elsewhere', { role: 'editor', allHosts: false, hostAccess: { other: 'admin' } }],
  ]

  it.each(MEMBERS)('a %s may pause exactly when the door let them', (_name, member) => {
    expect(after(member)).toBe(before(member))
  })

  it.each(['admin', 'editor', 'author', 'viewer'] as HostAccessRole[])('a site %s’s preset is the door’s answer', (role) => {
    expect(holdsStampedSiteKey({ memberRoles: { u: role } }, 'u', 'workflows.sitePause', WORKFLOWS_SITE_PAUSE_PRESET)).toBe(
      role === 'admin' || role === 'editor',
    )
  })

  it('refuses in the permission’s words', () => {
    expect(workflowsPermissionRefusal('workflows.sitePause')).toBe(
      'Your role does not include "Pause org automations on a site" — ask an organization admin',
    )
  })
})
