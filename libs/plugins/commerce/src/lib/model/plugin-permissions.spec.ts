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

import { narrowPermissionsToSite, siteNarrowingFor } from '@aglyn/aglyn/app-utils/host-permissions'
import { resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { resolveRolePermissions } from '@aglyn/aglyn/app-utils/org-roles'
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import {
  COMMERCE_PERMISSIONS,
  holdsPosPermission,
  mayVisitPosHardwareShop,
  posPermissionLabel,
  posPermissionRefusal,
  type PosPermission,
  type PosRegisterPermission,
} from './plugin-permissions'

/**
 * The register's finer keys (AGL-4047), split from `managePos`: each refines
 * it with the same tier defaults, so every member keeps exactly the register
 * they had until a role or an override narrows one. `posBuyHardware` follows
 * it the same way, and may also be granted without it.
 */

const REGISTER: PosRegisterPermission[] = ['posSell', 'posRefund', 'posDiscount', 'posCashDrawer', 'posDevices']
const FINER: PosPermission[] = [...REGISTER, 'posBuyHardware']

beforeAll(() => registerPluginPermissions(COMMERCE_PERMISSIONS))

describe('the register’s finer keys (AGL-4047)', () => {
  it('declares each register key as a refinement of managePos, and buying hardware as following it', () => {
    const umbrella = COMMERCE_PERMISSIONS.find((entry) => entry.key === 'managePos')
    for (const key of FINER) {
      const entry = COMMERCE_PERMISSIONS.find((candidate) => candidate.key === key)
      if (key === 'posBuyHardware') {
        expect(entry?.refines).toBeUndefined()
        expect(entry?.follows).toBe('managePos')
      } else {
        expect(entry?.refines).toBe('managePos')
      }
      expect(entry?.defaults).toEqual(umbrella?.defaults)
      expect(posPermissionLabel(key)).not.toBe(key)
    }
  })

  it('leaves every built-in role and every managePos override exactly where it was', () => {
    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      for (const override of [undefined, true, false]) {
        const member = { role, ...(override === undefined ? {} : { permissions: { managePos: override } }) }
        const granted = resolveOrgPermissions(member)
        const tier = resolveRolePermissions(role === 'owner' ? 'admin' : role, member.permissions)
        for (const key of FINER) {
          expect(granted[key]).toBe(granted['managePos'])
          expect(tier[key]).toBe(tier['managePos'])
          expect(holdsPosPermission(granted, key)).toBe(granted['managePos'])
        }
      }
    }
  })

  it('leaves every custom role that moves managePos exactly where it was, buying hardware included', () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      for (const managePos of [true, false]) {
        const member = { role, roleId: 'r1' }
        const granted = resolveOrgPermissions(member, { permissions: { managePos } })
        const tier = resolveRolePermissions('r1', null, { r1: { permissions: { managePos } } as never })
        for (const key of FINER) {
          expect(granted[key]).toBe(managePos)
          expect(tier[key]).toBe(managePos)
        }
      }
    }
  })

  it('grants buying hardware on its own, without the register, and refuses it beside the register', () => {
    // A bookkeeper: a viewer with no register, granted the hardware shop.
    const bookkeeper = resolveOrgPermissions({ role: 'viewer', permissions: { posBuyHardware: true } })
    expect(bookkeeper['managePos']).toBe(false)
    expect(bookkeeper['posBuyHardware']).toBe(true)
    expect(holdsPosPermission(bookkeeper, 'posBuyHardware')).toBe(true)
    expect(mayVisitPosHardwareShop(bookkeeper)).toBe(true)
    // The register's own keys still never hold without managePos.
    for (const key of REGISTER) expect(holdsPosPermission(bookkeeper, key)).toBe(false)
    // An editor whose role takes the register and grants the shop.
    const byRole = resolveOrgPermissions(
      { role: 'editor', roleId: 'books' },
      { permissions: { managePos: false, posBuyHardware: true } },
    )
    expect(byRole['posBuyHardware']).toBe(true)
    const tier = resolveRolePermissions('editor', { managePos: false, posBuyHardware: true })
    expect(tier['posBuyHardware']).toBe(true)
    // A cashier: the register, with the shop refused.
    const cashier = resolveOrgPermissions({ role: 'editor', permissions: { posBuyHardware: false } })
    expect(cashier['managePos']).toBe(true)
    expect(holdsPosPermission(cashier, 'posBuyHardware')).toBe(false)
    expect(mayVisitPosHardwareShop(cashier)).toBe(true)
  })

  it('holds a finer action to managePos and to its own key, an absent key following managePos', () => {
    expect(holdsPosPermission({ managePos: true }, 'posRefund')).toBe(true)
    expect(holdsPosPermission({ managePos: true, posRefund: false }, 'posRefund')).toBe(false)
    expect(holdsPosPermission({ managePos: false, posRefund: true }, 'posRefund')).toBe(false)
    expect(holdsPosPermission(null, 'posSell')).toBe(false)
    expect(holdsPosPermission({ managePos: true }, 'posBuyHardware')).toBe(true)
    expect(holdsPosPermission({ managePos: false }, 'posBuyHardware')).toBe(false)
    expect(holdsPosPermission({ managePos: false, posBuyHardware: true }, 'posBuyHardware')).toBe(true)
    expect(holdsPosPermission({ managePos: true, posBuyHardware: false }, 'posBuyHardware')).toBe(false)
    expect(mayVisitPosHardwareShop({ managePos: false })).toBe(false)
    expect(mayVisitPosHardwareShop(null)).toBe(false)
  })

  it('names the key in a refusal', () => {
    expect(posPermissionRefusal('posBuyHardware')).toBe(
      'Your role does not include "Buy point of sale hardware" — ask an organization admin',
    )
  })
})

