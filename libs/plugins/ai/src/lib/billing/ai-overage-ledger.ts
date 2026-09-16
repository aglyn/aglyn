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
 * THE OVERAGE CHARGE LEDGER (AGL-3011).
 *
 * Every dollar of AI overage a workspace is charged mid-period passes
 * through here twice: once as a CLAIM, taken in a transaction before any
 * money is asked for, and once as a SETTLEMENT, recorded after Stripe
 * answers. Nothing in this module talks to Stripe.
 *
 * ## Why claim first
 *
 * The figure that decides a charge — the month's overage — is a counter many
 * requests move. Two requests crossing the threshold a millisecond apart
 * both read "$25 unbilled" and would both charge for it. The claim closes
 * that: inside one transaction it moves `overageInvoicedUsd` forward by the
 * amount it is about to charge and records an open charge, so the second
 * request reads an already-claimed balance and stands down. The invoice is
 * created afterwards, outside the transaction, because a Stripe call inside
 * a Firestore transaction would be retried by the transaction.
 *
 * ## What a lost process costs
 *
 * A claim that never became an invoice leaves `overageInvoicedUsd` ahead of
 * what was billed, which UNDER-charges rather than over-charges, and leaves
 * an open charge that blocks the next one. Both are repaired by the
 * reconcile sweep, which asks Stripe whether the claim ever became an
 * invoice and either records it or releases the claim. Under-charging while
 * confused is the direction this must err in.
 *
 * ## The documents
 *
 * `orgs/{orgId}/assistUsage/{YYYY-MM}` — the month's rollup, which the
 * reservation already reads, gains four fields so the gate costs no extra
 * read: `overageInvoicedUsd`, `overagePaidUsd`, `overageCharges` and
 * `overageInvoiceOpen`.
 *
 * `orgs/{orgId}/aiOverageCharges/{chargeId}` — one row per charge, the
 * audit trail staff read and the reconcile sweep walks.
 *
 * Both are server-written: the rules allow the same readers as
 * `aiAllotments` and no writer at all.
 */

import { FieldValue } from 'firebase-admin/firestore'
import { assistMonthOverage } from '@aglyn/aglyn/app-utils/assist-credits'
import {
  AI_OVERAGE_MIN_CHARGE_USD,
  AI_OVERAGE_THRESHOLD_USD,
  aiOverageCardOnFile,
  readAiOverageStanding,
  type AiOverageOrg,
} from './ai-overage-standing'

/** The subcollection and document the standing lives at. */
export const AI_BILLING_SUBCOLLECTION = 'aiBilling'
export const AI_BILLING_STANDING_DOC = 'standing'
/** The subcollection one row per charge lives in. */
export const AI_OVERAGE_CHARGES_SUBCOLLECTION = 'aiOverageCharges'

/** Which sweep asked for the charge. */
export type AiOverageChargeKind = 'threshold' | 'closeout'

/** Where a charge is in its life. */
export type AiOverageChargeStatus =
  | 'claimed'
  | 'open'
  | 'paid'
  | 'failed'
  | 'void'

/** A claim taken, ready to be charged. */
export interface AiOverageClaim {
  chargeId: string
  orgId: string
  month: string
  seq: number
  kind: AiOverageChargeKind
  /** Floored to the cent — Stripe bills whole cents. */
  amountUsd: number
  /** The credits and rate the amount came from, for the audit row. */
  credits: number
  rateUsdPer1k: number | null
}

/** Why no claim was taken. Each one is a different thing to do about it. */
export type AiOverageClaimRefusal =
  | 'below-threshold'
  | 'charge-already-open'
  | 'no-card'
  | 'paused'
  | 'not-sold'

export type AiOverageClaimResult =
  | { claimed: AiOverageClaim; refused: null }
  | { claimed: null; refused: AiOverageClaimRefusal }

