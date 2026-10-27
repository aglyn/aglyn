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
  ORG_PERMISSION_REFINEMENTS,
  orgPermissionDefinition,
  projectMemberResolvedPermissions,
  resolveOrgPermissions,
} from './org-permissions'
import { resolveRolePermissions } from './org-roles'
import { explainOrgPermissions } from './org-permission-editor'
import { assembleOrgRoleGrants, ORG_ROLE_GRANTS, rolePermissions } from './org-role-grants'
import { registerPluginEntitlements } from '../plugin-manager/plugin-entitlements'
import {
  pluginPermissionRefinements,
  refinePermissionMap,
  registerPluginPermissions,
} from '../plugin-manager/plugin-permissions'

/**
 * A key that REFINES a broader one (AGL-4047): a finer part of it, such as
 * one action of a register the broader key opens. It is never held without
 * that key, and where no custom role or override sets it, it follows that
 * key — so splitting a key into finer ones leaves every member with exactly
 * the access they had.
 */

const TIER = { admin: true, editor: true, viewer: false }

beforeAll(() => {
  registerPluginPermissions([
    { key: 'useTill', pluginId: 'shop', label: 'Use the till', defaults: TIER },
    { key: 'tillRefund', pluginId: 'shop', label: 'Till refunds', defaults: TIER, refines: 'useTill' },
    { key: 'tillBigRefund', pluginId: 'shop', label: 'Big refunds', defaults: TIER, refines: 'tillRefund' },
    { key: 'tillNowhere', pluginId: 'shop', label: 'Refines nothing known', defaults: TIER, refines: 'noSuchKey' },
    // Follows the till without needing it: ordering till paper is not ringing sales.
    { key: 'tillSupplies', pluginId: 'shop', label: 'Order till supplies', defaults: TIER, follows: 'useTill' },
    { key: 'tillLost', pluginId: 'shop', label: 'Follows nothing known', defaults: TIER, follows: 'noSuchKey' },
  ])
  registerPluginEntitlements({
    pluginId: 'desk',
    orgPermissions: [
      {
        key: 'desk.use',
        label: 'Use the desk',
        description: 'Open it.',
        roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
      },
      {
        key: 'desk.close',
        label: 'Close the desk',
        description: 'Close it.',
        roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
        refines: 'desk.use',
      },
      {
        key: 'desk.order',
        label: 'Order for the desk',
        description: 'Order its supplies.',
        roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
        follows: 'desk.use',
      },
    ],
  })
})