/**
 * The register is a site's own (AGL-4047): an editor of the whole workspace
 * given Viewer access to one site does not work that site's register, unless
 * the site grants it, and keeps it on every other site. The hardware shop is
 * the workspace's, so the narrowing leaves it alone.
 */
describe('a site narrows its register (AGL-4047)', () => {
  const narrowed = { role: 'editor' as const, allHosts: true, hostAccess: { 'site-a': 'viewer' as const } }
  const onSite = (member: typeof narrowed & { hostPermissions?: Record<string, Record<string, boolean>> }, hostId: string) =>
    narrowPermissionsToSite(resolveOrgPermissions(member, null), siteNarrowingFor(member, hostId))

  it('marks the register keys, and not the hardware shop, as narrowed per site', () => {
    const narrowedKeys = COMMERCE_PERMISSIONS.filter((entry) => entry.narrowsPerSite).map((entry) => entry.key)
    expect(narrowedKeys).toEqual(['managePos', ...REGISTER])
  })

  it('no register on the narrowed site, the whole register on another', () => {
    const here = onSite(narrowed, 'site-a')
    expect(here['managePos']).toBe(false)
    for (const key of REGISTER) expect(holdsPosPermission(here, key)).toBe(false)
    const there = onSite(narrowed, 'site-b')
    expect(there['managePos']).toBe(true)
    for (const key of REGISTER) expect(holdsPosPermission(there, key)).toBe(true)
  })

  it('keeps the hardware shop on the narrowed site', () => {
    const here = onSite(narrowed, 'site-a')
    expect(holdsPosPermission(here, 'posBuyHardware')).toBe(true)
    expect(mayVisitPosHardwareShop(here)).toBe(true)
  })

  it('a site that grants selling back opens the register to sell, and nothing else', () => {
    const here = onSite({ ...narrowed, hostPermissions: { 'site-a': { posSell: true } } }, 'site-a')
    expect(here['managePos']).toBe(true)
    expect(holdsPosPermission(here, 'posSell')).toBe(true)
    for (const key of REGISTER.filter((key) => key !== 'posSell')) {
      expect(holdsPosPermission(here, key)).toBe(false)
    }
  })

  it('members no site narrows keep exactly the register they had', () => {
    for (const member of [
      { role: 'owner' as const, hostAccess: { 'site-a': 'viewer' as const } },
      { role: 'admin' as const, allHosts: true },
      { role: 'editor' as const, allHosts: true },
      { role: 'editor' as const, allHosts: true, hostAccess: { 'site-a': 'editor' as const } },
      { role: 'viewer' as const, allHosts: true, permissions: { managePos: true } },
    ]) {
      expect(narrowPermissionsToSite(resolveOrgPermissions(member, null), siteNarrowingFor(member, 'site-a'))).toEqual(
        resolveOrgPermissions(member, null),
      )
    }
  })
})
