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
  AI_ADDON_CREDITS_PER_MONTH,
  PLAN_ENTITLEMENTS,
  PLAN_PRICING,
  type OrgPlan,
} from '@aglyn/aglyn'

/**
 * `aiAddonOffer` in `billing-addons-card.component.tsx`, restated: importing
 * the component drags MUI into this spec for one three-line rule.
 */
function aiAddonOffer(plan: OrgPlan): 'included' | 'upgrade' | 'sold' {
  const { aiGenerative, aiAssist } = PLAN_ENTITLEMENTS[plan].features
  if (aiGenerative && aiAssist) return 'included'
  return PLAN_PRICING[plan].aiAddonMonthlyUsd == null ? 'upgrade' : 'sold'
}

/**
 * The native "Plan add-ons" screen restates three things the console works out
 * in code, because a screen spec has no arithmetic or plan tables: which add-on
 * kinds exist, how many AI credits each plan's add-on brings, and which plan
 * has the AI add-on included rather than for sale. This keeps them from
 * drifting from `BillingAddonsCardComponent`.
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

  it('names the same AI credits per plan', () => {
    expect(screen.constants.aiCredits).toEqual(AI_ADDON_CREDITS_PER_MONTH)
  })

  it('says "Included in your plan" for exactly the plans the console does', () => {
    const included = (Object.keys(PLAN_PRICING) as OrgPlan[]).filter(
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
