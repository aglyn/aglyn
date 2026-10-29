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
  checkEntitlement,
  claimAttempt,
  deriveStripeObjectKey,
  resolveTransactionFeeCents,
  type PluginApiHandler,
  type PluginApiRequest,
} from '@aglyn/aglyn/server'
import { resolveHostToken, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { type SiteReturnHost, siteReturnOrigin } from '@aglyn/aglyn/app-utils/site-return-url'
import { consumeRateLimit, firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { merchantAccountIsReady } from '@aglyn/tenant-data-admin/server/payment-provider'
import { checkoutSessionCardAuthenticationParams } from '@aglyn/tenant-data-admin/server/stripe-card-authentication'
import { quotePageHref } from '../constants/quote-page'
import * as CommerceModel from '../model'
import { expireCheckoutSession, type CheckoutSessionExpiry } from './checkout-session-expiry'
import { resolveManualTaxRateId } from './manual-tax-rate'
import {
  applyNativeCheckoutParams,
  nativeCheckoutStripeHeaders,
  readCheckoutSessionPayload,
  resolveNativeCheckoutMode,
  type NativeCheckoutMode,
} from './native-checkout'
import { orderStatusUrl } from './order-status-token'
import { ensureCheckoutDomain } from './payment-method-domains'
import { verifyQuoteLinkToken } from './quote-link-token'

/*==========================================
 * THE CUSTOMER'S QUOTE PAGE AND ITS PAY BUTTON (AGL-4094).
 *
 *   GET  /api/commerce/quote-view?hostId=&q=<quoteId>&t=<token>
 *        → 200 QuotePageView | 200 { state: 'replaced', storeName } | 404
 *   POST /api/commerce/quote-pay  { hostId, q, t, v }  + Idempotency-Key
 *        → 200 { url } (Stripe's page) | 200 { clientSecret, publishableKey, sessionId, wallets? }
 *          (the in-page form) | 409 { error, reason } | 410 { error, replaced: true } | 404
 *
 * The signed link (`quote-link-token.ts`) is the whole credential. A wrong
 * token answers exactly as a missing quote does, so neither route tells
 * anyone which quote ids exist; both are rate-limited per address per site
 * BEFORE the token check, so guessing costs what looking does. A link signed
 * for an older version of the quote opens the replaced page and nothing else.
 *
 * Pay opens a FRESH Checkout Session from the stored quote on every press:
 * the prices are the stored lines', never anything the page sends, and the
 * session the previous press opened is expired first, so two sessions for one
 * quote can never both be open. The quote keeps the open one in
 * `checkoutSessionId`. A Stripe session lapses after a day; the quote and its
 * link do not, because the next press opens another.
 *
 * The payment completes in `billing-webhook.ts`, which turns this same
 * document into the order (`paidQuoteOrder`); nothing here marks it paid.
 *=========================================*/

/** Lookups and presses one address may make per site, per ten minutes. */
export const QUOTE_VIEW_LOOKUPS_PER_WINDOW = 60
export const QUOTE_PAY_PRESSES_PER_WINDOW = 20
export const QUOTE_WINDOW_MS = 10 * 60_000

export interface QuotePayDeps {
  firestore(): FirebaseFirestore.Firestore
  consumeRateLimit(key: string, options: { limit: number; windowMs: number }): Promise<{ allowed: boolean; resetMs: number }>
  orgForHost(hostId: string): Promise<{ id?: string; org?: any } | null>
  nativeMode(orgId: string): Promise<NativeCheckoutMode>
  /** The store's manual tax rate as a Stripe tax rate, or null when one cannot be had. */
  taxRateId(input: Parameters<typeof resolveManualTaxRateId>[0]): Promise<string | null>
  createSession(
    params: URLSearchParams,
    headers: Record<string, string>,
  ): Promise<{ ok: boolean; session: { id?: string; url?: string; client_secret?: string; error?: unknown } }>
  expireSession(sessionId: string): Promise<CheckoutSessionExpiry>
  /** Registers the page's domain for Apple Pay; never throws. */
  ensureDomain(input: Parameters<typeof ensureCheckoutDomain>[0]): Promise<unknown>
  now(): number
}

export function defaultQuotePayDeps(): QuotePayDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    consumeRateLimit: (key, options) => consumeRateLimit(key, options),
    orgForHost: async (hostId) => {
      const found = await getOrgForHost(hostId)
      return found ? { id: found.orgId, org: found.org } : null
    },
    nativeMode: (orgId) => resolveNativeCheckoutMode(orgId),
    taxRateId: (input) => resolveManualTaxRateId(input),
    createSession: async (params, headers) => {
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          ...headers,
        },
        body: params.toString(),
      })
      return { ok: response.ok, session: (await response.json().catch(() => ({}))) as never }
    },
    expireSession: (sessionId) => expireCheckoutSession(sessionId),
    ensureDomain: (input) => ensureCheckoutDomain(input).catch(() => null),
    now: () => Date.now(),
  }
}

