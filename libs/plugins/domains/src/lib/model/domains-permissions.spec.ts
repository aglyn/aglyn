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
 * "Manage the workspace's domains" (AGL-4047), as the plugin really declares
 * it: its default must be exactly the owner and admins the workspace arm of
 * the domains gate asked for.
 */

import { ORG_PERMISSIONS, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { registerDomainsDeclarations } from '../declarations'
import { DOMAINS_MANAGE_REFUSAL, DOMAINS_PERMISSIONS } from './domains-permissions'

beforeAll(() => registerDomainsDeclarations())

describe('"Manage the workspace’s domains" (AGL-4047)', () => {
  it('is a workspace key defaulting to the owner and admins', () => {
    expect(DOMAINS_PERMISSIONS).toEqual([
      expect.objectContaining({
        key: 'domains.manage',
        roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
      }),
    ])
    expect(ORG_PERMISSIONS.find((entry) => entry.key === 'domains.manage')).toMatchObject({
      pluginId: 'domains',
      scope: 'org',
    })
  })

  it.each(['owner', 'admin', 'editor', 'viewer'] as const)('a workspace %s holds it as the gate admitted them', (role) => {
    expect(resolveOrgPermissions({ role, allHosts: true }, null)['domains.manage']).toBe(role === 'owner' || role === 'admin')
  })

  it('a member’s own permissions grant or refuse it, and the refusal names it', () => {
    expect(resolveOrgPermissions({ role: 'editor', allHosts: true, permissions: { 'domains.manage': true } }, null)['domains.manage']).toBe(true)
    expect(resolveOrgPermissions({ role: 'admin', permissions: { 'domains.manage': false } }, null)['domains.manage']).toBe(false)
    expect(DOMAINS_MANAGE_REFUSAL).toBe('Your role does not include "Manage the workspace’s domains" — ask an organization admin')
  })
})
