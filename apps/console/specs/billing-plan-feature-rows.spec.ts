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
 * AGL-2079: the plan comparison checklist covers EVERY entitlement flag.
 *
 * The expected set is derived from `PLAN_ENTITLEMENTS.free.features` — the
 * source of truth — and never from a list written here. A guard holding its
 * own copy of the row names is the same artifact as the bug: `FEATURE_ROWS`
 * decayed to 19 of 34 precisely because nothing tied it back to the flags,
 * and a spec with a hand-typed expectation would have decayed alongside it in
 * the same commit.
 *
 * So the only way to satisfy this file is to add the row or to add an
 * exclusion with a written reason. Both are decisions; neither is silence.
 */

import {
  FEATURE_ROWS,
  FEATURE_ROW_EXCLUSIONS,
} from '../components/billing/billing-plan-cards.component'
import { PLAN_ENTITLEMENTS } from '@aglyn/aglyn'

const ALL_FLAGS = Object.keys(PLAN_ENTITLEMENTS.free.features) as Array<
  keyof (typeof PLAN_ENTITLEMENTS)['free']['features']
>

describe('AGL-2079 · every entitlement flag is listed or excluded', () => {
  it('reads a real flag set from PLAN_ENTITLEMENTS', () => {
    // Assert the source produced something before asserting over it. A
    // rename of `features` would leave ALL_FLAGS empty and every
    // set-difference below would pass by comparing nothing to nothing —
    // the shape of green check that proves only what it read.
    expect(ALL_FLAGS.length).toBeGreaterThanOrEqual(30)
    expect(ALL_FLAGS).toContain('ssoEnabled')
    expect(ALL_FLAGS).toContain('commerce')
  })

  it('has no flag that is neither a row nor an exclusion', () => {
    const listed = new Set(FEATURE_ROWS.map((row) => row.key))
    const excluded = new Set(Object.keys(FEATURE_ROW_EXCLUSIONS))
    const orphans = ALL_FLAGS.filter(
      (flag) => !listed.has(flag) && !excluded.has(flag),
    )
    expect(orphans).toEqual([])
  })

  it('covers the flags AGL-2079 found missing', () => {
    // The specific regression, named. The set-difference above is the
    // general guard; this is the one that fails loudly if someone "fixes"
    // the guard by moving these into the exclusion list instead.
    const listed = new Set(FEATURE_ROWS.map((row) => row.key))
    for (const flag of [
      'abTesting',
      'apiAccess',
      'commerce',
      'pos',
      'storefrontSubscriptions',
      'contentGating',
      'giftCards',
      'productReviews',
      'abandonedCart',
      'dropshipRouting',
      'commerceAnalytics',
      'whiteLabel',
      'ssoEnabled',
    ] as const) {
      expect(listed.has(flag)).toBe(true)
    }
  })

  it('lists no row that is not a real flag', () => {
    const real = new Set<string>(ALL_FLAGS)
    expect(FEATURE_ROWS.filter((row) => !real.has(row.key))).toEqual([])
  })

  it('gives every exclusion a written reason', () => {
    const entries = Object.entries(FEATURE_ROW_EXCLUSIONS)
    expect(entries.length).toBeGreaterThan(0)
    for (const [flag, reason] of entries) {
      expect(typeof reason).toBe('string')
      // Long enough to be a reason rather than a placeholder.
      expect((reason as string).length).toBeGreaterThan(30)
      expect(ALL_FLAGS).toContain(flag)
    }
  })

  it('never lists the same flag twice', () => {
    const keys = FEATURE_ROWS.map((row) => row.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never both lists and excludes a flag', () => {
    const listed = new Set(FEATURE_ROWS.map((row) => row.key))
    const both = Object.keys(FEATURE_ROW_EXCLUSIONS).filter((flag) =>
      listed.has(flag as never),
    )
    expect(both).toEqual([])
  })

  it('gives every row a non-empty label', () => {
    expect(FEATURE_ROWS.length).toBeGreaterThanOrEqual(28)
    for (const row of FEATURE_ROWS) expect(row.label.trim()).not.toBe('')
  })
})