/** A link route's answer: a status, a JSON body and any extra headers. */
export type QuoteLinkOutcome = { status: number; body: Record<string, unknown>; headers?: Record<string, string> }

const DOC_ID = /^(?!__.*__$)[^/]{1,200}$/

const NOT_FOUND: QuoteLinkOutcome = {
  status: 404,
  body: { error: 'We could not find that quote. Check the link you were sent.' },
}

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
  return String(Array.isArray(value) ? (value[0] ?? '') : (value ?? '')).trim()
}

/** The rate limit a link route spends per address per site, BEFORE the token is checked. */
export async function limitedQuoteLink(
  deps: QuotePayDeps,
  req: PluginApiRequest,
  key: string,
  limit: number,
): Promise<QuoteLinkOutcome | null> {
  const ip = readClientIp(req.headers as never, { remoteAddress: req.socket?.remoteAddress }) ?? 'no-address'
  const rate = await deps.consumeRateLimit(`${key}:${ip}`, { limit, windowMs: QUOTE_WINDOW_MS })
  if (rate.allowed) return null
  return {
    status: 429,
    body: { error: 'Too many tries. Try again in a few minutes.' },
    headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetMs - deps.now()) / 1000))) },
  }
}

export interface LoadedQuote {
  hostRef: FirebaseFirestore.DocumentReference
  host: Record<string, unknown>
  order: CommerceModel.HostOrder
  storeName: string
  store: FirebaseFirestore.DocumentSnapshot
}

/**
 * The quote a link names, after its token: the quote, the replaced answer for
 * a link to an older version, or the one not-found answer for everything else.
 */
export async function loadLinkedQuote(
  deps: QuotePayDeps,
  hostId: string,
  quoteId: string,
  token: string,
): Promise<{ loaded: LoadedQuote } | { outcome: QuoteLinkOutcome }> {
  const version = verifyQuoteLinkToken(hostId, quoteId, token)
  if (version === null) return { outcome: NOT_FOUND }
  const hostRef = deps.firestore().collection('hosts').doc(hostId)
  const [hostSnapshot, store, orderSnapshot] = await Promise.all([
    hostRef.get(),
    hostRef.collection('settings').doc('store').get(),
    hostRef.collection('orders').doc(quoteId).get(),
  ])
  if (!hostSnapshot.exists || !orderSnapshot.exists) return { outcome: NOT_FOUND }
  const order = orderSnapshot.data() as CommerceModel.HostOrder
  if (!CommerceModel.isQuote(order) || !order.quote) return { outcome: NOT_FOUND }
  const host = (hostSnapshot.data() ?? {}) as Record<string, unknown>
  const storeName = String(resolveHostToken('businessName', host as HostTokenSource) ?? '')
  const current = CommerceModel.quoteLinkVersion(order.quote)
  if (version > current) return { outcome: NOT_FOUND }
  if (version < current) {
    return {
      outcome: {
        status: 410,
        body: {
          state: 'replaced',
          storeName,
          replaced: true,
          error: `This quote was updated, and ${storeName || 'the business'} sent you a newer link.`,
        },
      },
    }
  }
  return { loaded: { hostRef, host, order, storeName, store } }
}

