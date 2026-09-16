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
 * ONE-OFF USAGE INVOICES (AGL-3011).
 *
 * A workspace's accrued usage, charged to the card on file while the billing
 * period is still open, rather than waiting for the renewal invoice. The
 * caller decides WHEN and HOW MUCH; this module only knows how to turn that
 * decision into a Stripe invoice and report what happened.
 *
 * ## Why it is here and not in the plugin that calls it
 *
 * Stripe credentials, the pinned API version and the idempotency discipline
 * are platform concerns, and a plugin that minted its own invoices would be
 * a second Stripe integration to keep in step with this one. Nothing in this
 * module names a plugin, a meter or a product: the caller hands over a
 * customer, an amount, a product and its own metadata, and every figure on
 * the invoice came from the caller.
 *
 * ## Why an invoice and not a PaymentIntent
 *
 * An invoice carries invoice-level automatic tax, produces a document the
 * customer can see in Billing and pay from it, and reaches the platform's
 * existing `invoice.paid` tax-ledger and revenue path. A raw PaymentIntent
 * has none of that, and a failure on one would simply be lost.
 *
 * ## ⚠️ NOTHING RETRIES A FAILED CHARGE HERE (AGL-3023)
 *
 * These invoices are created `auto_advance: false`, so Stripe runs no
 * automatic collection on them: no retry schedule, no dunning emails, no
 * further attempt of any kind. Measured on a test clock — the invoice sat at
 * `attempt_count: 1, next_payment_attempt: null` through four clock
 * advances over a week.
 *
 * `auto_advance: false` is deliberate, because it is what lets this module
 * finalize and pay as its own steps and RETURN the outcome rather than a
 * promise of one. The cost is that re-collection is ours: a failed charge
 * leaves an open invoice that the customer can pay from Billing, and nothing
 * chases it until they do.
 *
 * Do not restore a claim that Smart Retries cover these. An earlier version
 * of this comment said so; it was never true of an invoice created this way,
 * and a comment that is wrong about money is worse than no comment.
 *
 * ## Why a failure here never threatens the subscription
 *
 * This invoice is not a subscription invoice. It has its own lifecycle, so a
 * card that declines fails THIS invoice and leaves the plan alone; Stripe's
 * subscription dunning — which ends by canceling the subscription — is not
 * reachable from here.
 */

/**
 * The API version every call below is pinned to.
 *
 * Pinned rather than taking the account default, because the parameters on
 * an invoice item have moved between versions — `2025-03-31.basil` replaced
 * the top-level `price` with `pricing[price]` — and a charge that silently
 * changed shape under a Dashboard upgrade is the failure this constant
 * exists to prevent. The same string the checkout route pins.
 */
export const USAGE_INVOICE_API_VERSION = '2024-06-20'

/**
 * The smallest invoice this module will raise, in cents (AGL-3023).
 *
 * Stripe's minimum chargeable amount in USD. Below it there is nothing to
 * charge, and an invoice raised anyway is finalized as PAID having collected
 * nothing — the same "paid without money" shape that a caller crediting its
 * own claim would read as a successful charge. Measured on a test clock: a
 * $0.40 invoice came back `status: paid` and every later call answered
 * "Invoice is already paid".
 *
 * Enforced HERE rather than left to each caller's own floor, because this is
 * the module that knows about Stripe. A caller is free to hold a higher
 * floor of its own; none may go under this one.
 */
export const USAGE_INVOICE_MIN_CHARGE_CENTS = 50

/** What a caller asks to be charged. */
export interface OrgUsageInvoiceRequest {
  /** The workspace the charge belongs to, for the invoice's metadata. */
  orgId: string
  /** The Stripe customer to bill — resolved by the caller from org billing. */
  stripeCustomerId: string
  /** The Stripe product the line is billed against; it carries the tax code. */
  productId: string
  /** The amount in whole cents. Must be positive. */
  amountCents: number
  /** ISO 4217, lower case. */
  currency: string
  /** The line's description, as the customer reads it on the invoice. */
  description: string
  /**
   * Metadata stamped on BOTH the invoice item and the invoice.
   *
   * The caller's own claim ticket travels here — which plugin asked, which
   * accrual this settles — so the webhook can route the outcome back without
   * core knowing what any of it means.
   */
  metadata: Readonly<Record<string, string>>
  /**
   * One string that identifies this attempt.
   *
   * Every write below derives its own key from it, because Stripe's
   * idempotency layer is account-scoped and compares parameters: sending one
   * key to `/v1/invoiceitems` and then to `/v1/invoices` would make the
   * second call fail outright. Same discipline as the enterprise
   * provisioning route.
   */
  idempotencyKey: string
}

