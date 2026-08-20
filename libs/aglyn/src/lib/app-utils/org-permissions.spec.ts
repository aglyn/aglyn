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

import {
  hasOrgPermission,
  ORG_PERMISSION_KEYS,
  resolveOrgPermissions,
} from './org-permissions'

describe('org permissions (AGL-243)', () => {
  it('maps role defaults: admins everything, editors content-only, viewers nothing', () => {
    const admin = resolveOrgPermissions({ role: 'admin' })
    expect(Object.values(admin).every(Boolean)).toBe(true)
    const editor = resolveOrgPermissions({ role: 'editor' })
    expect(editor['billing.view']).toBe(false)
    expect(editor['members.manage']).toBe(false)
    expect(editor['hosts.create']).toBe(false)
    expect(editor['data.manage']).toBe(true)
    expect(editor['marketplace.publish']).toBe(true)
    const viewer = resolveOrgPermissions({ role: 'viewer' })
    expect(Object.values(viewer).some(Boolean)).toBe(false)
    // Missing member (not in the org) has no permissions at all.
    expect(Object.values(resolveOrgPermissions(null)).some(Boolean)).toBe(
      false,
    )
  })

  it('custom role map overrides role defaults; member overrides win last', () => {
    const billingEditor = resolveOrgPermissions(
      { role: 'editor', roleId: 'billing-editor' },
      { permissions: { 'billing.view': true, 'data.manage': false } },
    )
    expect(billingEditor['billing.view']).toBe(true)
    expect(billingEditor['data.manage']).toBe(false)
    // Custom role only applies when the member carries its roleId.
    const withoutRoleId = resolveOrgPermissions(
      { role: 'editor' },
      { permissions: { 'billing.view': true } },
    )
    expect(withoutRoleId['billing.view']).toBe(false)
    // Per-member override beats both layers.
    const stripped = resolveOrgPermissions(
      {
        role: 'admin',
        permissions: { 'billing.manage': false },
      },
      null,
    )
    expect(stripped['billing.manage']).toBe(false)
    expect(stripped['billing.view']).toBe(true)
  })

  it('hasOrgPermission convenience matches the resolved map', () => {
    expect(hasOrgPermission({ role: 'owner' }, 'org.settings')).toBe(true)
    expect(hasOrgPermission({ role: 'viewer' }, 'org.settings')).toBe(false)
    // The catalog is TEN after AGL-2444 removed `marketing.manage`, which
    // named a host-scoped action no org-level boundary governs. Asserted
    // exactly rather than as a floor: the point of that issue is that a key
    // nobody enforces must not sit here quietly, and a `>` bound is exactly
    // the assertion an unenforced addition would slip past.
    expect(ORG_PERMISSION_KEYS.length).toBe(10)
    expect(ORG_PERMISSION_KEYS).not.toContain('marketing.manage')
  })
})