/** The link's site, quote and token from a query or a body, and whether all three are there. */
export function quoteLinkParams(source: Record<string, unknown>) {
  const hostId = String(source['hostId'] ?? '')
  const quoteId = String(source['q'] ?? '').slice(0, 200)
  const token = String(source['t'] ?? '').slice(0, 200)
  const complete = DOC_ID.test(hostId) && DOC_ID.test(quoteId) && Boolean(token)
  return { hostId, quoteId, token, complete }
}

/** `GET /api/commerce/quote-view`: the quote page's data. */
export async function handleQuoteView(deps: QuotePayDeps, req: PluginApiRequest): Promise<QuoteLinkOutcome> {
  if (req.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } }
  const { hostId, quoteId, token, complete } = quoteLinkParams((req.query ?? {}) as Record<string, unknown>)
  if (!complete) return { status: 400, body: { error: 'This link is incomplete.' } }
  const refused = await limitedQuoteLink(deps, req, `commerce-quote-view:${hostId}`, QUOTE_VIEW_LOOKUPS_PER_WINDOW)
  if (refused) return refused
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token)
  if ('outcome' in linked) {
    // The replaced page is a page, not a failure: answered as data.
    if (linked.outcome.status === 410) {
      const { storeName } = linked.outcome.body as { storeName: string }
      return { status: 200, body: { state: 'replaced', storeName } }
    }
    return linked.outcome
  }
  const { host, order, storeName, store } = linked.loaded
  const view = CommerceModel.buildQuotePageView({
    order,
    orderId: quoteId,
    storeName,
    currency: String(store.get('currency') ?? 'USD'),
    receiptUrl: CommerceModel.isUnpaidQuote(order) ? null : orderStatusUrl(host, hostId, quoteId),
  })
  return { status: 200, body: view as unknown as Record<string, unknown> }
}

/** The Checkout Session a quote's Pay opens, as form params. Pure over its inputs. */
export function buildQuoteSessionParams(input: {
  hostId: string
  quoteId: string
  order: CommerceModel.HostOrder
  charge: CommerceModel.QuoteCheckoutCharge
  accountId: string
  feeCents: number
  taxRateId: string
  returnUrl: string
  paymentMethods: CommerceModel.StorefrontPaymentMethodControls
}): URLSearchParams {
  const { charge, order } = input
  const quote = order.quote as CommerceModel.OrderQuote
  const params = new URLSearchParams({
    mode: 'payment',
    ...checkoutSessionCardAuthenticationParams('payment'),
    ...(charge.taxAtPayment ? { 'automatic_tax[enabled]': 'true' } : {}),
  })
  charge.lines.forEach((line, index) => {
    const at = `line_items[${index}]`
    params.set(`${at}[quantity]`, '1')
    params.set(`${at}[price_data][currency]`, 'usd')
    params.set(`${at}[price_data][unit_amount]`, String(line.amountCents))
    params.set(`${at}[price_data][product_data][name]`, line.name.slice(0, 120))
    if (line.description) params.set(`${at}[price_data][product_data][description]`, line.description)
    // Stripe Tax's nontaxable code, for tax-exempt products and a tax charged as its own line.
    if (!line.taxable) params.set(`${at}[price_data][product_data][tax_code]`, 'txcd_00000000')
    if (line.taxable && input.taxRateId) params.set(`${at}[tax_rates][0]`, input.taxRateId)
  })
  // Shipping the business priced for the quote's ship-to, charged as the one
  // option, with the address asked for where it ships (and where Stripe Tax
  // reads the tax from). The quote's own address stands when it asks nothing.
  if (charge.shippingCents > 0) {
    const country = String(quote.shipTo?.country ?? '').toUpperCase()
    CommerceModel.appendShippingAddressCollectionParams(
      params,
      /^[A-Z]{2}$/.test(country) ? [country] : CommerceModel.CHECKOUT_SHIPPING_COUNTRIES,
    )
    CommerceModel.appendCheckoutShippingParams(params, [
      { rateId: 'quote', name: 'Shipping', amountCents: charge.shippingCents },
    ])
  }
  const shippingFloorCents = charge.shippingCents
  for (const [key, value] of Object.entries(
    CommerceModel.destinationChargeParams({
      accountId: input.accountId,
      feeCents: input.feeCents,
      taxOwner: charge.taxAtPayment ? 'platform' : 'merchant',
      merchantGoodsCents: charge.goodsCents,
      shippingFloorCents,
    }),
  )) {
    params.set(key, value)
  }
  const email = String(quote.customer?.email ?? '').trim()
  if (email) params.set('customer_email', email)
  const separator = input.returnUrl.includes('?') ? '&' : '?'
  params.set('success_url', `${input.returnUrl}${separator}session_id={CHECKOUT_SESSION_ID}`)
  params.set('cancel_url', input.returnUrl)
  // What the `commerce-draft` webhook branch reads to turn this quote into
  // its order, and to tell a payment for the quote as it stands from one for
  // a replaced link or an earlier edit.
  params.set('metadata[type]', 'commerce-draft')
  params.set('metadata[hostId]', input.hostId)
  params.set('metadata[orderId]', input.quoteId)
  params.set('metadata[quoteId]', input.quoteId)
  params.set('metadata[quoteLinkVersion]', String(CommerceModel.quoteLinkVersion(quote)))
  params.set('metadata[quoteUpdatedAtMs]', String(Number(quote.updatedAtMs) || 0))
  params.set('metadata[feeCents]', String(input.feeCents))
  // A tax charged as its own line is invisible to Stripe's tax total; this
  // witness is what records it as the business's tax.
  if (charge.taxCents > 0 && charge.taxPct === null) {
    params.set('metadata[taxCents]', String(charge.taxCents))
  }
  if (charge.taxAtPayment) {
    params.set(
      'metadata[transferCents]',
      String(
        CommerceModel.platformLiableTransferCents({
          feeCents: input.feeCents,
          merchantGoodsCents: charge.goodsCents,
          shippingFloorCents,
        }),
      ),
    )
    params.set('metadata[transferShippingCents]', String(shippingFloorCents))
  }
  CommerceModel.appendStorefrontPaymentMethodParams(params, input.paymentMethods)
  return params
}

