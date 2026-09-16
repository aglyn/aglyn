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
 * CHARGING AI OVERAGE AS IT ACCRUES (AGL-3011).
 *
 * Three entry points, all of them the same three steps — claim, charge,
 * settle — differing only in what makes them run:
 *
 * - `maybeChargeAiOverage` runs after a metered turn's batch commits, and
 *   charges when unbilled overage has reached the threshold.
 * - `closeOutAiOverage` runs after a month ends, and bills the remainder.
 * - `reconcileAiOverageCharge` runs over a claim that never reported an
 *   outcome, and asks Stripe what actually happened.
 *
 * ## Nothing here runs before the cutover
 *
 * Every entry point asks `aiOverageBillsByInvoice` first. With
 * `AI_OVERAGE_INVOICED_FROM` unset — how it ships — each one returns without
 * reading a document, and AI overage keeps billing through the monthly meter
 * exactly as it does today. There is no other switch and no partial state.
 *
 * ## A failed charge fails only its own invoice
 *
 * The invoice this creates is a one-off, not a subscription invoice. A
 * declined card fails it and leaves the plan untouched; the subscription
 * dunning that ends by CANCELING a subscription is not reachable from here.
 * What the failure does do is pause accrual, which stops the balance growing
 * while it is unpaid — and leaves the workspace's included credits working.
 */

import {
  chargeOrgUsageInvoice,
  findOrgUsageInvoice,
} from '@aglyn/tenant-data-admin/server/usage-invoice'
import { AI_PLUGIN_ID } from '../constants'
import { aiOverageBillsByInvoice } from './ai-overage-cutover'
import {
  AI_OVERAGE_CHARGES_SUBCOLLECTION,
  claimAiOverageCharge,
  settleAiOverageCharge,
  type AiOverageChargeKind,
  type AiOverageClaim,
  type AiOverageClaimRefusal,
} from './ai-overage-ledger'
import { pauseAiOverage } from './ai-overage-standing-writes'
import type { AiOverageOrg } from './ai-overage-standing'

/**
 * The Stripe product the overage line is billed against.
 *
 * A product rather than a bare amount because the PRODUCT carries the tax
 * code the account's automatic tax computes from. Created in test mode
 * first and in live mode only with the owner's yes; until the variable is
 * set, no charge is attempted and the reason says so rather than failing
 * against Stripe.
 */
export const AI_OVERAGE_PRODUCT_ENV = 'STRIPE_PRODUCT_AI_OVERAGE'

/** The metadata key the reconcile search matches a claim on. */
export const AI_OVERAGE_CHARGE_METADATA_KEY = 'chargeId'

/** What one attempt did, for logs, the sweep's report and specs. */
export interface AiOverageChargeOutcome {
  charged: boolean
  chargeId: string | null
  invoiceId: string | null
  /** Why nothing was charged, when nothing was. */
  skipped:
    | AiOverageClaimRefusal
    | 'before-cutover'
    | 'no-stripe-customer'
    | 'no-product'
    | null
  /** Stripe's message when a charge was attempted and failed. */
  error: string | null
}

const NOTHING: AiOverageChargeOutcome = {
  charged: false,
  chargeId: null,
  invoiceId: null,
  skipped: null,
  error: null,
}

/** What the caller must hand over; nothing here reads the org document. */
export interface AiOverageChargeRequest {
  orgId: string
  org: AiOverageOrg
  month: string
  /** The workspace's Stripe customer, resolved by the caller from billing. */
  stripeCustomerId: string | null
  now?: Date
}

/**
 * The line as the customer reads it on the invoice.
 *
 * Credits and retail dollars only. Provider cost never reaches a customer
 * surface, and an invoice is the most customer-facing surface there is.
 */
export function aiOverageInvoiceDescription(claim: AiOverageClaim): string {
  const credits = claim.credits.toLocaleString('en-US')
  const month = claim.month
  return claim.kind === 'closeout'
    ? `AI credits past your included band — ${month} close-out (${credits} credits)`
    : `AI credits past your included band — ${month} (${credits} credits)`
}

async function chargeClaim(
  firestore: FirebaseFirestore.Firestore,
  request: AiOverageChargeRequest & { stripeCustomerId: string },
  claim: AiOverageClaim,
): Promise<AiOverageChargeOutcome> {
  const productId = String(process.env[AI_OVERAGE_PRODUCT_ENV] ?? '').trim()
  if (!productId) {
    // The claim is released rather than left open: with no product there is
    // nothing to bill against, and an open claim would block every later
    // charge behind a state that only configuration can change.
    await settleAiOverageCharge(firestore, request.orgId, {
      chargeId: claim.chargeId,
      month: claim.month,
      invoiceId: null,
      status: 'failed',
    })
    return { ...NOTHING, chargeId: claim.chargeId, skipped: 'no-product' }
  }
  const result = await chargeOrgUsageInvoice({
    orgId: request.orgId,
    stripeCustomerId: request.stripeCustomerId,
    productId,
    amountCents: Math.round(claim.amountUsd * 100),
    currency: 'usd',
    description: aiOverageInvoiceDescription(claim),
    metadata: {
      orgId: request.orgId,
      pluginId: AI_PLUGIN_ID,
      kind: 'ai-overage',
      [AI_OVERAGE_CHARGE_METADATA_KEY]: claim.chargeId,
      month: claim.month,
    },
    // One key per attempt, derived from the claim — which is unique per
    // workspace-month-sequence — so a retry of this attempt re-reads the
    // objects the first one made instead of creating a second invoice.
    idempotencyKey: `aiov-${request.orgId}-${claim.chargeId}`,
  })
  // `failed` covers both shapes of a failure, and the difference between
  // them is carried by `invoiceId`: an invoice that exists keeps its claim on
  // the month's unbilled total, and one that never existed releases it. The
  // ledger reads that distinction rather than a second status for it.
  await settleAiOverageCharge(firestore, request.orgId, {
    chargeId: claim.chargeId,
    month: claim.month,
    invoiceId: result.invoiceId,
    status: result.ok ? 'paid' : 'failed',
    // What Stripe took, not what we claimed (AGL-3023). The two agree on
    // every ordinary charge; where they do not, crediting the claim would
    // clear a balance nobody paid.
    paidUsd: result.amountPaidCents / 100,
  })
  if (!result.ok) {
    // `requires_action` reads like "not yet" and is in fact "no": nobody is
    // at the keyboard for an off-session charge, so a 3-D Secure challenge
    // is a charge that will not complete. It pauses accrual like a decline.
    await pauseAiOverage(firestore, request.orgId, {
      reason: 'charge_failed',
      invoiceId: result.invoiceId,
      now: request.now ?? new Date(),
    })
  }
  return {
    charged: result.ok,
    chargeId: claim.chargeId,
    invoiceId: result.invoiceId,
    skipped: null,
    error: result.error,
  }
}

