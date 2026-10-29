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
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
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
import { quotePayLinkUrl } from './quote-link-token'

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
 *
 * Every action but the pay link's two asks "Create and edit quotes"
 * (`commerce.quotes`); the pay link's two ask "Send quotes and invoices to
 * customers" (`commerce.quotes.send`, AGL-4094). The PDF (AGL-4095) is the
 * document the customer would download from the quote page, and carries the
 * pay link only for someone who also holds `commerce.quotes.send`. Create and update take an
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
  /** The quote's PDF; loads the PDF writer and sharp only when asked. */
  quotePdf(input: Parameters<typeof quotePdfFile>[0]): Promise<CommercePdfFile>
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
    quotePdf: async (input) => (await import('./commerce-pdf')).quotePdfFile(input),
    now: () => Date.now(),
  }
}

/** Expires the session the pay page opened, when there is one; a failure is logged, never thrown. */
async function closeOpenSession(deps: QuoteDeps, sessionId: string | undefined, context: string): Promise<void> {
  if (!sessionId) return
  const result = await deps.expireSession(sessionId).catch((): CheckoutSessionExpiry => 'open')
  if (result === 'open') {
    console.error(`${context}: the quote's Stripe session was not expired and may still be paid`, { sessionId })
  }
}

type Outcome = { status: number; body: Record<string, unknown>; pdf?: CommercePdfFile }

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

  let decoded: { uid: string; email?: string | null }
  try {
    decoded = await deps.verifyIdToken(idToken)
  } catch {
    return refuse(401, 'Unauthenticated')
  }
  const firestore = deps.firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = await hostRef.get()
  if (!host.exists) return refuse(404, 'Unknown site')
  const key = action === 'pay-link' || action === 'replace-link' ? 'commerce.quotes.send' : 'commerce.quotes'
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
      transaction.delete(ref)
      return { status: 200, body: { deleted: true }, closeSession: order.checkoutSessionId }
    })
    const { closeSession, ...outcome } = deleted as Outcome & { closeSession?: string }
    await closeOpenSession(deps, closeSession, 'quote deleted')
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
          timeline: [{ atMs: now, event: 'quote', detail: `Quote created by ${actor}` }],
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

/** `POST /api/commerce/quote`. */
export const quoteHandler: PluginApiHandler = async (req, res) => {
  const outcome = await handleQuote(defaultQuoteDeps(), req)
  if (outcome.pdf) return sendPdf(res, outcome.pdf)
  return res.status(outcome.status).json(outcome.body)
}
