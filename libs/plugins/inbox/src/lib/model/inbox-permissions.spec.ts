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
 * Inbox's site keys (AGL-4047), as the plugin really declares them: each
 * preset must be exactly the site-role gate it replaced (Admin, Editor), for
 * every site role and every workspace role, and the doors read the site's
 * stamp first.
 */

import {
  holdsStampedSiteKey,
  resolveSiteRolePresetPermissions,
  siteRolePresetPermissionKeys,
} from '@aglyn/aglyn/app-utils/host-permissions'
import { ORG_PERMISSIONS, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { hostRoleFor, projectHostMemberRoles } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember, HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { registerInboxDeclarations } from '../declarations'
import {
  INBOX_SITE_PERMISSIONS,
  INBOX_SITE_ROLE_PRESET,
  inboxSitePermissionRefusal,
  type InboxSitePermission,
} from './inbox-permissions'

const SITE = 'site-1'
const KEYS: InboxSitePermission[] = ['inbox.reply', 'inbox.assign']
const HOST_ROLES: HostAccessRole[] = ['admin', 'editor', 'author', 'viewer']
/** The doors' check before: the site Admin or Editor. */
const before = (role: string | null | undefined) => role === 'admin' || role === 'editor'

beforeAll(() => registerInboxDeclarations())

describe('Inbox’s site keys (AGL-4047)', () => {
  it('keep the site Admin and Editor as their preset', () => {
    expect(INBOX_SITE_ROLE_PRESET).toEqual({ admin: true, editor: true, author: false, viewer: false })
    expect(INBOX_SITE_PERMISSIONS.map((entry) => entry.key)).toEqual(KEYS)
    for (const entry of INBOX_SITE_PERMISSIONS) {
      expect(entry).toMatchObject({
        presetFromSiteRole: true,
        hostRoleDefaults: INBOX_SITE_ROLE_PRESET,
        roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
      })
    }
    expect(siteRolePresetPermissionKeys().filter((key) => key.startsWith('inbox.'))).toEqual(KEYS)
    for (const key of KEYS) {
      expect(ORG_PERMISSIONS.find((entry) => entry.key === key)).toMatchObject({ pluginId: 'inbox', scope: 'site' })
    }
  })

  const MEMBERS: Array<[string, Partial<AglynOrgMember> & { $id: string }]> = [
    ['owner', { $id: 'owner', role: 'owner', allHosts: true }],
    ['admin', { $id: 'admin', role: 'admin' }],
    ['workspace editor', { $id: 'editor', role: 'editor', allHosts: true }],
    ['editor narrowed to Author here', { $id: 'ed-author', role: 'editor', allHosts: true, hostAccess: { [SITE]: 'author' } }],
    ['viewer made Editor here', { $id: 'vw-editor', role: 'viewer', allHosts: true, hostAccess: { [SITE]: 'editor' } }],
    ['workspace viewer', { $id: 'viewer', role: 'viewer', allHosts: true }],
    ['collaborator, Admin here', { $id: 'co-admin', role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'admin' } }],
    ['collaborator, Author here', { $id: 'co-author', role: 'viewer', allHosts: false, hostAccess: { [SITE]: 'author' } }],
    ['collaborator elsewhere', { $id: 'co-other', role: 'viewer', allHosts: false, hostAccess: { other: 'admin' } }],
  ]

  it.each(MEMBERS)('a %s holds them on the site exactly when the doors let them in', (_name, member) => {
    const expected = before(hostRoleFor(member, SITE))
    const memberRoles = projectHostMemberRoles(MEMBERS.map(([, fixture]) => fixture), SITE)
    for (const key of KEYS) {
      expect([key, resolveSiteRolePresetPermissions(member, SITE)[key]]).toEqual([key, expected])
      expect([key, holdsStampedSiteKey({ memberRoles }, member.$id, key, INBOX_SITE_ROLE_PRESET)]).toEqual([key, expected])
    }
  })

  it.each(HOST_ROLES)('a site %s holds them exactly when the doors let them in', (role) => {
    for (const key of KEYS) {
      expect(holdsStampedSiteKey({ memberRoles: { u: role } }, 'u', key, INBOX_SITE_ROLE_PRESET)).toBe(before(role))
    }
  })

  it.each(['owner', 'admin', 'editor', 'viewer'] as const)('a workspace %s holds them with no site named', (role) => {
    for (const key of KEYS) expect(resolveOrgPermissions({ role, allHosts: true }, null)[key]).toBe(role !== 'viewer')
  })

  it('read the site’s stamp first, either way, and refuse in the permission’s words', () => {
    for (const key of KEYS) {
      const host = { memberRoles: { u: 'author', v: 'admin' }, memberPermissions: { u: { [key]: true }, v: { [key]: false } } }
      expect(holdsStampedSiteKey(host, 'u', key, INBOX_SITE_ROLE_PRESET)).toBe(true)
      expect(holdsStampedSiteKey(host, 'v', key, INBOX_SITE_ROLE_PRESET)).toBe(false)
      const label = INBOX_SITE_PERMISSIONS.find((entry) => entry.key === key)?.label
      expect(inboxSitePermissionRefusal(key)).toBe(`Your role does not include "${label}" — ask an organization admin`)
    }
  })
})
