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
export interface DunningSchedule {
  /**
   * Which Stripe mode this describes. It is a field rather than a naming
   * convention because the whole defect was numbers travelling without it.
   */
  mode: 'test' | 'live'
  measuredOn: string
  /** Payment attempts before Stripe gives up, including the first. */
  attempts: number
  /** Days from the failed renewal to the terminal state. */
  cancelsAfterDays: number
  smartRetries: boolean
  terminalStatus: 'canceled' | 'unpaid' | 'past_due'
  terminalReason: string | null
}

export const TEST_MODE_DUNNING_SCHEDULE: DunningSchedule = {
  mode: 'test',
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
 * The live-mode schedule, read from the **live Dashboard by a human** on
 * 2026-08-24 (Settings → Billing → Subscriptions and emails → Manage failed
 * payments → Card payments → Cards → Manage):
 *
 *     ● Smart Retries    Retry up to 4 times within 3 weeks
 *     ○ Custom retries
 *
 * so 1 initial attempt + 4 retries = 5 attempts across 3 weeks = 21 days,
 * and "if all retries for a payment fail" is set to **cancel the
 * subscription**. That is the same shape the test-mode clock drill measured,
 * which is the good outcome — the divergence this issue was opened to catch
 * did not happen.
 *
 * ## HOW MUCH THIS IS WORTH, AND WHY THE CHECKER EXISTS
 *
 * **This value cannot be verified by the API, and it never could be.**
 * Re-probed read-only on 2026-08-24 against a `sk_test_` key, reproducing
 * the 2026-08-20 live probe exactly: `/v1/billing/settings`,
 * `/v1/subscription_settings`, `/v1/billing/dunning`,
 * `/v1/billing/retry_settings`, `/v1/account/settings` and
 * `/v1/billing/configurations` all 404 "Unrecognized request URL", and
 * `GET /v1/account` carries zero fields matching `dunning|retry|smart_retr`.
 * The endpoint list is a property of the API, not of the mode, so a test-key
 * 404 is evidence about live too.
 *
 * So this constant is a **transcription of a human reading a screen**, with
 * no mechanism that would notice if someone changed that screen tomorrow.
 * Treat it accordingly: it is the best available record, not a measurement
 * the code can re-take. `tools/scripts/check-stripe-dunning-drift.mjs`
 * exists because of that gap — it cannot read the setting either, so it
 * instead watches the account's *behaviour* for anything this record would
 * forbid, and re-probes whether Stripe has since shipped a config endpoint
 * that would make the record checkable at last.
 *
 * ## THE OTHER LIVE-ONLY FACT WORTH KNOWING
 *
 * Nothing had ever exercised this in live: as of the 2026-08-20 audit the
 * account had produced no failed live renewal at all, so there is no live
 * observation behind these numbers either — only the Dashboard screen. The
 * first real test of this record is a paying customer's card failing after
 * 2026-09-01.
 */
export const LIVE_MODE_DUNNING_SCHEDULE: DunningSchedule | null = {
  mode: 'live',
  measuredOn: '2026-08-24',
  /** 1 initial attempt + the 4 Smart Retries the Dashboard names. */
  attempts: 5,
  /** "within 3 weeks". */
  cancelsAfterDays: 21,
  smartRetries: true,
  /**
   * "If all retries for a payment fail → **cancel the subscription**."
   *
   * It does NOT mark the subscription `unpaid`. So the auto-lock's
   * `canceled` + `payment_failed` clause is the REACHABLE path in live and
   * the `unpaid` banner branch is the secondary one — the opposite way round
   * from the risk AGL-2430 was opened on.
   */
  terminalStatus: 'canceled' as const,
  terminalReason: 'payment_failed' as const,
}

/**
 * The two neighbouring live settings read in the same pass, kept because
 * each one changes which code path a delinquent customer takes.
 *
 * Same provenance and same caveat as `LIVE_MODE_DUNNING_SCHEDULE`: a human
 * read a screen, and nothing can re-read it.
 */
export const LIVE_MODE_DUNNING_NEIGHBOURS = {
  readOn: '2026-08-24',
  /**
   * "Invoice status → **leave the invoice past-due**." The invoice is not
   * voided when the subscription cancels, so the debt survives the
   * cancellation and remains collectable.
   */
  invoiceAfterFinalRetry: 'leave-past-due' as const,
  /**
   * "If a dispute is opened → **leave the subscription past-due**." A
   * chargeback therefore does NOT cancel; it parks the subscription in
   * `past_due`, which is the banner's primary branch.
   */
  onDispute: 'leave-past-due' as const,
  /** `Upcoming renewal events` fire 15 days before the renewal. */
  upcomingRenewalNoticeDays: 15,
}

/**
 * Whether anyone here has read the live schedule at all.
 *
 * Note what this does and does not license. It is `true` from 2026-08-24 —
 * the Dashboard was opened and the numbers written down. It is NOT a
 * statement that the numbers are still current, because nothing can check
 * that; see `MAY_QUOTE_RETRY_WINDOW_IN_COPY` for the separate question of
 * whether customer copy may repeat them.
 */
export const LIVE_RETRY_WINDOW_IS_KNOWN = LIVE_MODE_DUNNING_SCHEDULE !== null

/**
 * Whether customer-facing copy may quote a concrete retry count or window.
 *
 * **`false`, deliberately, even though the window is now known.** These are
 * two different questions and collapsing them is the mistake this constant
 * exists to prevent.
 *
 * Knowing a number today does not make it safe to print. The retry schedule
 * is a Dashboard setting with no API surface (see above), so the instant
 * anyone edits that screen the copy becomes a lie, and there is no check —
 * not this repo's, not Stripe's — that would go red. A banner that says
 * "we retry for 21 days" is a promise the code cannot keep and cannot even
 * audit. A banner that says "access continues while Stripe retries, and your
 * plan stops if the retries run out" is true under every setting that screen
 * can hold, including the one it holds after somebody changes it.
 *
 * The number's legitimate use is internal: reconciling
 * `BILLING_LOCK_GRACE_DAYS`, and giving the drift checker something to test
 * observed behaviour against. Both are readers who can be corrected. A
 * customer who read a stale promise cannot.
 */
export const MAY_QUOTE_RETRY_WINDOW_IN_COPY = false

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
export const LIVE_STRIPE_DUNNING_EMAIL_IS_KNOWN = true

/**
 * WHAT THE LIVE DASHBOARD SAYS, read from
 * Settings → Billing → Subscriptions and emails. Recorded here because it is
 * unreadable through the API (see above) and because two of the four lines
 * are decisions with reasons, not merely observations.
 *
 * This constant is documentation with a type. Nothing branches on it — the
 * code cannot read these settings, so a branch would be a lie. It exists so
 * the next person to open that Dashboard page finds out what the current
 * values mean before changing one.
 */
export const LIVE_STRIPE_SUBSCRIPTION_EMAIL_SETTINGS = {
  readOn: '2026-08-24',
  /**
   * The other four customer emails on that screen, all ON as of the read:
   * trial-ending reminder (7 days), upcoming renewals, expiring cards, and
   * bank-debit payment failures. The last was OFF and was turned ON on
   * 2026-08-24 at the explicit instruction, verified persisted after a
   * reload — the only Dashboard write in this whole issue.
   */
  otherCustomerEmailsAllOn: true,
  /**
   * ON. The customer IS told when a card payment fails — this is the only
   * failed-payment email anyone sends. Aglyn composes none of its own, and
   * the in-app notification it does send is suppressed entirely by a muted
   * `billing` category (`system-email-catalog.ts`). Turning this off leaves
   * a failed renewal with no customer-reachable signal at all.
   */
  sendEmailsWhenCardPaymentsFail: true,
  /**
   * `Use a mix of both (Legacy)`, with all four destinations — free-trial
   * reminders, expiring cards, card-payment failures, upcoming renewals —
   * pointing at `https://aglyn.com/`, the marketing homepage.
   *
   * THAT IS THE DEFECT. A customer whose card just failed is mailed a link
   * to a page with no way to update a card, and the subscription then runs
   * out its retries and cancels. `Route.BILLING_ENTRY` (`/billing`) exists
   * to give those four fields somewhere true to point.
   *
   * ⛔ SWITCHING OFF `Use a mix of both (Legacy)` IS IRREVERSIBLE. Stripe
   * shows a confirmation dialog saying so, and the legacy option cannot be
   * restored on this account afterwards. It has been declined deliberately;
   * accepting it is an account owner's decision, never an incidental one.
   */
  paymentMethodUpdates: 'mix-of-both-legacy' as const,
  /**
   * OFF, and it STAYS OFF. This is a decision, not an oversight.
   *
   * The toggle appends a Stripe-hosted "manage your subscription" link to
   * subscription emails, which lands the customer in Stripe's billing portal
   * — where CANCEL is a button. Cancellation at Aglyn goes through the
   * retention funnel (AGL-1859/AGL-1863): survey, downsell, winback, and
   * only then the cancel. A portal link routes around all of it, and the
   * customer who was going to accept a downsell never sees one.
   *
   * The asymmetry is the whole design, and it is the same one the console's
   * own billing page already implements: RECOVERY is self-serve and as
   * frictionless as we can make it — that is what `/billing` is for —
   * while LEAVING goes through Aglyn's funnel. Friction belongs on the way
   * out, never on the way back in.
   *
   * Note this is a different question from the card-update path, which
   * legitimately hands off to Stripe's portal from inside the console
   * (`handleOpenPortal` on the billing page). That hand-off starts from a
   * page we control, after the customer has already arrived somewhere that
   * knows which org they are fixing.
   */
  includeSubscriptionManagementLink: false,
}

/**
 * The URL to paste into all four "Payment method updates" fields.
 *
 * Org-agnostic on purpose — Stripe stores ONE link for the whole account and
 * offers nothing to interpolate a workspace into. `/billing` authenticates
 * the visitor and then routes them to their own workspace's billing page;
 * signed out, it goes through `/signin?continue=/billing` and comes back.
 *
 * `app.` and not the apex: the apex is the marketing site, and a workspace
 * subdomain would name an org the mail cannot know.
 */
export const BILLING_ENTRY_URL = 'https://app.aglyn.com/billing'

/**
 * WHERE Stripe's own dunning emails send a customer.
 *
 * ## Why this constant exists rather than a check
 *
 * Stripe's failed-payment emails carry a link configured by pasting a URL into
 * the Dashboard — Settings → Billing → Subscriptions and emails. That value is
 * held PER MODE, exactly like the retry schedule beside it, and it is the same
 * test/live split this module was written to stop people getting wrong.
 *
 * It is also **not readable through the Stripe API**. Measured against
 * test-mode Stripe: `GET /v1/account` exposes `settings.branding`,
 * `card_payments`, `dashboard`, `invoices`, `payments` and `payouts`, and none
 * of them carries the customer-email link; `billing_portal/configurations`
 * carries only the portal's own `default_return_url`. So nothing in the
 * repository, and nothing in the health check, can read where a customer in
 * dunning is actually being sent right now.
 *
 * What CAN be done is to write down where it should point, so that the value
 * to paste is reviewed, versioned, and the same in both modes. That is this
 * constant. `/api/health/billing` reports it so an operator comparing the two
 * has our expectation in front of them rather than in someone's memory.
 *
 * The destination is the ORG-AGNOSTIC billing entry, deliberately: the link
 * arrives by email, so the recipient is routinely signed out or signed in to
 * the wrong workspace, and a slug-scoped URL would 404 or land them somewhere
 * that is not theirs. That route resolves the workspace after sign-in.
 */
export const DUNNING_EMAIL_RETURN_PATH = '/billing'

/** The absolute URL to paste into the Stripe Dashboard, per deployment. */
export function dunningEmailReturnUrl(
  origin = 'https://app.aglyn.com',
): string {
  return `${origin.replace(/\/+$/, '')}${DUNNING_EMAIL_RETURN_PATH}`
}
