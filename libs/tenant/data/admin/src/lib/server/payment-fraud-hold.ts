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

/*==========================================
 * THE PAYMENT-FRAUD HOLD: THE DURABLE HALF (AGL-3767).
 *
 * When Stripe says a workspace's OWN subscription payment is fraud, the
 * workspace is put on an automatic `security` hold: the workspace and each
 * of its sites locked as a takedown, its subscriptions canceled, staff
 * alerted once. Never `abuse`: that is a permanent ban, and Stripe's verdict
 * is a strong signal about a card, not a decision about a person. Staff
 * re-place the hold as `abuse` on Staff → Lockdown, or lift it.
 *
 * Three triggers, all on charges that resolve to a workspace through the
 * `stripeCustomers` index — never a site's sale on a connected account:
 *
 *  1. one failed charge Radar BLOCKED at `highest` risk, or that Stripe
 *     itself reported as `fraudulent` ({@link chargeFraudTrigger});
 *  2. CARD CYCLING: failed charges on {@link PAYMENT_FRAUD_HOLD}'s
 *     `cyclingMinCards` or more distinct card fingerprints within its
 *     `cyclingWindowMs` ({@link cardCyclingPattern}). A real customer whose
 *     card is declined tries it again, or tries one other card; three
 *     different cards inside half an hour on one invoice is a card tester
 *     working through a list. The workspace that prompted this (2026-10-13)
 *     put four cards on one $56 invoice in two minutes;
 *  3. an issuer's early fraud warning or a Radar review on the workspace's
 *     charge — filed by `payment-fraud-signal.ts`, which asks for the hold.
 *
 * Two guards turn the hold into an alert only: a workspace 14 or more days
 * old, or one that has paid an invoice with any charge other than the
 * flagged ones. Those are customers with a history, and a person decides.
 *
 * This module is the state: one `paymentFraudHolds/{orgId}` document holding
 * the workspace's recent failed charges (what card cycling counts) and the
 * hold's own state, claimed in a transaction so a Stripe redelivery, or two
 * events about one attempt arriving together, place one hold and raise one
 * alert. The locks themselves are the console's
 * (`apps/console/utils/server/payment-fraud-hold.ts`), because only the
 * console holds the lockdown cores.
 *=========================================*/

/** One document per workspace. Admin SDK only; no client rule opens it. */
export const PAYMENT_FRAUD_HOLD_COLLECTION = 'paymentFraudHolds'

/** The actor every automatic payment-fraud lock's audit rows name. */
export const PAYMENT_FRAUD_HOLD_ACTOR_UID = 'system:payment-fraud'

/** The lock reason the hold places. Never `abuse`: see the module header. */
export const PAYMENT_FRAUD_HOLD_LOCK_REASON = 'security'

export const PAYMENT_FRAUD_HOLD = {
  /** Distinct card fingerprints failing on one workspace… */
  cyclingMinCards: 3,
  /** …within this window. */
  cyclingWindowMs: 30 * 60_000,
  /** A workspace this many days old or older gets an alert, not a lock. */
  youngDays: 14,
  /** How long a failed charge is kept on the workspace's document. */
  retainMs: 24 * 60 * 60_000,
  /** And at most this many of them. */
  maxFailures: 30,
  /** After an alert-only decision, how long before another may be raised. */
  alertWindowMs: 24 * 60 * 60_000,
  /** How long one run may hold a claim before another may take it over. */
  claimLeaseMs: 10 * 60_000,
} as const

/** Why a hold was asked for. */
export type PaymentFraudHoldTrigger =
  | 'radar-blocked'
  | 'stripe-reported-fraud'
  | 'card-cycling'
  | 'early-fraud-warning'
  | 'radar-review'

export const PAYMENT_FRAUD_HOLD_TRIGGER_LABELS: Record<PaymentFraudHoldTrigger, string> = {
  'radar-blocked': 'Radar blocked a payment at highest risk',
  'stripe-reported-fraud': 'Stripe reported a payment as fraudulent',
  'card-cycling': `${PAYMENT_FRAUD_HOLD.cyclingMinCards} or more different cards failed within ${
    PAYMENT_FRAUD_HOLD.cyclingWindowMs / 60_000
  } minutes`,
  'early-fraud-warning': 'An issuer sent an early fraud warning',
  'radar-review': 'Radar opened a review',
}

