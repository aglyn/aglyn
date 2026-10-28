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
 * The reservation keys (AGL-4047), as commerce really declares them.
 *
 * A stay was the content-write roles' to change (Admin, Editor, Author on the
 * site), at the rules and at the routes. The two keys that replaced that
 * gate must keep it as their preset exactly, for every site role and every
 * workspace role, and the routes must read the same preset the rules do.
 * The full matrix of membership shapes is proven in the core's
 * `site-role-preset.spec.ts`; this holds commerce's declarations to it.
 */

import {
  hostStampedSitePermission,
  resolveSiteRolePresetPermissions,
  siteRolePresetPermissionKeys,
} from '@aglyn/aglyn/app-utils/host-permissions'
import { ORG_PERMISSIONS, resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { canWriteHost, HOST_CONTENT_WRITE_ROLES } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember, HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { registerCommerceDeclarations } from '../declarations'
import { WALK_IN_PERMISSION } from '../server/reservation-walk-in'
import { holdsCommerceSiteKey } from '../server/commerce-site-keys'
import {
  commerceSitePermissionRefusal,
  COMMERCE_SITE_PERMISSIONS,
  ORDERS_SITE_ROLE_PRESET,
  RESERVATION_SITE_ROLE_PRESET,
  reservationPermissionLabel,
  STORE_SETTINGS_SITE_ROLE_PRESET,
  type CommerceSitePermission,
  reservationPermissionRefusal,
} from './plugin-permissions'

jest.mock('@aglyn/tenant-data-admin', () => ({ __esModule: true, firebaseAdmin: {} }))

const HOST_ROLES: HostAccessRole[] = ['admin', 'editor', 'author', 'viewer']
const KEYS = ['commerce.reservations', 'commerce.walkIns'] as const
const SITE = 'site-1'

beforeAll(() => registerCommerceDeclarations())

describe('the reservation keys (AGL-4047)', () => {
  it('keep the content-write roles as their site preset, and the workspace roles that reach them', () => {
    for (const entry of COMMERCE_SITE_PERMISSIONS.filter((candidate) => (KEYS as readonly string[]).includes(candidate.key))) {
      expect(entry.presetFromSiteRole).toBe(true)
      for (const role of HOST_ROLES) {
        expect(entry.hostRoleDefaults?.[role]).toBe(HOST_CONTENT_WRITE_ROLES.includes(role))
      }
      // The answer with no site named: each workspace role's own site role.
      expect(entry.roleDefaults).toEqual({
        owner: entry.hostRoleDefaults?.admin,
        admin: entry.hostRoleDefaults?.admin,
        editor: entry.hostRoleDefaults?.editor,
        viewer: entry.hostRoleDefaults?.viewer,
      })
    }
    expect(RESERVATION_SITE_ROLE_PRESET).toEqual(
      Object.fromEntries(HOST_ROLES.map((role) => [role, HOST_CONTENT_WRITE_ROLES.includes(role)])),
    )
  })

  it('register into the one catalog, filed under Commerce, as site-role presets', () => {
    // After the core's site keys (AGL-4047).
    expect(siteRolePresetPermissionKeys().filter((key) => key.startsWith('commerce.'))).toEqual([
      ...KEYS,
      'commerce.orders',
      'commerce.giftCards',
      'commerce.paymentMethods',
      'commerce.shippingConnections',
    ])
    for (const key of KEYS) {
      const definition = ORG_PERMISSIONS.find((entry) => entry.key === key)
      expect(definition).toMatchObject({ pluginId: 'commerce', group: 'commerce', scope: 'site', presetFromSiteRole: true })
    }
    expect(ORG_PERMISSIONS.find((entry) => entry.key === 'commerce.walkIns')?.follows).toBe('commerce.reservations')
  })

  it('the walk-in and guests routes read the same preset the rules read', () => {
    expect(WALK_IN_PERMISSION).toEqual({
      key: 'commerce.walkIns',
      presetFor: RESERVATION_SITE_ROLE_PRESET,
      refusal: reservationPermissionRefusal('commerce.walkIns'),
    })
  })

  it.each(HOST_ROLES)('a site %s holds them exactly when the content-write gate let them in', (role) => {
    const collaborator: Partial<AglynOrgMember> = { role: 'viewer', allHosts: false, hostAccess: { [SITE]: role } }
    const resolved = resolveSiteRolePresetPermissions(collaborator, SITE)
    const stamped = (key: string) =>
      hostStampedSitePermission({ memberRoles: { u: role } }, 'u', key, RESERVATION_SITE_ROLE_PRESET)
    for (const key of KEYS) {
      expect(resolved[key]).toBe(canWriteHost(collaborator, SITE))
      expect(stamped(key)).toBe(canWriteHost(collaborator, SITE))
    }
  })

  it.each(['owner', 'admin', 'editor', 'viewer'] as const)('a workspace %s holds them as before, on a site and with none named', (role) => {
    const member: Partial<AglynOrgMember> = { role, allHosts: true }
    for (const key of KEYS) {
      expect(resolveSiteRolePresetPermissions(member, SITE)[key]).toBe(canWriteHost(member, SITE))
      expect(resolveOrgPermissions(member, null)[key]).toBe(role !== 'viewer')
    }
  })

  it('a refusal names the permission, never a role', () => {
    for (const key of KEYS) {
      const refusal = reservationPermissionRefusal(key)
      expect(refusal).toBe(`Your role does not include "${reservationPermissionLabel(key)}" — ask an organization admin`)
      expect(refusal).not.toMatch(/\b(editor|author|viewer) role\b/i)
    }
  })
})

describe('the order and gift card keys (AGL-4047)', () => {
  const ORDER_KEYS = ['commerce.orders', 'commerce.giftCards'] as const

  it('keep the site Admin and Editor who worked orders as their preset, never an Author', () => {
    expect(ORDERS_SITE_ROLE_PRESET).toEqual({ admin: true, editor: true, author: false, viewer: false })
    for (const key of ORDER_KEYS) {
      const entry = COMMERCE_SITE_PERMISSIONS.find((candidate) => candidate.key === key)
      expect(entry).toMatchObject({ presetFromSiteRole: true, hostRoleDefaults: ORDERS_SITE_ROLE_PRESET })
      expect(entry?.roleDefaults).toEqual({ owner: true, admin: true, editor: true, viewer: false })
    }
  })

  it.each(HOST_ROLES)('a site %s holds them exactly when the order routes let them in', (role) => {
    const collaborator: Partial<AglynOrgMember> = { role: 'viewer', allHosts: false, hostAccess: { [SITE]: role } }
    const before = role === 'admin' || role === 'editor'
    for (const key of ORDER_KEYS) {
      expect(resolveSiteRolePresetPermissions(collaborator, SITE)[key]).toBe(before)
      expect(holdsCommerceSiteKey({ memberRoles: { u: role } }, 'u', key)).toBe(before)
    }
  })

  it('the routes read the site’s stamp first', () => {
    const host = { memberRoles: { u: 'author', v: 'editor' }, memberPermissions: { u: { 'commerce.orders': true }, v: { 'commerce.giftCards': false } } }
    expect(holdsCommerceSiteKey(host, 'u', 'commerce.orders')).toBe(true)
    expect(holdsCommerceSiteKey(host, 'v', 'commerce.giftCards')).toBe(false)
    expect(holdsCommerceSiteKey(host, 'v', 'commerce.orders')).toBe(true)
  })

  it('refuse in the permission’s words', () => {
    expect(commerceSitePermissionRefusal('commerce.orders')).toBe(
      'Your role does not include "Manage orders" — ask an organization admin',
    )
  })
})

describe('the payment method and shipping app keys (AGL-4047)', () => {
  const SETTINGS_KEYS = ['commerce.paymentMethods', 'commerce.shippingConnections'] as const

  it('keep the site Admin who alone changed them as their preset', () => {
    expect(STORE_SETTINGS_SITE_ROLE_PRESET).toEqual({ admin: true, editor: false, author: false, viewer: false })
    for (const key of SETTINGS_KEYS) {
      const entry = COMMERCE_SITE_PERMISSIONS.find((candidate) => candidate.key === key)
      expect(entry).toMatchObject({ presetFromSiteRole: true, hostRoleDefaults: STORE_SETTINGS_SITE_ROLE_PRESET })
      expect(entry?.roleDefaults).toEqual({ owner: true, admin: true, editor: false, viewer: false })
    }
  })

  it.each(HOST_ROLES)('a site %s holds them exactly when the routes let them change things', (role) => {
    const collaborator: Partial<AglynOrgMember> = { role: 'viewer', allHosts: false, hostAccess: { [SITE]: role } }
    for (const key of SETTINGS_KEYS) {
      expect(resolveSiteRolePresetPermissions(collaborator, SITE)[key]).toBe(role === 'admin')
      expect(holdsCommerceSiteKey({ memberRoles: { u: role } }, 'u', key)).toBe(role === 'admin')
    }
  })

  it.each(['owner', 'admin', 'editor', 'viewer'] as const)('a workspace %s holds them as before', (role) => {
    const member: Partial<AglynOrgMember> = { role, allHosts: true }
    for (const key of SETTINGS_KEYS) {
      expect(resolveSiteRolePresetPermissions(member, SITE)[key]).toBe(role === 'owner' || role === 'admin')
      expect(resolveOrgPermissions(member, null)[key]).toBe(role === 'owner' || role === 'admin')
    }
  })

  it('reading either card stays the Admin and Editor’s: "Manage orders" or the key', () => {
    for (const role of HOST_ROLES) {
      const host = { memberRoles: { u: role } }
      const reads = (key: CommerceSitePermission) =>
        holdsCommerceSiteKey(host, 'u', key) || holdsCommerceSiteKey(host, 'u', 'commerce.orders')
      for (const key of SETTINGS_KEYS) expect([role, reads(key)]).toEqual([role, role === 'admin' || role === 'editor'])
    }
  })
})
