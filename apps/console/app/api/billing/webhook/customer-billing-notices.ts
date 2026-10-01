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

import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import { PLAN_LABELS, readOrgPlanComp } from '@aglyn/aglyn/app-utils/plan-entitlements'

/**
 * WHAT THE BILLING WEBHOOK TELLS A WORKSPACE'S ADMINS (AGL-3432).
 *
 * Each notice is listed in the console and, for an admin who turned billing
 * email on, mailed under its title. An admin can belong to several
 * workspaces, so every title and body names the workspace, and every body
 * says what happened and what it means without leaning on the title.
 *
 * Kept out of the route so the copy can be read, and pinned, without a
 * signed payload and a Firestore double in front of it. Plans come from the
 * entitlements module itself rather than the server barrel, which the
 * route's own specs replace wholesale.
 */

export interface CustomerBillingNotice {
  title: string
  body: string
}

/** The workspace as a sentence names it: its name, else its slug. */
export function billingNoticeWorkspace(org: {
  get(field: string): unknown
} | null | undefined): string {
  for (const field of ['name', 'slug']) {
    const value = org?.get(field)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return 'your workspace'
}

/** A plan by the name the pricing page prints. */
function planLabel(plan: string): string {
  return (PLAN_LABELS as Record<string, string>)[plan] ?? plan
}

/**
 * The plan a workspace lands on once its subscription is gone: a staff comp
 * when one is stored, because a comp is dormant only while a subscription
 * decides the plan (AGL-3034), else Free.
 */
function planAfterCancellation(org: Record<string, unknown> | null | undefined): string {
  const comp = readOrgPlanComp(org as Partial<AglynOrgBilling> | null | undefined)
  return comp ? `the ${planLabel(comp.plan)} plan it was granted` : 'the Free plan'
}

/** `$42.00`, from Stripe's integer cents. */
function usd(cents: unknown): string {
  const value = Number(cents)
  return `$${((Number.isFinite(value) ? value : 0) / 100).toFixed(2)}`
}

/**
 * A subscription Stripe canceled after its payment retries ran out
 * (`cancellation_details.reason === 'payment_failed'`).
 *
 * Every clause is what the webhook does in the same delivery or what Stripe
 * is configured to do: the plan is mirrored to `free` and nothing is deleted
 * (the downgrade path deletes nothing; over-limit resources stay), and the
 * live dunning settings leave the last invoice past due rather than voiding
 * it, so it is still owed and still payable from Billing
 * (`LIVE_MODE_DUNNING_NEIGHBOURS`).
 *
 * `previousPlan` is the org's plan read before the mirror. A redelivery reads
 * `free` there, and the sentence then names no plan rather than a wrong one.
 */
export function dunningCancellationNotice(input: {
  workspace: string
  previousPlan: string
  /** The org document, for a staff comp that outlives the subscription. */
  org?: Record<string, unknown> | null
}): CustomerBillingNotice {
  const subscription =
    input.previousPlan && input.previousPlan !== 'free'
      ? `its ${planLabel(input.previousPlan)} subscription`
      : 'its subscription'
  const after = planAfterCancellation(input.org)
  const limits =
    after === 'the Free plan'
      ? 'Nothing was deleted; paid features are off and Free plan limits apply.'
      : 'Nothing was deleted.'
  return {
    title: `Subscription for ${input.workspace} canceled after failed payments`,
    body:
      `Stripe could not collect payment for ${input.workspace} after repeated ` +
      `attempts, so ${subscription} was canceled and the workspace is now on ` +
      `${after}. ${limits} The unpaid invoice is still open in Billing, ` +
      'where you can also choose a plan again.',
  }
}

/** The three invoice events that notify a workspace's admins. */
export type CustomerInvoiceEvent =
  | 'invoice.finalized'
  | 'invoice.paid'
  | 'invoice.payment_failed'

/**
 * An invoice was issued, paid, or failed to collect.
 *
 * `invoice` is the Stripe invoice object off the event. The fields read:
 *
 * - `collection_method` — `charge_automatically` (the default) is charged to
 *   the payment method on file; `send_invoice` waits for the customer.
 * - `next_payment_attempt` — set while Stripe will retry a failed charge,
 *   `null` once it will not (and always for `send_invoice`).
 * - `subscription`, or `parent.subscription_details.subscription` on newer
 *   API versions — whether the invoice bills a subscription, which is the
 *   only kind the live dunning settings cancel when every retry fails
 *   (`LIVE_MODE_DUNNING_SCHEDULE`), mirroring the workspace to Free.
 * - `paid_out_of_band` — staff marked it paid with no charge behind it.
 */
export function invoiceNotice(input: {
  type: CustomerInvoiceEvent
  workspace: string
  invoice: Record<string, any> | null | undefined
  /** The org document, for where a canceled subscription leaves it. */
  org?: Record<string, unknown> | null
}): CustomerBillingNotice {
  const { type, workspace } = input
  const invoice = input.invoice ?? {}
  if (type === 'invoice.paid') {
    const paid = usd(invoice['amount_paid'] ?? invoice['amount_due'])
    return {
      title: `Invoice paid: ${paid} for ${workspace}`,
      body:
        `The ${paid} invoice for ${workspace} was ` +
        `${invoice['paid_out_of_band'] === true ? 'marked paid' : 'paid'}. ` +
        'Nothing more is due on it.',
    }
  }
  const due = usd(invoice['amount_due'] ?? invoice['amount_paid'])
  if (type === 'invoice.finalized') {
    const charged = invoice['collection_method'] !== 'send_invoice'
    const next = !(Number(invoice['amount_due']) > 0)
      ? 'Nothing is due on it.'
      : charged
        ? 'It will be charged to the payment method on file automatically.'
        : 'It is not charged automatically: pay it from Billing.'
    return {
      title: `New ${due} invoice for ${workspace}`,
      body: `A ${due} invoice for ${workspace} is ready in Billing. ${next}`,
    }
  }
  const retrying = typeof invoice['next_payment_attempt'] === 'number'
  const subscriptionId =
    invoice['subscription'] ?? invoice['parent']?.subscription_details?.subscription
  const billsSubscription =
    typeof subscriptionId === 'string' ? subscriptionId !== '' : Boolean(subscriptionId?.id)
  const what = billsSubscription ? `${workspace}'s subscription` : workspace
  const body = retrying
    ? `Stripe could not charge ${due} for ${what} and will try again ` +
      'automatically. Update the payment method or pay the invoice in Billing' +
      (billsSubscription
        ? ' to keep your plan. If every retry fails, the subscription is ' +
          `canceled and ${workspace} moves to ${planAfterCancellation(input.org)}.`
        : '.')
    : `Stripe could not charge ${due} for ${what} and will not retry this ` +
      'invoice automatically. It is still open in Billing, where you can ' +
      'update the payment method and pay it.'
  return { title: `Payment failed: ${due} for ${workspace}`, body }
}
