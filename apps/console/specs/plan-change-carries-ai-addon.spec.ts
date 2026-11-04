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
 * credit blocks (AGL-2899, AGL-4144).
 *
 * `/api/billing/subscription` moves every add-on item to the target in the
 * same update and reports the kinds it deleted as `droppedAddons`. A block is
 * one price on every paid plan, so a plan change KEEPS the blocks, their count
 * and their price; only a target that sells none (Free, or a plan pricing v4
 * retired), or one the server
 * could not carry them to, drops them. This is the sentence the switch confirm
 * appends, and the answers it has to give: carries at the blocks' own price,
 * is removed (and why), or is not mentioned because the org never had any.
 */

import { AI_CREDIT_BLOCK_MONTHLY_USD } from '@aglyn/aglyn'
import { carriedAiAddonSentence } from '../utils/proration-quote'

const proWithBlocks = (blocks: number) =>
  ({
    plan: 'pro',
    subscription: { status: 'active' },
    seatAddons: { aiAddon: blocks },
  }) as any

describe('carriedAiAddonSentence (AGL-2899, AGL-4144)', () => {
  it('says nothing for an org without blocks', () => {
    expect(carriedAiAddonSentence({ plan: 'pro' } as any, 'starter', [])).toBe('')
    expect(carriedAiAddonSentence(proWithBlocks(0), 'starter', [])).toBe('')
    // A dead subscription's blocks are not carried, because they are not held.
    expect(
      carriedAiAddonSentence(
        { ...proWithBlocks(2), subscription: { status: 'canceled' } },
        'starter',
        [],
      ),
    ).toBe('')
  })

  it('names the blocks at THEIR OWN price on the target, which the plan change does not move', () => {
    expect(AI_CREDIT_BLOCK_MONTHLY_USD).toBe(10)
    expect(carriedAiAddonSentence(proWithBlocks(1), 'starter', [])).toBe(
      ' Your 1 block of Aglyn AI credits carries over at $10/mo on Starter, billed with the plan.',
    )
    // The count is the price: three blocks are $30 on any paid plan.
    expect(carriedAiAddonSentence(proWithBlocks(3), 'starter', [])).toBe(
      ' Your 3 blocks of Aglyn AI credits carry over at $30/mo on Starter, billed with the plan.',
    )
    // A stored count past the ceiling is the ceiling, never more.
    expect(carriedAiAddonSentence(proWithBlocks(45), 'pro', [])).toContain(
      'Your 30 blocks of Aglyn AI credits carry over at $300/mo on Pro',
    )
  })

  it('says they are removed when the target sells no blocks', () => {
    expect(carriedAiAddonSentence(proWithBlocks(1), 'free', [])).toContain(
      'Your 1 block of Aglyn AI credits is not sold on Free, so it is removed',
    )
    const many = carriedAiAddonSentence(proWithBlocks(4), 'free', [])
    expect(many).toContain('Your 4 blocks of Aglyn AI credits are not sold on Free, so they are removed')
    // The credits go with them — the sentence says so, because the meter
    // will.
    expect(many).toContain('the credits go with them')
    // …and a plan pricing v4 retired, which sells nothing (AGL-4126).
    expect(carriedAiAddonSentence(proWithBlocks(2), 'business', [])).toContain(
      'not sold on Business, so they are removed',
    )
  })

  it('says they are removed when the server reports the drop, without claiming the plan sells none', () => {
    const sentence = carriedAiAddonSentence(proWithBlocks(2), 'starter', ['aiAddon'])
    expect(sentence).toContain('cannot move to Starter with this change, so they are removed')
    expect(sentence).toContain('the credits go with them')
    expect(sentence).toContain('You can add blocks again under Plan add-ons afterwards.')
    expect(sentence).not.toContain('not sold')
  })

  it('tolerates a preview without the field', () => {
    expect(carriedAiAddonSentence(proWithBlocks(2), 'starter', undefined)).toContain(
      '$20/mo on Starter',
    )
  })

  it('names no tier: the retired tier names are gone from the sentence', () => {
    const sentence = carriedAiAddonSentence(
      { ...proWithBlocks(1), aiTier: 'studio' } as any,
      'starter',
      [],
    )
    expect(sentence).not.toMatch(/Spark|Boost|Plus|Max|Ultra|Studio|tier/)
    expect(sentence).toContain('$10/mo')
  })
})
