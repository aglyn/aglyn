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

import { resolveRolePermissions } from './tenant-roles'

describe('tenant roles', () => {
  it('resolves built-in role defaults', () => {
    expect(resolveRolePermissions('admin').editBilling).toBe(true)
    expect(resolveRolePermissions('editor')).toMatchObject({
      createHosts: false,
      editHosts: true,
      editBilling: false,
      publishToCommunity: true,
    })
    expect(resolveRolePermissions('viewer').installPlugins).toBe(false)
  })

  it('treats unknown or missing roles as viewer', () => {
    expect(resolveRolePermissions(undefined).editHosts).toBe(false)
    expect(resolveRolePermissions('superuser').manageMembers).toBe(false)
  })

  it('applies boolean overrides key-by-key, ignoring junk', () => {
    const resolved = resolveRolePermissions('viewer', {
      editBilling: true,
      createHosts: 'yes' as any,
    })
    expect(resolved.editBilling).toBe(true)
    expect(resolved.createHosts).toBe(false)
    // Overrides can also revoke from a permissive role.
    expect(
      resolveRolePermissions('admin', { manageMembers: false }).manageMembers,
    ).toBe(false)
  })

  it('resolves custom roles from the map, viewer otherwise (AGL-133)', () => {
    const customRoles = {
      marketer: {
        name: 'Marketer',
        permissions: { publishToCommunity: true, installPlugins: true },
      },
    }
    const resolved = resolveRolePermissions('marketer', null, customRoles)
    expect(resolved.publishToCommunity).toBe(true)
    expect(resolved.installPlugins).toBe(true)
    expect(resolved.createHosts).toBe(false)
    // Per-user overrides still win over the custom role.
    expect(
      resolveRolePermissions('marketer', { installPlugins: false }, customRoles)
        .installPlugins,
    ).toBe(false)
    // Unknown custom id stays least-privilege viewer.
    expect(
      resolveRolePermissions('ghost', null, customRoles).publishToCommunity,
    ).toBe(false)
  })
})
