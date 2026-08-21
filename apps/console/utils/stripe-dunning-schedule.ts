/**
 * What we actually know about Stripe's dunning schedule — and, more to the
 * point, which MODE we know it in (AGL-2430).
 *
 * Stripe's retry schedule, the Smart Retries flag, the after-the-final-retry
 * behaviour and the subscription-email toggles are **Dashboard settings held
 * independently per mode**. Test mode and live mode do not share them, and
 * this account has already been shown to diverge between modes on a
 * neighbouring setting (product tax codes were live-only until AGL-1877
 * reconciled them).
 *
 * Before this module the measured TEST-mode numbers were restated in six
 * places — the customer docs, the staff docs, the webhook comments, the
 * auto-lock comments, a spec constant and a console banner — none of which
 * said "test mode". Repeated often enough and without a mode label, a
 * test-mode measurement reads as a fact about the customer's subscription.
 * This module exists so the numbers have exactly one home and cannot be
 * quoted without their mode.
 */

/**
 * The dunning timeline, measured end to end on 2026-08-19 with a Stripe test
 * clock (AGL-1877): `sub_1U6GjZ…` on clock `clock_1U6GjV…`, card swapped to
 * `tok_chargeCustomerFail` with the good one detached so no retry could
 * succeed.
 *
 * **This is a TEST-mode measurement.** It is the basis for the webhook's
 * handling of a dunning cancellation, which is correct regardless of the
 * exact numbers — the shape (retry, retry, terminal state) is what the code
 * branches on.
 */
export const TEST_MODE_DUNNING_SCHEDULE = {
  mode: 'test' as const,
  measuredOn: '2026-08-19',
  /** Payment attempts before Stripe gives up, including the first. */
  attempts: 5,
  /** Days from the failed renewal to the terminal state. */
  cancelsAfterDays: 21.08,
  /** Smart Retries was ON, so the intervals are Stripe's, not a fixed cron. */
  smartRetries: true,
  /**
   * The terminal state. Note it is `canceled`, NOT `unpaid` — the account's
   * test-mode "after the final retry" setting is *cancel the subscription*.
   * `cancellation_details.reason` is `'payment_failed'` and
   * `canceled_at === ended_at`.
   */
  terminalStatus: 'canceled' as const,
  terminalReason: 'payment_failed' as const,
}

/**
 * The live-mode schedule, as read on 2026-08-20.
 *
 * It is `null`, and that is a measurement rather than an omission. Two
 * independent read-only probes of the LIVE account
 * (`acct_1IzHQTDYHP4psn7h`) establish it:
 *
 * 1. **No API surface exposes it.** `GET /v1/account` returns no field
 *    matching `dunning|retry|smart_retr` anywhere in its payload, and every
 *    plausible settings endpoint 404s with "Unrecognized request URL":
 *    `/v1/billing/settings`, `/v1/subscription_settings`,
 *    `/v1/billing/dunning`, `/v1/billing/retry_settings`,
 *    `/v1/account/settings`. (`/v1/billing_portal/configurations` does
 *    resolve, but it is the customer portal, not dunning.)
 * 2. **No live renewal has ever attempted a real charge**, so it cannot be
 *    inferred from an invoice either. The live account holds 3 invoices, all
 *    `paid`; the single `billing_reason: 'subscription_cycle'` one
 *    (`in_1U5qemDYHP4psn7hLzqzXuYc`, 2026-08-18) is **amount 0 with
 *    `attempt_count: 0`** — a zero-amount renewal that never touched a card.
 *    Of 1 live charge, 0 failed. Both live subscriptions are `canceled` with
 *    `cancellation_details.reason: 'cancellation_requested'` — voluntary, not
 *    dunning.
 *
 * Reading it requires a human opening the **live** Dashboard at
 * Settings → Subscriptions and emails. Until someone does, nothing in the
 * product may state a live retry count, a live window length, or a live
 * terminal state as fact.
 */
export const LIVE_MODE_DUNNING_SCHEDULE: typeof TEST_MODE_DUNNING_SCHEDULE | null =
  null

/**
 * Whether the product may quote a concrete retry window to a customer.
 *
 * The console runs against the LIVE account, so the only schedule it is
 * entitled to describe is the live one. While that is unread this is `false`
 * and the dunning banner says what is true in every configuration — access
 * continues while Stripe retries — without naming a duration nobody here has
 * measured.
 */
export const LIVE_RETRY_WINDOW_IS_KNOWN = LIVE_MODE_DUNNING_SCHEDULE !== null

/**
 * Whether Stripe's own failed-payment email reaches the customer in live.
 *
 * Also a Dashboard toggle with no API surface. `system-email-catalog.ts`
 * catalogues `stripe-payment-failed` as `deliveredBy: 'stripe'` precisely
 * because the code cannot read it. Aglyn composes no failed-payment email of
 * its own, and the in-app notification it does send is suppressed entirely by
 * a muted `billing` category — so if this toggle is off in live, a failed
 * renewal has no customer-reachable signal beyond the console banner. Not
 * asserted either way until the live Dashboard is read.
 */
export const LIVE_STRIPE_DUNNING_EMAIL_IS_KNOWN = false
