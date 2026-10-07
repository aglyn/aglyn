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

import { merchantAccountIsReady } from '@aglyn/tenant-data-admin/server/payment-provider'
import { readOrgBilling } from '@aglyn/tenant-data-admin'
import {
  labelChargeCents,
  LABEL_MARKUP_PCT,
  type LabelBillingMethod,
  type LabelBillingState,
} from '../model/label-billing'
import { readDebitConsent } from './account-store'
import type { ShippingConfig } from './config'
import { shippingDb } from './db'

/**
 * RECOVERING A LABEL'S COST FROM THE MERCHANT (AGL-3612).
 *
 * The provider bills the PLATFORM for every label bought on its own carrier
 * accounts, so each one is recovered — at cost plus `LABEL_MARKUP_PCT`
 * (zero) — by the first of these that applies:
 *
 * 1. **Account debit.** A charge with the merchant's connected account as its
 *    `source` (Stripe, "Debit connected accounts"): it moves funds from the
 *    merchant's Stripe balance to the platform's at once. Valid here because
 *    the merchants are Express accounts the platform created
 *    (`commerce/server/connect.ts`, `type: 'express'`), for which the platform
 *    is responsible for negative balances — the requirement the docs state —
 *    and only once the member has agreed to it (`account-store.ts`). Stripe
 *    refuses a debit that would take the balance negative, or in another
 *    currency than the account's default; either refusal falls to (2).
 * 2. **Usage invoice.** Counted toward the month and billed by the monthly
 *    usage sweep through this plugin's usage meter, on the workspace's own
 *    subscription invoice — the `offlineFees` precedent, through the
 *    generic meter seam rather than an edit to the sweep.
 *
 * A workspace that has neither — no consent or no connected account, and no
 * Stripe customer to invoice — is REFUSED before a label is bought.
 *
 * Every Stripe call carries an idempotency key derived from the label id, so
 * a retried purchase can never debit twice, and a voided label's credit is a
 * refund of that same payment under its own derived key.
 */

export interface LabelBillingPlan {
  method: LabelBillingMethod
  /** The connected account to debit, for `account_debit`. */
  stripeAccountId?: string
  chargeCents: number
  markupPct: number
}

export type LabelBillingRefusal = { refused: true; message: string }

/** The merchant's connected Stripe account, when it may be charged in this mode. */
async function connectedAccountFor(org: Record<string, unknown>): Promise<string | null> {
  const ownerUid = String(org['ownerUid'] ?? '')
  if (!ownerUid) return null
  const profile = await shippingDb().collection('profiles').doc(ownerUid).get()
  const accountId = profile.get('stripeAccountId')
  // The same gate every charge door asks (AGL-2471): charges enabled, and
  // the account's recorded mode matching this deployment's.
  const ready = merchantAccountIsReady(
    {
      accountId,
      chargesEnabled: profile.get('stripeChargesEnabled'),
      accountLivemode: profile.get('stripeAccountLivemode'),
    },
    { subject: `shipping label debit for owner ${ownerUid}` },
  )
  return ready && typeof accountId === 'string' ? accountId : null
}

/**
 * How this label will be paid for, decided BEFORE it is bought, or a
 * refusal a merchant can act on.
 */
export async function planLabelBilling(input: {
  orgId: string
  org: Record<string, unknown>
  config: ShippingConfig
  costCents: number
  /** The rate is on a carrier account the merchant connected. */
  merchantCarrierAccount: boolean
}): Promise<LabelBillingPlan | LabelBillingRefusal> {
  if (input.config.testMode) {
    return { method: 'test', chargeCents: 0, markupPct: 0 }
  }
  if (input.merchantCarrierAccount) {
    return { method: 'carrier_account', chargeCents: 0, markupPct: 0 }
  }
  const chargeCents = labelChargeCents(input.costCents)
  const [consent, stripeAccountId, billing] = await Promise.all([
    readDebitConsent(input.orgId, input.config),
    connectedAccountFor(input.org),
    readOrgBilling(input.orgId),
  ])
  if (consent && stripeAccountId) {
    return { method: 'account_debit', stripeAccountId, chargeCents, markupPct: LABEL_MARKUP_PCT }
  }
  if (billing.stripeCustomerId) {
    return { method: 'usage_invoice', chargeCents, markupPct: LABEL_MARKUP_PCT }
  }
  return {
    refused: true,
    message:
      'Labels can’t be paid for yet. Allow label costs to be taken from your Stripe balance ' +
      'in Shipping settings, or add a payment method on the Billing page.',
  }
}