/** What one charge says about the card, kept as evidence. */
export interface PaymentFraudChargeEvidence {
  chargeId: string
  paymentIntentId: string | null
  invoiceId: string | null
  /** The card's fingerprint: the same card number always has the same one. */
  fingerprint: string | null
  cardCountry: string | null
  cardBrand: string | null
  last4: string | null
  /** `outcome.type`: `blocked`, `issuer_declined`, `authorized`… */
  outcomeType: string | null
  /** `outcome.reason`: `highest_risk_level`, `rule`… */
  outcomeReason: string | null
  riskLevel: string | null
  riskScore: number | null
  /** `fraud_details.stripe_report`. */
  stripeReport: string | null
  failureCode: string | null
  declineCode: string | null
  postalCheck: string | null
  cvcCheck: string | null
  amountCents: number | null
  currency: string
  atMs: number
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function refOf(value: unknown): string | null {
  if (typeof value === 'string') return value || null
  return text((value as { id?: unknown } | null)?.id)
}

/** A Stripe Charge object → the evidence kept about it. Pure. */
export function chargeEvidence(charge: any, atMs: number): PaymentFraudChargeEvidence {
  const card = charge?.payment_method_details?.card ?? {}
  const outcome = charge?.outcome ?? {}
  const amount = Number(charge?.amount)
  const score = Number(outcome?.risk_score)
  return {
    chargeId: String(charge?.id ?? ''),
    paymentIntentId: refOf(charge?.payment_intent),
    invoiceId: refOf(charge?.invoice),
    fingerprint: text(card?.fingerprint),
    cardCountry: text(card?.country),
    cardBrand: text(card?.brand),
    last4: text(card?.last4),
    outcomeType: text(outcome?.type),
    outcomeReason: text(outcome?.reason),
    riskLevel: text(outcome?.risk_level),
    riskScore: outcome?.risk_score == null || !Number.isFinite(score) ? null : score,
    stripeReport: text(charge?.fraud_details?.stripe_report),
    failureCode: text(charge?.failure_code),
    declineCode: text(outcome?.network_decline_code),
    postalCheck: text(card?.checks?.address_postal_code_check),
    cvcCheck: text(card?.checks?.cvc_check),
    amountCents: Number.isFinite(amount) ? amount : null,
    currency: String(charge?.currency ?? 'usd'),
    atMs,
  }
}

/**
 * Does this ONE charge ask for a hold? Stripe's own fraud report first —
 * it is the stronger statement — then a Radar block at `highest` risk. A
 * block at `elevated` risk, or by a custom rule, is not enough on its own:
 * those catch real customers too, and card cycling is what catches the
 * tester behind them.
 */
export function chargeFraudTrigger(
  evidence: Pick<PaymentFraudChargeEvidence, 'stripeReport' | 'outcomeType' | 'riskLevel'>,
): PaymentFraudHoldTrigger | null {
  if (evidence.stripeReport === 'fraudulent') return 'stripe-reported-fraud'
  if (evidence.outcomeType === 'blocked' && evidence.riskLevel === 'highest') return 'radar-blocked'
  return null
}

/** Whether the failures show card cycling at `nowMs`. Pure. */
export function cardCyclingPattern(
  failures: readonly PaymentFraudChargeEvidence[],
  nowMs: number,
): { matched: boolean; fingerprints: string[] } {
  const since = nowMs - PAYMENT_FRAUD_HOLD.cyclingWindowMs
  const fingerprints = [
    ...new Set(
      failures
        .filter((entry) => entry.atMs >= since && entry.atMs <= nowMs && entry.fingerprint)
        .map((entry) => entry.fingerprint as string),
    ),
  ]
  return { matched: fingerprints.length >= PAYMENT_FRAUD_HOLD.cyclingMinCards, fingerprints }
}

/**
 * The guards (AGL-3767): a workspace 14+ days old, or one that has paid an
 * invoice other than with the flagged charges, is alerted about and never
 * locked automatically. An unreadable creation date is an existing customer,
 * as everywhere else on the platform (`isYoungWorkspaceAge`). Pure.
 */
export function paymentFraudHoldGuard(input: {
  ageDays: number | null
  hasPaidInvoice: boolean
}): { lock: boolean; reason: string | null } {
  if (input.hasPaidInvoice) {
    return { lock: false, reason: 'The workspace has paid an invoice before, so a person decides.' }
  }
  if (
    typeof input.ageDays !== 'number' ||
    !Number.isFinite(input.ageDays) ||
    input.ageDays >= PAYMENT_FRAUD_HOLD.youngDays
  ) {
    return {
      lock: false,
      reason:
        input.ageDays === null || !Number.isFinite(input.ageDays)
          ? 'The workspace has no readable creation date, so it is treated as an existing customer.'
          : `The workspace is ${Math.floor(input.ageDays)} days old (${PAYMENT_FRAUD_HOLD.youngDays} or more), so a person decides.`,
    }
  }
  return { lock: true, reason: null }
}

/**
 * Has this workspace paid an invoice with any charge OTHER than the flagged
 * ones? Read off `platformRevenue`, which holds a row for every paid
 * subscription invoice (AGL-1811). The flagged charges are excluded because
 * a stolen card that went through has "paid" too — an early fraud warning
 * only ever arrives on a charge that succeeded.
 */
export async function hasPaidOtherInvoice(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  flagged: { chargeIds: readonly string[]; paymentIntentIds: readonly string[] },
): Promise<boolean> {
  const rows = await firestore
    .collection('platformRevenue')
    .where('orgId', '==', orgId)
    .limit(25)
    .get()
  return rows.docs.some((row) => {
    if (!(Number(row.get('grossCents')) > 0)) return false
    const chargeId = text(row.get('chargeId'))
    const paymentIntentId = text(row.get('paymentIntentId'))
    if (chargeId && flagged.chargeIds.includes(chargeId)) return false
    if (paymentIntentId && flagged.paymentIntentIds.includes(paymentIntentId)) return false
    return true
  })
}

/**
 * - `watching` — failures recorded, nothing asked for.
 * - `placing` — a run claimed the hold.
 * - `held` — locks placed. Never placed again automatically.
 * - `alerted` — a guard made it an alert only; another alert waits out the window.
 * - `skipped` — never held: the house, a staff-owned workspace, one that is gone.
 */
export type PaymentFraudHoldState = 'watching' | 'placing' | 'held' | 'alerted' | 'skipped'

export interface PaymentFraudHoldRecord {
  orgId: string
  state: PaymentFraudHoldState
  failures: PaymentFraudChargeEvidence[]
  claimedAtMs?: number | null
  heldAtMs?: number | null
  alertedAtMs?: number | null
  trigger?: PaymentFraudHoldTrigger | null
  reviewId?: string | null
  outcome?: Record<string, unknown> | null
  updatedAtMs?: number
}

function holdRef(firestore: FirebaseFirestore.Firestore, orgId: string) {
  return firestore.collection(PAYMENT_FRAUD_HOLD_COLLECTION).doc(orgId)
}

/**
 * Keep one failed charge on its workspace's document and say whether the
 * failures now show card cycling. Idempotent on the charge id: a redelivery
 * adds nothing and reports `added: false`.
 */
export async function recordWorkspaceChargeFailure(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  evidence: PaymentFraudChargeEvidence,
  nowMs: number = Date.now(),
): Promise<{
  added: boolean
  cycling: { matched: boolean; fingerprints: string[] }
  /** The failures inside the cycling window, oldest first, this one included. */
  recent: PaymentFraudChargeEvidence[]
  state: PaymentFraudHoldState
}> {
  const ref = holdRef(firestore, orgId)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const stored = (snapshot.exists ? (snapshot.data() ?? {}) : {}) as Partial<PaymentFraudHoldRecord>
    const previous = Array.isArray(stored.failures) ? stored.failures : []
    const state = (stored.state ?? 'watching') as PaymentFraudHoldState
    const added = !previous.some((entry) => entry.chargeId === evidence.chargeId)
    const failures = added
      ? [...previous.filter((entry) => entry.atMs >= nowMs - PAYMENT_FRAUD_HOLD.retainMs), evidence].slice(
          -PAYMENT_FRAUD_HOLD.maxFailures,
        )
      : previous
    if (added) {
      transaction.set(
        ref,
        {
          orgId,
          failures,
          ...(snapshot.exists ? {} : { state: 'watching' }),
          updatedAtMs: nowMs,
        },
        { merge: true },
      )
    }
    return {
      added,
      cycling: cardCyclingPattern(failures, nowMs),
      recent: failures.filter((entry) => entry.atMs >= nowMs - PAYMENT_FRAUD_HOLD.cyclingWindowMs),
      state,
    }
  })
}

