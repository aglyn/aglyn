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
 * WRITING A WORKSPACE'S OVERAGE STANDING (AGL-3011).
 *
 * Every writer of `orgs/{orgId}/aiBilling/standing` is here, and each one is
 * a transaction over the document it changes — the ladder and the pause are
 * read by the gate on every request past the band, so a read-modify-write
 * that lost a concurrent event would lose a pause or a step.
 *
 * `ai-overage-standing.ts` holds the shape and the arithmetic; this holds the
 * writes. Nothing here decides a policy: what qualifies a month and what a
 * ceiling resolves to are answered there, once, for the gate and the staff
 * card as well as for these.
 */

import { FieldValue } from 'firebase-admin/firestore'
import {
  AI_BILLING_STANDING_DOC,
  AI_BILLING_SUBCOLLECTION,
} from './ai-overage-ledger'
import {
  AI_OVERAGE_QUALIFYING_MONTHS_KEPT,
  aiOverageQualifyingMonth,
  aiOverageStep,
  readAiOverageStanding,
  type AiOveragePauseReason,
  type AiOverageStanding,
} from './ai-overage-standing'

function standingRef(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): FirebaseFirestore.DocumentReference {
  return firestore
    .collection('orgs')
    .doc(orgId)
    .collection(AI_BILLING_SUBCOLLECTION)
    .doc(AI_BILLING_STANDING_DOC)
}

/**
 * Reads the standing, hands it to `change`, and writes back what comes out.
 *
 * `change` returning `null` writes nothing — which is how "this event does
 * not move the standing" is said without a write that only restamps
 * `updatedAt` and wakes every listener on the document.
 */
async function updateStanding(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  change: (standing: AiOverageStanding) => Record<string, unknown> | null,
): Promise<void> {
  const ref = standingRef(firestore, orgId)
  await firestore.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref)
    const standing = readAiOverageStanding(
      snapshot.exists ? (snapshot.data() ?? null) : null,
    )
    const write = change(standing)
    if (!write) return
    tx.set(ref, { ...write, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}

/** The mirrored `step`, kept beside the months it is derived from. */
function withStep(
  months: string[],
): { qualifyingMonths: string[]; step: number } {
  const kept = months.slice(-AI_OVERAGE_QUALIFYING_MONTHS_KEPT)
  return {
    qualifyingMonths: kept,
    step: aiOverageStep({ qualifyingMonths: kept } as AiOverageStanding),
  }
}

/**
 * Stops accrual.
 *
 * An existing pause is NOT overwritten: the first reason is the one that
 * started it and the one the customer was told, and a `past_due` arriving
 * behind a `charge_failed` would replace a sentence naming an invoice the
 * customer can pay with one that names nothing. The exception is a dispute,
 * which outranks everything because only staff may lift it.
 */
export async function pauseAiOverage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  pause: { reason: AiOveragePauseReason; invoiceId?: string | null; now: Date },
): Promise<void> {
  await updateStanding(firestore, orgId, (standing) => {
    if (standing.pause && standing.pause.reason === 'dispute') return null
    if (standing.pause && pause.reason !== 'dispute') return null
    return {
      pause: {
        reason: pause.reason,
        invoiceId: pause.invoiceId ?? null,
        since: pause.now.toISOString(),
      },
    }
  })
}

/**
 * Lifts a pause — but only the pause the caller is entitled to lift.
 *
 * Scoped two ways, and the scoping is the point. `invoiceId` lifts only a
 * pause that names that invoice, so paying an AI charge clears the pause it
 * caused and nothing else. `reason` lifts only a pause of that kind, so a
 * paid renewal clears `past_due` and leaves a failed AI charge paused — the
 * AI invoice is still open, and resuming accrual against it would let the
 * balance grow while it is unpaid.
 *
 * Unscoped clears whatever is there, which is the staff path and the voided
 * invoice's. A dispute pause is never lifted by a payment of any kind: it
 * needs `force`, which only staff pass.
 */
