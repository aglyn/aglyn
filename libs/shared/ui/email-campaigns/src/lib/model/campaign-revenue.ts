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

/*
 * The window and the model name come from `@aglyn/shared-util-email`, not
 * from here. The writer is in `tenant-data-admin`, which may not import a
 * feature plugin, and a window defined on both sides of the join would drift
 * into a number credited under one rule and printed under another.
 */
import {
  EMAIL_ATTRIBUTION_MODEL,
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
} from '@aglyn/shared-util-email'
import { campaignRate, type CampaignCaveat } from './campaign-report'

/**
 * WHAT A CAMPAIGN EARNED — the read half of the commerce↔email join.
 *
 * ## Why this is a join and not an attribution model
 *
 * Every compared ESP reconstructs campaign revenue probabilistically, because
 * none of them owns the order. Klaviyo and Mailchimp watch someone else's
 * store through an integration and a browser snippet, so their figure is a
 * reconciliation against a foreign system and their window is the fudge
 * factor that makes the reconciliation close. Commerce here is first-party:
 * the click and the order are rows in one database, keyed the same way, so
 * the "attribution" is a lookup.
 *
 * That does not make the MODEL choice go away — two campaigns can both have
 * touched a buyer and only one can be credited — but it does mean the model
 * is the only judgement in the number. There is no sampling, no identity
 * resolution and no cookie.
 *
 * ## The model: LAST CLICK, inside a fixed 7-day window
 *
 * Stated in one sentence, which is the whole requirement: **an order is
 * credited to the last campaign whose link the buyer clicked, if they clicked
 * it within the {@link EMAIL_ATTRIBUTION_WINDOW_DAYS} days before they
 * ordered.**
 *
 * Three decisions are inside that sentence.
 *
 * **Last touch, not multi-touch.** Multi-touch is the more honest description
 * of how buying works and it is unpresentable: it splits one order across
 * several campaigns by a rule the merchant did not choose, so no campaign's
 * revenue is a number they can check against their own bank, and two
 * campaigns' figures cannot be added or compared without knowing the split
 * rule. HubSpot ships multi-touch and puts it behind an Enterprise plan and a
 * consultant. A figure a merchant cannot explain to themselves is worse than
 * no figure, and it is worse in the specific way that matters here: they will
 * still make decisions with it.
 *
 * **A CLICK is the touch. An open is not.** An open is evidence about the
 * recipient's mail client, not about the recipient — Apple's Mail Privacy
 * Protection prefetches images, which inflated network-wide open rates by
 * roughly 15% and means a large share of recorded opens had no human behind
 * them. Crediting revenue to an open would therefore credit campaigns for
 * orders from people who never saw them, and the error is not random: it
 * concentrates on whichever campaign most recently reached an Apple Mail
 * user. `email-delivery-log.ts` records the same preference for the same
 * reason, and the audience rules already segment on clicks over opens.
 *
 * **Seven days, and not configurable.** Klaviyo's window is 1–30 days per
 * channel; ActiveCampaign's is a fixed, unadjustable 7. Fixed is the better
 * default here because a configurable window is a setting whose change
 * silently rewrites history: yesterday's report and today's would disagree
 * about a campaign that has not been touched since, with nothing on screen to
 * say why. The stored record carries `windowDays` per order for exactly that
 * reason — a future setting can be added without making the orders already
 * attributed unreadable, because each one says which window it was judged
 * under.
 *
 * ## GROSS and REFUNDED, never a decrement
 *
 * A refunded order must stop counting as revenue a campaign earned, and there
 * are two ways to make it stop. Decrementing the gross figure makes a stored
 * number mean one thing before a refund and another after, with nothing to
 * distinguish them; recording the reversal beside it keeps both facts. This
 * is the shape `contact-refund.ts` chose for `ltvCents`/`refundedCents` on the
 * contact and the orders CSV chose for `amountUsd`/`refundedUsd`, and it is
 * chosen again here so all three answer "what did this earn, net" the same
 * way.
 *
 * So {@link campaignRevenueReport} reports gross, refunded and net, and NET
 * is the figure the screen leads with. Net is clamped at zero for display
 * only: a refund larger than the sale it reverses is arithmetically possible
 * on an order attributed before a partial refund settled, and a negative
 * campaign revenue is a sentence nobody can act on.
 *
 * ## Currencies are never summed
 *
 * Money is stored in minor units and no currency travels with it — every
 * checkout door in this repo sets `currency: 'usd'` on the Stripe line items,
 * so the amounts really are all USD, but that is a fact about the code rather
 * than a field on the order. The rollup therefore buckets BY currency and
 * this module never adds two buckets together. A campaign with two currencies
 * renders two blocks and no total, and says so.
 *
 * The rule survives the merge across a container's emails.
 * {@link campaignRevenueAcrossSends} keys its accumulator on the currency, so
 * two rollups can only ever meet inside a bucket they already share — there
 * is no code path in which a USD amount and a EUR amount reach the same
 * addition, and no combined figure exists for a screen to print by accident.
 */

