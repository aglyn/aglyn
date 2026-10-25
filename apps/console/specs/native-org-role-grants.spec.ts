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
 * The native apps resolve a member's permissions from `ORG_ROLE_GRANTS` in
 * the contracts (AGL-3950) when the member row carries no
 * `resolvedPermissions` stamp. That table must be the console's: this spec
 * registers every plugin's declarations through the generated manifest, as
 * the console does at boot, and holds the contracts' catalog and grants to
 * `DEFAULT_ROLE_PERMISSIONS`, and `rolePermissions` to `resolveOrgPermissions`
 * with custom roles and per-member overrides layered on.
 *
 * The contracts are read from disk, so this app spec imports no plugin.
 */

import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  DEFAULT_ROLE_PERMISSIONS,
  ORG_PERMISSION_GROUPS,
  ORG_PERMISSION_KEYS,
  ORG_PERMISSIONS,
  resolveOrgPermissions,
} from '@aglyn/aglyn/app-utils/org-permissions'
import {
  rolePermissions,
  type OrgRoleGrants,
  type OrgRoleName,
} from '@aglyn/aglyn/app-utils/org-role-grants'
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'

const ROOT = resolve(__dirname, '../../..')
const GRANTS = (
  JSON.parse(readFileSync(join(ROOT, 'libs/native/contracts/contracts.generated.json'), 'utf8')) as {
    ORG_ROLE_GRANTS: OrgRoleGrants
  }
).ORG_ROLE_GRANTS
const ROLES: OrgRoleName[] = ['owner', 'admin', 'editor', 'viewer']

beforeAll(async () => {
  await registerPluginDeclarations()
})

describe('the contracts’ role grants are the console’s', () => {
  it('CONTROL: a plugin’s declared key is in the console’s catalog', () => {
    expect(ORG_PERMISSION_KEYS).toContain('ai.generate')
    expect(ORG_PERMISSION_KEYS).toContain('hosts.create')
  })

  it('holds the same keys, in the role editor’s order', () => {
    expect(GRANTS.permissions.map((entry) => entry.key)).toEqual([...ORG_PERMISSION_KEYS])
  })

  it('carries the keys of BOTH plugin declaration APIs (AGL-4047)', () => {
    // `registerPluginPermissions` keys joined the one catalog, so the native
    // role editor and gates see `managePos` beside `ai.use`.
    expect(ORG_PERMISSION_KEYS).toEqual(expect.arrayContaining(['managePos', 'outreach.use', 'accounting.manage']))
  })

  it('files every key under the console’s group, with the same headings', () => {
    expect(GRANTS.permissions.map((entry) => [entry.key, entry.group])).toEqual(
      ORG_PERMISSIONS.map((definition) => [definition.key, definition.group]),
    )
    expect((GRANTS.groups ?? []).map((group) => [group.id, group.label])).toEqual(
      ORG_PERMISSION_GROUPS.map((group) => [group.id, group.label]),
    )
  })

  it.each(ROLES)('gives %s exactly the console’s defaults', (role) => {
    expect(rolePermissions(GRANTS, role)).toEqual({ ...DEFAULT_ROLE_PERMISSIONS[role] })
  })

  it.each([
    ['an editor on a custom role', { role: 'editor', roleId: 'r1' }, { permissions: { 'hosts.create': true, 'data.manage': false, 'ai.generate': false } }],
    ['a viewer with an override', { role: 'viewer', permissions: { 'billing.view': true, 'ai.use': true } }, null],
    ['an admin on a custom role with an override', { role: 'admin', roleId: 'r2', permissions: { 'hosts.delete': false } }, { permissions: { 'members.manage': false } }],
    ['a member with no role', {}, null],
  ] as const)('resolves %s as resolveOrgPermissions does', (_name, member, customRole) => {
    const expected = resolveOrgPermissions(member as never, customRole as never)
    const layered = rolePermissions(
      GRANTS,
      (member as { role?: string }).role,
      (member as { roleId?: string }).roleId ? (customRole as never) : null,
      (member as { permissions?: Record<string, boolean> }).permissions
        ? { permissions: (member as { permissions: Record<string, boolean> }).permissions }
        : null,
    )
    expect(layered).toEqual({ ...expected })
  })
})
