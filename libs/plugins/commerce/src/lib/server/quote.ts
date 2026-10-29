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

import { claimAttempt, type PluginApiHandler, type PluginApiRequest } from '@aglyn/aglyn/server'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { checkEntitlement } from '@aglyn/aglyn/server'
import type { PluginTaxAddress } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import {
  searchPluginPeople,
  type PluginPersonRecord,
  type PluginPersonSearchRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import {
  pluginRecordFactsReader,
  type PluginRecordFactsRead,
  type PluginRecordFactsRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import * as CommerceModel from '../model'
import { commerceSitePermissionRefusal } from '../model/plugin-permissions'
import { holdsCommerceSiteKey } from './commerce-site-keys'
import {
  quoteSaleTaxWithEngine,
  type SaleTaxEngineRequest,
  type SaleTaxEngineResult,
} from './tax-engine-quote'
import { expireCheckoutSession, type CheckoutSessionExpiry } from './checkout-session-expiry'
import type { quotePdfFile } from './commerce-pdf'
import { sendPdf, type CommercePdfFile } from './pdf-response'
import { quotePayLinkUrl, quoteProofLinkUrl } from './quote-link-token'
import type { QuoteMailer } from './quote-email'
import type { QuoteUploadCalls } from './quote-uploads'

/*==========================================
 * QUOTES IN THE CONSOLE (AGL-4093): `POST /api/commerce/quote`.
 *
 *   { action: 'create', hostId, quote }                       → { quoteId, number, updatedAtMs }
 *   { action: 'update', hostId, quoteId, baseUpdatedAtMs, quote } → { quoteId, number, updatedAtMs }
 *   { action: 'delete', hostId, quoteId }                     → { deleted: true }
 *   { action: 'search-customers', hostId, text }              → { available, customers }
 *   { action: 'pay-link', hostId, quoteId }                   → { url, linkVersion }
 *   { action: 'replace-link', hostId, quoteId }               → { url, linkVersion }
 *   { action: 'pdf', hostId, quoteId }                        → application/pdf
 *   { action: 'send', hostId, quoteId, to?, subject?, message } + Idempotency-Key
 *                                                             → { sent, to, atMs, revision, linkVersion, linkReplaced }
 *
 * Proofs and revisions (AGL-4096), all under "Create and edit quotes":
 *
 *   { action: 'proof-ticket', hostId, quoteId, file: { name, contentType, size } }
 *                                                             → { ticket, upload: { url, fields }, file }
 *   { action: 'proof-finalize', hostId, quoteId, ticket }     → { proof, updatedAtMs }
 *   { action: 'proof-remove', hostId, quoteId, proofId }      → { removed: true, updatedAtMs }
 *   { action: 'start-revision', hostId, quoteId }             → { revision, updatedAtMs }
 *   { action: 'revisions', hostId, quoteId }                  → { revisions: QuoteRevisionView[] }
 *   { action: 'file', hostId, quoteId, fileId, revision? }    → the file (a proof, the customer's, or the request's)
 *
 * A quote from a request (AGL-4098), under "Create and edit quotes":
 *
 *   { action: 'start-from-request', hostId, submissionId }    → { prefill, request, files, threaded }
 *   { action: 'create', hostId, quote, from: { kind: 'submission', id } }
 *                                                             → as create, stamped from the request
 *
 * The request is a form submission another plugin keeps, read through the
 * core's record-facts seam (`QUOTE_REQUEST_FACTS_RESOURCE`) for the member
 * asking, on the Inbox's read rules — never from the request body. A create
 * that names one re-reads it and stamps the quote with it: `quote.request`,
 * its files as `quote.requestFiles`, and the conversation its confirmation
 * started as `quote.emailThread`, so the quote's first email replies into it.
 *
 * A proof goes up the way a visitor's file does (`visitor-upload`): a ticket
 * for a signed upload straight to Storage, then finalize, which inspects the
 * bytes and keeps them under the quote. Adding or removing a proof, and
 * starting a revision, change what the customer is shown, so each is an edit
 * of the quote: it moves `quote.updatedAtMs` (the page's version) and closes
 * the pay page's open session, as an edit does.
 *
 * Every action but the pay link's two and the send asks "Create and edit
 * quotes" (`commerce.quotes`); those three ask "Send quotes and invoices to
 * customers" (`commerce.quotes.send`, AGL-4094, AGL-4097). The send emails
 * the quote to the customer (`quote-email.ts`, loaded only then). The PDF
 * (AGL-4095) is the document the customer would download from the quote
 * page, and carries the pay link only for someone who also holds
 * `commerce.quotes.send`. Create and update take an
 * `Idempotency-Key` header, one per attempt, so a retried save replays its
 * answer instead of writing a second quote or failing its own change check;
 * delete is idempotent by nature, and so are the link's two (a replace bumps
 * the version once per press, and a second press is another replacement).
 *
 * A quote's open Checkout Session (`checkoutSessionId`, opened by the pay
 * page) was priced from the quote as it stood. Editing the quote, deleting it
 * or replacing its link expires that session, so nobody pays a price or a
 * link the business has withdrawn.
 *
 * The server prices every product line from the product and works out the
 * tax; the console sends what was chosen, never what it costs. A quote is
 * written to `hosts/{hostId}/orders` as an unpaid order on the `quote`
 * channel, numbered from the store's order counter, and WITHOUT the fields
 * order lists read (see `commerce-quotes.ts`). No payment is created here.
 *=========================================*/

export interface QuoteDeps {
  verifyIdToken(token: string): Promise<{ uid: string; email?: string | null }>
  firestore(): FirebaseFirestore.Firestore
  /** The workspace that owns the site, for its plan. */
  orgForHost(hostId: string): Promise<{ id?: string; org?: unknown } | null>
  searchPeople(request: PluginPersonSearchRequest): Promise<PluginPersonRecord[] | null>
  /** The site's tax service, where one is connected; `{ quote: null }` otherwise. */
  quoteTax(request: SaleTaxEngineRequest): Promise<SaleTaxEngineResult>
  /** Closes a Checkout Session the pay page opened for the quote. */
  expireSession(sessionId: string): Promise<CheckoutSessionExpiry>
  /** The quote's pay link at a link version, or null when the site has no address or no signing secret. */
  payLinkUrl(host: Record<string, unknown>, hostId: string, quoteId: string, version: number): string | null
  /** One of the current revision's proofs behind that link, for the email's pictures. */
  proofLinkUrl(host: Record<string, unknown>, hostId: string, quoteId: string, version: number, proofId: string): string | null
  /** The quote's PDF; loads the PDF writer and sharp only when asked. */
  quotePdf(input: Parameters<typeof quotePdfFile>[0]): Promise<CommercePdfFile>
  /** The upload pipeline, loaded only by the proof actions. */
  uploads(): Promise<QuoteUploadCalls>
  /** The quote email (AGL-4097): the renderer, the PDF and sharp, loaded only by the send. */
  mailer(): Promise<QuoteMailer>
  /**
   * A request's facts (AGL-4098), from the plugin that keeps form submissions,
   * through the core's seam; null when no plugin reads them in this process.
   */
  requestFacts(request: PluginRecordFactsRequest): Promise<PluginRecordFactsRead | null>
  now(): number
}

export function defaultQuoteDeps(): QuoteDeps {
  return {
    verifyIdToken: (token) => firebaseAdmin.app().auth().verifyIdToken(token),
    firestore: () => firebaseAdmin.app().firestore(),
    orgForHost: async (hostId) => {
      const found = await getOrgForHost(hostId)
      return found ? { id: found.orgId, org: found.org } : null
    },
    searchPeople: (request) => searchPluginPeople(request),
    quoteTax: (request) => quoteSaleTaxWithEngine(request),
    expireSession: (sessionId) => expireCheckoutSession(sessionId),
    payLinkUrl: (host, hostId, quoteId, version) => quotePayLinkUrl(host, hostId, quoteId, version),
    proofLinkUrl: (host, hostId, quoteId, version, proofId) => quoteProofLinkUrl(host, hostId, quoteId, version, proofId),
    quotePdf: async (input) => (await import('./commerce-pdf')).quotePdfFile(input),
    uploads: async () => (await import('./quote-uploads')).quoteUploadCalls(),
    mailer: async () => (await import('./quote-email')).quoteMailer(),
    requestFacts: async (request) =>
      (await pluginRecordFactsReader(CommerceModel.QUOTE_REQUEST_FACTS_RESOURCE)?.reader.read(request)) ?? null,
    now: () => Date.now(),
  }
}

/** A request's facts for the member asking, or the refusal to answer with. */
async function readRequest(
  deps: QuoteDeps,
  input: { hostId: string; submissionId: string; uid: string; staff: boolean },
): Promise<{ facts: CommerceModel.QuoteRequestFacts } | { outcome: Outcome }> {
  if (!DOC_ID.test(input.submissionId)) return { outcome: refuse(400, 'Missing submissionId') }
  const owner = await deps.orgForHost(input.hostId)
  const read = await deps.requestFacts({
    orgId: owner?.id ?? '',
    hostId: input.hostId,
    id: input.submissionId,
    uid: input.uid,
    staff: input.staff,
    org: (owner?.org ?? null) as Readonly<Record<string, unknown>> | null,
    now: new Date(deps.now()),
  })
  if (!read) return { outcome: refuse(404, 'Requests aren’t available on this site.') }
  if ('error' in read) return { outcome: refuse(read.status, read.error) }
  const facts = CommerceModel.readQuoteRequestFacts(read.facts)
  if (!facts) return { outcome: refuse(404, 'That request is no longer in the Inbox.') }
  return { facts }
}

/** Expires the session the pay page opened, when there is one; a failure is logged, never thrown. */
async function closeOpenSession(deps: QuoteDeps, sessionId: string | undefined, context: string): Promise<void> {
  if (!sessionId) return
  const result = await deps.expireSession(sessionId).catch((): CheckoutSessionExpiry => 'open')
  if (result === 'open') {
    console.error(`${context}: the quote's Stripe session was not expired and may still be paid`, { sessionId })
  }
}

type Outcome = {
  status: number
  body: Record<string, unknown>
  pdf?: CommercePdfFile
  /** A proof or a customer's file, streamed by the handler. */
  file?: { path: string; name: string; contentType: string }
}

const refuse = (status: number, error: string): Outcome => ({ status, body: { error } })

function bodyOf(req: PluginApiRequest): Record<string, unknown> {
  const raw = req.body
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
}

function headerOf(req: PluginApiRequest, name: string): string {
  const headers = (req.headers ?? {}) as Record<string, unknown>
  const value = headers[name.toLowerCase()] ?? headers[name]
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim()
}

const DOC_ID = /^(?!__.*__$)[^/]{1,200}$/

/** The actions under "Send quotes and invoices to customers" (`commerce.quotes.send`). */
const SEND_ACTIONS = new Set(['pay-link', 'replace-link', 'send'])

/** The ship-to as a tax service reads it, or `null` to tax at the store's address. */
function serviceAddress(shipTo: CommerceModel.OrderAddress | null): PluginTaxAddress | null {
  if (!shipTo?.country) return null
  return {
    country: shipTo.country,
    ...(shipTo.line1 ? { line1: shipTo.line1 } : {}),
    ...(shipTo.line2 ? { line2: shipTo.line2 } : {}),
    ...(shipTo.city ? { city: shipTo.city } : {}),
    ...(shipTo.state ? { region: shipTo.state } : {}),
    ...(shipTo.postalCode ? { postalCode: shipTo.postalCode } : {}),
  }
}

interface PricedQuote {
  lineItems: CommerceModel.PricedQuoteLine[]
  totals: CommerceModel.OrderTotals
  tax: CommerceModel.QuoteTaxBasis
  taxMode: CommerceModel.StorefrontTaxMode | undefined
  requireProofApprovalDefault: boolean
}

/**
 * Prices a quote: each product line from its product, the tax from the
 * store's settings and, where the site connected one, its tax service.
 */
async function priceQuote(
  deps: QuoteDeps,
  hostRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  input: CommerceModel.QuoteInput,
): Promise<PricedQuote | Outcome> {
  const productIds = [
    ...new Set(
      input.lines.flatMap((line) => (line.kind === 'catalog' ? [line.productId] : [])),
    ),
  ]
  const productDocs = await Promise.all(
    productIds.map((id) => hostRef.collection('products').doc(id).get()),
  )
  const products = new Map(
    productDocs.map((snapshot, index) => [
      productIds[index],
      snapshot.exists ? (snapshot.data() as Partial<CommerceModel.HostProduct>) : null,
    ]),
  )
  const lineItems: CommerceModel.PricedQuoteLine[] = []
  for (const line of input.lines) {
    if (line.kind === 'custom') {
      lineItems.push(CommerceModel.priceQuoteCustomLine(line))
      continue
    }
    const priced = CommerceModel.priceQuoteCatalogLine(products.get(line.productId), line)
    if ('error' in priced) return refuse(400, priced.error)
    lineItems.push(priced.line)
  }

  const store = await hostRef.collection('settings').doc('store').get()
  const taxSettings = (store.get('tax') ?? {}) as CommerceModel.TaxSettings
  let tax = CommerceModel.quoteTaxBasisFromSettings(taxSettings, input.shipTo)
  const shippingCents = input.shipping?.amountCents ?? 0
  const amounts = CommerceModel.quoteLineAmounts(lineItems, input.discount)
  // A tax service answers only for a store on its own rates; it is asked about
  // what each line is charged after its share of the discount.
  if (taxSettings.mode === 'manual' && amounts.itemsCents > 0) {
    const serviceLines = lineItems
      .map((line, index) => ({ line, index, amountCents: amounts.netCents[index] }))
      .filter((entry) => entry.amountCents > 0)
    const answer = await deps.quoteTax({
      hostId,
      settings: taxSettings,
      channel: 'invoice',
      lines: serviceLines.map(({ line, index, amountCents }) => ({
        id: String(index),
        ...(line.productId ? { productId: line.productId } : {}),
        ...(line.variantId ? { variantId: line.variantId } : {}),
        ...(line.sku ? { sku: line.sku } : {}),
        description: [line.name, line.variantLabel].filter(Boolean).join(' — '),
        quantity: line.quantity,
        amountCents,
        ...(line.taxExempt ? { exempt: true } : {}),
      })),
      ...(shippingCents ? { shippingCents } : {}),
      shipTo: serviceAddress(input.shipTo),
      customerEmail: input.customer.email ?? null,
    })
    if (answer.quote) {
      tax = {
        kind: 'service',
        taxCents: answer.quote.taxCents,
        providerLabel: answer.quote.providerLabel || answer.quote.provider,
      }
    }
  }
  const totals = CommerceModel.computeQuoteTotals({
    lines: lineItems,
    discount: input.discount,
    shippingCents,
    tax,
  })
  return {
    lineItems,
    totals: CommerceModel.quoteOrderTotals(totals),
    tax,
    taxMode: CommerceModel.quoteTaxMode(tax, totals.taxCents),
    requireProofApprovalDefault: CommerceModel.quoteRequiresProofApprovalByDefault(
      store.get('quotes') as CommerceModel.QuoteStoreSettings | undefined,
    ),
  }
}

/** The editable half of the `quote` section, every key written so a save clears what was removed. */
function editedQuoteFields(input: CommerceModel.QuoteInput) {
  return {
    customer: input.customer,
    billTo: input.billTo,
    shipTo: input.shipTo,
    notes: input.notes,
    terms: input.terms,
    discount: input.discount,
    shipping: input.shipping,
  }
}

export async function handleQuote(deps: QuoteDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method !== 'POST') return refuse(405, 'Method not allowed')
  const authorization = headerOf(req, 'authorization')
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : ''
  if (!idToken) return refuse(401, 'Unauthenticated')
  const body = bodyOf(req)
  const hostId = String(body['hostId'] ?? '')
  const action = String(body['action'] ?? '')
  if (!DOC_ID.test(hostId)) return refuse(400, 'Missing hostId')

  let decoded: { uid: string; email?: string | null; staff?: unknown }
  try {
    decoded = await deps.verifyIdToken(idToken)
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return refuse(401, 'Unauthenticated')
  }
  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = await hostRef.get()
  if (!host.exists) return refuse(404, 'Unknown site')
  const key = SEND_ACTIONS.has(action) ? 'commerce.quotes.send' : 'commerce.quotes'
  if (!holdsCommerceSiteKey(host, decoded.uid, key)) {
    return refuse(403, commerceSitePermissionRefusal(key))
  }
  const actor = String(decoded.email || decoded.uid)

  if (action === 'pay-link' || action === 'replace-link') {
    const quoteId = String(body['quoteId'] ?? '')
    if (!DOC_ID.test(quoteId)) return refuse(400, 'Missing quoteId')
    const ref = hostRef.collection('orders').doc(quoteId)
    const now = deps.now()
    const answer = await firestore.runTransaction(
      async (transaction): Promise<{ outcome: Outcome; closeSession?: string }> => {
        const snapshot = await transaction.get(ref)
        const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
        if (!order || !CommerceModel.isQuote(order) || !order.quote) return { outcome: refuse(404, 'Unknown quote') }
        const version = CommerceModel.quoteLinkVersion(order.quote)
        if (action === 'pay-link') return { outcome: { status: 200, body: { linkVersion: version } } }
        if (!CommerceModel.isUnpaidQuote(order)) {
          return { outcome: refuse(409, 'This quote has been paid, so its link can no longer be replaced.') }
        }
        const next = version + 1
        // The open session goes with the link it was opened from.
        const rest: Partial<CommerceModel.HostOrder> = { ...order }
        delete rest.checkoutSessionId
        transaction.set(ref, {
          ...rest,
          timeline: CommerceModel.appendOrderEvent(
            order,
            'quote-link-replaced',
            `Pay link replaced by ${actor}; the earlier link no longer opens the quote`,
            now,
          ),
          quote: { ...order.quote, linkVersion: next },
        })
        return { outcome: { status: 200, body: { linkVersion: next } }, closeSession: order.checkoutSessionId }
      },
    )
    if (answer.closeSession) await closeOpenSession(deps, answer.closeSession, 'quote link replaced')
    if (answer.outcome.status !== 200) return answer.outcome
    const linkVersion = Number(answer.outcome.body['linkVersion'])
    const url = deps.payLinkUrl((host.data() ?? {}) as Record<string, unknown>, hostId, quoteId, linkVersion)
    if (!url) return refuse(409, 'This site has no web address yet, so its quotes have no pay link. Publish the site first.')
    return { status: 200, body: { url, linkVersion } }
  }

  if (action === 'send') {
    const quoteId = String(body['quoteId'] ?? '')
    if (!DOC_ID.test(quoteId)) return refuse(400, 'Missing quoteId')
    return handleSendAction(deps, {
      req,
      body,
      hostId,
      quoteId,
      hostRef,
      host: (host.data() ?? {}) as Record<string, unknown>,
      firestore,
      actor,
      senderEmail: decoded.email ? String(decoded.email) : null,
    })
  }

  if (action === 'start-from-request') {
    const read = await readRequest(deps, {
      hostId,
      submissionId: String(body['submissionId'] ?? ''),
      uid: decoded.uid,
      staff: decoded.staff === true,
    })
    if ('outcome' in read) return read.outcome
    const started = CommerceModel.quoteStartFromRequest(String(body['submissionId']), read.facts)
    return {
      status: 200,
      body: {
        prefill: started.prefill,
        request: started.request,
        files: CommerceModel.quoteRequestFileViews(started.files),
        threaded: Boolean(started.emailThread),
      },
    }
  }

  if (PROOF_ACTIONS.has(action)) {
    const quoteId = String(body['quoteId'] ?? '')
    if (!DOC_ID.test(quoteId)) return refuse(400, 'Missing quoteId')
    return handleProofAction(deps, { action, body, hostId, quoteId, hostRef, firestore, uid: decoded.uid, actor })
  }

  if (action === 'pdf') {
    const quoteId = String(body['quoteId'] ?? '')
    if (!DOC_ID.test(quoteId)) return refuse(400, 'Missing quoteId')
    const [snapshot, store] = await Promise.all([
      hostRef.collection('orders').doc(quoteId).get(),
      hostRef.collection('settings').doc('store').get(),
    ])
    const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
    if (!order || !CommerceModel.isQuote(order) || !order.quote) return refuse(404, 'Unknown quote')
    const hostData = (host.data() ?? {}) as Record<string, unknown>
    // The pay link is "Send quotes and invoices to customers"; without it the PDF leaves the link off.
    const payUrl =
      CommerceModel.isUnpaidQuote(order) && holdsCommerceSiteKey(host, decoded.uid, 'commerce.quotes.send')
        ? deps.payLinkUrl(hostData, hostId, quoteId, CommerceModel.quoteLinkVersion(order.quote))
        : null
    try {
      const pdf = await deps.quotePdf({
        hostId,
        quoteId,
        order,
        host: hostData,
        store: (store.data() ?? null) as Record<string, unknown> | null,
        payUrl,
      })
      return { status: 200, body: {}, pdf }
    } catch (error) {
      console.error('commerce quote pdf failed', error)
      return refuse(500, 'The PDF could not be made. Try again.')
    }
  }

  if (action === 'search-customers') {
    const text = String(body['text'] ?? '').trim().slice(0, 120)
    if (text.length < 2) return { status: 200, body: { available: true, customers: [] } }
    const owner = await deps.orgForHost(hostId)
    const people = await deps.searchPeople({ hostId, orgId: owner?.id || null, text, limit: 10 })
    if (people === null) return { status: 200, body: { available: false, customers: [] } }
    return {
      status: 200,
      body: {
        available: true,
        customers: people.map((person) => {
          const data = person.data ?? {}
          const read = (key: string) => (typeof data[key] === 'string' ? String(data[key]).trim() : '')
          return {
            record: { kind: person.kind, id: person.id },
            name: read('name'),
            company: read('company'),
            email: person.email,
            phone: read('phone') || null,
          }
        }),
      },
    }
  }

  const quoteId = String(body['quoteId'] ?? '')
  if (action === 'delete') {
    if (!DOC_ID.test(quoteId)) return refuse(400, 'Missing quoteId')
    const ref = hostRef.collection('orders').doc(quoteId)
    const deleted = await firestore.runTransaction(async (transaction): Promise<Outcome & { closeSession?: string }> => {
      const snapshot = await transaction.get(ref)
      // Already gone is what a retried delete finds.
      if (!snapshot.exists) return { status: 200, body: { deleted: true } }
      const order = snapshot.data() as CommerceModel.HostOrder
      if (!CommerceModel.isQuote(order)) return refuse(404, 'Unknown quote')
      if (!CommerceModel.isUnpaidQuote(order)) {
        return refuse(409, 'This quote has been paid, so it is an order now and stays on record.')
      }
      if ((order.quote?.stage ?? 'draft') !== 'draft') {
        return refuse(409, 'Only a draft quote can be deleted.')
      }
      // Earlier revisions are what the customer was shown and answered; a
      // quote that has them stays on record.
      if (Number(order.quote?.revision ?? 1) > 1) {
        return refuse(409, 'This quote has earlier revisions the customer saw, so it stays on record.')
      }
      transaction.delete(ref)
      return { status: 200, body: { deleted: true }, closeSession: order.checkoutSessionId }
    })
    const { closeSession, ...outcome } = deleted as Outcome & { closeSession?: string }
    await closeOpenSession(deps, closeSession, 'quote deleted')
    // Its proofs and anything the customer sent go with it.
    if (outcome.status === 200) await removeQuoteFiles(deps, hostId, quoteId)
    return outcome
  }

  if (action !== 'create' && action !== 'update') return refuse(400, 'Unknown action')
  if (action === 'update' && !DOC_ID.test(quoteId)) return refuse(400, 'Missing quoteId')
  const idempotencyKey = headerOf(req, 'idempotency-key').slice(0, 200)
  if (!idempotencyKey) return refuse(400, 'A quote save needs an Idempotency-Key header.')

  const owner = await deps.orgForHost(hostId)
  if (!checkEntitlement(owner?.org as never, 'commerce')) return refuse(403, 'Selling is not enabled')

  const parsed = CommerceModel.parseQuoteInput(body['quote'])
  if ('error' in parsed) return refuse(400, parsed.error)
  const input = parsed.input
  /*
   * A new quote from a request (AGL-4098): the request is read again, here,
   * for the member saving, and what the quote takes from it — which request,
   * its files, its conversation — comes from that read and never from the
   * body. The editable fields (customer, lines, notes) are the editor's.
   */
  const from = (body['from'] ?? null) as { kind?: unknown; id?: unknown } | null
  let started: ReturnType<typeof CommerceModel.quoteStartFromRequest> | null = null
  if (action === 'create' && from?.kind === 'submission') {
    const read = await readRequest(deps, {
      hostId,
      submissionId: String(from.id ?? ''),
      uid: decoded.uid,
      staff: decoded.staff === true,
    })
    if ('outcome' in read) return read.outcome
    started = CommerceModel.quoteStartFromRequest(String(from.id), read.facts)
  }
  const priced = await priceQuote(deps, hostRef, hostId, input)
  if ('status' in priced) return priced

  const claimed = await claimAttempt(firestore, {
    kind: action === 'create' ? 'commerce-quote' : 'commerce-quote-update',
    scopeId: action === 'create' ? hostId : `${hostId}:${quoteId}`,
    orgId: owner?.id ?? '',
    key: idempotencyKey,
    busyMessage: 'This quote is already being saved',
  })
  if ('replay' in claimed) {
    return { status: claimed.replay.status, body: claimed.replay.body as Record<string, unknown> }
  }
  const claim = claimed.claim
  const now = deps.now()

  try {
    let outcome: Outcome
    if (action === 'create') {
      const orderRef = hostRef.collection('orders').doc(createResourceUid())
      const counterRef = hostRef.collection('counters').doc('orders')
      let number = 0
      await firestore.runTransaction(async (transaction) => {
        const counter = await transaction.get(counterRef)
        number = Number(counter.get('next') ?? 1)
        transaction.set(counterRef, { next: number + 1 }, { merge: true })
        const quote: CommerceModel.OrderQuote = {
          stage: 'draft',
          revision: 1,
          ...editedQuoteFields(input),
          tax: priced.tax,
          requireProofApproval: input.requireProofApproval ?? priced.requireProofApprovalDefault,
          ...(started
            ? {
                request: started.request,
                ...(started.files.length ? { requestFiles: started.files } : {}),
                ...(started.emailThread ? { emailThread: started.emailThread } : {}),
              }
            : {}),
          createdAtMs: now,
          updatedAtMs: now,
          createdBy: actor,
          updatedBy: actor,
        }
        // No `createdAtMs`, list fields or customer fields at the top: an
        // unpaid quote is not an order any list counts (`commerce-quotes.ts`).
        transaction.set(orderRef, {
          number,
          status: 'pending',
          channel: 'quote',
          lineItems: priced.lineItems,
          totals: priced.totals,
          ...(priced.taxMode ? { taxMode: priced.taxMode } : {}),
          timeline: [
            {
              atMs: now,
              event: 'quote',
              detail: started
                ? `Quote created by ${actor} from a request sent through “${started.request.formName}”`
                : `Quote created by ${actor}`,
            },
          ],
          quote,
        })
      })
      outcome = { status: 200, body: { quoteId: orderRef.id, number, updatedAtMs: now } }
    } else {
      const baseUpdatedAtMs = Number(body['baseUpdatedAtMs'])
      const orderRef = hostRef.collection('orders').doc(quoteId)
      let closeSession: string | undefined
      outcome = await firestore.runTransaction(async (transaction): Promise<Outcome> => {
        closeSession = undefined
        const snapshot = await transaction.get(orderRef)
        const existing = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
        if (!existing || !CommerceModel.isQuote(existing) || !existing.quote) {
          return refuse(404, 'Unknown quote')
        }
        if (!CommerceModel.isUnpaidQuote(existing)) {
          return refuse(409, 'This quote has been paid, so it can no longer be changed.')
        }
        if (Number(existing.quote.updatedAtMs) !== baseUpdatedAtMs) {
          return refuse(409, 'Someone else changed this quote. Close it and open it again to see their changes.')
        }
        // The tax mode is restated from this pricing, and dropped when it has
        // none. The pay page's open session was priced from the quote before
        // this edit, so it is closed and forgotten.
        const rest: Partial<CommerceModel.HostOrder> = { ...existing }
        delete rest.taxMode
        delete rest.checkoutSessionId
        closeSession = existing.checkoutSessionId
        transaction.set(orderRef, {
          ...rest,
          lineItems: priced.lineItems,
          totals: priced.totals,
          ...(priced.taxMode ? { taxMode: priced.taxMode } : {}),
          timeline: CommerceModel.appendOrderEvent(existing, 'quote-updated', `Quote edited by ${actor}`, now),
          quote: {
            ...existing.quote,
            ...editedQuoteFields(input),
            tax: priced.tax,
            requireProofApproval:
              input.requireProofApproval ?? existing.quote.requireProofApproval === true,
            updatedAtMs: now,
            updatedBy: actor,
          },
        })
        return { status: 200, body: { quoteId, number: existing.number ?? null, updatedAtMs: now } }
      })
      if (outcome.status === 200) await closeOpenSession(deps, closeSession, 'quote edited')
    }
    if (outcome.status === 200) await claim.record(outcome.status, outcome.body)
    else await claim.release()
    return outcome
  } catch (error) {
    console.error('commerce quote save failed', error)
    await claim.release()
    return refuse(500, 'The quote could not be saved')
  }
}

/*==========================================
 * PROOFS AND REVISIONS (AGL-4096)
 *=========================================*/

const PROOF_ACTIONS = new Set(['proof-ticket', 'proof-finalize', 'proof-remove', 'start-revision', 'revisions', 'file'])

/** Deletes a quote's kept files, its proofs and the customer's artwork; never throws. */
async function removeQuoteFiles(deps: QuoteDeps, hostId: string, quoteId: string): Promise<void> {
  try {
    const uploads = await deps.uploads()
    await Promise.all(
      [CommerceModel.QUOTE_PROOF_PURPOSE, CommerceModel.QUOTE_ARTWORK_PURPOSE].map((purpose) =>
        uploads.removeAll({ hostId, purpose, purposeId: quoteId }),
      ),
    )
  } catch (error) {
    console.error('quote files were not removed', { hostId, quoteId, error })
  }
}

/** A file as the console is told about it: everything but where it is kept. */
function fileView<T extends { path?: string }>(file: T): Omit<T, 'path'> {
  const rest: T = { ...file }
  delete rest.path
  return rest
}

/** A revision as the console's history lists it. */
function revisionView(snapshot: CommerceModel.QuoteRevisionSnapshot) {
  return {
    ...snapshot,
    proofs: (snapshot.proofs ?? []).map(fileView),
    responses: (snapshot.responses ?? []).map((response) => ({
      ...response,
      ...(response.files ? { files: response.files.map(fileView) } : {}),
    })),
  }
}

/**
 * Writes `next` over the quote in `transaction`, without the pay page's open
 * session, which was priced from the quote as it stood; the caller closes it.
 */
function writeEditedQuote(
  transaction: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
  next: CommerceModel.HostOrder,
): string | undefined {
  const rest: Partial<CommerceModel.HostOrder> = { ...next }
  const session = rest.checkoutSessionId
  delete rest.checkoutSessionId
  transaction.set(ref, rest)
  return session
}

async function handleProofAction(
  deps: QuoteDeps,
  context: {
    action: string
    body: Record<string, unknown>
    hostId: string
    quoteId: string
    hostRef: FirebaseFirestore.DocumentReference
    firestore: FirebaseFirestore.Firestore
    uid: string
    actor: string
  },
): Promise<Outcome> {
  const { action, body, hostId, quoteId, hostRef, firestore, uid, actor } = context
  const ref = hostRef.collection('orders').doc(quoteId)
  const proofScope = { hostId, purpose: CommerceModel.QUOTE_PROOF_PURPOSE, purposeId: quoteId }

  if (action === 'revisions' || action === 'file') {
    const snapshot = await ref.get()
    const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
    if (!order || !CommerceModel.isQuote(order) || !order.quote) return refuse(404, 'Unknown quote')
    const current = Number(order.quote.revision ?? 1)
    const wanted = body['revision'] === undefined || body['revision'] === null ? current : Number(body['revision'])
    let snapshots: CommerceModel.QuoteRevisionSnapshot[] = []
    if (action === 'revisions' || wanted !== current) {
      const listed = await ref.collection('revisions').get()
      snapshots = listed.docs
        .map((entry) => entry.data() as CommerceModel.QuoteRevisionSnapshot)
        .filter((entry) => Number.isInteger(Number(entry?.revision)))
        .sort((a, b) => Number(a.revision) - Number(b.revision))
    }
    if (action === 'revisions') return { status: 200, body: { revisions: snapshots.map(revisionView) } }

    const fileId = String(body['fileId'] ?? '')
    const source =
      wanted === current
        ? { proofs: CommerceModel.currentQuoteProofs(order.quote), responses: order.quote.responses ?? [] }
        : snapshots.find((entry) => Number(entry.revision) === wanted)
    const files = [
      ...(source?.proofs ?? []),
      ...(source?.responses ?? []).flatMap((response) => response.files ?? []),
      // The request's files (AGL-4098), on every revision: they came first.
      ...(order.quote.requestFiles ?? []),
    ]
    const file = files.find((entry) => entry.id === fileId)
    if (!file?.path) return refuse(404, 'That file is no longer on this quote.')
    return { status: 200, body: {}, file: { path: file.path, name: file.name, contentType: file.contentType } }
  }

  if (action === 'proof-ticket') {
    const snapshot = await ref.get()
    const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
    const refused = CommerceModel.quoteProofChangeRefusal(order, 'add')
    if (refused) return refuse(refused === 'not-a-quote' ? 404 : 409, CommerceModel.quoteProofRefusalMessage(refused))
    // Storage is spent here, so the plan must sell, as a save's must.
    const owner = await deps.orgForHost(hostId)
    if (!checkEntitlement(owner?.org as never, 'commerce')) return refuse(403, 'Selling is not enabled')
    const uploads = await deps.uploads()
    const minted = await uploads.mint({ scope: proofScope, request: body['file'], caller: { uid } })
    if ('error' in minted) return refuse(minted.status, minted.error)
    return { status: 200, body: { ticket: minted.ticket, upload: minted.upload, file: minted.file } }
  }

  if (action === 'proof-finalize') {
    const uploads = await deps.uploads()
    const kept = await uploads.finalize({ scope: proofScope, ticket: body['ticket'], caller: { uid } })
    if ('error' in kept) return refuse(kept.status, kept.error)
    const now = deps.now()
    const answer = await firestore.runTransaction(
      async (transaction): Promise<{ outcome: Outcome; closeSession?: string }> => {
        const snapshot = await transaction.get(ref)
        const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
        if (!order) return { outcome: refuse(404, 'Unknown quote') }
        // A retried finalize finds its proof already on the quote.
        const already = CommerceModel.currentQuoteProofs(order.quote).find((proof) => proof.id === kept.file.id)
        if (already) {
          return { outcome: { status: 200, body: { proof: fileView(already), updatedAtMs: order.quote?.updatedAtMs ?? null } } }
        }
        const added = CommerceModel.withQuoteProofAdded(
          order,
          {
            id: kept.file.id,
            name: kept.file.name,
            contentType: kept.file.contentType,
            size: kept.file.size,
            path: kept.file.path,
          },
          { atMs: now, by: actor },
        )
        if ('reason' in added) {
          return {
            outcome: refuse(added.reason === 'not-a-quote' ? 404 : 409, CommerceModel.quoteProofRefusalMessage(added.reason)),
          }
        }
        const closeSession = writeEditedQuote(transaction, ref, added.order)
        return { outcome: { status: 200, body: { proof: fileView(added.proof), updatedAtMs: now } }, closeSession }
      },
    )
    if (answer.outcome.status !== 200) await uploads.remove(kept.file.path).catch(() => undefined)
    await closeOpenSession(deps, answer.closeSession, 'quote proof added')
    return answer.outcome
  }

  if (action === 'proof-remove') {
    const proofId = String(body['proofId'] ?? '')
    const now = deps.now()
    const answer = await firestore.runTransaction(
      async (transaction): Promise<{ outcome: Outcome; closeSession?: string; path?: string }> => {
        const snapshot = await transaction.get(ref)
        const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
        if (!order) return { outcome: refuse(404, 'Unknown quote') }
        const removed = CommerceModel.withQuoteProofRemoved(order, proofId, { atMs: now, by: actor })
        if ('reason' in removed) {
          return {
            outcome: refuse(
              removed.reason === 'not-a-quote' || removed.reason === 'unknown-proof' ? 404 : 409,
              CommerceModel.quoteProofRefusalMessage(removed.reason),
            ),
          }
        }
        const closeSession = writeEditedQuote(transaction, ref, removed.order)
        return { outcome: { status: 200, body: { removed: true, updatedAtMs: now } }, closeSession, path: removed.proof.path }
      },
    )
    if (answer.path) {
      const uploads = await deps.uploads()
      await uploads.remove(answer.path).catch((error) => console.error('quote proof file was not deleted', error))
    }
    await closeOpenSession(deps, answer.closeSession, 'quote proof removed')
    return answer.outcome
  }

  // start-revision
  const now = deps.now()
  const answer = await firestore.runTransaction(
    async (transaction): Promise<{ outcome: Outcome; closeSession?: string }> => {
      const snapshot = await transaction.get(ref)
      const order = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
      if (!order) return { outcome: refuse(404, 'Unknown quote') }
      const started = CommerceModel.startQuoteRevision(order, { atMs: now, by: actor })
      if ('reason' in started) return { outcome: refuse(started.reason === 'paid' ? 409 : 404, started.error) }
      const revisionRef = ref.collection('revisions').doc(String(started.revision))
      // A revision on record is never written over.
      if ((await transaction.get(revisionRef)).exists) {
        return { outcome: refuse(409, `Revision ${started.revision} is already on record. Close the quote and open it again.`) }
      }
      transaction.set(revisionRef, started.snapshot)
      const closeSession = writeEditedQuote(transaction, ref, started.order)
      return {
        outcome: { status: 200, body: { revision: started.revision + 1, updatedAtMs: now } },
        closeSession,
      }
    },
  )
  await closeOpenSession(deps, answer.closeSession, 'quote revision started')
  return answer.outcome
}

/*==========================================
 * SENDING THE QUOTE (AGL-4097)
 *
 *   { action: 'send', hostId, quoteId, to?, subject?, message } + Idempotency-Key
 *
 * Emails the quote to `to` (else the customer's email) under `subject` (else
 * the conversation's, else "Quote #N from {business}"), with the business's
 * message, the proof, the PDF and the pay link. Refused for a paid quote, one
 * with nowhere to send it, and an address on a suppression list.
 *
 * When the customer was emailed an earlier revision and the link has not
 * been replaced since, the link is replaced first (as Replace link does: the
 * version moves on, the open payment closes) so the earlier email's link
 * says the quote was updated. A resend of the same revision keeps it. Then
 * the send is recorded (`quote.sends`), the conversation moves on
 * (`quote.emailThread`), the quote moves to Sent unless the customer has
 * answered this revision, and the timeline says so.
 *
 * One attempt per key: a retried press replays the answer and never sends a
 * second email. A send that fails releases the key, and a retry finds the
 * link already replaced, so it never replaces it twice.
 *=========================================*/

async function handleSendAction(
  deps: QuoteDeps,
  context: {
    req: PluginApiRequest
    body: Record<string, unknown>
    hostId: string
    quoteId: string
    hostRef: FirebaseFirestore.DocumentReference
    host: Record<string, unknown>
    firestore: FirebaseFirestore.Firestore
    actor: string
    senderEmail: string | null
  },
): Promise<Outcome> {
  const { req, body, hostId, quoteId, hostRef, host, firestore, actor } = context
  const parsed = CommerceModel.parseQuoteSendInput(body)
  if ('error' in parsed) return refuse(400, parsed.error)
  const idempotencyKey = headerOf(req, 'idempotency-key').slice(0, 200)
  if (!idempotencyKey) return refuse(400, 'Sending a quote needs an Idempotency-Key header.')

  const ref = hostRef.collection('orders').doc(quoteId)
  const [snapshot, store] = await Promise.all([ref.get(), hostRef.collection('settings').doc('store').get()])
  const stored = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
  const to = CommerceModel.quoteSendRecipient(stored, parsed.input.to)
  const refused = CommerceModel.quoteSendRefusal(stored, to)
  if (refused) {
    return refuse(refused === 'not-a-quote' ? 404 : refused === 'paid' ? 409 : 400, CommerceModel.quoteSendRefusalMessage(refused))
  }
  if (!deps.payLinkUrl(host, hostId, quoteId, CommerceModel.quoteLinkVersion(stored?.quote))) {
    return refuse(409, 'This site has no web address yet, so its quotes have no pay link. Publish the site first.')
  }
  const owner = await deps.orgForHost(hostId)
  if (!checkEntitlement(owner?.org as never, 'commerce')) return refuse(403, 'Selling is not enabled')
  const mailer = await deps.mailer()
  if (!mailer.configured()) {
    return refuse(503, 'Email isn’t set up here, so quotes can’t be emailed. Copy the pay link and send it yourself.')
  }
  // The bounce and complaint list only (AGL-4098): the customer asked for the
  // quote, so unsubscribing from the site's newsletter does not refuse it.
  if (await mailer.suppression(to)) {
    return refuse(
      409,
      `${to} bounced or reported an email as spam, so it can’t be emailed. Copy the pay link and send it another way.`,
    )
  }

  const claimed = await claimAttempt(firestore, {
    kind: 'commerce-quote-send',
    scopeId: `${hostId}:${quoteId}`,
    orgId: owner?.id ?? '',
    key: idempotencyKey,
    busyMessage: 'This quote is already being sent',
  })
  if ('replay' in claimed) {
    return { status: claimed.replay.status, body: claimed.replay.body as Record<string, unknown> }
  }
  const claim = claimed.claim
  const now = deps.now()

  let prepared:
    | { outcome: Outcome }
    | { order: CommerceModel.HostOrder; linkVersion: number; linkReplaced: boolean; closeSession?: string }
  try {
    // A new revision's first email replaces the link the customer was sent.
    prepared = await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      const order = current.exists ? (current.data() as CommerceModel.HostOrder) : null
      const again = CommerceModel.quoteSendRefusal(order, to)
      if (again || !order?.quote) {
        const reason = again ?? 'not-a-quote'
        return { outcome: refuse(reason === 'not-a-quote' ? 404 : 409, CommerceModel.quoteSendRefusalMessage(reason)) }
      }
      const version = CommerceModel.quoteLinkVersion(order.quote)
      if (!CommerceModel.quoteSendReplacesLink(order.quote)) return { order, linkVersion: version, linkReplaced: false }
      const rest: Partial<CommerceModel.HostOrder> = { ...order }
      delete rest.checkoutSessionId
      const replaced = {
        ...rest,
        timeline: CommerceModel.appendOrderEvent(
          order,
          'quote-link-replaced',
          `Pay link replaced to send revision ${Number(order.quote.revision ?? 1)}; the earlier email's link no longer opens the quote`,
          now,
        ),
        quote: { ...order.quote, linkVersion: version + 1 },
      } as CommerceModel.HostOrder
      transaction.set(ref, replaced)
      return { order: replaced, linkVersion: version + 1, linkReplaced: true, closeSession: order.checkoutSessionId }
    })
  } catch (error) {
    console.error('commerce quote send failed before sending', error)
    await claim.release()
    return refuse(500, 'The quote could not be sent. Try again.')
  }
  if ('outcome' in prepared) {
    await claim.release()
    return prepared.outcome
  }
  const { order, linkVersion, linkReplaced } = prepared
  await closeOpenSession(deps, prepared.closeSession, 'quote link replaced to send a revision')

  const payUrl = deps.payLinkUrl(host, hostId, quoteId, linkVersion) as string
  let delivered: Awaited<ReturnType<QuoteMailer['deliver']>>
  try {
    delivered = await mailer.deliver({
      hostId,
      quoteId,
      order,
      host,
      store: (store.data() ?? null) as Record<string, unknown> | null,
      owner: owner ? { id: owner.id, org: owner.org } : null,
      to,
      subject: parsed.input.subject,
      message: parsed.input.message,
      payUrl,
      proofUrl: (proofId) => deps.proofLinkUrl(host, hostId, quoteId, linkVersion, proofId),
      linkReplaced,
      senderEmail: context.senderEmail,
      atMs: now,
    })
  } catch (error) {
    console.error('commerce quote send failed', error)
    await claim.release()
    return refuse(502, 'The quote email could not be sent. Try again.')
  }
  // `strictNullChecks` is off, so the result does not narrow on `sent`.
  if ('error' in delivered) {
    await claim.release()
    return refuse(delivered.status, delivered.error)
  }
  const done = delivered as Extract<typeof delivered, { sent: true }>

  // The email is out: from here a failure is logged, never answered as one,
  // so a retry does not send it twice.
  const revision = Math.max(1, Number(order.quote?.revision ?? 1) || 1)
  const send: CommerceModel.QuoteSendRecord = {
    revision,
    to,
    subject: done.subject,
    atMs: now,
    by: actor,
    messageId: done.messageId,
    providerId: done.providerId,
    linkVersion,
  }
  try {
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref)
      const latest = current.exists ? (current.data() as CommerceModel.HostOrder) : null
      if (!latest?.quote) return
      transaction.set(ref, CommerceModel.quoteAfterSend(latest, send, done.thread))
    })
  } catch (error) {
    console.error('commerce quote sent but not recorded', { hostId, quoteId, messageId: done.messageId, error })
  }
  const outcome: Outcome = {
    status: 200,
    body: { sent: true, to, atMs: now, revision, linkVersion, linkReplaced },
  }
  await claim.record(outcome.status, outcome.body)
  return outcome
}

/** `POST /api/commerce/quote`. */
export const quoteHandler: PluginApiHandler = async (req, res) => {
  const deps = defaultQuoteDeps()
  const outcome = await handleQuote(deps, req)
  if (outcome.pdf) return sendPdf(res, outcome.pdf)
  if (outcome.file) {
    const uploads = await deps.uploads()
    return uploads.send(res as never, outcome.file)
  }
  return res.status(outcome.status).json(outcome.body)
}