/** What became of the attempt. */
export interface OrgUsageInvoiceResult {
  ok: boolean
  /** The invoice, once it exists — present even when the charge failed. */
  invoiceId: string | null
  /**
   * Stripe's own invoice status: `paid`, `open`, `void`, `uncollectible`, or
   * `draft` when finalization itself failed.
   */
  status: string | null
  /**
   * What the finalized invoice actually came to, and what Stripe actually
   * collected, in cents (AGL-3023).
   *
   * Both are reported because the caller must never credit a workspace from
   * the amount it ASKED to charge. An invoice that finalized at zero, or one
   * that reports `paid` having collected nothing, is not a payment — and a
   * bound enforced by our own bookkeeping rather than by money is not a
   * bound at all.
   */
  totalCents: number
  amountPaidCents: number
  /**
   * Whether Stripe asked for more from the cardholder (3-D Secure). It is
   * not a payment, and a caller extending credit must treat it as a failure
   * rather than wait: nobody is at the keyboard on an off-session charge.
   */
  requiresAction: boolean
  /** Stripe's message when something went wrong, for logs and staff. */
  error: string | null
}

type StripeFetch = typeof fetch

interface StripeAnswer {
  ok: boolean
  status: number
  body: Record<string, unknown>
}

async function stripe(
  fetchImpl: StripeFetch,
  secretKey: string,
  path: string,
  params: Record<string, string> | null,
  idempotencyKey: string | null,
): Promise<StripeAnswer> {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': USAGE_INVOICE_API_VERSION,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      // Stripe documents idempotency keys as having no effect on GET, so
      // only the writes carry one.
      ...(params && idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: response.ok, status: response.status, body }
}

function stripeError(answer: StripeAnswer, fallback: string): string {
  const error = answer.body?.['error'] as { message?: unknown } | undefined
  const message = error?.message
  return typeof message === 'string' && message ? message : fallback
}

/** `metadata[key]=value` pairs, with every value coerced to a string. */
function metadataParams(
  metadata: Readonly<Record<string, string>>,
): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue
    params[`metadata[${key}]`] = String(value)
  }
  return params
}

/**
 * Charges one workspace's accrued usage to the card on file.
 *
 * Four Stripe writes, each with its own idempotency key derived from the
 * caller's: the invoice item, the invoice, the finalization and the pay. A
 * retry of the whole attempt with the same key re-reads the objects the
 * first attempt made rather than making a second set.
 *
 * `auto_advance` is left OFF and the invoice is finalized and paid here, so
 * the answer this returns is the outcome rather than a promise of one. The
 * webhook remains the authority — this only gets there sooner.
 *
 * The amount is NOT validated against anything: the caller is the only one
 * that knows what was accrued, and a helper second-guessing it would be a
 * second figure to drift from the first. It is checked for being a positive
 * whole number of cents, which is a shape check, not a judgement.
 */