/** One Stripe form POST, with an idempotency key. Never logs the key. */
async function stripeForm<T>(
  path: string,
  params: Record<string, string>,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; body: T & { error?: { message?: string; code?: string } } }> {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env['STRIPE_SECRET_KEY'] ?? ''}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: new URLSearchParams(params).toString(),
  })
  return { ok: response.ok, body: (await response.json().catch(() => ({}))) as never }
}

let stripeFetch: typeof fetch | null = null

/** Test seam: the `fetch` the Stripe calls here make. */
export function setLabelBillingFetchForTests(fetchImpl: typeof fetch | null): void {
  stripeFetch = fetchImpl
}

export interface LabelBillingRecord {
  method: LabelBillingMethod
  state: LabelBillingState
  chargeCents: number
  markupPct: number
  currency: string
  /** `YYYY-MM` the charge counts toward, for the usage meter. */
  month: string
  stripePaymentId?: string
  stripeRefundId?: string
  failure?: string
  chargedAtMs?: number
  creditedAtMs?: number
  /** `YYYY-MM` the credit was given in; the usage meter takes it off that month. */
  creditMonth?: string
}

export function monthOf(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 7)
}

/**
 * Takes the label's charge as planned. A debit Stripe refuses becomes a
 * usage-invoice charge — the label is bought, so its cost is owed either
 * way — and the record says why.
 */
export async function chargeLabel(input: {
  labelId: string
  plan: LabelBillingPlan
  currency: string
  description: string
  atMs?: number
}): Promise<LabelBillingRecord> {
  const atMs = input.atMs ?? Date.now()
  const base = {
    chargeCents: input.plan.chargeCents,
    markupPct: input.plan.markupPct,
    currency: input.currency,
    month: monthOf(atMs),
  }
  if (input.plan.method === 'test' || input.plan.method === 'carrier_account') {
    return { ...base, method: input.plan.method, state: 'not_billed' }
  }
  if (input.plan.chargeCents <= 0) {
    return { ...base, method: input.plan.method, state: 'not_billed' }
  }
  if (input.plan.method === 'account_debit' && input.plan.stripeAccountId) {
    try {
      const debit = await stripeForm<{ id?: string }>(
        'charges',
        {
          amount: String(input.plan.chargeCents),
          currency: input.currency.toLowerCase(),
          source: input.plan.stripeAccountId,
          description: input.description.slice(0, 200),
          'metadata[type]': 'shipping-label',
          'metadata[labelId]': input.labelId,
        },
        `shipping-label:${input.labelId}:debit`,
        stripeFetch ?? fetch,
      )
      if (debit.ok && debit.body.id) {
        return {
          ...base,
          method: 'account_debit',
          state: 'charged',
          stripePaymentId: debit.body.id,
          chargedAtMs: atMs,
        }
      }
      return {
        ...base,
        method: 'usage_invoice',
        state: 'deferred',
        failure: String(debit.body.error?.message ?? 'The Stripe balance could not be debited').slice(0, 300),
      }
    } catch {
      return { ...base, method: 'usage_invoice', state: 'deferred', failure: 'Stripe could not be reached' }
    }
  }
  return { ...base, method: 'usage_invoice', state: 'charged', chargedAtMs: atMs }
}

/**
 * Gives a voided label's charge back once the provider refunded it: the
 * debit is refunded to the balance it came from; a usage-invoice charge is
 * marked credited, which takes it out of the month the meter bills.
 */
export async function creditLabel(input: {
  labelId: string
  billing: LabelBillingRecord
  atMs?: number
}): Promise<LabelBillingRecord> {
  const atMs = input.atMs ?? Date.now()
  const billing = input.billing
  if (billing.state === 'credited' || billing.state === 'not_billed') return billing
  if (billing.method === 'account_debit' && billing.stripePaymentId) {
    const refund = await stripeForm<{ id?: string }>(
      'refunds',
      {
        charge: billing.stripePaymentId,
        'metadata[type]': 'shipping-label-void',
        'metadata[labelId]': input.labelId,
      },
      `shipping-label:${input.labelId}:credit`,
      stripeFetch ?? fetch,
    )
    if (!refund.ok || !refund.body.id) {
      throw new Error(refund.body.error?.message ?? 'The label charge could not be refunded')
    }
    return {
      ...billing,
      state: 'credited',
      stripeRefundId: refund.body.id,
      creditedAtMs: atMs,
      creditMonth: monthOf(atMs),
    }
  }
  return { ...billing, state: 'credited', creditedAtMs: atMs, creditMonth: monthOf(atMs) }
}
