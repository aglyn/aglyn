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
 * How a storefront subscription (`hosts/{hostId}/subscriptions`) reads to a
 * person (AGL-4191): its status in words, the one date that matters next, and
 * what it is worth a month. One copy for the console's Subscriptions list and
 * the buyer's account page, so the merchant and the subscriber never read two
 * different answers about the same subscription.
 */

export type SubscriptionBillingInterval = 'month' | 'year'

/** Stripe's subscription statuses, in the merchant's words. */
export const SUBSCRIPTION_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Past due',
  unpaid: 'Unpaid',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  canceled: 'Canceled',
  paused: 'Paused',
}

export const SUBSCRIPTION_STATUS_COLOR: Readonly<
  Record<string, 'success' | 'info' | 'warning' | 'error' | 'default'>
> = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  unpaid: 'error',
  incomplete: 'warning',
}

/** The statuses the console's filter offers, in the order a merchant scans them. */
export const SUBSCRIPTION_FILTER_STATUSES = [
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'canceled',
] as const

/**
 * The statuses that bring money in every cycle: what monthly recurring revenue
 * counts. A trial has not paid yet, and `unpaid` has stopped paying; `past_due`
 * stays in because Stripe is still collecting and the subscriber has not left,
 * the same reason it stays live for access (`commerce-subscription-status.ts`).
 */
export const SUBSCRIPTION_PAYING_STATUSES = ['active', 'past_due'] as const

export function subscriptionStatusLabel(status: unknown): string {
  const key = String(status ?? '')
  return SUBSCRIPTION_STATUS_LABELS[key] ?? (key ? key.replace(/_/g, ' ') : 'Unknown')
}

export function subscriptionStatusColor(
  status: unknown,
): 'success' | 'info' | 'warning' | 'error' | 'default' {
  return SUBSCRIPTION_STATUS_COLOR[String(status ?? '')] ?? 'default'
}

/** `month` or `year` from a stored value, or null for anything else. */
export function subscriptionInterval(value: unknown): SubscriptionBillingInterval | null {
  return value === 'month' || value === 'year' ? value : null
}

/**
 * A recurring charge as a monthly figure: a yearly price counts a twelfth.
 * Tax is the government's, not the merchant's revenue, so it is left out.
 * Rounded to whole cents.
 */
export function monthlyRecurringCents(
  totalCents: unknown,
  taxCents: unknown,
  interval: unknown,
): number {
  const net = Math.max(0, (Number(totalCents) || 0) - (Number(taxCents) || 0))
  const cadence = subscriptionInterval(interval)
  if (cadence === 'year') return Math.round(net / 12)
  if (cadence === 'month') return Math.round(net)
  return 0
}

/** The fields of a stored subscription the date line reads. */
export interface SubscriptionDateFields {
  status?: unknown
  cancelAtPeriodEnd?: unknown
  currentPeriodEndMs?: unknown
  /** Set by each paid invoice; the fallback when Stripe sent no period end. */
  paidThroughMs?: unknown
}

export type SubscriptionDateKind =
  | 'renews'
  | 'trialEnds'
  | 'ends'
  | 'ended'
  | 'paymentFailed'
  | 'awaitingPayment'

export interface SubscriptionDateLine {
  kind: SubscriptionDateKind
  /** Absent where the line names no date ("Payment failed"). */
  atMs?: number
}

function positiveMs(value: unknown): number | undefined {
  const ms = Number(value)
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/**
 * The one date that matters next for a subscription, or null when there is
 * nothing honest to say.
 *
 * `cancelAtPeriodEnd` wins over a renewal: a subscriber who cancelled in the
 * billing portal keeps access to the end of the period they paid for and is
 * not charged again, so "Renews" would be a promise of a charge that will not
 * happen. A failed payment names no date, because Stripe moves the period end
 * forward while the unpaid invoice is retried, so that date is neither a
 * renewal nor an end.
 */
export function subscriptionDateLine(
  subscription: SubscriptionDateFields,
): SubscriptionDateLine | null {
  const status = String(subscription.status ?? '')
  const periodEnd =
    positiveMs(subscription.currentPeriodEndMs) ?? positiveMs(subscription.paidThroughMs)
  const ending = subscription.cancelAtPeriodEnd === true
  switch (status) {
    case 'active':
      if (!periodEnd) return null
      return { kind: ending ? 'ends' : 'renews', atMs: periodEnd }
    case 'trialing':
      if (!periodEnd) return null
      return { kind: ending ? 'ends' : 'trialEnds', atMs: periodEnd }
    case 'past_due':
    case 'unpaid':
      return { kind: 'paymentFailed' }
    case 'incomplete':
      return { kind: 'awaitingPayment' }
    case 'canceled':
    case 'incomplete_expired':
      return periodEnd ? { kind: 'ended', atMs: periodEnd } : null
    default:
      return null
  }
}

/** A short date in the reader's own locale: "Dec 4, 2026". */
export function formatSubscriptionDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** The date line in words: "Renews Dec 4, 2026", "Payment failed". */
export function subscriptionDateText(
  line: SubscriptionDateLine | null,
  formatDate: (ms: number) => string = formatSubscriptionDate,
): string {
  if (!line) return ''
  const on = line.atMs ? formatDate(line.atMs) : ''
  switch (line.kind) {
    case 'renews':
      return `Renews ${on}`
    case 'trialEnds':
      return `Trial ends ${on}`
    case 'ends':
      return `Ends ${on}`
    case 'ended':
      return `Ended ${on}`
    case 'paymentFailed':
      return 'Payment failed'
    case 'awaitingPayment':
      return 'Waiting for the first payment'
  }
}

/** "/month" or "/year", or "" for a stored value that is neither. */
export function subscriptionIntervalSuffix(interval: unknown): string {
  const cadence = subscriptionInterval(interval)
  return cadence ? `/${cadence}` : ''
}

/**
 * What a subscription's plan is called: the line the subscriber bought, with
 * its quantity when more than one, or the product id for a subscription sold
 * before lines were stored (AGL-1732).
 */
export function subscriptionPlanName(subscription: {
  lineItems?: Array<{ name?: string; quantity?: number }>
  productId?: string
}): string {
  const line = subscription.lineItems?.[0]
  if (line?.name) {
    return (line.quantity ?? 1) > 1 ? `${line.quantity}× ${line.name}` : line.name
  }
  return subscription.productId || 'Subscription'
}