export async function chargeOrgUsageInvoice(
  request: OrgUsageInvoiceRequest,
  options: { secretKey?: string; fetchImpl?: StripeFetch } = {},
): Promise<OrgUsageInvoiceResult> {
  const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const empty: OrgUsageInvoiceResult = {
    ok: false,
    invoiceId: null,
    status: null,
    totalCents: 0,
    amountPaidCents: 0,
    requiresAction: false,
    error: null,
  }
  if (!secretKey) return { ...empty, error: 'Stripe is not configured' }
  const amountCents = Math.floor(Number(request.amountCents))
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ...empty, error: 'A usage invoice needs a positive amount' }
  }
  if (amountCents < USAGE_INVOICE_MIN_CHARGE_CENTS) {
    // Refused rather than attempted: Stripe finalizes a sub-minimum invoice
    // as paid without collecting, so attempting one produces a document that
    // claims to be settled and is not. Carrying the amount to the next
    // charge is the caller's business and the honest answer here is "no".
    return {
      ...empty,
      error:
        `A usage invoice must be at least ${USAGE_INVOICE_MIN_CHARGE_CENTS} ` +
        `cents; ${amountCents} would finalize as paid having collected nothing`,
    }
  }
  if (!request.stripeCustomerId || !request.productId) {
    return { ...empty, error: 'A usage invoice needs a customer and a product' }
  }
  const currency = String(request.currency || 'usd').toLowerCase()
  const metadata = metadataParams(request.metadata)
  const key = (object: string) => `${request.idempotencyKey}:${object}`

  // THE INVOICE FIRST, THEN THE LINE ATTACHED TO IT BY ID (AGL-3023).
  //
  // The order is the fix, and the reason is a default. `POST /v1/invoices`
  // documents `pending_invoice_items_behavior` as "Defaults to `exclude` if
  // the parameter is omitted" — so an invoice created after a pending item,
  // without that parameter, sweeps up NOTHING. Every invoice comes out
  // empty, finalizes at zero, and a zero-total invoice is already paid the
  // moment it finalizes. That is what the first test-clock drill measured.
  //
  // Passing `pending_invoice_items_behavior: 'include'` would also fix the
  // zero, and it is the wrong fix: "include" means every pending item on
  // that customer, not ours. A proration, another plugin's usage line, an
  // item some other part of the platform staged — all of it would land on an
  // invoice this module then reports as an AI overage charge for an amount
  // it made up. Attaching our line to our invoice BY ID binds exactly one
  // line and cannot pick up a second.
  const created = await stripe(
    fetchImpl,
    secretKey,
    'invoices',
    {
      customer: request.stripeCustomerId,
      collection_method: 'charge_automatically',
      auto_advance: 'false',
      'automatic_tax[enabled]': 'true',
      // Stated rather than left to the default, so this call says what it
      // means: this invoice carries the line added below and nothing else.
      pending_invoice_items_behavior: 'exclude',
      ...metadata,
    },
    key('invoice'),
  )
  if (!created.ok) {
    return { ...empty, error: stripeError(created, 'The usage invoice was refused') }
  }
  const invoiceId = String(created.body?.['id'] ?? '')
  if (!invoiceId) {
    return { ...empty, error: 'Stripe returned an invoice with no id' }
  }

  // The line, addressed to the draft above. `price_data` rather than a bare
  // amount, because the PRODUCT is what carries the tax code the account's
  // automatic tax computes from, and an amount with no product behind it is
  // an untaxed line on a taxed invoice. `tax_behavior` is stated rather than
  // left to the account default: US sales tax is added on top of the
  // platform's prices, and an unspecified behavior is refused outright when
  // automatic tax is on.
  const item = await stripe(
    fetchImpl,
    secretKey,
    'invoiceitems',
    {
      customer: request.stripeCustomerId,
      invoice: invoiceId,
      'price_data[product]': request.productId,
      'price_data[currency]': currency,
      'price_data[unit_amount]': String(amountCents),
      'price_data[tax_behavior]': 'exclusive',
      description: request.description,
      ...metadata,
    },
    key('invoiceitem'),
  )
  if (!item.ok) {
    return {
      ...empty,
      invoiceId,
      status: 'draft',
      error: stripeError(item, 'The usage line was refused'),
    }
  }

  const finalized = await stripe(
    fetchImpl,
    secretKey,
    `invoices/${invoiceId}/finalize`,
    { auto_advance: 'false' },
    key('finalize'),
  )
  if (!finalized.ok) {
    return {
      ...empty,
      invoiceId,
      status: String(finalized.body?.['status'] ?? 'draft'),
      error: stripeError(finalized, 'The usage invoice could not be finalized'),
    }
  }

  // WHAT THE INVOICE ACTUALLY CAME TO (AGL-3023).
  //
  // Checked before paying, because a zero-total invoice is not a cheap
  // charge — it is a charge that did not happen, and Stripe marks it paid on
  // finalization. Calling `pay` on one answers "Invoice is already paid",
  // which reads like a failure of the card and is nothing of the sort.
  //
  // The comparison is `< amountCents` rather than `!== 0`: automatic tax
  // ADDS to the total, so a correct invoice is at least what we asked for
  // and usually more. Anything less means the line did not land.
  const totalCents = Math.max(0, Math.floor(Number(finalized.body?.['total'] ?? 0)))
  if (totalCents < amountCents) {
    return {
      ...empty,
      invoiceId,
      status: String(finalized.body?.['status'] ?? null) || null,
      totalCents,
      error:
        `The usage invoice finalized at ${totalCents} cents for a ` +
        `${amountCents}-cent line, so the line did not reach it`,
    }
  }

  const paid = await stripe(
    fetchImpl,
    secretKey,
    `invoices/${invoiceId}/pay`,
    {},
    key('pay'),
  )
  return readPayOutcome(invoiceId, totalCents, paid)
}