/**
 * Re-exported so a reader of the report has the window and the model name
 * without reaching past this module for them — the screen prints both, and a
 * window nobody can see is a window nobody can check.
 */
export {
  EMAIL_ATTRIBUTION_MODEL,
  EMAIL_ATTRIBUTION_WINDOW_DAYS,
  EMAIL_ATTRIBUTION_WINDOW_MS,
} from '@aglyn/shared-util-email'

/** One currency's totals as the rollup stores them. */
export interface CampaignRevenueCurrencyStored {
  /** Minor units credited to this campaign, gross of refunds. */
  grossCents?: number
  /** Minor units handed back on orders that had been credited. */
  refundedCents?: number
  /** Orders credited to this campaign. */
  orders?: number
  /** Of those, how many ended fully reversed. */
  refundedOrders?: number
}

/**
 * The stored shape of `campaigns/{campaignId}/reports/revenue`.
 *
 * Its own document, for the reason the link rollup is its own document: the
 * campaign document is read by the history list, the glance widget and the
 * send path, and a map that grows with the campaign's sales would make every
 * one of those reads larger. Split, it is read by the one screen that draws
 * it.
 */
export interface CampaignRevenueRollup {
  byCurrency?: Record<string, CampaignRevenueCurrencyStored>
  /** The model the orders in this rollup were credited under. */
  model?: string
  /** The window, in days, they were credited inside. */
  windowDays?: number
}

/**
 * Money over a population, with the population named — {@link CampaignRate}'s
 * rule applied to an average instead of a share.
 *
 * A percentage and an average go wrong the same way, so they carry the same
 * guarantee: the denominator travels as data and the screen has to print it.
 * "$0.42 per recipient" over an audience nobody named is the figure this
 * whole reporting surface exists to refuse.
 */
export interface CampaignMoneyPerMessage {
  /** Minor units per message of the denominator. Fractional by nature. */
  cents: number
  numeratorCents: number
  denominator: number
  denominatorLabel: string
  currency: string
}

/** One currency's block on screen. */
export interface CampaignRevenueCurrencyReport {
  /** Lowercase ISO code as the sale recorded it, e.g. `'usd'`. */
  currency: string
  grossCents: number
  refundedCents: number
  /** `gross - refunded`, clamped at zero. */
  netCents: number
  orders: number
  refundedOrders: number
  /**
   * Net revenue per DELIVERED message, or `null` when it cannot be taken.
   *
   * Delivered is the denominator for the same reason every engagement rate on
   * this report is taken over it: mail that bounced was never in front of a
   * human, so counting it depresses a figure describing the audience with a
   * fact about the address list.
   *
   * It is deliberately NOT taken over `audienceSize`. That figure is written
   * by the FIRST batch only and is a floor when audience resolution hit its
   * read ceiling, so a campaign delivered over six runs would divide six
   * runs' revenue by one run's measure of the audience — the stale-population
   * division this surface is built to make impossible.
   */
  netPerDelivered: CampaignMoneyPerMessage | null
}

