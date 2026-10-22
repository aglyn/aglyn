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
 * The warning and the refusal measure the same capacities (AGL-3080).
 *
 * Two gates read a plan change. `overLimitRows` draws the warning a customer
 * sees BEFORE choosing a smaller plan; `includedCapacity` and `heldCount`
 * drive the refusal they get if they choose anyway and the refusal of an
 * add-on reduction. They have always had to agree — "a refusal that disagreed
 * with the warning that preceded it would be worse than either alone" is
 * `over-limit.ts`'s own note — and until AGL-3080 they agreed because both
 * spelled out the same three capacities by hand, under two different
 * vocabularies.
 *
 * They now compose the same declarations, and this is what holds that: for
 * every capacity a plugin backs, both gates know it, both measure it against
 * the same entitlement field, and both produce the same number.
 *
 * Neither gate loads a plugin. `capacity-in-use` is imported here with only
 * Firestore stubbed, so the capacities it resolves are the compiled ones — the
 * state a console API route is in. A capacity that needed a registration to
 * exist would be absent from these cases, which is the whole point of
 * declaring them.
 */

export {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => ({}) }) },
  listOrgMembers: async () => [],
}))

import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { pluginOrgCapacities } from '@aglyn/aglyn/plugin-manager/plugin-org-capacity'
import { OVER_LIMIT_KINDS, overLimitRows } from '../utils/over-limit'
import {
  CAPACITY_ADDON_KINDS,
  includedCapacity,
} from '../utils/server/capacity-in-use'

/** The plan both gates are asked about. Starter includes 3 datasets. */
const PLAN = 'starter'

describe('a capacity a plugin backs is known to both gates', () => {
  it('declares at least one, or every case below proves nothing', () => {
    // The floor. With no declarations these tests iterate an empty list and
    // pass having asserted nothing — the failure mode a guard like this dies
    // of, and the one that would follow from the declarations going missing.
    expect(pluginOrgCapacities().length).toBeGreaterThan(0)
  })

  it('is listed by both, in the same order core sorts them', () => {
    for (const capacity of pluginOrgCapacities()) {
      expect([capacity.kind, OVER_LIMIT_KINDS.includes(capacity.kind)]).toEqual([
        capacity.kind,
        true,
      ])
      expect([
        capacity.addonKind,
        CAPACITY_ADDON_KINDS.includes(capacity.addonKind),
      ]).toEqual([capacity.addonKind, true])
    }
    // Core's own two come first and in their own order, so the customer reads
    // sites and seats before anything a plugin added.
    expect(OVER_LIMIT_KINDS.slice(0, 2)).toEqual(['sites', 'seats'])
  })

  it('measures the same included figure in both', () => {
    for (const capacity of pluginOrgCapacities()) {
      const included = Number(
        (PLAN_ENTITLEMENTS[PLAN] as unknown as Record<string, unknown>)[
          capacity.includedEntitlement
        ],
      )
      const [row] = overLimitRows(
        { declared: { [capacity.kind]: included + 5 } },
        PLAN,
      )
      expect([capacity.kind, row?.included]).toEqual([capacity.kind, included])
      expect([capacity.kind, row?.excess]).toEqual([capacity.kind, 5])
      expect([
        capacity.kind,
        includedCapacity(capacity.addonKind, PLAN_ENTITLEMENTS[PLAN]),
      ]).toEqual([capacity.kind, included])
    }
  })

  it('reports an unreadable count rather than omitting it', () => {
    // The reassuring failure is the dangerous one: a count nobody could read
    // must reach the customer as unchecked, not as a clean bill of health.
    for (const capacity of pluginOrgCapacities()) {
      const rows = overLimitRows({ declared: { [capacity.kind]: null } }, PLAN)
      expect([capacity.kind, rows.map((row) => row.kind)]).toEqual([
        capacity.kind,
        [capacity.kind],
      ])
      expect([capacity.kind, rows[0].count, rows[0].excess]).toEqual([
        capacity.kind,
        null,
        0,
      ])
    }
  })

  it('emits no row for a capacity nobody declared', () => {
    // A count for an invented kind is not a capacity; inventing a row for it
    // would refuse a plan change over a thing no plugin measures.
    expect(overLimitRows({ declared: { nonesuch: 9999 } }, PLAN)).toEqual([])
    expect(includedCapacity('nonesuch', PLAN_ENTITLEMENTS[PLAN])).toBe(0)
  })
})
