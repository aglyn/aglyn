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
  AI_CREDIT_BLOCK_TERMS,
  AI_CREDIT_BLOCKS_MAX,
  AI_CREDITS_PER_BLOCK,
  aiCreditBlocksLabel,
  includedAiCreditsPerMonth,
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
 * `aiAddonDescription(null)` and `aiAddonIncludedLine` from the same file,
 * restated for the same reason. The description is the plan-free sentence:
 * the plan's own figure is in the stepper's line, which moves with the count.
 */
const aiAddonDescription =
  'Questions, copy, generated pages, emails, campaigns and products all ' +
  'draw on one pool of AI credits. ' +
  `Add blocks on top: ${AI_CREDIT_BLOCK_TERMS}, up to ${AI_CREDIT_BLOCKS_MAX}.`
function aiAddonIncludedLine(plan: OrgPlan, blocks: number): string {
  const total = includedAiCreditsPerMonth(PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth, blocks)
  const amount = `${total.toLocaleString()} AI credits a month`
  return blocks > 0
    ? `With ${aiCreditBlocksLabel(blocks)}: ${amount} in all.`
    : `With no blocks: ${amount}, your plan's own.`
}

/**
 * The native "Plan add-ons" screen restates what the console works out in
 * code, because a screen spec has no arithmetic or plan tables: which add-on
 * kinds exist, and which plan has Aglyn AI included rather than for sale.
 * The credits a block adds and its price are read off the route
 * (`catalog.aiAddon.credits`, `unitUsd`); the screen restates only each
 * selling plan's own included band and the block ceiling (AGL-4155).
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

  it('describes the AI row in the console\'s words, and reads a block\'s credits off the route', () => {
    expect(screen.constants.aiCredits).toBeUndefined()
    const ai = screen.constants.addons.find((row: { kind: string }) => row.kind === 'aiAddon')
    expect(ai.label).toBe('Aglyn AI credits')
    expect(ai.description).toBe(aiAddonDescription)
    // A stepper, not a switch (AGL-4155).
    expect(ai.toggle).toBe(false)
    const badges = screen.blocks.find((b: { type: string }) => b.type === 'list').badges
    const held = badges.filter((b: { text: string }) => /credits a month$/.test(b.text))
    expect(held.map((b: { text: string }) => b.text)).toEqual([
      '1 block · {data.addons.catalog[@item.kind].credits:number} credits a month',
      '{data.addons.quantities[@item.kind]} blocks · ' +
        '{data.addons.quantities[@item.kind] * data.addons.catalog[@item.kind].credits:number} credits a month',
    ])
    // Free points at the plan grid in the add-on's own name, as the console's link does.
    expect(badges.map((b: { text: string }) => b.text)).toContain('Upgrade your plan to add Aglyn AI')
  })

  describe('the AI credits stepper', () => {
    const actions = screen.blocks.find((b: { type: string }) => b.type === 'list').actions
    const blocks = actions.find((a: { id: string }) => a.id === 'blocks')
    const field = blocks.prompt[0]

    it('steps whole blocks from 0 to the console\'s ceiling', () => {
      expect(field.kind).toBe('stepper')
      expect(field.integer).toBe(true)
      expect(field.min).toBe(0)
      expect(field.max).toBe(AI_CREDIT_BLOCKS_MAX)
      expect(field.mustChange).toBe(true)
      expect(field.unit).toEqual({ one: 'block', other: 'blocks' })
      expect(blocks.body).toEqual({
        orgId: '{org.id}',
        action: 'set',
        kind: '{item.kind}',
        quantity: '{form.blocks}',
      })
      expect(blocks.check.body.quantity).toBe('{form.blocks}')
    })

    it('knows each selling plan\'s own included band', () => {
      const sold = (Object.keys(PLAN_ENTITLEMENTS) as OrgPlan[]).filter((plan) => planSellsAiCredits(plan))
      expect(Object.keys(screen.constants.aiCreditsIncluded).sort()).toEqual([...sold].sort())
      for (const plan of sold) {
        expect(screen.constants.aiCreditsIncluded[plan]).toBe(
          PLAN_ENTITLEMENTS[plan].assistCreditsPerMonth,
        )
      }
    })

    it.each([0, 1, 3, 30])('says the console\'s line under the stepper for %i block(s)', (count) => {
      const when = count === 0 ? 'form.blocks == 0' : count === 1 ? 'form.blocks == 1' : 'form.blocks > 1'
      const part = field.says.filter((p: { when: string }) => p.when === when)
      expect(part).toHaveLength(1)
      for (const plan of ['starter', 'pro'] as OrgPlan[]) {
        // The screen's arithmetic, done as its renderer does it, over the route's credits per block.
        const total = screen.constants.aiCreditsIncluded[plan] + count * AI_CREDITS_PER_BLOCK
        const rendered = part[0].text
          .replace('{form.blocks}', String(count))
          .replace(/\{const\.aiCreditsIncluded[^}]*:number\}/, total.toLocaleString('en-US'))
        expect(rendered).toBe(aiAddonIncludedLine(plan, count))
      }
    })

    it('confirms in blocks, as the console\'s confirm does', () => {
      const texts = blocks.confirm.map((p: { text: string }) => p.text)
      expect(texts).toContain('{item.label}: 1 block? ')
      expect(texts).toContain('{item.label}: {form.blocks} blocks? ')
      expect(texts).toContain('${form.blocks * data.addons.catalog[@item.kind].unitUsd}/mo')
      expect(texts).toContain(
        ", adding {form.blocks * data.addons.catalog[@item.kind].credits:number} AI credits a month on top of your plan's.",
      )
    })

    it('says when a lower count takes effect, as the console\'s snackbar does', () => {
      expect(blocks.report.map((p: { text: string }) => p.text)).toEqual([
        '{item.label} ends on {response.pendingAddonChange.effectiveAt:date}.',
        '{item.label} changes on {response.pendingAddonChange.effectiveAt:date}.',
        '{item.label} updated',
      ])
    })
  })

  it('has no tier control: the route sends no tiers and refuses one', () => {
    const actions = screen.blocks.find((b: { type: string }) => b.type === 'list').actions
    expect(actions.find((a: { id: string }) => a.id === 'tier')).toBeUndefined()
    expect(JSON.stringify(screen)).not.toMatch(/aiTiers?\b|\btier\b/i)
    for (const action of actions) {
      expect('tier' in (action.body ?? {})).toBe(false)
      expect('tier' in (action.check?.body ?? {})).toBe(false)
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
})