/**
 * The charge's outcome, told apart from the transport.
 *
 * A declined card is a 402 from Stripe with a real invoice behind it, not a
 * fault of ours — so the invoice id and the status survive the failure, and
 * the caller can record which invoice to wait on. `requires_action` is
 * singled out because it reads like "not yet" and is in fact "no": nobody is
 * present to complete a 3-D Secure challenge on an off-session charge.
 *
 * ## `paid` is not enough; money is (AGL-3023)
 *
 * Success requires BOTH a `paid` status and an `amount_paid` that covers the
 * line. An invoice can read `paid` having collected nothing — a zero total
 * is marked paid at finalization — and a caller that credited a workspace
 * from our own requested figure would record a payment that never happened.
 * On a usage bound that is the worst possible failure: the balance the gate
 * refuses on would be cleared by bookkeeping rather than by money, and the
 * workspace could spend without limit. So what is reported here is what
 * Stripe says it took.
 */
function readPayOutcome(
  invoiceId: string,
  totalCents: number,
  paid: StripeAnswer,
): OrgUsageInvoiceResult {
  const invoice = paid.ok ? paid.body : null
  const status = String((invoice ?? {})['status'] ?? '') || null
  const amountPaidCents = Math.max(
    0,
    Math.floor(Number((invoice ?? {})['amount_paid'] ?? 0)),
  )
  if (paid.ok && status === 'paid' && amountPaidCents >= totalCents && totalCents > 0) {
    return {
      ok: true,
      invoiceId,
      status,
      totalCents,
      amountPaidCents,
      requiresAction: false,
      error: null,
    }
  }
  if (paid.ok && status === 'paid') {
    // Stripe answered 200 and `paid`, and took less than the invoice came
    // to. Reported as a failure with the figures, because the alternative is
    // crediting a workspace for money nobody received.
    return {
      ok: false,
      invoiceId,
      status,
      totalCents,
      amountPaidCents,
      requiresAction: false,
      error:
        `The usage invoice reports paid having collected ${amountPaidCents} ` +
        `cents of ${totalCents}`,
    }
  }
  const error = paid.body?.['error'] as
    | { message?: unknown; payment_intent?: { status?: unknown } }
    | undefined
  const intentStatus = String(error?.payment_intent?.status ?? '')
  return {
    ok: false,
    invoiceId,
    status: status ?? 'open',
    totalCents,
    amountPaidCents,
    requiresAction: intentStatus === 'requires_action',
    error: stripeError(paid, 'The card on file did not complete the charge'),
  }
}

/**
 * Finds a usage invoice by the caller's own claim id.
 *
 * The reconciliation read for a caller that claimed a charge and then lost
 * the process before it learned the outcome — a crash, a killed background
 * task. Searching by the caller's metadata answers "did this claim ever
 * become an invoice" without the caller having to persist a Stripe id it
 * never received.
 *
 * Stripe's search index is eventually consistent, so an empty answer means
 * "not found YET" and never "not created". Callers reconcile on a schedule
 * with that in mind rather than treating the first miss as proof.
 */
export async function findOrgUsageInvoice(
  query: { metadataKey: string; metadataValue: string },
  options: { secretKey?: string; fetchImpl?: StripeFetch } = {},
): Promise<{
  invoiceId: string | null
  status: string | null
  /** What that invoice collected, in cents — 0 when none was found. */
  amountPaidCents: number
  error: string | null
}> {
  const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  if (!secretKey) {
    return {
      invoiceId: null,
      status: null,
      amountPaidCents: 0,
      error: 'Stripe is not configured',
    }
  }
  // Single quotes around the value are Stripe's own search syntax; a value
  // carrying one would break the query, so it is refused rather than escaped
  // — every id this is called with is generated by us from `[A-Za-z0-9-]`.
  if (/['\\]/.test(query.metadataValue)) {
    return { invoiceId: null, status: null, amountPaidCents: 0, error: 'Unsearchable claim id' }
  }
  const search = `metadata['${query.metadataKey}']:'${query.metadataValue}'`
  const answer = await stripe(
    fetchImpl,
    secretKey,
    `invoices/search?query=${encodeURIComponent(search)}&limit=1`,
    null,
    null,
  )
  if (!answer.ok) {
    return {
      invoiceId: null,
      status: null,
      amountPaidCents: 0,
      error: stripeError(answer, 'Invoice search failed'),
    }
  }
  const data = (answer.body?.['data'] ?? []) as Array<Record<string, unknown>>
  const found = data[0]
  if (!found) return { invoiceId: null, status: null, amountPaidCents: 0, error: null }
  return {
    invoiceId: String(found['id'] ?? '') || null,
    status: String(found['status'] ?? '') || null,
    amountPaidCents: Math.max(0, Math.floor(Number(found['amount_paid'] ?? 0))),
    error: null,
  }
}
