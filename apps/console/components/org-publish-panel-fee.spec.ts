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
 * AGL-2078: the publisher is told what Aglyn keeps.
 *
 * `marketplaceFeePct` moved money on every sale — 20% paid, 30% free — and
 * appeared in exactly one console surface, the STAFF override table. This
 * asserts the customer half exists and, more importantly, that it is
 * computed rather than transcribed: a hard-coded "20%" in the panel is a
 * second copy of a rate that bills, free to drift from the one that does.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PLAN_ENTITLEMENTS, resolveMarketplaceFeePct } from '@aglyn/aglyn'

import { code } from '../specs/source-text'

const PANEL = code(
  readFileSync(join(__dirname, 'org-publish-panel.component.tsx'), 'utf8'),
  'org-publish-panel.component.tsx',
)

describe('the publish panel discloses the platform cut', () => {
  it('reads the rate from the helper the checkout deducts with', () => {
    expect(PANEL).toContain('resolveMarketplaceFeePct')
    // Interpolated, never written out. A literal percentage would survive
    // every future pricing change silently.
    expect(PANEL).toContain('${feePct}%')
    expect(PANEL).not.toMatch(/keeps 20% of each sale/)
    expect(PANEL).not.toMatch(/keeps 30% of each sale/)
  })

  it('waits for the org doc before naming a rate', () => {
    // `resolveMarketplaceFeePct(undefined)` returns the FREE-plan rate, so
    // rendering during load tells a paying publisher they are on 30%.
    expect(PANEL).toContain('orgReady ?')
  })

  it('compares against the paid rate from the table, not a literal', () => {
    expect(PANEL).toContain('PLAN_ENTITLEMENTS.starter.marketplaceFeePct')
  })

  it('the free rate really is worse than the paid one', () => {
    // The panel only shows the comparison when `feePct > paidFeePct`. If
    // the tiers ever converged, that branch would be dead and this spec
    // would be asserting about copy nobody sees.
    expect(PLAN_ENTITLEMENTS.free.marketplaceFeePct).toBeGreaterThan(
      PLAN_ENTITLEMENTS.starter.marketplaceFeePct,
    )
    expect(resolveMarketplaceFeePct(undefined)).toBe(
      PLAN_ENTITLEMENTS.free.marketplaceFeePct,
    )
  })
})