async function runCharge(
  firestore: FirebaseFirestore.Firestore,
  request: AiOverageChargeRequest,
  kind: AiOverageChargeKind,
): Promise<AiOverageChargeOutcome> {
  if (!aiOverageBillsByInvoice(request.month)) {
    return { ...NOTHING, skipped: 'before-cutover' }
  }
  if (!request.stripeCustomerId) {
    return { ...NOTHING, skipped: 'no-stripe-customer' }
  }
  const claim = await claimAiOverageCharge(firestore, {
    orgId: request.orgId,
    org: request.org,
    month: request.month,
    kind,
    now: request.now,
  })
  if (!claim.claimed) return { ...NOTHING, skipped: claim.refused }
  return chargeClaim(
    firestore,
    { ...request, stripeCustomerId: request.stripeCustomerId },
    claim.claimed,
  )
}

/**
 * Charges the workspace when its unbilled overage has reached the threshold.
 *
 * Called from `after()` once a metered turn's batch has committed, never on
 * the request's await path: the tokens are already spent, and making a
 * customer wait on a Stripe round trip to be handed an answer they have
 * already paid for is the wrong trade. A charge that does not happen because
 * the process ended is picked up by the reconcile sweep or by the next turn.
 */
export function maybeChargeAiOverage(
  firestore: FirebaseFirestore.Firestore,
  request: AiOverageChargeRequest,
): Promise<AiOverageChargeOutcome> {
  return runCharge(firestore, request, 'threshold')
}

/**
 * Bills the remainder of a month that has ended.
 *
 * The month's last charge, and the only one that bills below the threshold —
 * there is nothing more to accrue, so anything Stripe will accept is worth
 * settling. A remainder under Stripe's minimum is left unbilled rather than
 * sent as an invoice that can never be paid.
 */
export function closeOutAiOverage(
  firestore: FirebaseFirestore.Firestore,
  request: AiOverageChargeRequest,
): Promise<AiOverageChargeOutcome> {
  return runCharge(firestore, request, 'closeout')
}

/**
 * Asks Stripe what became of a claim that never reported an outcome.
 *
 * The case is a process that died between claiming and charging, or between
 * charging and recording. The claim id is on the invoice's metadata, so the
 * question "did this claim ever become an invoice" has an answer even though
 * this process never saw one.
 *
 * Stripe's search index is eventually consistent, so "not found" means NOT
 * FOUND YET. A claim is only released after a grace period long enough for
 * the index to have caught up; releasing early would create a second invoice
 * for dollars that are already billed.
 */
export async function reconcileAiOverageCharge(
  firestore: FirebaseFirestore.Firestore,
  request: { orgId: string; month: string; chargeId: string; claimedAgeMs: number },
  options: { graceMs?: number } = {},
): Promise<{ resolved: boolean; invoiceId: string | null; released: boolean }> {
  const graceMs = options.graceMs ?? 15 * 60 * 1000
  const found = await findOrgUsageInvoice({
    metadataKey: AI_OVERAGE_CHARGE_METADATA_KEY,
    metadataValue: request.chargeId,
  })
  if (found.invoiceId) {
    await settleAiOverageCharge(firestore, request.orgId, {
      chargeId: request.chargeId,
      month: request.month,
      invoiceId: found.invoiceId,
      status:
        found.status === 'paid'
          ? 'paid'
          : found.status === 'void'
            ? 'void'
            : found.status === 'uncollectible'
              ? 'void'
              : 'open',
      // The found invoice's own collected figure (AGL-3023), never the
      // claim: a reconcile that credited what we meant to charge would clear
      // a balance on the strength of an invoice it had just looked up.
      paidUsd: found.amountPaidCents / 100,
    })
    return { resolved: true, invoiceId: found.invoiceId, released: false }
  }
  if (found.error) return { resolved: false, invoiceId: null, released: false }
  if (request.claimedAgeMs < graceMs) {
    return { resolved: false, invoiceId: null, released: false }
  }
  // Old enough that the index would have it. No invoice was ever created, so
  // the dollars the claim reserved go back to unbilled and a later charge
  // bills them.
  await settleAiOverageCharge(firestore, request.orgId, {
    chargeId: request.chargeId,
    month: request.month,
    invoiceId: null,
    status: 'failed',
  })
  return { resolved: true, invoiceId: null, released: true }
}

/** The path a claimed charge's audit row lives at, for the sweep's query. */
export function aiOverageChargesPath(orgId: string): string {
  return `orgs/${orgId}/${AI_OVERAGE_CHARGES_SUBCOLLECTION}`
}
