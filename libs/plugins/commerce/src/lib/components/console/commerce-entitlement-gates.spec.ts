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
 * AGL-2080: every commerce feature the SERVER enforces is gated in the
 * console that configures it.
 *
 * Written as a CALL-SITE assertion, in the shape AGL-2056 established. A
 * spec that exercised `checkEntitlement` would have passed for the whole
 * period these five surfaces never called it — the endpoint was always
 * correct; the console never asked. So this reads the components and
 * asserts the wire.
 *
 * The pairing table below is the actual finding: a server enforcement point
 * with a console surface that configures the same thing. Adding a server
 * `checkEntitlement` without gating its console surface reproduces exactly
 * the defect this closes — an operator configuring something that fails at
 * checkout, to their customer rather than to them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PLAN_ENTITLEMENTS, planGrantingFeature } from '@aglyn/aglyn'

/** Console surface → the entitlement its server counterpart enforces. */
const GATED_SURFACES: Array<{ file: string; feature: string }> = [
  { file: 'reviews-moderation-card.component.tsx', feature: 'productReviews' },
  { file: 'suppliers-card.component.tsx', feature: 'dropshipRouting' },
  { file: 'member-posts-card.component.tsx', feature: 'contentGating' },
  {
    file: 'product-editor-dialog.component.tsx',
    feature: 'storefrontSubscriptions',
  },
  { file: 'product-editor-dialog.component.tsx', feature: 'giftCards' },
  // The AGL-2056 pair, kept in the same table so the set is the unit of
  // assertion rather than the file — a sibling nobody checked is how both
  // of these got here.
  { file: 'commerce-analytics-card.component.tsx', feature: 'commerceAnalytics' },
  { file: 'commerce-glance-card.component.tsx', feature: 'commerceAnalytics' },
]

function source(file: string): string {
  return readFileSync(join(__dirname, file), 'utf8')
}

describe('AGL-2080 · commerce entitlements are gated at the console', () => {
  it('asserts over a real, non-empty surface table', () => {
    // A parser or table that silently matched nothing would let every
    // per-surface check below pass by iterating an empty list.
    expect(GATED_SURFACES.length).toBeGreaterThanOrEqual(7)
    expect(new Set(GATED_SURFACES.map((s) => s.feature)).size).toBeGreaterThanOrEqual(5)
  })

  it.each(GATED_SURFACES)(
    '$file names $feature',
    ({ file, feature }) => {
      // Either quote style: the shared gate takes the flag as a JSX
      // attribute (`feature="productReviews"`), the hook takes it as a
      // string argument (`'giftCards'`). Asserting one style only would
      // have reported three surfaces as ungated while they were gated —
      // a false RED is as much a broken guard as a false green.
      expect(source(file)).toMatch(
        new RegExp(`['"]${feature}['"]`),
      )
    },
  )

  it.each(GATED_SURFACES)(
    '$file reads the entitlement rather than assuming it',
    ({ file }) => {
      const text = source(file)
      // Either it calls `checkEntitlement` itself (the AGL-2056 pair) or it
      // routes through the shared gate, which does. Both are a real read;
      // neither is a rendered-anyway surface.
      expect(
        text.includes('checkEntitlement') ||
          text.includes('useCommerceEntitlement') ||
          text.includes('EntitlementGatedCard'),
      ).toBe(true)
    },
  )

  it.each(GATED_SURFACES)(
    '$file never refuses before the plan has settled',
    ({ file }) => {
      // The loading-default trap: `checkEntitlement(undefined)` resolves the
      // FREE tier, not "unknown", so a surface that refuses on the raw call
      // tells a paying org it has not paid for a render or two.
      const text = source(file)
      const waits =
        // shared gate: `ready` is checked inside it
        text.includes('EntitlementGatedCard') ||
        text.includes('useCommerceEntitlement') ||
        // hand-rolled: must check `ready` itself
        (text.includes('useOrgPlan') && /ready/.test(text))
      expect(waits).toBe(true)
      // And the raw-call shape must not appear un-guarded in a hand-rolled
      // surface: an `if (!entitled)` with no `ready` anywhere is the bug.
      if (!text.includes('EntitlementGatedCard') && !text.includes('useCommerceEntitlement')) {
        expect(text).toMatch(/ready/)
      }
    },
  )

  it('every gated feature is a real flag on a real plan', () => {
    const flags = Object.keys(PLAN_ENTITLEMENTS.free.features)
    expect(flags.length).toBeGreaterThanOrEqual(30)
    for (const { feature } of GATED_SURFACES) {
      expect(flags).toContain(feature)
      // An upsell that cannot name a plan is a dead end, not an upgrade
      // path. Every flag gated here must be carried by some tier.
      expect(planGrantingFeature(feature as never)).toBeDefined()
    }
  })

  it('the shared gate routes its upsell through AppLink to billing', () => {
    // Never a MUI `href` — it bypasses the client router and full-reloads
    // the console.
    const gate = source('entitlement-gate.component.tsx')
    expect(gate).toContain('<AppLink')
    expect(gate).toContain('/billing')
    expect(gate).toContain('planLabelGrantingFeature')
    expect(gate).not.toMatch(/<Button[^>]*\bhref=/)
  })

  it('the shared gate holds while the plan is in flight', () => {
    const gate = source('entitlement-gate.component.tsx')
    expect(gate).toContain('useOrgPlan')
    expect(gate).toContain('if (!ready)')
    // The refusal branch must come AFTER the ready branch, or the ready
    // branch is unreachable and the guard is decorative.
    expect(gate.indexOf('if (!ready)')).toBeLessThan(gate.indexOf('if (!entitled)'))
  })

  it('the product editor locks options instead of removing them', () => {
    // Removing a MenuItem whose value a saved product still carries makes
    // the select render blank and the next edit silently rewrite the
    // product. `disabled` refuses new configuration without touching
    // existing data.
    const text = source('product-editor-dialog.component.tsx')
    expect(text).toContain('disabled={giftsLocked}')
    expect(text).toContain('disabled={subsLocked}')
    // Locked means ready AND unentitled — never the raw negation.
    expect(text).toMatch(/subsLocked\s*=\s*subs\.ready\s*&&\s*!subs\.entitled/)
    expect(text).toMatch(/giftsLocked\s*=\s*gifts\.ready\s*&&\s*!gifts\.entitled/)
    // The gift option must still be present to be disabled.
    expect(text).toContain(`<MenuItem value="gift"`)
    expect(text).toContain(`<MenuItem value="month"`)
  })
})