describe('permission refinements (AGL-4047)', () => {
  it('carries a refinement from either declaration API into the catalog, and drops one to an unknown key', () => {
    expect(ORG_PERMISSION_REFINEMENTS).toEqual(
      expect.arrayContaining([
        ['tillRefund', 'useTill'],
        ['tillBigRefund', 'tillRefund'],
        ['desk.close', 'desk.use'],
      ]),
    )
    expect(ORG_PERMISSION_REFINEMENTS.map(([key]) => key)).not.toContain('tillNowhere')
    expect(orgPermissionDefinition('tillRefund')?.refines).toBe('useTill')
    expect(orgPermissionDefinition('tillNowhere')?.refines).toBeUndefined()
    expect(pluginPermissionRefinements()).toEqual(
      expect.arrayContaining([['tillRefund', 'useTill']]),
    )
  })

  it('leaves every member with the access the broader key gives them when nothing sets the finer one', () => {
    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      const granted = resolveOrgPermissions({ role })
      expect(granted['tillRefund']).toBe(granted['useTill'])
      expect(granted['tillBigRefund']).toBe(granted['useTill'])
      const tier = resolveRolePermissions(role === 'owner' ? 'admin' : role)
      expect(tier['tillRefund']).toBe(tier['useTill'])
    }
  })

  it('follows the broader key wherever a custom role or an override moves it', () => {
    // An override hands a viewer the till: its refund follows.
    expect(resolveOrgPermissions({ role: 'viewer', permissions: { useTill: true } })['tillRefund']).toBe(true)
    expect(resolveRolePermissions('viewer', { useTill: true })['tillRefund']).toBe(true)
    // A custom role takes it from an editor: so goes the refund.
    expect(
      resolveOrgPermissions({ role: 'editor', roleId: 'r1' }, { permissions: { useTill: false } })['tillRefund'],
    ).toBe(false)
    // …and a custom role on the per-tier resolver's own shape.
    expect(
      resolveRolePermissions('cashier', null, { cashier: { name: 'Cashier', permissions: { useTill: true } } })[
        'tillRefund'
      ],
    ).toBe(true)
  })

  it('narrows on its own, and is never held without the broader key', () => {
    const narrowed = resolveOrgPermissions({ role: 'editor', permissions: { tillRefund: false } })
    expect(narrowed['useTill']).toBe(true)
    expect(narrowed['tillRefund']).toBe(false)
    // A chain settles in one pass: the finer key under the narrowed one goes too.
    expect(narrowed['tillBigRefund']).toBe(false)
    expect(resolveRolePermissions('editor', { tillRefund: false })['tillBigRefund']).toBe(false)
    // An allow on the finer key does not open the till itself.
    const held = resolveOrgPermissions({ role: 'viewer', permissions: { tillRefund: true } })
    expect(held['useTill']).toBe(false)
    expect(held['tillRefund']).toBe(false)
    expect(resolveRolePermissions('viewer', { tillRefund: true })['tillRefund']).toBe(false)
    // The override beats the custom role, then the broader key decides.
    expect(
      resolveOrgPermissions(
        { role: 'editor', roleId: 'r1', permissions: { tillRefund: true } },
        { permissions: { tillRefund: false } },
      )['tillRefund'],
    ).toBe(true)
  })

  it('refines a catalog declaration the same way', () => {
    expect(resolveOrgPermissions({ role: 'admin' })['desk.close']).toBe(true)
    expect(resolveOrgPermissions({ role: 'editor', permissions: { 'desk.use': true } })['desk.close']).toBe(true)
    expect(resolveOrgPermissions({ role: 'admin', permissions: { 'desk.use': false } })['desk.close']).toBe(false)
  })

  it('stamps the refined verdict for the rules', () => {
    expect(projectMemberResolvedPermissions({ role: 'editor', permissions: { useTill: false } })).toMatchObject({
      useTill: false,
      tillRefund: false,
    })
  })

  it('explains a followed key and one the broader key holds back', () => {
    const explained = explainOrgPermissions({ role: 'viewer', permissions: { tillRefund: true } })
    expect(explained['tillRefund']).toMatchObject({
      granted: false,
      source: 'override',
      refines: 'useTill',
      heldBy: 'useTill',
    })
    expect(explainOrgPermissions({ role: 'editor' })['tillRefund']).toMatchObject({
      granted: true,
      source: 'refines',
      refines: 'useTill',
    })
    expect(explainOrgPermissions({ role: 'editor' })['tillRefund'].heldBy).toBeUndefined()
  })

  it('carries the refinement to the native apps’ table, whose resolver applies it the same way', () => {
    const table = assembleOrgRoleGrants(ORG_ROLE_GRANTS, [
      { key: 'useTill', label: 'Use the till', pluginId: 'shop', defaults: TIER },
      { key: 'tillRefund', label: 'Till refunds', pluginId: 'shop', defaults: TIER, refines: 'useTill' },
    ])
    expect(table.permissions.find((entry) => entry.key === 'tillRefund')?.refines).toBe('useTill')
    expect(table.permissions.find((entry) => entry.key === 'useTill')?.refines).toBeUndefined()
    expect(rolePermissions(table, 'editor')['tillRefund']).toBe(true)
    expect(rolePermissions(table, 'viewer', null, { permissions: { useTill: true } })['tillRefund']).toBe(true)
    expect(rolePermissions(table, 'editor', { permissions: { useTill: false } })['tillRefund']).toBe(false)
    expect(rolePermissions(table, 'viewer', null, { permissions: { tillRefund: true } })['tillRefund']).toBe(false)
    expect(rolePermissions(table, 'editor', null, { permissions: { tillRefund: false } })).toMatchObject({
      useTill: true,
      tillRefund: false,
    })
  })

  it('carries a key that only follows from either declaration API, and drops one to an unknown key', () => {
    expect(ORG_PERMISSION_REFINEMENTS).toEqual(
      expect.arrayContaining([
        ['tillSupplies', 'useTill', 'follows'],
        ['desk.order', 'desk.use', 'follows'],
      ]),
    )
    expect(ORG_PERMISSION_REFINEMENTS.map(([key]) => key)).not.toContain('tillLost')
    expect(orgPermissionDefinition('tillSupplies')).toMatchObject({ follows: 'useTill' })
    expect(orgPermissionDefinition('tillSupplies')?.refines).toBeUndefined()
    expect(orgPermissionDefinition('tillLost')?.follows).toBeUndefined()
    expect(pluginPermissionRefinements()).toEqual(
      expect.arrayContaining([['tillSupplies', 'useTill', 'follows']]),
    )
  })

  it('follows the key where nothing sets it, on every resolver, and is granted on its own', () => {
    for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
      expect(resolveOrgPermissions({ role })['tillSupplies']).toBe(resolveOrgPermissions({ role })['useTill'])
      const tier = resolveRolePermissions(role === 'owner' ? 'admin' : role)
      expect(tier['tillSupplies']).toBe(tier['useTill'])
    }
    // Moved with the till by a custom role or an override, as a refinement is.
    expect(resolveOrgPermissions({ role: 'viewer', permissions: { useTill: true } })['tillSupplies']).toBe(true)
    expect(
      resolveOrgPermissions({ role: 'editor', roleId: 'r1' }, { permissions: { useTill: false } })['tillSupplies'],
    ).toBe(false)
    // Unlike a refinement, granted without the till…
    const books = resolveOrgPermissions({ role: 'viewer', permissions: { tillSupplies: true } })
    expect(books).toMatchObject({ useTill: false, tillSupplies: true })
    expect(resolveRolePermissions('viewer', { tillSupplies: true })['tillSupplies']).toBe(true)
    expect(
      resolveOrgPermissions({ role: 'editor', roleId: 'r1' }, { permissions: { useTill: false, tillSupplies: true } })[
        'tillSupplies'
      ],
    ).toBe(true)
    expect(
      resolveRolePermissions('books', null, {
        books: { name: 'Books', permissions: { useTill: false, tillSupplies: true } },
      })['tillSupplies'],
    ).toBe(true)
    // …and refused beside it.
    expect(resolveOrgPermissions({ role: 'editor', permissions: { tillSupplies: false } })).toMatchObject({
      useTill: true,
      tillSupplies: false,
    })
    expect(resolveOrgPermissions({ role: 'viewer', permissions: { 'desk.order': true } })['desk.order']).toBe(true)
    expect(resolveOrgPermissions({ role: 'admin', permissions: { 'desk.use': false } })['desk.order']).toBe(false)
    expect(projectMemberResolvedPermissions({ role: 'viewer', permissions: { tillSupplies: true } })).toMatchObject({
      useTill: false,
      tillSupplies: true,
    })
  })

  it('explains a key that follows, and never says the followed key holds it back', () => {
    expect(explainOrgPermissions({ role: 'editor' })['tillSupplies']).toMatchObject({
      granted: true,
      source: 'follows',
      follows: 'useTill',
    })
    const own = explainOrgPermissions({ role: 'viewer', permissions: { tillSupplies: true } })['tillSupplies']
    expect(own).toMatchObject({ granted: true, source: 'override', follows: 'useTill' })
    expect(own.heldBy).toBeUndefined()
  })

  it('carries a key that follows to the native apps’ table, whose resolver applies it the same way', () => {
    const table = assembleOrgRoleGrants(ORG_ROLE_GRANTS, [
      { key: 'useTill', label: 'Use the till', pluginId: 'shop', defaults: TIER },
      { key: 'tillSupplies', label: 'Order till supplies', pluginId: 'shop', defaults: TIER, follows: 'useTill' },
    ])
    expect(table.permissions.find((entry) => entry.key === 'tillSupplies')).toMatchObject({ follows: 'useTill' })
    expect(table.permissions.find((entry) => entry.key === 'tillSupplies')?.refines).toBeUndefined()
    expect(rolePermissions(table, 'editor')['tillSupplies']).toBe(true)
    expect(rolePermissions(table, 'viewer', null, { permissions: { useTill: true } })['tillSupplies']).toBe(true)
    expect(rolePermissions(table, 'editor', { permissions: { useTill: false } })['tillSupplies']).toBe(false)
    expect(rolePermissions(table, 'viewer', null, { permissions: { tillSupplies: true } })).toMatchObject({
      useTill: false,
      tillSupplies: true,
    })
    expect(rolePermissions(table, 'editor', null, { permissions: { tillSupplies: false } })['tillSupplies']).toBe(false)
  })

  it('leaves a key that follows as a map already resolved it', () => {
    expect(
      refinePermissionMap({ useTill: false, tillSupplies: true }, [['tillSupplies', 'useTill', 'follows']]),
    ).toEqual({ useTill: false, tillSupplies: true })
    expect(
      refinePermissionMap({ useTill: true, tillSupplies: false }, [['tillSupplies', 'useTill', 'follows']], [{}]),
    ).toEqual({ useTill: true, tillSupplies: true })
  })

  it('holds a map already resolved with every layer to its broader keys, and drops a loop', () => {
    expect(
      refinePermissionMap({ useTill: false, tillRefund: true, tillBigRefund: true }, [
        ['tillBigRefund', 'tillRefund'],
        ['tillRefund', 'useTill'],
      ]),
    ).toEqual({ useTill: false, tillRefund: false, tillBigRefund: false })
    expect(refinePermissionMap({ useTill: true, tillRefund: false }, [['tillRefund', 'useTill']])).toEqual({
      useTill: true,
      tillRefund: false,
    })
    // A refinement that loops back is not resolved at all.
    expect(refinePermissionMap({ a: true, b: false }, [['a', 'b'], ['b', 'a']])).toEqual({ a: true, b: false })
    // No refinement, no copy.
    const map = { a: true }
    expect(refinePermissionMap(map, [])).toBe(map)
  })
})