export async function resumeAiOverage(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  scope: {
    invoiceId?: string | null
    reason?: AiOveragePauseReason
    force?: boolean
  } = {},
): Promise<void> {
  await updateStanding(firestore, orgId, (standing) => {
    if (!standing.pause) return null
    if (standing.pause.reason === 'dispute' && !scope.force) return null
    if (scope.invoiceId && standing.pause.invoiceId !== scope.invoiceId) return null
    if (scope.reason && standing.pause.reason !== scope.reason) return null
    return { pause: null }
  })
}

/**
 * Records a paid invoice, which is what moves a workspace up the ladder.
 *
 * Two different things happen on a first payment and on a later one. The
 * first sets `firstPaidMonth` — the baseline the ladder counts FROM, never a
 * step on it, because every paid workspace pays one invoice the moment it
 * subscribes and a ladder that counted it would start everyone a step up.
 * Every later month with a real payment adds a step.
 *
 * `aiOverageQualifyingMonth` decides which is which, and refuses a payment
 * that is not evidence: an invoice marked paid out of band is a staff
 * action, and a zero payment is a credit.
 */
export async function recordAiOveragePaidInvoice(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  payment: { month: string; amountPaidCents: number; paidOutOfBand: boolean },
): Promise<void> {
  await updateStanding(firestore, orgId, (standing) => {
    if (payment.paidOutOfBand || !(payment.amountPaidCents > 0)) return null
    if (!standing.firstPaidMonth) return { firstPaidMonth: payment.month }
    const month = aiOverageQualifyingMonth(standing, payment)
    if (!month) return null
    if (standing.qualifyingMonths.includes(month)) return null
    return withStep([...standing.qualifyingMonths, month].sort())
  })
}

/**
 * Takes a month back off the ladder.
 *
 * The close-out sweep calls this for a month that ended with an AI charge
 * still unpaid. A month in which the workspace both paid an invoice and left
 * an AI charge unpaid is not evidence of the thing the ladder measures, and
 * leaving it counted would raise a ceiling on the strength of a payment that
 * did not happen.
 */
export async function dropAiOverageQualifyingMonth(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
): Promise<void> {
  await updateStanding(firestore, orgId, (standing) => {
    if (!standing.qualifyingMonths.includes(month)) return null
    return withStep(standing.qualifyingMonths.filter((kept) => kept !== month))
  })
}

/**
 * A dispute: the ladder goes back to the bottom and accrual stops.
 *
 * Both, not either. The reset is about the future — a workspace that
 * disputes has not earned a raised ceiling — and the pause is about now.
 * Only staff can lift the pause, because a dispute is a judgement about the
 * relationship and no automatic event should end it.
 */
export async function recordAiOverageDispute(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  now: Date,
): Promise<void> {
  await updateStanding(firestore, orgId, () => ({
    ...withStep([]),
    firstPaidMonth: null,
    lastDisputeAt: now.toISOString(),
    pause: { reason: 'dispute' as const, invoiceId: null, since: now.toISOString() },
  }))
}

/**
 * Mirrors the workspace's default payment method type.
 *
 * `null` means the customer has no default, which is a real answer and is
 * written. The value is never written as `undefined` — that state means
 * "nobody has looked", and once anyone has, it is gone for good.
 */
export async function recordAiOveragePaymentMethod(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  defaultType: string | null,
): Promise<void> {
  await updateStanding(firestore, orgId, (standing) => {
    if (standing.paymentMethodType === defaultType) return null
    return { paymentMethodType: defaultType }
  })
}

/** Sets or clears the staff ceiling override. */
export async function setAiOverageStaffOverride(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  override:
    | { ceilingUsd: number; reason: string; setBy: string; expiresAt: string | null }
    | null,
  now: Date,
): Promise<void> {
  await updateStanding(firestore, orgId, () => ({
    staffOverride: override
      ? {
          ceilingUsd: override.ceilingUsd,
          reason: override.reason,
          setBy: override.setBy,
          setAt: now.toISOString(),
          expiresAt: override.expiresAt,
        }
      : null,
  }))
}

/**
 * Puts the workspace back at the bottom of the ladder by hand.
 *
 * Staff-only, and separate from the dispute reset: this one does not pause,
 * because staff resetting a step are correcting a standing, not responding
 * to a chargeback.
 */
export async function resetAiOverageStep(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<void> {
  await updateStanding(firestore, orgId, () => withStep([]))
}
