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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADDON_KINDS } from '@aglyn/tenant-data-admin/server/billing-addons'
import {
  isCustomPricedPlan,
  PLAN_ENTITLEMENTS,
  planSellsAiCredits,
  type OrgPlan,
} from '@aglyn/aglyn'

/**
 * `aiAddonOffer` in `billing-addons-card.component.tsx`, restated: importing
 * the component drags MUI into this spec for one three-line rule.
 */
function aiAddonOffer(plan: OrgPlan): 'included' | 'upgrade' | 'sold' {
  if (planSellsAiCredits(plan)) return 'sold'
  return isCustomPricedPlan(plan) ? 'included' : 'upgrade'
}

/**
 * The native "Plan add-ons" screen restates what the console works out in
 * code, because a screen spec has no arithmetic or plan tables: which add-on
 * kinds exist, and which plan has Aglyn AI included rather than for sale.
 * It restates no credit figure of its own: the credits are read off the
 * route (`catalog.aiAddon.credits`), which since AGL-4144 is what ONE credit
 * block adds — 5,000 — so the row describes what its one purchase buys.
 */
const SPEC = join(
  __dirname,
  '../../../libs/native/screens/billing.screens.json',
)

const screen = (JSON.parse(readFileSync(SPEC, 'utf8')).screens as any[]).find(
  (s) => s.id === 'core.billing.addons',
)

describe('native plan add-ons', () => {
  it('lists every add-on kind the route sells, in the console order', () => {
    expect(screen.constants.addons.map((row: { kind: string }) => row.kind)).toEqual([
      ...ADDON_KINDS,
    ])
  })

  it('reads the AI credits off the route, not a per-plan table', () => {
    expect(screen.constants.aiCredits).toBeUndefined()
    const badges = screen.blocks.find((b: { type: string }) => b.type === 'list').badges
    const credits = badges.find((b: { text: string }) => /credits\/mo/.test(b.text))
    expect(credits.text).toBe('+{data.addons.catalog[@item.kind].credits:number} credits/mo')
    expect(credits.when).toBe('item.kind == aiAddon && data.addons.catalog[@item.kind].credits')
    // The row says one pool, as the console's `aiAddonDescription` does.
    const ai = screen.constants.addons.find((row: { kind: string }) => row.kind === 'aiAddon')
    expect(ai.description).toContain('one pool of AI credits')
    expect(ai.description).not.toMatch(/\{const\./)
  })

  it('can post a retired tier only behind the route\'s tier list, which the route no longer sends', () => {
    // The add-ons route answers `catalog` and `quantities` and NO `aiTiers`
    // since AGL-4144 (and refuses any `tier` with `ai_tier_retired`). So every
    // native control whose request names a `tier` must be gated on
    // `data.addons.aiTiers`, or the screen could offer a purchase the route
    // refuses. Holds vacuously once the native lane removes the tier control.
    const actions = screen.blocks.find((b: { type: string }) => b.type === 'list').actions ?? []
    const postsTier = actions.filter(
      (action: { body?: Record<string, unknown>; check?: { body?: Record<string, unknown> } }) =>
        'tier' in (action.body ?? {}) || 'tier' in (action.check?.body ?? {}),
    )
    for (const action of postsTier) {
      expect(`${action.id}: ${action.when}`).toMatch(/data\.addons\.aiTiers/)
    }
  })

  it('says "Included in your plan" for exactly the plans the console does', () => {
    const included = (Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]).filter(
      (plan) => aiAddonOffer(plan) === 'included',
    )
    // The badge is keyed on the plan being enterprise.
    expect(included).toEqual(['enterprise'])
    const badge = screen.blocks
      .find((b: { type: string }) => b.type === 'list')
      .badges.find(
        (b: { text: string }) => b.text === 'Included in your plan',
      )
    expect(badge.when).toBe('item.kind == aiAddon && data.addons.plan == enterprise')
    expect(PLAN_ENTITLEMENTS.enterprise.features.aiGenerative).toBe(true)
  })

  /*
   * What the native add-ons screen still has of the retired tiers (AGL-4144).
   * Not asserted either way — the console is the stepper — and owed by the
   * native lane. Until then the AI row's switch buys ONE block ($10, 5,000
   * credits, both read off the route), which is a true purchase, just not
   * the whole range.
   */
  it.todo(
    'native lane (AGL-4144): the AI row is `toggle: true` (0/1); the console sells 0–30 blocks ' +
      'with a stepper and "With N blocks: X AI credits a month in all."',
  )
  it.todo(
    'native lane (AGL-4144): the AI row\'s description still says "an Aglyn AI tier adds more on top"; ' +
      'the console says "Add blocks on top: 5,000 credits each, $10 a month per block, up to 30."',
  )
  it.todo(
    'native lane (AGL-4144): the "{item.label} tier" action (tier picker reading `aiTiers`, posting `tier`) ' +
      'is dead and should go',
  )
})