const QUOTE_UPDATED_MESSAGE = 'This quote was updated since you opened it. Reload the page to see it before you pay.'

const refusal = (status: number, reason: string, error: string, extra: Record<string, unknown> = {}): QuoteLinkOutcome => ({
  status,
  body: { error, reason, ...extra },
})

/** `POST /api/commerce/quote-pay`: a fresh Checkout Session for the quote. */
export async function handleQuotePay(deps: QuotePayDeps, req: PluginApiRequest): Promise<QuoteLinkOutcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  if (!process.env.STRIPE_SECRET_KEY) return { status: 501, body: { error: 'Payments are not configured.' } }
  const { hostId, quoteId, token, complete } = quoteLinkParams(bodyOf(req))
  if (!complete) return { status: 400, body: { error: 'This link is incomplete.' } }
  const idempotencyKey = headerOf(req, 'idempotency-key').slice(0, 200)
  if (!idempotencyKey) return { status: 400, body: { error: 'Paying needs an Idempotency-Key header.' } }
  const refused = await limitedQuoteLink(deps, req, `commerce-quote-pay:${hostId}`, QUOTE_PAY_PRESSES_PER_WINDOW)
  if (refused) return refused
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token)
  if ('outcome' in linked) return linked.outcome
  const { hostRef, host, order, storeName, store } = linked.loaded

  // Every refusal the customer can be given is above the claim, so none of
  // them spends the press. `v` is the edit of the quote the page showed: a
  // quote changed since is shown again before it is paid, never charged unseen.
  const seen = Number(bodyOf(req)['v'])
  if (Number.isFinite(seen) && seen > 0 && seen !== (Number(order.quote?.updatedAtMs) || 0)) {
    return refusal(409, 'updated', QUOTE_UPDATED_MESSAGE)
  }
  const blocked = CommerceModel.quotePayRefusal(order, quoteId)
  if (blocked) return refusal(409, blocked, CommerceModel.quotePayRefusalMessage(blocked, storeName))
  const owner = await deps.orgForHost(hostId)
  const unavailable = refusal(
    409,
    'payments-unavailable',
    `${storeName || 'This business'} can’t take payments online right now. Contact them to pay this quote.`,
  )
  if (!checkEntitlement(owner?.org as never, 'commerce')) return unavailable
  const ownerUid = owner?.org?.ownerUid
  const profile = ownerUid ? await deps.firestore().collection('profiles').doc(String(ownerUid)).get() : null
  const accountId = profile?.get('stripeAccountId')
  const ready = merchantAccountIsReady(
    {
      accountId,
      chargesEnabled: profile?.get('stripeChargesEnabled'),
      accountLivemode: profile?.get('stripeAccountLivemode'),
    },
    { subject: `quote ${quoteId} on host ${hostId}` },
  )
  if (!ready) return unavailable
  const taxSettings = (store.get('tax') ?? {}) as CommerceModel.TaxSettings
  if (CommerceModel.storefrontTaxDecision({ settings: taxSettings }).kind === 'undecided') {
    return refusal(409, 'tax-undecided', CommerceModel.quotePayRefusalMessage('tax-undecided', storeName))
  }

  const charge = CommerceModel.quoteCheckoutCharge(order, quoteId)
  const feeCents = resolveTransactionFeeCents(owner?.org as never, charge.feeProductType, charge.goodsCents, charge.totalCents)
  const nativeMode = await deps.nativeMode(String(owner?.id ?? ''))
  const site = host as SiteReturnHost
  const origin = siteReturnOrigin({
    candidates: [headerOf(req, 'referer'), `https://${headerOf(req, 'host')}`],
    site,
    requestHost: headerOf(req, 'host'),
  })
  const returnUrl = `${origin}${quotePageHref(quoteId, token)}`
  const openedFor = order.checkoutSessionId ?? ''
  const openedAtEdit = Number(order.quote?.updatedAtMs) || 0

  const claimed = await claimAttempt(deps.firestore(), {
    kind: 'commerce-quote-pay',
    scopeId: `${hostId}:${quoteId}`,
    orgId: String(owner?.id ?? ''),
    key: idempotencyKey,
    busyMessage: 'Your payment is already being set up',
  })
  if ('replay' in claimed) {
    return { status: claimed.replay.status, body: claimed.replay.body as Record<string, unknown> }
  }
  const claim = claimed.claim
  const stripeKey = (object: string): Record<string, string> => {
    const derived = deriveStripeObjectKey(claim.stripeKey, object)
    return derived ? { 'Idempotency-Key': derived } : {}
  }
  let minted = ''
  try {
    // The session the last press opened is closed before another opens. One
    // that was paid a moment ago means the quote is paid; one that cannot be
    // closed means a second session would be a second way to pay.
    if (openedFor) {
      const previous = await deps.expireSession(openedFor)
      if (previous === 'complete') {
        await claim.release()
        return refusal(409, 'paid', 'This quote has just been paid. Your receipt is on its way.', { confirming: true })
      }
      if (previous === 'open') {
        await claim.release()
        return { status: 502, body: { error: 'Your payment could not be set up. Try again.' } }
      }
    }

    let taxRateId = ''
    if (charge.taxPct !== null && charge.taxableCents > 0) {
      const basis = order.quote?.tax
      taxRateId =
        (await deps.taxRateId({
          hostRef,
          taxPct: charge.taxPct,
          taxLabel:
            basis?.kind === 'rate'
              ? basis.label || `Tax (${charge.taxPct}%)`
              : 'Sales tax',
          headers: stripeKey(`tax-rate-${Math.round(charge.taxPct * 10_000)}`),
        })) ?? ''
      if (!taxRateId) {
        // Never an untaxed session for a taxed quote.
        await claim.release()
        return { status: 502, body: { error: 'Your payment could not be set up. Try again.' } }
      }
    }

    const paymentMethods = CommerceModel.resolveStorefrontPaymentMethodControls(
      CommerceModel.normalizeStorefrontPaymentMethodSettings(store.get('paymentMethods')),
    )
    const params = buildQuoteSessionParams({
      hostId,
      quoteId,
      order,
      charge,
      accountId: String(accountId),
      feeCents,
      taxRateId,
      returnUrl,
      paymentMethods,
    })
    if (nativeMode.native) {
      applyNativeCheckoutParams(params, params.get('success_url') ?? returnUrl)
    }
    const domain = nativeMode.native
      ? deps.ensureDomain({ pageUrl: returnUrl, site, hostId })
      : Promise.resolve(null)
    const created = await deps.createSession(params, {
      ...stripeKey('session'),
      ...nativeCheckoutStripeHeaders(nativeMode),
    })
    await domain
    const payload = created.ok
      ? readCheckoutSessionPayload(created.session, nativeMode, paymentMethods.wallets)
      : null
    if (!payload || !created.session.id) {
      console.error('Stripe quote checkout error', created.session?.error)
      await claim.release()
      return { status: 502, body: { error: 'Your payment could not be set up. Try again.' } }
    }
    minted = String(created.session.id)

    // The quote keeps the session it now has open. Whatever another press
    // stored meanwhile is closed after, so the last press is the one open
    // session; a quote that was paid, replaced or edited meanwhile closes
    // this one instead.
    const orderRef = hostRef.collection('orders').doc(quoteId)
    const settled = await deps.firestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(orderRef)
      const current = snapshot.exists ? (snapshot.data() as CommerceModel.HostOrder) : null
      if (!current || !CommerceModel.isQuote(current)) return { outcome: NOT_FOUND, displaced: '' }
      if (!CommerceModel.isUnpaidQuote(current)) {
        return {
          outcome: refusal(409, 'paid', CommerceModel.quotePayRefusalMessage('paid', storeName)),
          displaced: '',
        }
      }
      if (CommerceModel.quoteLinkVersion(current.quote) !== CommerceModel.quoteLinkVersion(order.quote)) {
        return {
          outcome: {
            status: 410,
            body: { replaced: true, error: `This quote was updated, and ${storeName || 'the business'} sent you a newer link.` },
          },
          displaced: '',
        }
      }
      if ((Number(current.quote?.updatedAtMs) || 0) !== openedAtEdit) {
        return { outcome: refusal(409, 'updated', QUOTE_UPDATED_MESSAGE), displaced: '' }
      }
      transaction.set(orderRef, { checkoutSessionId: minted }, { merge: true })
      const displaced = current.checkoutSessionId && current.checkoutSessionId !== openedFor ? current.checkoutSessionId : ''
      return { outcome: null, displaced }
    })
    if (settled.outcome) {
      await deps.expireSession(minted)
      await claim.release()
      return settled.outcome
    }
    if (settled.displaced && settled.displaced !== minted) await deps.expireSession(settled.displaced)
    await claim.record(200, payload)
    return { status: 200, body: payload as unknown as Record<string, unknown> }
  } catch (error) {
    console.error('quote pay failed', error)
    if (minted) await deps.expireSession(minted).catch(() => 'open')
    await claim.release()
    return { status: 500, body: { error: 'Your payment could not be set up. Try again.' } }
  }
}

/** Sends a link route's answer, never cached or indexed. */
export function sendQuoteLinkOutcome(res: Parameters<PluginApiHandler>[1], outcome: QuoteLinkOutcome) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  for (const [name, value] of Object.entries(outcome.headers ?? {})) res.setHeader(name, value)
  return res.status(outcome.status).json(outcome.body)
}

/** `GET /api/commerce/quote-view`. */
export const quoteViewHandler: PluginApiHandler = async (req, res) => {
  try {
    return sendQuoteLinkOutcome(res, await handleQuoteView(defaultQuotePayDeps(), req))
  } catch (error) {
    console.error('quote view failed', error)
    return sendQuoteLinkOutcome(res, { status: 500, body: { error: 'This quote could not be loaded. Try again.' } })
  }
}

/** `POST /api/commerce/quote-pay`. */
export const quotePayHandler: PluginApiHandler = async (req, res) =>
  sendQuoteLinkOutcome(res, await handleQuotePay(defaultQuotePayDeps(), req))
