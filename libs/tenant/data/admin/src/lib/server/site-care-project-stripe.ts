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

import {
  SITE_CARE_PROJECT_INVOICE_DAYS_UNTIL_DUE,
  type SiteCareProjectInvoiceKind,
} from '@aglyn/aglyn/app-utils/site-care-project'
import {
  siteCareStripeCall,
  siteCareStripeMessage,
  siteCareStripeMetadata,
  type SiteCareStripeOptions,
  type SiteCareStripeResult,
} from './site-care-stripe'

/**
 * A SITE CARE PROJECT'S INVOICES, IN STRIPE (AGL-3970).
 *
 * Every Stripe call the flat-quoted project invoice makes, and nothing else:
 * a ONE-OFF invoice for the org's Stripe customer — not attached to the
 * subscription — that Stripe does not charge automatically
 * (`collection_method: send_invoice`), finalized so it has a hosted page the
 * owner pays from their phone; then reading it, voiding it while unpaid, and
 * (through `creditExtraTimeItem`, the same credit-note call extra time uses)
 * crediting or refunding it. Staff never build one by hand in the Stripe
 * dashboard; the project record is the only door, and the caller writes the
 * record's history row around each call (`site-care-projects.ts`).
 *
 * The same pinned, form-encoded call as extra time (`site-care-stripe.ts`),
 * and the same order `usage-invoice.ts` settled on: the invoice FIRST, then
 * the one line attached to it by id, so nothing else pending on the customer
 * can land on it (`pending_invoice_items_behavior: exclude`).
 *
 * ## The tax code
 *
 * The line is priced against the Site Care product (`price_data[product]`),
 * read off the Site Care price with its tax code checked to be
 * `txcd_10103001` by `siteCareExtraTimeProduct` — the product is what Stripe
 * Tax computes from, and a product with any other code refuses the invoice
 * rather than bill it under the wrong one. Automatic tax is on and the line
 * is tax-exclusive, as every platform price is.
 *
 * ## Never twice
 *
 * Each write carries a key derived from the invoice record's own
 * (`:invoice`, `:item`, `:finalize`). A retry also looks for the invoice by
 * its metadata before creating one, so even past Stripe's 24-hour key window
 * a lost answer is adopted rather than invoiced again.
 */

/** Metadata every project invoice carries, which the webhook and the reconciliation read. */
export const SITE_CARE_PROJECT_METADATA_KEY = 'siteCareProjectId'

export interface ProjectInvoiceInput {
  customerId: string
  productId: string
  orgId: string
  projectId: string
  seq: number
  kind: SiteCareProjectInvoiceKind
  amountCents: number
  description: string
  memo: string
  idempotencyKey: string
  /** The invoice an earlier attempt made, when the record has it. */
  invoiceId: string | null
  /** When the project was created: how far back an earlier attempt's invoice can be. */
  sinceMs: number
}

export interface ProjectInvoiceState {
  invoiceId: string
  invoiceItemId: string | null
  status: string
  number: string | null
  hostedInvoiceUrl: string | null
  totalCents: number
  /** Before tax. */
  subtotalCents: number
  amountPaidCents: number
  metadata: Record<string, string>
}

type ProjectStripeResult<T> = SiteCareStripeResult<T> | { ok: false; error: string; invoiceId?: string | null }

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function invoiceState(body: Record<string, unknown>, invoiceItemId: string | null): ProjectInvoiceState {
  return {
    invoiceId: String(body['id'] ?? ''),
    invoiceItemId,
    status: String(body['status'] ?? ''),
    number: text(body['number']),
    hostedInvoiceUrl: text(body['hosted_invoice_url']),
    totalCents: Number(body['total'] ?? 0),
    subtotalCents: Number(body['subtotal'] ?? 0),
    amountPaidCents: Number(body['amount_paid'] ?? 0),
    metadata: (body['metadata'] as Record<string, string> | undefined) ?? {},
  }
}

function projectMetadata(input: Pick<ProjectInvoiceInput, 'orgId' | 'projectId' | 'seq' | 'kind'>): Record<string, string> {
  return {
    [SITE_CARE_PROJECT_METADATA_KEY]: input.projectId,
    orgId: input.orgId,
    invoiceSeq: String(input.seq),
    invoiceKind: input.kind,
  }
}

