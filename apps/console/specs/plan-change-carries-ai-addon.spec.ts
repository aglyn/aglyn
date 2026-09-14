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
 * add-on (AGL-2899).
 *
 * `/api/billing/subscription` re-prices every add-on item to the target plan
 * in the same update and reports the kinds it deleted as `droppedAddons`.
 * The proration figure the confirm quotes already includes that, but a
 * figure cannot say that a $19 line became a $39 one. This is the sentence
 * the switch confirm appends, and the three answers it has to give: carries
 * at the target's price, is removed, or is not mentioned because the org
 * never had it.
 */

import { PLAN_PRICING } from '@aglyn/aglyn'
import { carriedAiAddonSentence } from '../utils/proration-quote'

const PRO_WITH_AI = {
  plan: 'pro',
  subscription: { status: 'active' },
  seatAddons: { aiAddon: 1 },
} as any

describe('carriedAiAddonSentence (AGL-2899)', () => {
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

  it('names the add-on at the TARGET plan price, read from the pricing table', () => {
    // FORCED RED by quoting the current plan's price: a Pro org moving to
    // Business would read "$19/mo" on a line that bills $39.
    const sentence = carriedAiAddonSentence(PRO_WITH_AI, 'business', [])
    expect(sentence).toBe(
      ' Your Aglyn AI add-on carries over at $39/mo on Business, billed with the plan.',
    )
    expect(PLAN_PRICING.business.aiAddonMonthlyUsd).toBe(39)
    // Down the ladder too: a downgrade carries it at the lower price.
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'starter', [])).toContain('$9/mo on Starter')
  })

  it('says it is removed when the server reports the drop, or the target sells none', () => {
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'business', ['aiAddon'])).toContain(
      'not sold on Business, so it is removed',
    )
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'free', [])).toContain(
      'not sold on Free, so it is removed',
    )
    // The credits go with it — the sentence says so, because the meter
    // will.
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'free', [])).toContain(
      'its AI credits go with it',
    )
  })

  it('tolerates a preview without the field', () => {
    expect(carriedAiAddonSentence(PRO_WITH_AI, 'scale', undefined)).toContain(
      '$69/mo on Scale',
    )
  })
})
