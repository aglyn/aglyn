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

import { resolveOrgPermissions } from '@aglyn/aglyn/app-utils/org-permissions'
import { resolveRolePermissions } from '@aglyn/aglyn/app-utils/org-roles'
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import {
  COMMERCE_PERMISSIONS,
  holdsPosPermission,
  posPermissionLabel,
  posPermissionRefusal,
  type PosPermission,
} from './plugin-permissions'

/**
 * The register's finer keys (AGL-4047), split from `managePos`: each refines
 * it with the same tier defaults, so every member keeps exactly the register
 * they had until a role or an override narrows one.
 */

const FINER: PosPermission[] = ['posSell', 'posRefund', 'posDiscount', 'posCashDrawer', 'posDevices', 'posBuyHardware']

beforeAll(() => registerPluginPermissions(COMMERCE_PERMISSIONS))

describe('the register’s finer keys (AGL-4047)', () => {
  it('declares each as a refinement of managePos with its tier defaults', () => {
    const umbrella = COMMERCE_PERMISSIONS.find((entry) => entry.key === 'managePos')
    for (const key of FINER) {
      const entry = COMMERCE_PERMISSIONS.find((candidate) => candidate.key === key)
      expect(entry?.refines).toBe('managePos')
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

  it('holds a finer action to managePos and to its own key, an absent key following managePos', () => {
    expect(holdsPosPermission({ managePos: true }, 'posRefund')).toBe(true)
    expect(holdsPosPermission({ managePos: true, posRefund: false }, 'posRefund')).toBe(false)
    expect(holdsPosPermission({ managePos: false, posRefund: true }, 'posRefund')).toBe(false)
    expect(holdsPosPermission(null, 'posSell')).toBe(false)
  })

  it('names the key in a refusal', () => {
    expect(posPermissionRefusal('posBuyHardware')).toBe(
      'Your role does not include "Buy point of sale hardware" — ask an organization admin',
    )
  })
})
