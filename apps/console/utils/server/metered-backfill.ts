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
 * Metered-item back-fill for subscriptions our own routes did not build
 * (AGL-1352).
 *
 * THREE things change a subscription; only two of them attached the shared
 * metered price:
 *
 *   checkout/route.ts          → attaches (AGL-1340/1280)
 *   subscription/route.ts      → attaches, and back-fills, on `switch`
 *   anything Stripe-side       → NOTHING, until this
 *
 * "Anything Stripe-side" is the customer portal, a hand edit in the Stripe
 * dashboard, and — the population that actually exists today — every
 * subscription created before the metered prices were configured at all.
 * Those subscriptions are paying, entitled, and bill no usage overage
 * whatsoever, with no visible symptom: the plan is right, the entitlements are
 * right, and the invoice looks right. The only trace is revenue that never
 * arrives, which is exactly the profit-loss and abuse case the metered rates
 * exist to prevent.
 *
 * So the fix belongs in the WEBHOOK, which every one of those paths reports
 * through, rather than in any single path. Closing the portal (see the
 * `subscription_update` note in the audit script) shuts one door and leaves
 * the dashboard and the pre-flip population untouched.
 *
 * ── WHEN it attaches is a money decision, not a detail ───────────────────
 *
 * Stripe aggregates a meter over the ITEM's billing period, and an item added
 * mid-period inherits the subscription's period start. So attaching mid-period
 * retroactively prices every meter event already recorded in that period —
 * including events computed under rates that have since been corrected.
 *
 * The default is therefore `boundary`: attach only inside a short window after
 * a period starts, so the item's aggregation window contains no history. A
 * renewal emits `customer.subscription.updated` at the period start, so the
 * window is reached every cycle without a cron, and a missed delivery costs at
 * most one more period rather than being permanent.
 *
 * `immediate` is the other side of the trade — it bills the current period in
 * full, recovering the gap at the cost of a retroactive charge. It is the
 * right setting once no pre-correction events remain on the meter, which is
 * why this is an env knob and not a hardcoded choice.
 */

import {
  findPlanItem,
  isMeteredPriceId,
  meteredPriceId,
  planFromPriceId,
  PAID_PLANS,
} from './billing-addons'
import { isLiveSubscriptionStatus, type OrgPlan } from '@aglyn/aglyn/server'

/**
 * `boundary`  — attach only just after a period starts (DEFAULT). Never
 *               retroactively prices usage the customer accrued while
 *               unmetered.
 * `immediate` — attach on the first event that shows the item missing. Bills
 *               the whole current period, history included.
 * `off`       — attach nothing. The escape hatch if a billing incident needs
 *               the behaviour stopped without a deploy.
 */
export type MeteredBackfillMode = 'boundary' | 'immediate' | 'off'

/**
 * How long after `current_period_start` still counts as "the boundary".
 *
 * Generous on purpose. The renewal event arrives within seconds, so this is
 * not sized for the happy path — it is sized so that an endpoint outage, or
 * Stripe exhausting its retry schedule, does not silently cost a whole billing
 * period (a YEAR, on an annual subscription).
 *
 * The cost of the width is bounded by what the meter can actually contain: the
 * rollup posts ONE event per org per calendar month (`report-usage`), so the
 * only event this window can sweep up is a rollup landing within three days of
 * a period start — which is precisely what a checkout-attached subscription is
 * billed for anyway. Widening it does not create a new class of charge.
 */
export const BOUNDARY_GRACE_SECONDS = 72 * 60 * 60

export function meteredBackfillMode(): MeteredBackfillMode {
  const raw = String(process.env.STRIPE_METERED_BACKFILL ?? '').toLowerCase()
  if (raw === 'immediate' || raw === 'off' || raw === 'boundary') return raw
  return 'boundary'
}

export interface MeteredBackfillDecision {
  /** Whether to add the metered item now. */
  attach: boolean
  /** The interval-matched price to add; null whenever `attach` is false. */
  priceId: string | null
  /** The plan interval the decision was made against. */
  interval: 'month' | 'year'
  /** Machine-readable why, for logs and tests. */
  reason:
    | 'attach'
    | 'disabled'
    | 'not-billable'
    | 'not-a-paid-plan'
    | 'already-metered'
    | 'no-metered-price'
    | 'mid-period'
  /** Set when the configuration is asymmetric — one interval priced, not the other. */
  warning?: string
}

export interface MeteredBackfillInput {
  /** The subscription's items, as Stripe reports them. */
  items: any[]
  /** The plan the org is on — `metadata.plan` wins, exactly as the webhook mirrors it. */
  plan: string | null | undefined
  status: string | null | undefined
  canceled: boolean
  /** `current_period_start`, in SECONDS (Stripe's unit). */
  currentPeriodStart: number | null | undefined
  mode?: MeteredBackfillMode
  /** Milliseconds, injectable so the boundary rule is testable. */
  now?: number
}

/**
 * The whole policy, as a pure function — no Stripe, no Firestore, no clock of
 * its own. Every branch below is a reason NOT to touch live money, which is
 * why they are enumerated rather than collapsed into one boolean.
 */
