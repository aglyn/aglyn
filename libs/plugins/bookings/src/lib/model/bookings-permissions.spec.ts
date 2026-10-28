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
 * Bookings' keys (AGL-4047), as the plugin really declares them.
 *
 * Taking a booking's payment in person was the site Admin's and Editor's, and
 * refunding a booking the site Admin's alone. The keys that replaced those
 * gates must keep them as their preset exactly, for every site role and every
 * workspace role, and the routes must read the site's stamp first.
 */

import { resolveSiteRolePresetPermissions, siteRolePresetPermissionKeys } from '@aglyn/aglyn/app-utils/host-permissions'
import { ORG_PERMISSIONS, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import type { AglynOrgMember, HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { registerBookingsDeclarations } from '../declarations'
import { holdsBookingsSiteKey } from '../server/bookings-site-keys'
import {
  BOOKING_PAYMENTS_SITE_ROLE_PRESET,
  BOOKING_REFUNDS_SITE_ROLE_PRESET,
  BOOKINGS_SITE_PERMISSIONS,
  bookingsSitePermissionRefusal,
  type BookingsSitePermission,
} from './bookings-permissions'

const HOST_ROLES: HostAccessRole[] = ['admin', 'editor', 'author', 'viewer']
const SITE = 'site-1'

/** Who passed each gate before it was a key, by site role. */
const BEFORE: Record<BookingsSitePermission, (role: HostAccessRole) => boolean> = {
  'bookings.payments': (role) => role === 'admin' || role === 'editor',
  'bookings.refunds': (role) => role === 'admin',
}
const KEYS = Object.keys(BEFORE) as BookingsSitePermission[]

beforeAll(() => registerBookingsDeclarations())

describe('the bookings keys (AGL-4047)', () => {
  it('keep the site roles that passed each gate as their preset', () => {
    expect(BOOKING_PAYMENTS_SITE_ROLE_PRESET).toEqual({ admin: true, editor: true, author: false, viewer: false })
    expect(BOOKING_REFUNDS_SITE_ROLE_PRESET).toEqual({ admin: true, editor: false, author: false, viewer: false })
    for (const key of KEYS) {
      const entry = BOOKINGS_SITE_PERMISSIONS.find((candidate) => candidate.key === key)
      expect(entry?.presetFromSiteRole).toBe(true)
      for (const role of HOST_ROLES) expect([key, role, entry?.hostRoleDefaults?.[role]]).toEqual([key, role, BEFORE[key](role)])
      // The answer with no site named: each workspace role's own site role.
      expect(entry?.roleDefaults).toEqual({
        owner: BEFORE[key]('admin'),
        admin: BEFORE[key]('admin'),
        editor: BEFORE[key]('editor'),
        viewer: BEFORE[key]('viewer'),
      })
    }
  })

  it('register into the one catalog, filed under Bookings, as site-role presets', () => {
    expect(siteRolePresetPermissionKeys().filter((key) => key.startsWith('bookings.'))).toEqual(KEYS)
    for (const key of KEYS) {
      expect(ORG_PERMISSIONS.find((entry) => entry.key === key)).toMatchObject({
        pluginId: 'bookings',
        group: 'bookings',
        presetFromSiteRole: true,
      })
    }
  })

  it.each(HOST_ROLES)('a site %s holds them exactly when the routes let them in', (role) => {
    const collaborator: Partial<AglynOrgMember> = { role: 'viewer', allHosts: false, hostAccess: { [SITE]: role } }
    for (const key of KEYS) {
      expect([key, resolveSiteRolePresetPermissions(collaborator, SITE)[key]]).toEqual([key, BEFORE[key](role)])
      expect([key, holdsBookingsSiteKey({ memberRoles: { u: role } }, 'u', key)]).toEqual([key, BEFORE[key](role)])
    }
  })

  it.each(['owner', 'admin', 'editor', 'viewer'] as const)('a workspace %s holds them as before', (role) => {
    const member: Partial<AglynOrgMember> = { role, allHosts: true }
    const siteRole: HostAccessRole = role === 'owner' || role === 'admin' ? 'admin' : role
    for (const key of KEYS) {
      expect(resolveSiteRolePresetPermissions(member, SITE)[key]).toBe(BEFORE[key](siteRole))
      expect(resolveOrgPermissions(member, null)[key]).toBe(BEFORE[key](siteRole))
    }
  })

  it('the routes read the site’s stamp first, either way', () => {
    const host = {
      memberRoles: { u: 'author', v: 'admin' },
      memberPermissions: { u: { 'bookings.payments': true, 'bookings.refunds': true }, v: { 'bookings.refunds': false } },
    }
    expect(holdsBookingsSiteKey(host, 'u', 'bookings.payments')).toBe(true)
    expect(holdsBookingsSiteKey(host, 'u', 'bookings.refunds')).toBe(true)
    expect(holdsBookingsSiteKey(host, 'v', 'bookings.refunds')).toBe(false)
    expect(holdsBookingsSiteKey(host, 'v', 'bookings.payments')).toBe(true)
    expect(holdsBookingsSiteKey(host, 'stranger', 'bookings.payments')).toBe(false)
  })

  it('refuse in the permission’s words, never a role', () => {
    expect(bookingsSitePermissionRefusal('bookings.refunds')).toBe(
      'Your role does not include "Refund bookings" — ask an organization admin',
    )
    expect(bookingsSitePermissionRefusal('bookings.payments')).toBe(
      'Your role does not include "Take booking payments in person" — ask an organization admin',
    )
  })
})
