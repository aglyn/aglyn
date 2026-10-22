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
 * The permission gate's edges, stated where they can be stated exactly.
 *
 * `plugin-surface-permission-gate.spec.tsx` drives this through the real
 * route with a real member document, which is where the gate has to be
 * proven. What that cannot show cleanly is which of the two key spaces a
 * lookup went through — a member document that grants a key grants it in
 * both maps at once, so a gate that consulted the wrong one would still
 * answer correctly for every real member. The cases below split the two
 * sources so they DISAGREE, and pin which one wins for which kind of key.
 */

import type { OrgPermission } from '@aglyn/aglyn'
import {
  requiredExtensionPermissions,
  resolveExtensionPermission,
  type PermissionAnswers,
} from './extension-permission'

/** Answers where the two key spaces can be made to disagree on purpose. */
const answers = (
  overrides: Partial<PermissionAnswers> = {},
): PermissionAnswers => ({
  can: () => false,
  permissions: {},
  loaded: true,
  ...overrides,
})

describe('what a surface requires', () => {
  it('collects the extension’s key and the nav item’s', () => {
    expect(
      requiredExtensionPermissions(
        { permission: 'data.manage' },
        { permission: 'managePos' },
      ),
    ).toEqual(['data.manage', 'managePos'])
  })

  it('is empty when neither declares one', () => {
    expect(requiredExtensionPermissions({}, {})).toEqual([])
    expect(requiredExtensionPermissions(undefined, undefined)).toEqual([])
  })

  it('ignores a blank declaration rather than requiring the empty string', () => {
    // A key nothing can hold would refuse every reader, which is a surface
    // taken offline by a stray quote rather than a decision anybody made.
    expect(requiredExtensionPermissions({ permission: '  ' }, {})).toEqual([])
  })
})

describe('a surface that declares nothing', () => {
  it('is granted', () => {
    expect(resolveExtensionPermission([], answers())).toBe('granted')
  })

  it('is granted WITHOUT waiting on the member read', () => {
    // Most console surfaces are open to every member of the workspace.
    // Holding them behind a document they do not need would be a spinner in
    // front of an answer that was never in doubt.
    expect(resolveExtensionPermission([], answers({ loaded: false }))).toBe(
      'granted',
    )
  })
})

describe('an unsettled member read', () => {
  it('is `pending` — neither the surface nor a refusal', () => {
    // The console's permission map is the permissive ADMIN map until the
    // member document lands, so reading it here would grant; refusing here
    // accuses a legitimate admin on every navigation.
    expect(
      resolveExtensionPermission(
        ['data.manage'],
        answers({ can: () => true, loaded: false }),
      ),
    ).toBe('pending')
  })

  it('stays `pending` when `loaded` is not a boolean at all', () => {
    // `strictNullChecks` is off repo-wide, so an absent flag arrives as
    // `undefined` — which must mean "unknown", never "ready".
    expect(
      resolveExtensionPermission(
        ['data.manage'],
        answers({ loaded: undefined as never }),
      ),
    ).toBe('pending')
  })
})

describe('the two key spaces are looked up separately', () => {
  it('answers a DOTTED key from `can`, ignoring the camelCase map', () => {
    // The dotted catalog is what custom roles and per-member overrides are
    // stored in. Feeding a dotted key to the camelCase map matches nothing
    // and reads back `undefined`, which is the trap `toLegacyPermissions`
    // documents — so make the two disagree and pin which one governs.
    expect(
      resolveExtensionPermission(
        ['data.manage'],
        answers({
          can: () => true,
          permissions: { 'data.manage': false },
        }),
      ),
    ).toBe('granted')
    expect(
      resolveExtensionPermission(
        ['data.manage'],
        answers({
          can: () => false,
          permissions: { 'data.manage': true },
        }),
      ),
    ).toBe('refused')
  })

  it('answers a PLUGIN key from the map, ignoring `can`', () => {
    expect(
      resolveExtensionPermission(
        ['managePos'],
        answers({ can: () => false, permissions: { managePos: true } }),
      ),
    ).toBe('granted')
    expect(
      resolveExtensionPermission(
        ['managePos'],
        answers({ can: () => true, permissions: { managePos: false } }),
      ),
    ).toBe('refused')
  })

  it('passes the dotted key through to `can` verbatim', () => {
    // A gate that translated, lower-cased or stripped the key would answer
    // from the wrong entry and the assertions above would still pass.
    const seen: OrgPermission[] = []
    resolveExtensionPermission(
      ['billing.manage'],
      answers({
        can: (key) => {
          seen.push(key)
          return true
        },
      }),
    )
    expect(seen).toEqual(['billing.manage'])
  })
})

describe('a key nothing can answer', () => {
  it('REFUSES rather than passing', () => {
    // A typo, or a plugin whose `registerPluginPermissions` never ran.
    // Granting would make a broken gate indistinguishable from no gate.
    expect(
      resolveExtensionPermission(
        ['manageContactz'],
        answers({ can: () => true }),
      ),
    ).toBe('refused')
  })

  it('refuses even when the map is absent entirely', () => {
    expect(
      resolveExtensionPermission(
        ['managePos'],
        answers({ permissions: undefined }),
      ),
    ).toBe('refused')
  })

  it('refuses a key whose value is present but not a boolean', () => {
    // `undefined` and a truthy string are both "the map does not answer
    // this", and neither is a grant.
    expect(
      resolveExtensionPermission(
        ['managePos'],
        answers({ permissions: { managePos: 'yes' as never } }),
      ),
    ).toBe('refused')
  })
})

describe('requirements compose by AND', () => {
  it('refuses when any declared key is not held', () => {
    expect(
      resolveExtensionPermission(
        ['data.manage', 'managePos'],
        answers({ can: () => true, permissions: { managePos: false } }),
      ),
    ).toBe('refused')
    expect(
      resolveExtensionPermission(
        ['data.manage', 'managePos'],
        answers({ can: () => false, permissions: { managePos: true } }),
      ),
    ).toBe('refused')
  })

  it('CONTROL: grants when every declared key is held', () => {
    expect(
      resolveExtensionPermission(
        ['data.manage', 'managePos'],
        answers({ can: () => true, permissions: { managePos: true } }),
      ),
    ).toBe('granted')
  })
})