/** Everything the revenue section renders. */
export interface CampaignRevenueReport {
  /** One block per currency, largest net first. Never summed together. */
  currencies: CampaignRevenueCurrencyReport[]
  /** Orders credited to this campaign, across every currency. */
  attributedOrders: number
  /**
   * Whether any attribution has ever been recorded for this campaign.
   *
   * `false` means the rollup document does not exist, which is NOT the same
   * as "this campaign earned nothing" — it is also every campaign sent before
   * the join existed, and every campaign on a site with no store. The screen
   * renders the difference rather than printing a zero for both.
   */
  recorded: boolean
  /** More than one currency is present, so no total may be shown. */
  multiCurrency: boolean
  /** The model these figures were credited under, as stored. */
  model: string
  /** The window they were credited inside, as stored. */
  windowDays: number
  caveats: CampaignCaveat[]
}

/**
 * Why there is no total, in the words both reports use.
 *
 * One sentence, one definition. A send's report and its campaign's report
 * make the same refusal for the same reason, and two copies of the sentence
 * is how one of them comes to be softened into a promise of a total.
 */
export const REVENUE_MULTI_CURRENCY_MESSAGE =
  'This campaign earned in more than one currency. Each is reported on its ' +
  'own — nothing here converts between them, so there is deliberately no ' +
  'combined total.'