function money(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/** Down to the cent. Never up: a rounded-up cent is a cent never accrued. */
export function floorToCent(usd: number): number {
  return Math.floor(money(usd) * 100) / 100
}

/**
 * `{month}-{seq}` — readable, sortable, and unique per workspace-month.
 *
 * The id is also the Stripe idempotency key's payload and the metadata the
 * reconcile search matches on, so it must survive a URL and a Stripe search
 * query unescaped: digits, a hyphen, nothing else.
 */
export function aiOverageChargeId(month: string, seq: number): string {
  return `${month}-${String(Math.max(1, Math.floor(seq))).padStart(3, '0')}`
}

/**
 * Takes a claim on the workspace's unbilled overage, or explains why not.
 *
 * The four conditions are the design's, in one transaction with the reads
 * they are decided from:
 *
 * - enough unbilled overage (the threshold, or the minimum for a close-out);
 * - no charge already open — one at a time, so a failure has one owner;
 * - a card on file, since the bound assumes a payment method that settles
 *   now rather than in days;
 * - not paused.
 *
 * The card condition abstains when the workspace's payment method has never
 * been observed, for the reason `AiOverageStanding.paymentMethodType` gives.
 * A charge attempted against a customer with no default simply fails, and
 * the failure pauses accrual like any other — the guard is an optimization
 * here, not the safety property.
 */
export async function claimAiOverageCharge(
  firestore: FirebaseFirestore.Firestore,
  request: {
    orgId: string
    org: AiOverageOrg
    month: string
    kind: AiOverageChargeKind
    now?: Date
  },
): Promise<AiOverageClaimResult> {
  const now = request.now ?? new Date()
  const orgRef = firestore.collection('orgs').doc(request.orgId)
  const usageRef = orgRef.collection('assistUsage').doc(request.month)
  const standingRef = orgRef
    .collection(AI_BILLING_SUBCOLLECTION)
    .doc(AI_BILLING_STANDING_DOC)
  // A close-out settles a month that is over: there is nothing left to
  // accrue, so anything Stripe will accept is worth billing. A threshold
  // charge waits for the threshold, which is what keeps the invoice count
  // and its fees down.
  const floorUsd =
    request.kind === 'closeout' ? AI_OVERAGE_MIN_CHARGE_USD : AI_OVERAGE_THRESHOLD_USD

  return firestore.runTransaction(async (tx) => {
    const [usageSnapshot, standingSnapshot] = await Promise.all([
      tx.get(usageRef),
      tx.get(standingRef),
    ])
    const standing = readAiOverageStanding(
      standingSnapshot.exists ? (standingSnapshot.data() ?? null) : null,
    )
    if (aiOverageCardOnFile(standing) === false) {
      return { claimed: null, refused: 'no-card' as const }
    }
    if (standing.pause) return { claimed: null, refused: 'paused' as const }
    if (usageSnapshot.get('overageInvoiceOpen')) {
      return { claimed: null, refused: 'charge-already-open' as const }
    }
    const priced = assistMonthOverage(
      request.org,
      money(usageSnapshot.get('estCostUsd')),
    )
    // A plan that sells nothing past its band prices its overage to zero, so
    // this is structural rather than a check that could be forgotten — but
    // it is named, because "we billed nothing" and "there is nothing to
    // bill" are different answers to a staff question.
    if (priced.overageRateUsd === null) {
      return { claimed: null, refused: 'not-sold' as const }
    }
    const invoicedUsd = money(usageSnapshot.get('overageInvoicedUsd'))
    const unbilledUsd = floorToCent(priced.overageMonthlyUsd - invoicedUsd)
    if (!(unbilledUsd >= floorUsd)) {
      return { claimed: null, refused: 'below-threshold' as const }
    }
    const seq = Math.max(0, Math.floor(money(usageSnapshot.get('overageCharges')))) + 1
    const chargeId = aiOverageChargeId(request.month, seq)
    const claim: AiOverageClaim = {
      chargeId,
      orgId: request.orgId,
      month: request.month,
      seq,
      kind: request.kind,
      amountUsd: unbilledUsd,
      credits: priced.overageCredits,
      rateUsdPer1k: priced.overageRateUsd,
    }
    tx.set(
      usageRef,
      {
        month: request.month,
        overageInvoicedUsd: FieldValue.increment(unbilledUsd),
        overageCharges: FieldValue.increment(1),
        overageInvoiceOpen: {
          chargeId,
          invoiceId: null,
          amountUsd: unbilledUsd,
          since: now.toISOString(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    tx.set(
      orgRef.collection(AI_OVERAGE_CHARGES_SUBCOLLECTION).doc(chargeId),
      {
        month: request.month,
        seq,
        kind: request.kind,
        amountUsd: unbilledUsd,
        credits: priced.overageCredits,
        rateUsdPer1k: priced.overageRateUsd,
        invoiceId: null,
        status: 'claimed' satisfies AiOverageChargeStatus,
        createdAt: FieldValue.serverTimestamp(),
        paidAt: null,
        failedAt: null,
      },
      { merge: true },
    )
    return { claimed: claim, refused: null }
  })
}

/** What Stripe said, as the ledger records it. */
export interface AiOverageSettlement {
  chargeId: string
  month: string
  /** `null` only when no invoice was ever created. */
  invoiceId: string | null
  status: AiOverageChargeStatus
  /**
   * What Stripe actually collected, in dollars (AGL-3023).
   *
   * The month's paid total moves by THIS and never by the claim. The two are
   * normally equal, and the case where they are not is the one that matters:
   * an invoice that finalized at zero or collected less than it billed would
   * otherwise clear a balance nobody paid, and the gate's unpaid bound would
   * be satisfied by our own bookkeeping instead of by money.
   *
   * Omitted on a settlement that is not a payment, where it is not read.
   */
  paidUsd?: number
}

/**
 * Records what became of a claimed charge.
 *
 * `paid` adds the amount to the month's `overagePaidUsd`, which is what the
 * gate's unpaid bound subtracts — so paying is what lets a workspace keep
 * going, and nothing else does.
 *
 * An invoice that exists but is not paid KEEPS its claim on
 * `overageInvoicedUsd`: it is a real bill, Stripe's retries may still settle
 * it, and re-billing the same dollars on a second invoice would charge the
 * customer twice for one month's usage. Only a claim that never became an
 * invoice at all releases what it claimed, so those dollars can be charged
 * by a later attempt.
 *
 * The open-charge slot is always cleared. Leaving it set on a failure would
 * block the close-out and every later charge behind an invoice that is
 * never going to move on its own.
 */
export async function settleAiOverageCharge(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  settlement: AiOverageSettlement,
): Promise<void> {
  const orgRef = firestore.collection('orgs').doc(orgId)
  const usageRef = orgRef.collection('assistUsage').doc(settlement.month)
  const chargeRef = orgRef
    .collection(AI_OVERAGE_CHARGES_SUBCOLLECTION)
    .doc(settlement.chargeId)

  await firestore.runTransaction(async (tx) => {
    const [usageSnapshot, chargeSnapshot] = await Promise.all([
      tx.get(usageRef),
      tx.get(chargeRef),
    ])
    const amountUsd = money(chargeSnapshot.get('amountUsd'))
    // What the month's paid total moves by: what Stripe took. A settlement
    // that claims to be a payment and names no collected figure moves
    // nothing — silence is not evidence of money (AGL-3023).
    const paidUsd = money(settlement.paidUsd)
    const open = usageSnapshot.get('overageInvoiceOpen') as
      | { chargeId?: unknown }
      | null
      | undefined
    const ownsTheSlot = String(open?.chargeId ?? '') === settlement.chargeId
    // Already settled, or settled by another path (the webhook and the
    // synchronous answer both arrive). Recording the status again is
    // harmless; moving the money counters again is not.
    const alreadyPaid = chargeSnapshot.get('status') === 'paid'
    const releases = settlement.status === 'failed' && !settlement.invoiceId
    tx.set(
      chargeRef,
      {
        invoiceId: settlement.invoiceId,
        status: settlement.status,
        ...(settlement.status === 'paid' ? { paidUsd } : {}),
        ...(settlement.status === 'paid'
          ? { paidAt: FieldValue.serverTimestamp() }
          : {}),
        ...(settlement.status === 'failed'
          ? { failedAt: FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
    )
    tx.set(
      usageRef,
      {
        month: settlement.month,
        ...(settlement.status === 'paid' && !alreadyPaid && paidUsd > 0
          ? { overagePaidUsd: FieldValue.increment(paidUsd) }
          : {}),
        ...(releases
          ? {
              overageInvoicedUsd: FieldValue.increment(-amountUsd),
              overageCharges: FieldValue.increment(-1),
            }
          : {}),
        ...(ownsTheSlot ? { overageInvoiceOpen: null } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
  })
}

/** The month's charge counters, as the customer card and staff card read them. */
export interface AiOverageMonthLedger {
  invoicedUsd: number
  paidUsd: number
  charges: number
  open: { chargeId: string; invoiceId: string | null; amountUsd: number } | null
}

/** Reads the four fields off a month's rollup, defensively. */
export function readAiOverageMonthLedger(
  data: Record<string, unknown> | null | undefined,
): AiOverageMonthLedger {
  const open = data?.['overageInvoiceOpen'] as Record<string, unknown> | null | undefined
  const chargeId = typeof open?.['chargeId'] === 'string' ? open['chargeId'] : ''
  return {
    invoicedUsd: money(data?.['overageInvoicedUsd']),
    paidUsd: money(data?.['overagePaidUsd']),
    charges: Math.max(0, Math.floor(money(data?.['overageCharges']))),
    open: chargeId
      ? {
          chargeId,
          invoiceId:
            typeof open?.['invoiceId'] === 'string' ? (open['invoiceId'] as string) : null,
          amountUsd: money(open?.['amountUsd']),
        }
      : null,
  }
}
