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
 * AGLYN AI CREDITS, SOLD BY THE BLOCK (AGL-4144).
 *
 * One add-on replaces the six Aglyn AI tiers: a block of 5,000 credits for
 * $10 a month, bought in any quantity from 1 to 30, on any paid self-serve
 * plan. A block adds its credits to the plan's included monthly band; past
 * the plan's and the blocks' credits together, the plan's own overage rate
 * (`extraAssistCreditsUsdPer1k`) bills as it always has, unless the owner
 * turned the hard cap on.
 *
 * ## Why the figures are these
 *
 * A credit is `ASSIST_CREDIT_COST_USD` ($0.001) of provider spend, so a block
 * costs at most $5 at full burn against a $10 price: 50% of price, the same
 * line-margin floor every retail assist rate clears, and the $2 per 1,000
 * credits the top retired tier sold at. `tier-margin-floor.spec.ts` holds it.
 *
 * ## Where it is stored
 *
 * `org.seatAddons.aiAddon` is the block count, mirrored from the quantity on
 * the subscription item that carries the `aglyn_ai_credits` price (or its
 * yearly twin, matching the subscription's interval), the way every other
 * quantity add-on is. Yearly is ×12 with no discount, as every add-on is.
 *
 * Pure on purpose: no runtime import, so `plan-entitlements.ts` can read the
 * block's price and ceiling without a cycle, and the native generator and
 * the marketing table builder can read it without the plugin registries.
 */

/** Credits one block adds to the plan's included monthly band. */
export const AI_CREDITS_PER_BLOCK = 5_000

/** A block's monthly price, USD. */
export const AI_CREDIT_BLOCK_MONTHLY_USD = 10

/** A block's yearly price, USD: ×12, no discount, like every add-on. */
export const AI_CREDIT_BLOCK_YEARLY_USD = AI_CREDIT_BLOCK_MONTHLY_USD * 12

/** The fewest blocks a workspace holds: none. */
export const AI_CREDIT_BLOCKS_MIN = 0

/**
 * The most blocks one workspace may buy: 30, or 150,000 credits a month on
 * top of the plan. More is a Custom agreement.
 */
export const AI_CREDIT_BLOCKS_MAX = 30

/** The Stripe lookup keys of the block's two prices. */
export const AI_CREDIT_BLOCK_LOOKUP_KEYS = Object.freeze({
  month: 'aglyn_ai_credits',
  year: 'aglyn_ai_credits_yearly',
} as const)

/**
 * The env vars holding the block's two Stripe price ids. The console needs
 * both: a monthly subscription carries the first, a yearly one the second.
 */
export const AI_CREDIT_BLOCK_PRICE_ENV = Object.freeze({
  month: 'STRIPE_PRICE_AI_CREDITS',
  year: 'STRIPE_PRICE_AI_CREDITS_YEARLY',
} as const)

/**
 * The flat add-on key the env names are built from
 * (`STRIPE_PRICE_{KEY}[_YEARLY]`), as `billing-addons.ts` and
 * `tools/scripts/setup-stripe.mjs` spell it.
 */
export const AI_CREDIT_BLOCK_ENV_KEY = 'AI_CREDITS'

/** The block in one record, for a reader that wants all of it. */
export interface AiCreditBlock {
  credits: number
  monthlyUsd: number
  yearlyUsd: number
  maxBlocks: number
  lookupKeys: Readonly<{ month: string; year: string }>
  priceEnv: Readonly<{ month: string; year: string }>
}

export const AI_CREDIT_BLOCK: Readonly<AiCreditBlock> = Object.freeze({
  credits: AI_CREDITS_PER_BLOCK,
  monthlyUsd: AI_CREDIT_BLOCK_MONTHLY_USD,
  yearlyUsd: AI_CREDIT_BLOCK_YEARLY_USD,
  maxBlocks: AI_CREDIT_BLOCKS_MAX,
  lookupKeys: AI_CREDIT_BLOCK_LOOKUP_KEYS,
  priceEnv: AI_CREDIT_BLOCK_PRICE_ENV,
})

/** What 1,000 credits cost when bought by the block: $2. */
export const AI_CREDIT_BLOCK_USD_PER_1K =
  AI_CREDIT_BLOCK_MONTHLY_USD / (AI_CREDITS_PER_BLOCK / 1_000)

/**
 * How many blocks a stored quantity counts as: a whole number from 0 to 30.
 * A non-number, `NaN`, a negative or a fraction below one is none; a
 * fraction is rounded down; anything above the ceiling is the ceiling, so a
 * hand edit or a doubled webhook item can never grant credits nobody sells.
 */
export function aiCreditBlockCount(quantity: unknown): number {
  const value = Number(quantity ?? 0)
  if (!Number.isFinite(value) || value < 1) return AI_CREDIT_BLOCKS_MIN
  return Math.min(AI_CREDIT_BLOCKS_MAX, Math.floor(value))
}

/** The credits a month a number of blocks adds: blocks × 5,000. */
export function aiCreditBlocksCredits(blocks: unknown): number {
  return aiCreditBlockCount(blocks) * AI_CREDITS_PER_BLOCK
}

/**
 * THE INCLUDED-CREDITS ARITHMETIC: the plan's included monthly band plus
 * blocks × 5,000. An unlimited band stays unlimited; a non-number band reads
 * as none, so a missing figure never turns the blocks into `NaN`.
 */
export function includedAiCreditsPerMonth(
  planCreditsPerMonth: number,
  blocks: unknown,
): number {
  const band = Number(planCreditsPerMonth)
  if (band === Number.POSITIVE_INFINITY) return band
  return (Number.isFinite(band) && band > 0 ? band : 0) + aiCreditBlocksCredits(blocks)
}

/** What a number of blocks costs a month: blocks × $10. */
export function aiCreditBlocksMonthlyUsd(blocks: unknown): number {
  return aiCreditBlockCount(blocks) * AI_CREDIT_BLOCK_MONTHLY_USD
}

/** What a number of blocks costs per billing period: × $10 monthly, × $120 yearly. */
export function aiCreditBlocksPriceUsd(
  blocks: unknown,
  interval: 'month' | 'year',
): number {
  return (
    aiCreditBlockCount(blocks) *
    (interval === 'year' ? AI_CREDIT_BLOCK_YEARLY_USD : AI_CREDIT_BLOCK_MONTHLY_USD)
  )
}

/** The env var holding the block's price id at an interval. */
export function aiCreditBlockPriceEnvName(interval: 'month' | 'year'): string {
  return AI_CREDIT_BLOCK_PRICE_ENV[interval === 'year' ? 'year' : 'month']
}

/** "5,000". */
function formatCredits(credits: number): string {
  return credits.toLocaleString('en-US')
}

/**
 * The add-on's terms in one line, as the Billing stepper prints them:
 * "5,000 credits each, $10 a month per block".
 */
export const AI_CREDIT_BLOCK_TERMS =
  `${formatCredits(AI_CREDITS_PER_BLOCK)} credits each, ` +
  `$${AI_CREDIT_BLOCK_MONTHLY_USD} a month per block`

/** "1 block", "3 blocks". */
export function aiCreditBlocksLabel(blocks: number): string {
  const count = aiCreditBlockCount(blocks)
  return `${count} ${count === 1 ? 'block' : 'blocks'}`
}

/** "3 blocks · 15,000 credits a month". */
export function describeAiCreditBlocks(blocks: number): string {
  return (
    `${aiCreditBlocksLabel(blocks)} · ` +
    `${formatCredits(aiCreditBlocksCredits(blocks))} credits a month`
  )
}
