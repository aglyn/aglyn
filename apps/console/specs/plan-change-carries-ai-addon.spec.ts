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
 * A plan change never silently drops — or silently re-prices — the Aglyn AI
 * tier (AGL-2899, AGL-3965).
 *
 * `/api/billing/subscription` moves every add-on item to the target in the
 * same update and reports the kinds it deleted as `droppedAddons`. Since
 * AGL-3965 a tier is chosen on its own, at one price on every paid plan, so
 * a plan change KEEPS the tier and its price; only a target that sells no
 * tier (Free), or one the server could not carry it to, drops it. This is the
 * sentence the switch confirm appends, and the answers it has to give:
 * carries at the tier's own price, is removed (and why), or is not mentioned
 * because the org never had it.
 */

import { AI_TIERS } from '@aglyn/aglyn'
import { carriedAiAddonSentence } from '../utils/proration-quote'

const PRO_WITH_AI = {
  plan: 'pro',
  subscription: { status: 'active' },
  seatAddons: { aiAddon: 1 },
} as any

/** Starter with the add-on and no `aiTier` written: Starter's old add-on, Spark. */
const STARTER_WITH_AI = { ...PRO_WITH_AI, plan: 'starter' } as any

// Pricing v4 (AGL-4126): the plans sold are Free, Starter and Pro, so the
// moves below are between Starter and Pro; a retired plan sells no tier.

describe('carriedAiAddonSentence (AGL-2899, AGL-3965)', () => {
  it('says nothing for an org without the add-on', () => {
    expect(carriedAiAddonSentence({ plan: 'pro' } as any, 'starter', [])).toBe('')
    // A dead subscription's add-on is not carried, because it is not held.
    expect(
      carriedAiAddonSentence(
        { ...PRO_WITH_AI, subscription: { status: 'canceled' } },
        'starter',
        [],
      ),
    ).toBe('')
  })

  it('names the tier at ITS OWN price on the target, which the plan change does not move', () => {
    // No `aiTier` written: Starter's old add-on, which is Spark at $9. Moving
    // to Pro keeps it at $9 — not Pro's old $19 add-on.
    const sentence = carriedAiAddonSentence(STARTER_WITH_AI, 'pro', [])
    expect(sentence).toBe(
      ' Your Aglyn AI Spark tier carries over at $9/mo on Pro, billed with the plan.',
    )
    expect(AI_TIERS.spark.monthlyUsd).toBe(9)
    // Down the ladder too: the same tier, the same price.
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'starter', [])).toContain('$19/mo on Starter')
    // And the tier written, whatever the plan.
    expect(
      carriedAiAddonSentence({ ...STARTER_WITH_AI, aiTier: 'studio' }, 'pro', []),
    ).toBe(' Your Aglyn AI Studio tier carries over at $299/mo on Pro, billed with the plan.')
  })

  it('says it is removed when the target sells no tier', () => {
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'free', [])).toContain(
      'not sold on Free, so it is removed',
    )
    // The credits go with it — the sentence says so, because the meter
    // will.
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'free', [])).toContain(
      'its AI credits go with it',
    )
    // …and a plan pricing v4 retired, which sells nothing (AGL-4126).
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'business', [])).toContain(
      'not sold on Business, so it is removed',
    )
  })

  it('says it is removed when the server reports the drop, without claiming the plan sells none', () => {
    const sentence = carriedAiAddonSentence(PRO_WITH_AI, 'starter', ['aiAddon'])
    expect(sentence).toContain('cannot move to Starter with this change, so it is removed')
    expect(sentence).toContain('its AI credits go with it')
    expect(sentence).not.toContain('not sold')
  })

  it('tolerates a preview without the field', () => {
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'starter', undefined)).toContain(
      '$19/mo on Starter',
    )
  })
})