/**
 * Claim the workspace's hold for this run. Answers `claimed: false` with the
 * reason when the hold is already placed, another run is placing it inside
 * its lease, or a guard already alerted inside the alert window — which is
 * what makes a redelivery, or the next card in a burst, a no-op.
 */
export async function claimPaymentFraudHold(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  trigger: PaymentFraudHoldTrigger,
  nowMs: number = Date.now(),
): Promise<{
  claimed: boolean
  /** Why not, when `claimed` is false. */
  reason: 'held' | 'placing' | 'alerted' | 'skipped' | null
}> {
  const ref = holdRef(firestore, orgId)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const record = (snapshot.exists ? (snapshot.data() ?? {}) : {}) as Partial<PaymentFraudHoldRecord>
    const state = (record.state ?? 'watching') as PaymentFraudHoldState
    if (state === 'held') return { claimed: false as const, reason: 'held' as const }
    if (state === 'skipped') return { claimed: false as const, reason: 'skipped' as const }
    if (
      state === 'placing' &&
      typeof record.claimedAtMs === 'number' &&
      nowMs - record.claimedAtMs < PAYMENT_FRAUD_HOLD.claimLeaseMs
    ) {
      return { claimed: false as const, reason: 'placing' as const }
    }
    if (
      state === 'alerted' &&
      typeof record.alertedAtMs === 'number' &&
      nowMs - record.alertedAtMs < PAYMENT_FRAUD_HOLD.alertWindowMs
    ) {
      return { claimed: false as const, reason: 'alerted' as const }
    }
    transaction.set(
      ref,
      { orgId, state: 'placing', claimedAtMs: nowMs, trigger, updatedAtMs: nowMs },
      { merge: true },
    )
    return { claimed: true, reason: null }
  })
}

/** Record what the run did with a claimed hold. */
export async function settlePaymentFraudHold(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  state: 'held' | 'alerted' | 'skipped' | 'watching',
  fields: { reviewId?: string | null; outcome?: Record<string, unknown> | null },
  nowMs: number = Date.now(),
): Promise<void> {
  await holdRef(firestore, orgId).set(
    {
      state,
      ...(state === 'held' ? { heldAtMs: nowMs } : {}),
      ...(state === 'alerted' ? { alertedAtMs: nowMs } : {}),
      ...(fields.reviewId !== undefined ? { reviewId: fields.reviewId } : {}),
      ...(fields.outcome !== undefined ? { outcome: fields.outcome } : {}),
      claimedAtMs: null,
      updatedAtMs: nowMs,
    },
    { merge: true },
  )
}

/**
 * Is this workspace on an automatic payment-fraud hold? What collapses the
 * per-attempt `staff.paymentFailed` pings: once a workspace is held, the
 * hold's one alert is the news, and each further declined card is not.
 */
export async function isPaymentFraudHeld(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<boolean> {
  const snapshot = await holdRef(firestore, orgId).get()
  return snapshot.exists && snapshot.get('state') === 'held'
}
