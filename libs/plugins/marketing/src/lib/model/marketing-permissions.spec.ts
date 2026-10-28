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
 * "Run email campaigns" (`marketing.campaigns`, AGL-4047), as the plugin really declares it: its preset
 * must be exactly the role gate it replaced, for every site role and every
 * workspace role, and the doors read the site's stamp first.
 */

import {
  holdsStampedSiteKey,
  resolveSiteRolePresetPermissions,
  siteRolePresetPermissionKeys,
} from '@aglyn/aglyn/app-utils/host-permissions'
import { ORG_PERMISSIONS, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { hostRoleFor, projectHostMemberRoles } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember, HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { registerMarketingDeclarations } from '../declarations'
import {
  MARKETING_CAMPAIGNS_REFUSAL,
  MARKETING_CAMPAIGNS_SITE_ROLE_PRESET,
  MARKETING_SITE_PERMISSIONS,
} from './marketing-permissions'

const SITE = 'site-1'
const HOST_ROLES: HostAccessRole[] = ['admin', 'editor', 'author', 'viewer']
/** Who ran a site's campaigns before (`CAMPAIGN_DRAFT_ROLES`, the routes): the site Admin and Editor. */
const before = (role: string | null | undefined) => role === 'admin' || role === 'editor'

beforeAll(() => registerMarketingDeclarations())

describe('"Run email campaigns" (AGL-4047)', () => {
  it('keeps the site Admin and Editor as its preset, and the owner, admins and editors with no site named', () => {
    expect(MARKETING_CAMPAIGNS_SITE_ROLE_PRESET).toEqual({ admin: true, editor: true, author: false, viewer: false })
    expect(MARKETING_SITE_PERMISSIONS).toEqual([
      expect.objectContaining({
        key: 'marketing.campaigns',
        presetFromSiteRole: true,
        hostRoleDefaults: MARKETING_CAMPAIGNS_SITE_ROLE_PRESET,
        roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
      }),
    ])
    expect(siteRolePresetPermissionKeys()).toContain('marketing.campaigns')
    expect(ORG_PERMISSIONS.find((entry) => entry.key === 'marketing.campaigns')).toMatchObject({ pluginId: 'marketing', scope: 'site' })
  })

  const MEMBERS: Array<[string, Partial<AglynOrgMember> & { $id: string }]> = [
    ['owner', { $id: 'owner', role: 'owner', allHosts: true }],
    ['admin', { $id: 'admin', role: 'admin' }],
    ['workspace editor', { $id: 'editor', role: 'editor', allHosts: true }],
    ['editor narrowed to Author here', { $id: 'ed-author', role: 'editor', allHosts: true, hostAccess: { [SITE]: 'author' } }],
    ['viewer made Editor here', { $id: 'vw-editor', role: 'viewer', allHosts: true, hostAccess: { [SITE]: 'editor' } }],
    ['workspace viewer', { $id: 'viewer', role: 'viewer', allHosts: true }],
    ['collaborator, Admin here', { $id: 'co-admin', role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'admin' } }],
    ['collaborator, Editor here', { $id: 'co-editor', role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'editor' } }],
    ['collaborator, Author here', { $id: 'co-author', role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'author' } }],
    ['collaborator elsewhere', { $id: 'co-other', role: 'viewer', allHosts: false, hostAccess: { other: 'admin' } }],
  ]

  it.each(MEMBERS)('a %s holds it on the site exactly when the role gate let them in', (_name, member) => {
    const expected = before(hostRoleFor(member, SITE))
    expect(resolveSiteRolePresetPermissions(member, SITE)['marketing.campaigns']).toBe(expected)
    const memberRoles = projectHostMemberRoles(MEMBERS.map(([, fixture]) => fixture), SITE)
    expect(holdsStampedSiteKey({ memberRoles }, member.$id, 'marketing.campaigns', MARKETING_CAMPAIGNS_SITE_ROLE_PRESET)).toBe(expected)
  })

  it.each(HOST_ROLES)('a site %s holds it exactly when the gate let them in', (role) => {
    expect(holdsStampedSiteKey({ memberRoles: { u: role } }, 'u', 'marketing.campaigns', MARKETING_CAMPAIGNS_SITE_ROLE_PRESET)).toBe(before(role))
  })

  // The organization hub asked an org-wide owner, admin or editor (`ORG_MANAGE_ROLES`).
  it.each(['owner', 'admin', 'editor', 'viewer'] as const)('a workspace %s holds it with no site named as before', (role) => {
    expect(resolveOrgPermissions({ role, allHosts: true }, null)['marketing.campaigns']).toBe(role !== 'viewer')
  })

  it('reads the site’s stamp first, either way, and refuses in the permission’s words', () => {
    const host = {
      memberRoles: { u: 'author', v: 'admin' },
      memberPermissions: { u: { 'marketing.campaigns': true }, v: { 'marketing.campaigns': false } },
    }
    expect(holdsStampedSiteKey(host, 'u', 'marketing.campaigns', MARKETING_CAMPAIGNS_SITE_ROLE_PRESET)).toBe(true)
    expect(holdsStampedSiteKey(host, 'v', 'marketing.campaigns', MARKETING_CAMPAIGNS_SITE_ROLE_PRESET)).toBe(false)
    expect(MARKETING_CAMPAIGNS_REFUSAL).toBe('Your role does not include "Run email campaigns" — ask an organization admin')
  })
})