/** A stored count as a non-negative integer. */
function count(raw: unknown): number {
  const value = Math.floor(Number(raw ?? 0))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Money per message, or `null` when the division cannot honestly be taken.
 *
 * The three refusals are {@link campaignRate}'s, and this defers to it rather
 * than restating them: a zero denominator, an unrecorded denominator, and a
 * non-finite input all answer `null` there, so a second implementation of
 * "when may we divide" cannot drift from the first.
 */
export function campaignMoneyPerMessage(
  numeratorCents: number,
  denominator: number | undefined,
  denominatorLabel: string,
  currency: string,
): CampaignMoneyPerMessage | null {
  const divisible = campaignRate(numeratorCents, denominator, denominatorLabel)
  if (!divisible) return null
  return {
    cents: divisible.value,
    numeratorCents: divisible.numerator,
    denominator: divisible.denominator,
    denominatorLabel,
    currency,
  }
}

/**
 * Turns the stored rollup into the revenue section.
 *
 * `delivered` comes from the campaign's own `stats` and is passed in rather
 * than re-read, so the numerator and the denominator on screen are taken from
 * the same instant. It is `null` when no delivery event has ever been
 * recorded — the campaign predates the delivery webhook, or the events are
 * still in flight — and every figure over it is then withheld with a caveat,
 * never substituted for `sent`.
 */
export function campaignRevenueReport(options: {
  rollup: CampaignRevenueRollup | undefined
  /** `stats.delivered`, or `null` when it was never recorded. */
  delivered: number | null
  /** True while the send is still working through its audience. */
  midFlight?: boolean
}): CampaignRevenueReport {
  const { rollup, delivered, midFlight } = options
  const stored = rollup?.byCurrency ?? {}
  const caveats: CampaignCaveat[] = []

  const currencies: CampaignRevenueCurrencyReport[] = Object.entries(stored)
    .map(([currency, totals]) => {
      const grossCents = count(totals?.grossCents)
      const refundedCents = count(totals?.refundedCents)
      /*
       * CLAMPED, and only here at the point of display.
       *
       * Both stored figures are monotonic counters of money that really
       * moved in one direction, so neither can be negative; their DIFFERENCE
       * can be, for one reason — an order credited to a campaign and then
       * refunded by more than the amount that was credited, which happens
       * when a partial refund settles against an order whose attributed
       * amount was the charge at the time. Clamping at write time would
       * erase the evidence; clamping at read time keeps the stored pair
       * intact and stops the screen printing a campaign with negative
       * earnings, which is not a sentence anybody can act on.
       */
      const netCents = Math.max(0, grossCents - refundedCents)
      return {
        currency,
        grossCents,
        refundedCents,
        netCents,
        orders: count(totals?.orders),
        refundedOrders: count(totals?.refundedOrders),
        netPerDelivered: campaignMoneyPerMessage(
          netCents,
          delivered ?? undefined,
          'delivered',
          currency,
        ),
      }
    })
    .filter((entry) => entry.orders > 0 || entry.grossCents > 0)
    .sort(
      (a, b) => b.netCents - a.netCents || a.currency.localeCompare(b.currency),
    )

  const attributedOrders = currencies.reduce(
    (total, entry) => total + entry.orders,
    0,
  )
  const multiCurrency = currencies.length > 1

  if (delivered === null && currencies.length) {
    caveats.push({
      id: 'revenue-denominator-unrecorded',
      message:
        'No delivery events have been recorded for this campaign, so revenue ' +
        'per delivered message cannot be computed. The amounts below are ' +
        'still real.',
    })
  }
  if (multiCurrency) {
    caveats.push({
      id: 'revenue-multi-currency',
      message: REVENUE_MULTI_CURRENCY_MESSAGE,
    })
  }
  if (midFlight && currencies.length) {
    caveats.push({
      id: 'revenue-mid-flight',
      message:
        'This campaign is still going out. Revenue and delivered messages ' +
        'are both still rising, so every figure below is a running total ' +
        'rather than a final one.',
    })
  }

  return {
    currencies,
    attributedOrders,
    recorded: rollup !== undefined,
    multiCurrency,
    model: String(rollup?.model ?? EMAIL_ATTRIBUTION_MODEL),
    windowDays: count(rollup?.windowDays) || EMAIL_ATTRIBUTION_WINDOW_DAYS,
    caveats,
  }
}

/** One currency's totals, merged across a campaign's emails. */
export interface CampaignRevenueCurrencyAcrossSends {
  /** Lowercase ISO code as the sales recorded it, e.g. `'usd'`. */
  currency: string
  grossCents: number
  refundedCents: number
  /** `gross - refunded` over the whole campaign, clamped once at zero. */
  netCents: number
  orders: number
  refundedOrders: number
  /** Emails of the campaign whose revenue record holds this currency. */
  emails: number
}

/** Everything a campaign container's revenue section renders. */
export interface CampaignRevenueAcrossSends {
  /** One block per currency, largest net first. Never summed together. */
  currencies: CampaignRevenueCurrencyAcrossSends[]
  /**
   * Orders credited across every currency.
   *
   * A COUNT, which is why it may cross currencies when the money may not: an
   * order is one order whatever it was paid in, and counting two of them
   * loses nothing. Adding their amounts loses the unit.
   */
  attributedOrders: number
  /** Emails whose revenue record was looked for. */
  read: number
  /**
   * Of those, how many have a revenue record at all.
   *
   * The rollup is created by the attribution writer on the first order it
   * credits, so an email with no record has never been credited with one.
   * Zero across the whole campaign is therefore the container's version of
   * {@link CampaignRevenueReport.recorded} being `false`: it is not "this
   * campaign earned nothing", it is also every campaign sent before the join
   * existed and every campaign on a site with no store.
   */
  recorded: number
  /** More than one currency is present, so no total may be shown. */
  multiCurrency: boolean
  /** The models these emails were credited under, distinct and sorted. */
  models: string[]
  /** The windows, in days, they were credited inside, distinct and sorted. */
  windowDays: number[]
  caveats: CampaignCaveat[]
}

/**
 * MERGES A CAMPAIGN'S EMAILS INTO ONE REVENUE SECTION, per currency.
 *
 * `reports/revenue` is written per SEND, so a container's figure is one
 * document per email and a merge. The merge is the whole risk: two emails of
 * one campaign can have earned in different currencies, and adding their
 * amounts produces a number that is wrong with nothing on screen to show it.
 *
 * ## The currency is the accumulator's KEY, not a field beside the amount
 *
 * That is the structural half of the guarantee. Amounts are added into a map
 * keyed by currency, so two amounts can only reach the same addition when
 * they already carry the same code — a USD figure and a EUR figure have no
 * path to each other, whatever a later caller asks for. There is no combined
 * field on the result, so a screen cannot print a cross-currency total by
 * reading the wrong property, and
 * {@link CampaignRevenueAcrossSends.multiCurrency} is what tells the screen
 * to label the blocks.
 *
 * ## Clamped ONCE, over the campaign
 *
 * The single-send report clamps its net at zero because a partial refund can
 * settle against an order credited at the full charge. Doing that per email
 * and then summing would let one over-refunded email keep money a sibling
 * email handed back — an email at -$50 clamped to $0 beside one at $200 would
 * report $200 for a campaign holding $150. So gross and refunded are summed
 * as they stand and the difference is clamped once, at the end.
 *
 * ## No per-message average, deliberately
 *
 * The send report divides net revenue by that send's own `delivered`, taken
 * from the same document at the same instant. A container has no such pair.
 * Its delivery total is summed over the emails that RECORDED a delivery count
 * and its revenue over the emails that have a revenue record, and those are
 * different subsets of the campaign — so the quotient would be an average
 * over a population nobody named, which is the defect the whole reporting
 * surface is built to refuse. The amounts are reported without one.
 *
 * @param rollups - one entry per email read, `undefined` where no record
 * exists.
 */
export function campaignRevenueAcrossSends(
  rollups: readonly (CampaignRevenueRollup | undefined)[],
): CampaignRevenueAcrossSends {
  const byCurrency = new Map<string, CampaignRevenueCurrencyAcrossSends>()
  const models = new Set<string>()
  const windows = new Set<number>()
  let recorded = 0

  for (const rollup of rollups) {
    if (!rollup) continue
    recorded += 1
    models.add(String(rollup.model ?? EMAIL_ATTRIBUTION_MODEL))
    windows.add(count(rollup.windowDays) || EMAIL_ATTRIBUTION_WINDOW_DAYS)
    for (const [code, stored] of Object.entries(rollup.byCurrency ?? {})) {
      const currency = String(code).trim().toLowerCase()
      if (!currency) continue
      const entry = byCurrency.get(currency) ?? {
        currency,
        grossCents: 0,
        refundedCents: 0,
        netCents: 0,
        orders: 0,
        refundedOrders: 0,
        emails: 0,
      }
      entry.grossCents += count(stored?.grossCents)
      entry.refundedCents += count(stored?.refundedCents)
      entry.orders += count(stored?.orders)
      entry.refundedOrders += count(stored?.refundedOrders)
      // One rollup holds at most one bucket per currency, so this counts
      // EMAILS that earned in it rather than orders.
      entry.emails += 1
      byCurrency.set(currency, entry)
    }
  }

  const currencies = [...byCurrency.values()]
    .map((entry) => ({
      ...entry,
      netCents: Math.max(0, entry.grossCents - entry.refundedCents),
    }))
    .filter((entry) => entry.orders > 0 || entry.grossCents > 0)
    .sort(
      (a, b) => b.netCents - a.netCents || a.currency.localeCompare(b.currency),
    )

  const multiCurrency = currencies.length > 1
  const caveats: CampaignCaveat[] = []
  if (multiCurrency) {
    caveats.push({
      id: 'revenue-multi-currency',
      message: REVENUE_MULTI_CURRENCY_MESSAGE,
    })
  }
  /*
   * Two rules met in one figure, which is the currency problem in another
   * dimension: a campaign whose older emails were credited under a different
   * model or a different window holds amounts that were judged by different
   * tests. They are still money in one unit, so unlike two currencies they
   * add — the total stands, and the reader is told the rule behind it is not
   * single.
   */
  if (models.size > 1 || windows.size > 1) {
    caveats.push({
      id: 'revenue-mixed-model',
      message:
        'This campaign’s emails were not all credited under the same rule. ' +
        'The amounts are real, but they were judged by different attribution ' +
        'models or windows, so they are not strictly comparable with each ' +
        'other.',
    })
  }

  return {
    currencies,
    attributedOrders: currencies.reduce(
      (total, entry) => total + entry.orders,
      0,
    ),
    read: rollups.length,
    recorded,
    multiCurrency,
    models: [...models].sort(),
    windowDays: [...windows].sort((a, b) => a - b),
    caveats,
  }
}