/** The invoice an earlier attempt made for this record, found by its metadata. */
async function findEarlierInvoice(
  input: ProjectInvoiceInput,
  options: SiteCareStripeOptions,
): Promise<SiteCareStripeResult<{ body: Record<string, unknown> | null }>> {
  const answer = await siteCareStripeCall(options, 'GET', 'invoices', {
    customer: input.customerId,
    'created[gte]': String(Math.floor(input.sinceMs / 1000) - 60),
    limit: '100',
  })
  if (answer.ok === false) return { ok: false, error: siteCareStripeMessage(answer, 'Reading the invoices failed') }
  const rows = (answer.body['data'] as Array<Record<string, unknown>> | undefined) ?? []
  const found = rows.find((row) => {
    const metadata = (row['metadata'] as Record<string, string> | undefined) ?? {}
    return (
      metadata[SITE_CARE_PROJECT_METADATA_KEY] === input.projectId &&
      metadata['invoiceSeq'] === String(input.seq) &&
      row['status'] !== 'void'
    )
  })
  return { ok: true, body: found ?? null }
}

/** The project's own line on a draft, when one is there. */
async function existingLine(
  invoiceId: string,
  options: SiteCareStripeOptions,
): Promise<SiteCareStripeResult<{ invoiceItemId: string | null }>> {
  const lines = await siteCareStripeCall(options, 'GET', `invoices/${encodeURIComponent(invoiceId)}/lines`, {
    limit: '10',
  })
  if (lines.ok === false) return { ok: false, error: siteCareStripeMessage(lines, 'Reading the invoice lines failed') }
  const row = ((lines.body['data'] as Array<Record<string, unknown>> | undefined) ?? [])[0]
  if (!row) return { ok: true, invoiceItemId: null }
  return { ok: true, invoiceItemId: text(row['invoice_item']) ?? text(row['id']) }
}

/**
 * Creates (or finishes an earlier attempt at) one project invoice:
 * invoice, line, finalize. Answers the finalized invoice with its hosted
 * page, or the error and whatever invoice id got made on the way.
 */
export async function createProjectInvoice(
  input: ProjectInvoiceInput,
  options: SiteCareStripeOptions = {},
): Promise<ProjectStripeResult<{ state: ProjectInvoiceState }>> {
  if (!input.customerId) return { ok: false, error: 'The workspace has no Stripe customer to invoice.' }
  const amountCents = Math.floor(Number(input.amountCents))
  if (!Number.isInteger(amountCents) || amountCents < 100) {
    return { ok: false, error: 'A project invoice is at least $1.' }
  }
  const key = (step: string) => `${input.idempotencyKey}:${step}`
  const metadata = siteCareStripeMetadata(projectMetadata(input))

  let body: Record<string, unknown> | null
  if (input.invoiceId) {
    const read = await siteCareStripeCall(options, 'GET', `invoices/${encodeURIComponent(input.invoiceId)}`)
    if (read.ok === false) {
      return { ok: false, error: siteCareStripeMessage(read, 'Reading the invoice failed'), invoiceId: input.invoiceId }
    }
    body = read.body
  } else {
    const earlier = await findEarlierInvoice(input, options)
    if (earlier.ok === false) return earlier
    body = earlier.body
  }
  let fresh = false
  if (!body) {
    const created = await siteCareStripeCall(
      options,
      'POST',
      'invoices',
      {
        customer: input.customerId,
        collection_method: 'send_invoice',
        days_until_due: String(SITE_CARE_PROJECT_INVOICE_DAYS_UNTIL_DUE),
        auto_advance: 'false',
        'automatic_tax[enabled]': 'true',
        // This invoice carries the line added below and nothing else.
        pending_invoice_items_behavior: 'exclude',
        description: input.memo,
        ...metadata,
      },
      key('invoice'),
    )
    if (created.ok === false) return { ok: false, error: siteCareStripeMessage(created, 'Stripe refused the invoice') }
    body = created.body
    fresh = true
  }
  const invoiceId = String(body['id'] ?? '')
  if (!invoiceId) return { ok: false, error: 'Stripe returned an invoice with no id' }
  const status = String(body['status'] ?? '')
  if (status === 'void' || status === 'uncollectible') {
    return { ok: false, error: `The invoice is ${status}; raise a new one.`, invoiceId }
  }
  if (status !== 'draft') {
    const line = await existingLine(invoiceId, options)
    return { ok: true, state: invoiceState(body, line.ok ? line.invoiceItemId : null) }
  }

  let invoiceItemId: string | null = null
  if (!fresh) {
    const line = await existingLine(invoiceId, options)
    if (line.ok === false) return { ok: false, error: line.error, invoiceId }
    invoiceItemId = line.invoiceItemId
  }
  if (!invoiceItemId) {
    const item = await siteCareStripeCall(
      options,
      'POST',
      'invoiceitems',
      {
        customer: input.customerId,
        invoice: invoiceId,
        'price_data[product]': input.productId,
        'price_data[currency]': 'usd',
        'price_data[unit_amount]': String(amountCents),
        // US sales tax is added on top of the platform's prices, and
        // automatic tax refuses an unspecified behavior outright.
        'price_data[tax_behavior]': 'exclusive',
        description: input.description,
        ...metadata,
      },
      key('item'),
    )
    if (item.ok === false) {
      return { ok: false, error: siteCareStripeMessage(item, 'Stripe refused the project line'), invoiceId }
    }
    invoiceItemId = text(item.body['id'])
  }
  const finalized = await siteCareStripeCall(
    options,
    'POST',
    `invoices/${encodeURIComponent(invoiceId)}/finalize`,
    { auto_advance: 'false' },
    key('finalize'),
  )
  if (finalized.ok === false) {
    return { ok: false, error: siteCareStripeMessage(finalized, 'The invoice could not be finalized'), invoiceId }
  }
  const state = invoiceState(finalized.body, invoiceItemId)
  if (!state.hostedInvoiceUrl) {
    return { ok: false, error: 'Stripe finalized the invoice without a pay page.', invoiceId }
  }
  return { ok: true, state }
}

