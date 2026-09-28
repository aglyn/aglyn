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
 * A SELLER'S SHARE OF A DESTINATION CHARGE, PULLED BACK (AGL-1794, AGL-3363).
 *
 * Every tenant sale is a destination charge on the platform account, so a
 * lost dispute debits the PLATFORM's balance while the seller keeps the
 * transfer. The AGL-1794 policy: the seller returns their share by a
 * `transfers/{id}/reversals` call; the platform keeps Stripe's dispute fee.
 * This is the Stripe half of that, written once. It started as the commerce
 * webhook's `reverseSellerShare`; the booking deposit's lost dispute uses it
 * too (AGL-3363), so the two cannot drift. Each caller keeps its own record
 * and its own settle marker — this module touches no Firestore.
 *
 * PROPORTIONAL, NEVER MORE: `cause × transfer.amount ÷ charge.amount`,
 * FLOORED, capped at what the transfer has left (`amount − amount_reversed`).
 * No `refund_application_fee`: on a chargeback the platform keeps its
 * commission, a policy switch the AGL-1794 note says not to flip here.
 *
 * IDEMPOTENT at Stripe twice over: a reversal already on the transfer carrying
 * this cause's id in its metadata is ADOPTED rather than repeated (the crash
 * window between the POST and the caller's record), and the POST carries an
 * `Idempotency-Key` derived from the cause, so a racing delivery gets Stripe's
 * stored answer.
 *
 * TRANSIENT failures (a network reject, 429, 5xx) THROW, so the webhook's
 * redelivery is the retry. DEFINITIVE ones answer `not-reversed` with a
 * reason, for the caller to settle and record; no redelivery fixes them.
 *=========================================*/

/** Why nothing was pulled back, when the answer is final. */
export type TransferReversalFailure =
  | 'no-charge-on-cause'
  | 'charge-read-refused'
  | 'no-transfer-on-charge'
  | 'transfer-read-refused'
  | 'transfer-fully-reversed'
  | 'reversal-refused'

export type TransferReversalOutcome =
  /** Pulled back now, or found already pulled back and adopted. */
  | { kind: 'reversed'; cents: number; reversalId: string; adopted: boolean }
  /** Final: settle it and record why. `owedCents` when the share was known. */
  | { kind: 'not-reversed'; reason: TransferReversalFailure; owedCents?: number }
  /** Nothing was attempted and nothing should be settled: retry later. */
  | { kind: 'skipped'; reason: 'no-stripe-key' }

export interface TransferReversalCause {
  /** Which door: decides the metadata key and the idempotency key. */
  kind: 'dispute' | 'refund'
  /** The dispute's or refund's Stripe id. */
  id: string
  /** Cents going back to the cardholder. */
  amountCents: number
  /** The charge whose transfer is pulled back. */
  chargeId: string
  /** More metadata for the reversal: the caller's record id. */
  metadata?: Record<string, string>
}

/** Stripe failures a redelivery can actually fix. */
export function isTransientStripeStatus(status: number): boolean {
  return status === 429 || status >= 500
}

type FetchLike = typeof fetch

async function stripeGet(
  url: string,
  stripeKey: string,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; status: number; body: any }> {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

/** The metadata key a cause's reversal is stamped and found by. */
export function transferReversalMetadataKey(kind: TransferReversalCause['kind']): string {
  return kind === 'dispute' ? 'disputeId' : 'refundId'
}

/**
 * Pull the seller's proportional share of `cause` back from the charge's
 * transfer. See the module header for the rules.
 */
export async function reverseDestinationTransfer(
  cause: TransferReversalCause,
  deps: { stripeKey?: string; fetchImpl?: FetchLike } = {},
): Promise<TransferReversalOutcome> {
  const stripeKey = deps.stripeKey ?? process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return { kind: 'skipped', reason: 'no-stripe-key' }
  const fetchImpl = deps.fetchImpl ?? fetch
  const causeId = String(cause.id ?? '')
  const metadataKey = transferReversalMetadataKey(cause.kind)
  const label = `${cause.kind} ${causeId}`

  const chargeId = String(cause.chargeId ?? '')
  if (!chargeId) return { kind: 'not-reversed', reason: 'no-charge-on-cause' }
  const charge = await stripeGet(
    `https://api.stripe.com/v1/charges/${chargeId}`,
    stripeKey,
    fetchImpl,
  )
  if (!charge.ok) {
    if (isTransientStripeStatus(charge.status)) {
      throw new Error(`Stripe charge read failed (${charge.status}) for ${label}`)
    }
    console.error('Stripe refused the charge read', charge.body?.error)
    return { kind: 'not-reversed', reason: 'charge-read-refused' }
  }
  const transferId = String(charge.body?.transfer ?? '')
  const chargeAmountCents = Math.round(Number(charge.body?.amount ?? 0))
  if (!transferId || !(chargeAmountCents > 0)) {
    return { kind: 'not-reversed', reason: 'no-transfer-on-charge' }
  }
  const transfer = await stripeGet(
    `https://api.stripe.com/v1/transfers/${transferId}`,
    stripeKey,
    fetchImpl,
  )
  if (!transfer.ok) {
    if (isTransientStripeStatus(transfer.status)) {
      throw new Error(`Stripe transfer read failed (${transfer.status}) for ${label}`)
    }
    console.error('Stripe refused the transfer read', transfer.body?.error)
    return { kind: 'not-reversed', reason: 'transfer-read-refused' }
  }
  // The crash window's backstop: the POST landed on a previous delivery and
  // the caller's record did not. Adopt it rather than creating a second one.
  const existing = ((transfer.body?.reversals?.data ?? []) as any[]).find(
    (item) => String(item?.metadata?.[metadataKey] ?? '') === causeId,
  )
  if (existing) {
    return {
      kind: 'reversed',
      cents: Math.round(Number(existing.amount ?? 0)),
      reversalId: String(existing.id ?? ''),
      adopted: true,
    }
  }
  const transferCents = Math.round(Number(transfer.body?.amount ?? 0))
  const alreadyReversedCents = Math.round(Number(transfer.body?.amount_reversed ?? 0))
  const remainingCents = Math.max(0, transferCents - alreadyReversedCents)
  const causeCents = Math.round(Number(cause.amountCents ?? 0))
  const shareCents = Math.min(
    Math.floor((causeCents * transferCents) / chargeAmountCents),
    remainingCents,
  )
  if (!(shareCents > 0)) {
    return { kind: 'not-reversed', reason: 'transfer-fully-reversed', owedCents: 0 }
  }
  const params = new URLSearchParams({
    amount: String(shareCents),
    [`metadata[${metadataKey}]`]: causeId,
  })
  for (const [key, value] of Object.entries(cause.metadata ?? {})) {
    params.set(`metadata[${key}]`, value)
  }
  const response = await fetchImpl(
    `https://api.stripe.com/v1/transfers/${transferId}/reversals`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `${cause.kind}-reversal-${causeId}`,
      },
      body: params.toString(),
    },
  )
  const reversal = await response.json().catch(() => null)
  if (!response.ok) {
    if (isTransientStripeStatus(response.status)) {
      throw new Error(`Stripe transfer reversal failed (${response.status}) for ${label}`)
    }
    console.error('Stripe refused the transfer reversal', reversal?.error)
    return { kind: 'not-reversed', reason: 'reversal-refused', owedCents: shareCents }
  }
  return {
    kind: 'reversed',
    cents: Math.round(Number(reversal?.amount ?? shareCents)),
    reversalId: String(reversal?.id ?? ''),
    adopted: false,
  }
}
