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
 * The marketplace's publisher keys (AGL-4047), as the plugin really declares
 * them. Each replaced the owner-or-admin role helper (and, for the profile
 * and the listings, the rules' role list on `publisherProfiles` and
 * `marketplaceListings`), so each
 * default must be exactly that gate for every workspace role, a site
 * collaborator included, and a custom role or a member's own permissions
 * must then decide it either way.
 */

import { ORG_PERMISSIONS, projectMemberResolvedPermissions, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { registerMarketplaceDeclarations } from '../declarations'
import {
  MARKETPLACE_PUBLISHER_PERMISSIONS,
  marketplacePublisherPermissionRefusal,
  type MarketplacePublisherPermission,
} from './marketplace-publisher-permissions'

const KEYS: MarketplacePublisherPermission[] = [
  'marketplace.publisherProfile',
  'marketplace.manageListings',
  'marketplace.payouts',
  'marketplace.connectionCredentials',
]
/** The gate before: the owner-or-admin role helper, and the rules' `role in ['owner', 'admin']`. */
const before = (role: unknown) => role === 'owner' || role === 'admin'

beforeAll(() => registerMarketplaceDeclarations())

describe('the marketplace’s publisher keys (AGL-4047)', () => {
  it('are declared once each, owners and admins on by default, filed under Marketplace', () => {
    expect(MARKETPLACE_PUBLISHER_PERMISSIONS.map((entry) => entry.key)).toEqual(KEYS)
    for (const entry of MARKETPLACE_PUBLISHER_PERMISSIONS) {
      expect(entry).toMatchObject({
        pluginId: 'marketplace',
        defaults: { admin: true, editor: false, viewer: false },
      })
    }
    for (const key of KEYS) {
      expect(ORG_PERMISSIONS.find((entry) => entry.key === key)).toMatchObject({
        pluginId: 'marketplace',
        group: 'marketplace',
        scope: 'org',
      })
    }
  })

  const MEMBERS: Array<[string, Partial<AglynOrgMember>]> = [
    ['owner', { role: 'owner', allHosts: true }],
    ['admin', { role: 'admin' }],
    ['workspace editor', { role: 'editor', allHosts: true }],
    ['workspace viewer', { role: 'viewer', allHosts: true }],
    ['site collaborator (editor)', { role: 'editor', allHosts: false, hostAccess: { 'site-1': 'admin' } }],
    ['site collaborator (viewer)', { role: 'viewer', allHosts: false, hostAccess: { 'site-1': 'editor' } }],
  ]

  it.each(MEMBERS)('a %s holds them exactly when the old role gate let them in', (_name, member) => {
    for (const key of KEYS) {
      expect([key, resolveOrgPermissions(member, null)[key]]).toEqual([key, before(member.role)])
      // The stamp the rules read carries the same verdict.
      expect([key, projectMemberResolvedPermissions(member, null)[key]]).toEqual([key, before(member.role)])
    }
  })

  it('a custom role or a member’s own permissions decide them, either way', () => {
    const grant = { roleId: 'publisher', permissions: { 'marketplace.publisherProfile': true } }
    expect(
      resolveOrgPermissions({ role: 'editor', allHosts: true, roleId: 'publisher' }, grant)['marketplace.publisherProfile'],
    ).toBe(true)
    expect(
      resolveOrgPermissions({ role: 'editor', allHosts: true, roleId: 'publisher' }, grant)['marketplace.manageListings'],
    ).toBe(false)
    expect(
      resolveOrgPermissions(
        { role: 'viewer', allHosts: true, permissions: { 'marketplace.manageListings': true } },
        null,
      )['marketplace.manageListings'],
    ).toBe(true)
    expect(
      resolveOrgPermissions(
        { role: 'admin', permissions: { 'marketplace.publisherProfile': false } },
        null,
      )['marketplace.publisherProfile'],
    ).toBe(false)
    // Payouts are their own key: an editor trusted with them is not thereby
    // trusted with the profile, and an admin refused them keeps the rest.
    const payouts = resolveOrgPermissions(
      { role: 'editor', allHosts: true, permissions: { 'marketplace.payouts': true } },
      null,
    )
    expect([payouts['marketplace.payouts'], payouts['marketplace.publisherProfile']]).toEqual([true, false])
    const noPayouts = resolveOrgPermissions({ role: 'admin', permissions: { 'marketplace.payouts': false } }, null)
    expect([noPayouts['marketplace.payouts'], noPayouts['marketplace.manageListings']]).toEqual([false, true])
  })

  it('refuse in the permission’s words, never a role’s', () => {
    expect(marketplacePublisherPermissionRefusal('marketplace.publisherProfile')).toBe(
      'Your role does not include "Edit the publisher profile" — ask an organization admin',
    )
    expect(marketplacePublisherPermissionRefusal('marketplace.manageListings')).toBe(
      'Your role does not include "Manage published listings" — ask an organization admin',
    )
    expect(marketplacePublisherPermissionRefusal('marketplace.payouts')).toBe(
      'Your role does not include "Manage marketplace payouts" — ask an organization admin',
    )
  })
})
