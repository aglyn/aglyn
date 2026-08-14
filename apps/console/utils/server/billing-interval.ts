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
 * Which cadence a paid invoice was billed on — the sole input to the GTM §6
 * annual-mix metric (AGL-1640).
 *
 * Lives here rather than inline in the webhook route so each branch can be
 * driven directly by spec: the defect this replaces was invisible by
 * construction, because a wrong `billing_interval` looks exactly like a right
 * one in every report that reads it.
 *
 * ## Absence is reported as absence
 *
 * The previous form was a two-state ternary over a three-state world —
 * `interval === 'year' ? 'annual' : 'monthly'` — so everything that was not
 * literally `'year'` reported `'monthly'`, including every case where the
 * interval was UNKNOWN rather than monthly. That does not degrade the annual
 * mix symmetrically; it biases it toward monthly by exactly the rate at which
 * the field is unreadable, and annual mix feeds the cash-flow argument for
 * the beta pricing, so it is a number that gets used rather than looked at.
 *
 * Returning `undefined` makes an unreadable invoice a hit EXCLUDED from the
 * breakdown rather than a hit miscounted in it: `sanitizeEventParams` drops
 * undefined keys and `billingInterval` is optional on the taxonomy type, so
 * no `billing_interval` reaches GA at all. Same deliberate
 * `undefined`-vs-a-real-value distinction `first_publish` makes (AGL-1588).
 */

/** The two cadences Aglyn actually sells. */
export type BillingInterval = 'annual' | 'monthly'

interface InvoiceLineLike {
  price?: { recurring?: { interval?: unknown } | null } | unknown
  proration?: unknown
  [field: string]: unknown
}

interface InvoiceLike {
  lines?: { data?: readonly InvoiceLineLike[] | null } | null
  [field: string]: unknown
}

/** `price.recurring.interval` when it is one we model, else undefined. */
function intervalOf(line: InvoiceLineLike | null | undefined) {
  const price = line?.price
  if (!price || typeof price !== 'object') return undefined
  const recurring = (price as { recurring?: unknown }).recurring
  if (!recurring || typeof recurring !== 'object') return undefined
  const interval = (recurring as { interval?: unknown }).interval
  return interval === 'year' || interval === 'month' ? interval : undefined
}

/**
 * The line that describes the SUBSCRIPTION being billed.
 *
 * `lines.data[0]` is not it. An invoice carries proration lines from a
 * mid-cycle plan switch, one-off invoice items, credits and metered-only
 * lines, and any of them can sort first — a plan switch invoices the
 * proration against the OLD price ahead of the new plan, which is precisely
 * how an annual upgrade came to report as monthly.
 *
 * Selection is structural rather than by price id, so it holds without the
 * plan price-id env being configured: prefer a non-proration line carrying a
 * cadence we model, and fall back to a proration one, because Stripe requires
 * every recurring item on a single subscription to share a cadence — so a
 * proration's interval is still the subscription's interval. Only when NO
 * line states a readable cadence is the answer genuinely unknown.
 */
export function selectSubscriptionLine(
  invoice: InvoiceLike | null | undefined,
): InvoiceLineLike | undefined {
  const lines = invoice?.lines?.data ?? []
  return (
    lines.find((line) => !line?.proration && intervalOf(line)) ??
    lines.find((line) => intervalOf(line))
  )
}

/**
 * `'annual'`, `'monthly'`, or `undefined` when the invoice does not say.
 *
 * Never guesses. The third state is the whole point — see the module comment.
 */
export function billingIntervalFromInvoice(
  invoice: InvoiceLike | null | undefined,
): BillingInterval | undefined {
  const interval = intervalOf(selectSubscriptionLine(invoice))
  if (interval === 'year') return 'annual'
  if (interval === 'month') return 'monthly'
  return undefined
}
