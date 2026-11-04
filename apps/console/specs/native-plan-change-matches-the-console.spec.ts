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
import {
  AI_CREDIT_BLOCK_MONTHLY_USD,
  AI_CREDIT_BLOCKS_MAX,
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  planSellsAiCredits,
  SELF_SERVE_PLANS,
} from '@aglyn/aglyn'
import { carriedAiAddonSentence } from '../utils/proration-quote'

/**
 * The native plan-change screen restates what the console's plan cards and
 * `overLimitSummary` read from code: the self-serve plans in order, their
 * names, what each plan includes of the three capacities a downgrade can
 * strand, and which plans sell the Aglyn AI add-on (since AGL-4144 credit
 * blocks, one price on every paid plan, so the screen names no per-plan
 * price). A change to any of them must change the screen.
 */
const screens = JSON.parse(
  readFileSync(
    join(__dirname, '../../../libs/native/screens/billing.screens.json'),
    'utf8',
  ),
).screens as Array<{ id: string; constants?: any }>
const plans = screens.find((s) => s.id === 'core.billing.plans')!.constants
/** Billing's own Plan row names the plan in force the same way (`enterprise` reads "Custom"). */
const overview = screens.find((s) => s.id === 'core.billing')!.constants

describe('native plan change', () => {
  it('lists the self-serve plans in the console order, under the console names', () => {
    expect(plans.plans.map((p: { id: string }) => p.id)).toEqual([
      ...SELF_SERVE_PLANS,
    ])
    expect(plans.labels).toEqual(PLAN_LABELS)
    expect(overview.labels).toEqual(PLAN_LABELS)
  })

  it('knows what each plan includes of sites, team members and datasets', () => {
    for (const [plan, entitlements] of Object.entries(PLAN_ENTITLEMENTS)) {
      expect(plans.limits[plan]).toEqual({
        hostLimit: entitlements.hostLimit,
        managersPerOrg: entitlements.managersPerOrg,
        datasetsPerOrg: entitlements.datasetsPerOrg,
      })
    }
  })

  it('knows which plans sell Aglyn AI credit blocks, and what a block costs', () => {
    const sold = Object.fromEntries(
      Object.keys(PLAN_ENTITLEMENTS)
        .filter((plan) => planSellsAiCredits(plan))
        .map((plan) => [plan, true]),
    )
    expect(plans.aiCreditsSold).toEqual(sold)
    // The retired per-tier set is gone (AGL-4155).
    expect(plans.aiTiersSold).toBeUndefined()
    // One price on every plan that sells blocks, and the ceiling a stored
    // count is read against.
    expect(plans.aiCreditBlockUsd).toBe(AI_CREDIT_BLOCK_MONTHLY_USD)
    expect(plans.aiCreditBlocksMax).toBe(AI_CREDIT_BLOCKS_MAX)
    expect(plans.aiPrice).toBeUndefined()
  })

  /*
   * The sentence the switch confirm appends about the workspace's credit
   * blocks, in `carriedAiAddonSentence`'s words (AGL-4144, AGL-4155). The
   * screen states it in parts, one per count (one block, more) and outcome
   * (not sold, dropped, carried); each part is the console's sentence with
   * the target plan's name and the block count left as the screen's
   * templates, so a change of wording on either side reds here.
   */
  describe('the Aglyn AI credit blocks sentence', () => {
    const sw = (
      screens.find((s) => s.id === 'core.billing.plans') as any
    ).blocks
      .find((b: { type: string }) => b.type === 'list')
      .actions.find((a: { id: string }) => a.id === 'switch')
    const parts: Array<{ when?: string; text: string }> = sw.confirm.filter(
      (part: { when?: string }) => /seatAddons\.aiAddon/.test(part.when ?? ''),
    )
    const org = (blocks: number) =>
      ({ plan: 'pro', subscription: { status: 'active' }, seatAddons: { aiAddon: blocks } }) as any
    /** The screen's part for a count and outcome, with its templates filled the way the renderer fills them. */
    function screenSays(blocks: number, outcome: 'unsold' | 'dropped' | 'carried', label: string): string {
      const count = blocks === 1 ? 'aiAddon == 1' : 'aiAddon > 1'
      const matches = parts.filter((part) => {
        const when = part.when ?? ''
        if (!when.includes(count)) return false
        if (outcome === 'unsold') return when.includes('!const.aiCreditsSold')
        if (when.includes('!const.aiCreditsSold')) return false
        return outcome === 'dropped'
          ? when.includes('droppedAddons ~= aiAddon')
          : when.includes('droppedAddons !~= aiAddon')
      })
      expect(matches).toHaveLength(1)
      const held = Math.min(AI_CREDIT_BLOCKS_MAX, blocks)
      return matches[0].text
        .replace('{item.label}', label)
        .replace(
          '{min(const.aiCreditBlocksMax, data.org.seatAddons.aiAddon) * const.aiCreditBlockUsd}',
          String(held * AI_CREDIT_BLOCK_MONTHLY_USD),
        )
        .replace('{min(const.aiCreditBlocksMax, data.org.seatAddons.aiAddon)}', String(held))
        .replace('{const.aiCreditBlockUsd}', String(AI_CREDIT_BLOCK_MONTHLY_USD))
    }

    it('names no tier', () => {
      expect(parts).toHaveLength(6)
      for (const part of parts) expect(part.text).not.toMatch(/tier/i)
    })

    it.each([1, 3, 45])('says what the console says for %i block(s)', (blocks) => {
      expect(screenSays(blocks, 'unsold', 'Free')).toBe(
        carriedAiAddonSentence(org(blocks), 'free', []),
      )
      expect(screenSays(blocks, 'dropped', 'Starter')).toBe(
        carriedAiAddonSentence(org(blocks), 'starter', ['aiAddon']),
      )
      expect(screenSays(blocks, 'carried', 'Starter')).toBe(
        carriedAiAddonSentence(org(blocks), 'starter', []),
      )
    })
  })
})