/** One invoice as it stands in Stripe. */
export async function readProjectInvoice(
  invoiceId: string,
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ state: ProjectInvoiceState | null }>> {
  const answer = await siteCareStripeCall(options, 'GET', `invoices/${encodeURIComponent(invoiceId)}`)
  if (answer.status === 404) return { ok: true, state: null }
  if (answer.ok === false) return { ok: false, error: siteCareStripeMessage(answer, 'Reading the invoice failed') }
  return { ok: true, state: invoiceState(answer.body, null) }
}

/** Voids an unpaid invoice: the owner owes nothing on it. */
export async function voidProjectInvoice(
  input: { invoiceId: string; idempotencyKey: string },
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ status: string }>> {
  const answer = await siteCareStripeCall(
    options,
    'POST',
    `invoices/${encodeURIComponent(input.invoiceId)}/void`,
    null,
    input.idempotencyKey,
  )
  if (answer.ok === false) return { ok: false, error: siteCareStripeMessage(answer, 'Stripe refused to void the invoice') }
  return { ok: true, status: String(answer.body['status'] ?? 'void') }
}

/** Every project invoice on a customer created since `sinceMs`, as the reconciliation reads them. */
export async function listProjectInvoices(
  input: { customerId: string; sinceMs: number },
  options: SiteCareStripeOptions = {},
): Promise<SiteCareStripeResult<{ invoices: ProjectInvoiceState[] }>> {
  const invoices: ProjectInvoiceState[] = []
  let startingAfter = ''
  for (let page = 0; page < 10; page++) {
    const answer = await siteCareStripeCall(options, 'GET', 'invoices', {
      customer: input.customerId,
      'created[gte]': String(Math.floor(input.sinceMs / 1000)),
      limit: '100',
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    if (answer.ok === false) return { ok: false, error: siteCareStripeMessage(answer, 'Listing invoices failed') }
    const rows = (answer.body['data'] as Array<Record<string, unknown>> | undefined) ?? []
    for (const row of rows) {
      const metadata = (row['metadata'] as Record<string, string> | undefined) ?? {}
      if (metadata[SITE_CARE_PROJECT_METADATA_KEY]) invoices.push(invoiceState(row, null))
    }
    if (answer.body['has_more'] !== true || !rows.length) break
    startingAfter = String(rows[rows.length - 1]['id'])
  }
  return { ok: true, invoices }
}