export function meteredBackfillDecision(
  input: MeteredBackfillInput,
): MeteredBackfillDecision {
  const items = input.items ?? []
  // The interval must come off the PLAN item (AGL-1340): `items[0]` is not
  // reliably the plan once add-on and metered items ride along, and reading
  // the interval off an add-on is how a yearly subscription gets handed a
  // monthly price — the mixed-interval rejection Stripe treats as an error.
  const planItem = findPlanItem<any>(items)
  const interval: 'month' | 'year' =
    planItem?.price?.recurring?.interval === 'year' ? 'year' : 'month'
  const no = (reason: MeteredBackfillDecision['reason']) => ({
    attach: false as const,
    priceId: null,
    interval,
    reason,
  })

  const mode = input.mode ?? meteredBackfillMode()
  if (mode === 'off') return no('disabled')
  if (input.canceled) return no('not-billable')
  // Statuses that bill, and therefore should meter — the same list as "this
  // org has a live subscription", off the single source in `org-billing-doc.ts`
  // (AGL-1715). It is genuinely the same question asked of the same status
  // word: `past_due` is still owed and still meters, `incomplete`/`unpaid`
  // bill nothing. If the two ever need to differ, that is a decision to write
  // down here, not a triple to re-type.
  if (!isLiveSubscriptionStatus(input.status)) {
    return no('not-billable')
  }

  // Only the self-serve paid tiers, matching what checkout and the in-app
  // switch actually sell. `free` has no subscription to meter, and
  // `enterprise` bills on a negotiated ad-hoc price that neither other path
  // ever attaches a metered item to — quietly adding usage billing to a signed
  // contract is not a bug fix. `metadata.plan` is the same source the webhook
  // mirrors, with the price-id map as the fallback for dashboard-edited subs.
  const plan = (input.plan ||
    planFromPriceId(planItem?.price?.id) ||
    'free') as OrgPlan
  if (!PAID_PLANS.includes(plan)) return no('not-a-paid-plan')

  // Interval-agnostic on purpose: an item on the OTHER interval still means
  // this subscription meters, and a webhook is the wrong place to re-price it
  // — that is multi-item surgery, and getting it wrong 500s the webhook into
  // a redelivery loop. The audit script reports such a subscription instead.
  if (items.some((item: any) => isMeteredPriceId(item?.price?.id))) {
    return no('already-metered')
  }

  const priceId = meteredPriceId(interval)
  if (!priceId) {
    const other = meteredPriceId(interval === 'year' ? 'month' : 'year')
    return {
      ...no('no-metered-price'),
      // Said out loud only when the OTHER interval IS configured. That
      // asymmetry is the real fault and no screen shows it; both unset is
      // Stripe simply unprovisioned, and warning on that would train everyone
      // to ignore the warning.
      ...(other
        ? {
            warning: `${
              interval === 'year'
                ? 'STRIPE_PRICE_METERED_YEARLY'
                : 'STRIPE_PRICE_METERED'
            } is unset while the other interval's metered price IS set, so ${interval}ly subscriptions accrue usage that reaches no invoice`,
          }
        : {}),
    }
  }

  if (mode === 'boundary') {
    const startSeconds = Number(input.currentPeriodStart ?? 0)
    // No period start at all — refuse rather than guess. Guessing here means
    // guessing about a retroactive charge.
    if (!Number.isFinite(startSeconds) || startSeconds <= 0) {
      return no('mid-period')
    }
    const nowSeconds = (input.now ?? Date.now()) / 1000
    if (nowSeconds - startSeconds > BOUNDARY_GRACE_SECONDS) {
      return no('mid-period')
    }
  }

  return { attach: true, priceId, interval, reason: 'attach' }
}

/**
 * Adds the metered item to a live subscription. Returns whether it attached.
 *
 * BEST EFFORT BY CONTRACT. A throw here would 500 the webhook, and Stripe
 * would redeliver the whole event — re-applying every mirror above it for
 * nothing. The operation is self-healing instead: it re-runs on every
 * subscription event and at every renewal, so a failed attempt is retried by
 * the next one rather than by Stripe.
 */
export async function backfillMeteredItem(options: {
  secretKey: string
  subscriptionId: string
  priceId: string
  /** For the log line only. */
  orgId?: string
}): Promise<boolean> {
  const { secretKey, subscriptionId, priceId, orgId } = options
  try {
    // Re-read before writing. The event payload is the subscription as of the
    // event, and two events for one subscription can be in flight at once — so
    // trusting the payload's item list is how a subscription ends up with TWO
    // metered items and bills its usage twice.
    const fresh = await fetch(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    const subscription = await fresh.json()
    if (!fresh.ok) {
      console.error('[metered-backfill] re-read failed', {
        orgId,
        subscriptionId,
        error: subscription?.error?.message,
      })
      return false
    }
    const items: any[] = subscription?.items?.data ?? []
    if (items.some((item: any) => isMeteredPriceId(item?.price?.id))) {
      // Another delivery won the race. Nothing to do, and nothing wrong.
      return false
    }

    const response = await fetch('https://api.stripe.com/v1/subscription_items', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Belt to the re-read's braces: same subscription + same price can
        // only take effect once inside Stripe's 24h idempotency window,
        // however many deliveries race. Keyed on the SUBSCRIPTION, not the
        // event, because it is duplicate ITEMS that cost money.
        'Idempotency-Key': `agl1352-metered:${subscriptionId}:${priceId}`,
      },
      body: new URLSearchParams({
        subscription: subscriptionId,
        price: priceId,
        // A metered price carries no quantity — Stripe rejects one.
        //
        // `none` because there is nothing to prorate: the item bills $0 until
        // usage is reported. `create_prorations` would additionally cut an
        // invoice immediately, which is the last thing a silent back-fill
        // should do to a customer's card.
        proration_behavior: 'none',
      }).toString(),
    })
    const created = await response.json()
    if (!response.ok) {
      console.error('[metered-backfill] attach failed', {
        orgId,
        subscriptionId,
        priceId,
        error: created?.error?.message,
      })
      return false
    }
    console.warn('[metered-backfill] attached the metered usage item', {
      orgId,
      subscriptionId,
      priceId,
      itemId: created?.id,
    })
    return true
  } catch (error) {
    console.error('[metered-backfill] attach threw', {
      orgId,
      subscriptionId,
      priceId,
      error,
    })
    return false
  }
}
