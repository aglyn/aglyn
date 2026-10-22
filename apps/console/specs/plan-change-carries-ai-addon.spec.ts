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

describe('carriedAiAddonSentence (AGL-2899, AGL-3965)', () => {
  it('says nothing for an org without the add-on', () => {
    expect(carriedAiAddonSentence({ plan: 'pro' } as any, 'business', [])).toBe('')
    // A dead subscription's add-on is not carried, because it is not held.
    expect(
      carriedAiAddonSentence(
        { ...PRO_WITH_AI, subscription: { status: 'canceled' } },
        'business',
        [],
      ),
    ).toBe('')
  })

  it('names the tier at ITS OWN price on the target, which the plan change does not move', () => {
    // No `aiTier` written: Pro's old add-on, which is Boost at $19. Moving to
    // Business keeps it at $19 — not Business's old $39 add-on.
    const sentence = carriedAiAddonSentence(PRO_WITH_AI, 'business', [])
    expect(sentence).toBe(
      ' Your Aglyn AI Boost tier carries over at $19/mo on Business, billed with the plan.',
    )
    expect(AI_TIERS.boost.monthlyUsd).toBe(19)
    // Down the ladder too: the same tier, the same price.
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'starter', [])).toContain('$19/mo on Starter')
    // And the tier written, whatever the plan.
    expect(
      carriedAiAddonSentence({ ...PRO_WITH_AI, aiTier: 'studio' }, 'scale', []),
    ).toBe(' Your Aglyn AI Studio tier carries over at $299/mo on Scale, billed with the plan.')
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
  })

  it('says it is removed when the server reports the drop, without claiming the plan sells none', () => {
    const sentence = carriedAiAddonSentence(PRO_WITH_AI, 'business', ['aiAddon'])
    expect(sentence).toContain('cannot move to Business with this change, so it is removed')
    expect(sentence).toContain('its AI credits go with it')
    expect(sentence).not.toContain('not sold')
  })

  it('tolerates a preview without the field', () => {
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'scale', undefined)).toContain(
      '$19/mo on Scale',
    )
  })
})
