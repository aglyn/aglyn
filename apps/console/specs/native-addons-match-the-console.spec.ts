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
  planSellsAiTiers,
  type OrgPlan,
} from '@aglyn/aglyn'

/**
 * `aiAddonOffer` in `billing-addons-card.component.tsx`, restated: importing
 * the component drags MUI into this spec for one three-line rule.
 */
function aiAddonOffer(plan: OrgPlan): 'included' | 'upgrade' | 'sold' {
  if (planSellsAiTiers(plan)) return 'sold'
  return isCustomPricedPlan(plan) ? 'included' : 'upgrade'
}

/**
 * The native "Plan add-ons" screen restates what the console works out in
 * code, because a screen spec has no arithmetic or plan tables: which add-on
 * kinds exist, and which plan has Aglyn AI included rather than for sale.
 * Since AGL-3965 it restates no credit figure of its own: the credits a tier
 * adds are read off the route (`catalog.aiAddon.credits`), so a tier the
 * workspace holds is the one the row describes.
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
})
