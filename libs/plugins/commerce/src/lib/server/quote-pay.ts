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
  ACCOUNTS_PLUGIN_ID,
  checkEntitlement,
  claimAttempt,
  deriveStripeObjectKey,
  resolveHostEnabledPlugins,
  resolveTransactionFeeCents,
  type PluginApiHandler,
  type PluginApiRequest,
} from '@aglyn/aglyn/server'
import { resolveHostToken, type HostTokenSource } from '@aglyn/aglyn/app-utils/host-tokens'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { type SiteReturnHost, siteReturnOrigin } from '@aglyn/aglyn/app-utils/site-return-url'
import { consumeRateLimit, firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import {
  connectedAccountHeader,
  directChargeParams,
  merchantAccountIsReady,
  saleChargeModel,
  type SaleChargeModel,
} from '@aglyn/tenant-data-admin/server/payment-provider'
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
import { MEMBER_SESSIONS_VALID_FROM_FIELD, memberCookieName, parseMemberSession } from './membership'
import { ensureCheckoutDomain } from './payment-method-domains'
import { verifyQuoteLinkToken } from './quote-link-token'
import { SELLER_STRIPE_TAX_NOT_SET_UP_MESSAGE, sellerStripeTaxActive } from './seller-stripe-account'

/*==========================================
 * THE CUSTOMER'S QUOTE PAGE AND ITS PAY BUTTON (AGL-4094), AND AN
 * INVOICE'S (AGL-4099).
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
 *
 * THE PAGE OFFERS ONLY A PAY THAT WORKS (AGL-4162). The view asks the same
 * payments check Pay refuses on ({@link payLinkPayments}) and prices the tax
 * the same way (`quotePayTax`): a quote saved before the store chose its
 * sales tax is shown and charged under the store's choice now, and Pay
 * refuses when that choice is not the one the page showed (`tax`). The
 * session carries that basis (`quoteTax`) so the paid order records it.
 *
 * AN INVOICE'S LINK IS THIS ONE (AGL-4099). A draft order the business sent
 * an invoice for opens on the same page from the same kind of link (its
 * version on `payLink.version`, `commerce-invoices.ts`), as "Invoice #N" with
 * no proofs or approval, and Pay opens the same kind of fresh session from
 * its stored lines, discount, tax and the shipping rates it was made with.
 * Its webhook is the draft branch it always completed through, which flips
 * the draft to paid without restamping its list fields. The proof and answer
 * routes stay a quote's alone: `loadLinkedQuote` opens an invoice only for
 * the routes that ask (`{ invoices: true }`).
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
  /**
   * Closes a session so it can no longer be paid. `stripeAccount` names the
   * seller's account for a session opened there (a direct charge); absent, the
   * session is the platform's.
   */
  expireSession(sessionId: string, stripeAccount?: string): Promise<CheckoutSessionExpiry>
  /**
   * Whether the seller's own Stripe Tax is set up, for a direct charge that
   * asks Stripe Tax. Absent, `sellerStripeTaxActive` answers.
   */
  sellerTaxActive?(accountId: string): Promise<boolean>
  /** Registers the page's domain for Apple Pay; never throws. */
  ensureDomain(input: Parameters<typeof ensureCheckoutDomain>[0]): Promise<unknown>
  /**
   * The site account a quote's customer signs in to (AGL-4206): the member
   * under that address, on a site that serves accounts; null for a guest.
   * Absent, every customer reads as a guest.
   */
  customerAccount?(input: { hostId: string; host: Record<string, unknown>; email: string }): Promise<QuoteCustomerAccount | null>
  now(): number
}

/** A quote customer's account on the site, as the sign-in check needs it. */
export interface QuoteCustomerAccount {
  id: string
  /** Sessions minted before this were revoked in bulk (AGL-914). */
  validFromMs: number
  suspended: boolean
}

/**
 * The member under `email` on a site that serves accounts, or null. A site
 * with User Accounts switched off has no sign-in page to send anyone to, so
 * every customer of it is a guest.
 */
export async function readQuoteCustomerAccount(input: {
  hostId: string
  host: Record<string, unknown>
  email: string
}): Promise<QuoteCustomerAccount | null> {
  const owner = await getOrgForHost(input.hostId)
  if (!owner || !resolveHostEnabledPlugins(owner.org as never, input.host as never).includes(ACCOUNTS_PLUGIN_ID)) return null
  const found = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(input.hostId)
    .collection('siteMembers')
    .where('email', '==', input.email)
    .limit(1)
    .get()
  const member = found.docs[0]
  if (!member) return null
  return {
    id: member.id,
    validFromMs: Number(member.get(MEMBER_SESSIONS_VALID_FROM_FIELD) ?? 0) || 0,
    suspended: member.get('suspended') === true,
  }
}

/**
 * Whether this request may see the quote's proof and answer it (AGL-4206):
 * `open` unless the quote asks a customer with a site account to sign in and
 * this browser is not signed in to that account. Reads nothing for a quote
 * that does not ask, or a customer with no address.
 */
export async function quoteProofAccessFor(
  deps: QuotePayDeps,
  req: PluginApiRequest,
  input: { hostId: string; host: Record<string, unknown>; order: CommerceModel.HostOrder },
): Promise<CommerceModel.QuoteProofAccess> {
  const quote = input.order.quote
  if (quote?.requireProofSignIn !== true) return 'open'
  const email = CommerceModel.quoteCustomerAccountEmail(quote)
  if (!email) return 'open'
  const account = deps.customerAccount ? await deps.customerAccount({ hostId: input.hostId, host: input.host, email }) : null
  const cookies = (req.cookies ?? {}) as Record<string, string | undefined>
  const session = parseMemberSession(input.hostId, cookies[memberCookieName(input.hostId)])
  // A session for the customer's account counts only while the account stands and the session was not revoked.
  const signedIn =
    session && account && session.memberId === account.id && (account.suspended || session.issuedAtMs < account.validFromMs)
      ? null
      : (session?.memberId ?? null)
  return CommerceModel.quoteProofAccess({ quote, accountId: account?.id ?? null, signedInAccountId: signedIn })
}

/** A proof route's answer while the proof waits on a sign-in. */
export function quoteProofAccessRefusal(access: Exclude<CommerceModel.QuoteProofAccess, 'open'>, storeName: string): QuoteLinkOutcome {
  return {
    status: 403,
    body: { error: CommerceModel.quoteProofAccessMessage(access, storeName), reason: access },
  }
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
    expireSession: (sessionId, stripeAccount) =>
      stripeAccount ? expireConnectedCheckoutSession(sessionId, stripeAccount) : expireCheckoutSession(sessionId),
    ensureDomain: (input) => ensureCheckoutDomain(input).catch(() => null),
    customerAccount: (input) => readQuoteCustomerAccount(input),
    now: () => Date.now(),
  }
}

/**
 * `expireCheckoutSession` for a session on the seller's own account (a direct
 * charge), where the platform's call answers 404. Same answers, same rule: a
 * refused expiry reads the session back, so a paid one is never read as closed.
 */
async function expireConnectedCheckoutSession(
  sessionId: string,
  stripeAccount: string,
): Promise<CheckoutSessionExpiry> {
  if (!/^cs_(test|live)_[A-Za-z0-9]{8,255}$/.test(String(sessionId ?? ''))) return 'missing'
  const secretKey = String(process.env.STRIPE_SECRET_KEY ?? '').trim()
  if (!secretKey) return 'open'
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Account': stripeAccount,
  }
  try {
    const expired = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/expire`, {
      method: 'POST',
      headers,
    })
    if (expired.ok) return 'expired'
    const read = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, { headers })
    if (read.status === 404) return 'missing'
    if (!read.ok) return 'open'
    const session = (await read.json().catch(() => ({}))) as { status?: string }
    if (session.status === 'complete') return 'complete'
    if (session.status === 'expired') return 'expired'
    return 'open'
  } catch {
    return 'open'
  }
}

/** A link route's answer: a status, a JSON body and any extra headers. */
export type QuoteLinkOutcome = { status: number; body: Record<string, unknown>; headers?: Record<string, string> }

const DOC_ID = /^(?!__.*__$)[^/]{1,200}$/

const NOT_FOUND: QuoteLinkOutcome = {
  status: 404,
  body: { error: 'We could not find that quote. Check the link you were sent.' },
}

/** The not-found answer of a route an invoice's link reaches too: it names neither. */
const NOT_FOUND_ANY: QuoteLinkOutcome = {
  status: 404,
  body: { error: 'We could not find that quote or invoice. Check the link you were sent.' },
}

/** `quote` or `invoice`, as the customer reads it. */
const nounOf = (kind: CommerceModel.OrderPayLinkKind) => (kind === 'invoice' ? 'invoice' : 'quote')

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
  /** A quote, or an order's invoice (only for a route that opens invoices). */
  kind: CommerceModel.OrderPayLinkKind
}

/**
 * The quote a link names, after its token: the quote, the replaced answer for
 * a link to an older version, or the one not-found answer for everything else.
 * With `invoices`, a draft order's invoice too (AGL-4099). With `history`, a
 * link to an older version opens the quote as well: only for a route that
 * serves the quote's record and acts on nothing (its proofs, which an earlier
 * email draws, AGL-4097); pay, answers and uploads keep the current version.
 */
export async function loadLinkedQuote(
  deps: QuotePayDeps,
  hostId: string,
  quoteId: string,
  token: string,
  options: { invoices?: boolean; history?: boolean } = {},
): Promise<{ loaded: LoadedQuote } | { outcome: QuoteLinkOutcome }> {
  const notFound = options.invoices ? NOT_FOUND_ANY : NOT_FOUND
  const version = verifyQuoteLinkToken(hostId, quoteId, token)
  if (version === null) return { outcome: notFound }
  const hostRef = deps.firestore().collection('hosts').doc(hostId)
  const [hostSnapshot, store, orderSnapshot] = await Promise.all([
    hostRef.get(),
    hostRef.collection('settings').doc('store').get(),
    hostRef.collection('orders').doc(quoteId).get(),
  ])
  if (!hostSnapshot.exists || !orderSnapshot.exists) return { outcome: notFound }
  const order = orderSnapshot.data() as CommerceModel.HostOrder
  const kind = CommerceModel.orderPayLinkKind(order)
  if (kind === null || (kind === 'invoice' && !options.invoices)) return { outcome: notFound }
  const host = (hostSnapshot.data() ?? {}) as Record<string, unknown>
  const storeName = String(resolveHostToken('businessName', host as HostTokenSource) ?? '')
  const current = CommerceModel.orderPayLinkVersion(order)
  if (version > current) return { outcome: notFound }
  if (version < current && !options.history) {
    // What the customer was sent, in their words: a proof with no price says proof (AGL-4184).
    const noun = kind === 'quote' && CommerceModel.quoteIsProofOnly(order) ? 'proof' : nounOf(kind)
    return {
      outcome: {
        status: 410,
        body: {
          state: 'replaced',
          kind,
          noun,
          storeName,
          replaced: true,
          error: `This ${noun} was updated, and ${storeName || 'the business'} sent you a newer link.`,
        },
      },
    }
  }
  return { loaded: { hostRef, host, order, storeName, store, kind } }
}

/** The link's site, quote and token from a query or a body, and whether all three are there. */
export function quoteLinkParams(source: Record<string, unknown>) {
  const hostId = String(source['hostId'] ?? '')
  const quoteId = String(source['q'] ?? '').slice(0, 200)
  const token = String(source['t'] ?? '').slice(0, 200)
  const complete = DOC_ID.test(hostId) && DOC_ID.test(quoteId) && Boolean(token)
  return { hostId, quoteId, token, complete }
}

/** Whether the business behind a pay link can take a card payment now, and with what. */
export interface PayLinkPayments {
  ready: boolean
  /** The site's workspace, for the platform fee and the attempt's record. */
  owner: { id?: string; org?: any } | null
  /** The owner's payment account; empty unless `ready`. */
  accountId: string
  /**
   * Whether a sale is a direct charge on that account or a destination charge
   * from the platform's, as the connect route recorded it on the profile.
   */
  chargeModel: SaleChargeModel
}

/**
 * The one payments check a pay link answers on: the workspace's plan
 * includes commerce, and the workspace OWNER's payment account can take
 * charges (`merchantAccountIsReady`, the check every money route makes). The
 * page asks it before offering Pay and Pay asks it before charging, so the
 * two never disagree.
 */
export async function payLinkPayments(
  deps: QuotePayDeps,
  input: { hostId: string; orderId: string; kind: CommerceModel.OrderPayLinkKind },
): Promise<PayLinkPayments> {
  const owner = await deps.orgForHost(input.hostId)
  if (!checkEntitlement(owner?.org as never, 'commerce')) {
    return { ready: false, owner, accountId: '', chargeModel: 'destination' }
  }
  const ownerUid = owner?.org?.ownerUid
  const profile = ownerUid ? await deps.firestore().collection('profiles').doc(String(ownerUid)).get() : null
  const accountId = profile?.get('stripeAccountId')
  const ready = merchantAccountIsReady(
    {
      accountId,
      chargesEnabled: profile?.get('stripeChargesEnabled'),
      accountLivemode: profile?.get('stripeAccountLivemode'),
    },
    { subject: `${nounOf(input.kind)} ${input.orderId} on host ${input.hostId}` },
  )
  return {
    ready,
    owner,
    accountId: ready ? String(accountId) : '',
    chargeModel: saleChargeModel(profile?.get('stripeChargeModel')),
  }
}

/**
 * The page's view of a linked quote or invoice: the allow-listed projection,
 * priced under the store's tax choice and with Pay only where the business
 * can take it. A paid one asks nothing about payments.
 */
export async function payLinkPageView(
  deps: QuotePayDeps,
  input: {
    hostId: string
    orderId: string
    loaded: Pick<LoadedQuote, 'host' | 'order' | 'storeName' | 'store' | 'kind'>
    /** Whether this browser may see the proof (AGL-4206); absent reads as `open`. */
    proofAccess?: CommerceModel.QuoteProofAccess
  },
): Promise<CommerceModel.QuotePageView> {
  const { hostId, orderId } = input
  const { host, order, storeName, store, kind } = input.loaded
  const currency = String(store.get('currency') ?? 'USD')
  const unpaid = order.status === 'pending'
  const receiptUrl = unpaid ? null : orderStatusUrl(host, hostId, orderId)
  const paymentsReady = unpaid ? (await payLinkPayments(deps, { hostId, orderId, kind })).ready : undefined
  const view = {
    order,
    orderId,
    storeName,
    currency,
    receiptUrl,
    store: CommerceModel.payLinkStoreOf({ tax: store.get('tax') }),
    paymentsReady,
  }
  if (kind !== 'quote') return CommerceModel.buildInvoicePageView(view)
  const proofAccess = input.proofAccess ?? 'open'
  // The quote's conversation rides its page (AGL-4207), an answer's view too; it waits on
  // the same sign-in as the proof, so it is not read for a page that will not show it.
  let messages: CommerceModel.QuotePageMessage[] = []
  if (proofAccess === 'open' || CommerceModel.currentQuoteProofs(order.quote).length === 0) {
    const orderRef = deps.firestore().collection('hosts').doc(hostId).collection('orders').doc(orderId)
    const listed = await orderRef.collection('messages').orderBy('atMs', 'desc').limit(CommerceModel.QUOTE_MESSAGES_SHOWN).get()
    messages = CommerceModel.quotePageMessages(
      listed.docs.map((entry) => ({ id: entry.id, data: entry.data() as Partial<CommerceModel.QuoteMessage> })),
    )
  }
  return CommerceModel.buildQuotePageView({
    ...view,
    messages,
    approvalStatements: CommerceModel.quoteApprovalStatements(store.get('quotes')),
    proofAccess,
  })
}

/** `GET /api/commerce/quote-view`: the quote page's data. */
export async function handleQuoteView(deps: QuotePayDeps, req: PluginApiRequest): Promise<QuoteLinkOutcome> {
  if (req.method !== 'GET') return { status: 405, body: { error: 'Method not allowed' } }
  const { hostId, quoteId, token, complete } = quoteLinkParams((req.query ?? {}) as Record<string, unknown>)
  if (!complete) return { status: 400, body: { error: 'This link is incomplete.' } }
  const refused = await limitedQuoteLink(deps, req, `commerce-quote-view:${hostId}`, QUOTE_VIEW_LOOKUPS_PER_WINDOW)
  if (refused) return refused
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token, { invoices: true })
  if ('outcome' in linked) {
    // The replaced page is a page, not a failure: answered as data.
    if (linked.outcome.status === 410) {
      const { storeName, kind, noun } = linked.outcome.body as {
        storeName: string
        kind: CommerceModel.OrderPayLinkKind
        noun: string
      }
      return { status: 200, body: { state: 'replaced', kind, noun, storeName } }
    }
    return linked.outcome
  }
  const proofAccess =
    linked.loaded.kind === 'quote'
      ? await quoteProofAccessFor(deps, req, { hostId, host: linked.loaded.host, order: linked.loaded.order })
      : 'open'
  const view = await payLinkPageView(deps, { hostId, orderId: quoteId, loaded: linked.loaded, proofAccess })
  return { status: 200, body: view as unknown as Record<string, unknown> }
}

/** The Checkout Session a quote's (or an invoice's) Pay opens, as form params. Pure over its inputs. */
export function buildQuoteSessionParams(input: {
  hostId: string
  quoteId: string
  order: CommerceModel.HostOrder
  charge: CommerceModel.QuoteCheckoutCharge & Partial<Pick<CommerceModel.InvoiceCheckoutCharge, 'shippingOptions' | 'shippingCountries'>>
  accountId: string
  /**
   * `direct` opens the session ON the seller's account (the caller sends the
   * `Stripe-Account` header): Aglyn's take is the application fee, the seller
   * owns any Stripe Tax, and nothing is transferred. Absent is `destination`.
   */
  chargeModel?: SaleChargeModel
  feeCents: number
  taxRateId: string
  returnUrl: string
  paymentMethods: CommerceModel.StorefrontPaymentMethodControls
  /**
   * The tax basis charged when it is not the quote's stored one: a quote
   * saved before the store chose its sales tax, priced under the choice now
   * (`quotePayTax`, AGL-4162). The webhook records it on the paid order.
   */
  chargedTax?: CommerceModel.QuoteTaxBasis | null
}): URLSearchParams {
  const { charge, order } = input
  const invoice = CommerceModel.orderPayLinkKind(order) === 'invoice'
  const quote = (order.quote ?? {}) as CommerceModel.OrderQuote
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
  // An invoiced draft offers the rates it was made with, and the buyer picks
  // one, as on the draft's first link (AGL-4099).
  const rates = charge.shippingOptions ?? []
  if (rates.length > 0) {
    CommerceModel.appendShippingAddressCollectionParams(
      params,
      charge.shippingCountries?.length ? charge.shippingCountries : CommerceModel.CHECKOUT_SHIPPING_COUNTRIES,
    )
    CommerceModel.appendCheckoutShippingParams(params, rates)
  } else if (charge.shippingCents > 0) {
    const country = String(quote.shipTo?.country ?? '').toUpperCase()
    CommerceModel.appendShippingAddressCollectionParams(
      params,
      /^[A-Z]{2}$/.test(country) ? [country] : CommerceModel.CHECKOUT_SHIPPING_COUNTRIES,
    )
    CommerceModel.appendCheckoutShippingParams(params, [
      { rateId: 'quote', name: 'Shipping', amountCents: charge.shippingCents },
    ])
  }
  const shippingFloorCents = rates.length > 0 ? CommerceModel.shippingFloorCents(rates) : charge.shippingCents
  const direct = input.chargeModel === 'direct'
  for (const [key, value] of Object.entries(
    // A direct charge is already the seller's money, Stripe Tax included
    // (computed on THEIR registrations), so the take is the whole split.
    direct
      ? directChargeParams(input.feeCents)
      : CommerceModel.destinationChargeParams({
          accountId: input.accountId,
          feeCents: input.feeCents,
          taxOwner: charge.taxAtPayment ? 'platform' : 'merchant',
          merchantGoodsCents: charge.goodsCents,
          shippingFloorCents,
        }),
  )) {
    params.set(key, value)
  }
  const email = String((invoice ? order.customerEmail : quote.customer?.email) ?? '').trim()
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
  if (invoice) {
    // An invoice's link version, which the draft branch compares as a
    // quote's (AGL-4099), and the promotion the draft was priced with, which
    // it counts once the draft is paid (no hold: the draft's lapsed with its
    // first session).
    params.set('metadata[payLinkVersion]', String(CommerceModel.orderPayLinkVersion(order)))
    if (order.discountId) params.set('metadata[discountId]', String(order.discountId))
  } else {
    params.set('metadata[quoteId]', input.quoteId)
    params.set('metadata[quoteLinkVersion]', String(CommerceModel.quoteLinkVersion(quote)))
    params.set('metadata[quoteUpdatedAtMs]', String(Number(quote.updatedAtMs) || 0))
    if (input.chargedTax) params.set('metadata[quoteTax]', CommerceModel.quoteTaxBasisKey(input.chargedTax))
  }
  params.set('metadata[feeCents]', String(input.feeCents))
  // What the webhook, refunds and reports read to find the payment on the
  // seller's account rather than the platform's.
  if (direct) params.set('metadata[chargeModel]', 'direct')
  // A tax charged as its own line is invisible to Stripe's tax total; this
  // witness is what records it as the business's tax.
  if (charge.taxCents > 0 && charge.taxPct === null) {
    params.set('metadata[taxCents]', String(charge.taxCents))
  }
  // The fixed transfer Aglyn keeps its Stripe Tax back from; a direct charge
  // transfers nothing and its tax is the seller's.
  if (charge.taxAtPayment && !direct) {
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
  // The store's choices, and never buy-now-pay-later (AGL-4198), so the fee
  // above is priced at the card rate.
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
  const linked = await loadLinkedQuote(deps, hostId, quoteId, token, { invoices: true })
  if ('outcome' in linked) return linked.outcome
  const { hostRef, host, order, storeName, store, kind } = linked.loaded
  const noun = nounOf(kind)

  // Every refusal the customer can be given is above the claim, so none of
  // them spends the press. `v` is the edit of the quote the page showed: a
  // quote changed since is shown again before it is paid, never charged unseen.
  // An invoice is not edited, so it sends none. `tax` is the tax the page
  // priced it under: a quote saved before the store chose its sales tax is
  // priced under the choice as it stands, so one the store changed since, or
  // a page that did not say, is shown again too.
  const body = bodyOf(req)
  const seen = Number(body['v'])
  if (kind === 'quote' && Number.isFinite(seen) && seen > 0 && seen !== (Number(order.quote?.updatedAtMs) || 0)) {
    return refusal(409, 'updated', QUOTE_UPDATED_MESSAGE)
  }
  const payStore = CommerceModel.payLinkStoreOf({ tax: store.get('tax') })
  const payTax = CommerceModel.quotePayTax(order.quote, payStore)
  if (kind === 'quote') {
    const shownTax = typeof body['tax'] === 'string' ? body['tax'] : null
    const taxKey = CommerceModel.quoteTaxBasisKey(payTax.basis)
    if (shownTax !== null ? shownTax !== taxKey : payTax.source === 'current') {
      return refusal(409, 'updated', QUOTE_UPDATED_MESSAGE)
    }
  }
  const payments = await payLinkPayments(deps, { hostId, orderId: quoteId, kind })
  const blocked = CommerceModel.payLinkRefusalWithPayments(
    CommerceModel.invoicePayRefusal(order, quoteId, payStore),
    payments.ready,
  )
  if (blocked === 'payments-unavailable') {
    return refusal(409, blocked, CommerceModel.payLinkPaymentsUnavailableMessage(storeName, kind))
  }
  if (blocked) return refusal(409, blocked, CommerceModel.invoicePayRefusalMessage(blocked, storeName, kind))
  const { owner, accountId, chargeModel } = payments
  const direct = chargeModel === 'direct'
  // Every Stripe object for a direct sale lives on the seller's account.
  const onAccount = connectedAccountHeader(chargeModel, accountId)
  const sessionAccount = onAccount['Stripe-Account'] ?? ''

  const charge = CommerceModel.invoiceCheckoutCharge(order, quoteId, payStore)
  // The fee is sized on the most the buyer can pay, as a draft's first link
  // sized it on its dearest rate, and its processing half at the card rate:
  // the session below excludes every buy-now-pay-later method. A direct
  // charge's fee is the take alone: Stripe bills the seller its card fee.
  const dearestRateCents = charge.shippingOptions.reduce((most, rate) => Math.max(most, rate.amountCents), 0)
  const feeCents = resolveTransactionFeeCents(
    owner?.org as never,
    charge.feeProductType,
    charge.goodsCents,
    charge.totalCents + dearestRateCents,
    direct ? { direct: true } : { stripeTax: charge.taxAtPayment },
  )
  // Stripe refuses `automatic_tax` on a seller's account whose Stripe Tax is
  // not set up, and a store that chose it must not sell untaxed. Above the
  // claim, so the refusal spends no press.
  if (direct && charge.taxAtPayment) {
    const taxActive = await (deps.sellerTaxActive ?? sellerStripeTaxActive)(String(accountId))
    if (!taxActive) return refusal(409, 'seller-tax', SELLER_STRIPE_TAX_NOT_SET_UP_MESSAGE)
  }
  const nativeMode = await deps.nativeMode(String(owner?.id ?? ''))
  const site = host as SiteReturnHost
  const origin = siteReturnOrigin({
    candidates: [headerOf(req, 'referer'), `https://${headerOf(req, 'host')}`],
    site,
    requestHost: headerOf(req, 'host'),
  })
  const returnUrl = `${origin}${quotePageHref(quoteId, token)}`
  // A draft's first session (the one its paymentLinkUrl opens) is closed
  // here too, so the draft has one way to pay from the first press on.
  const openedFor = order.checkoutSessionId ?? ''
  const openedAtEdit = Number(order.quote?.updatedAtMs) || 0
  const openedAtVersion = CommerceModel.orderPayLinkVersion(order)
  // Closes a session this quote opened, on the account it was opened on. A
  // seller's earlier session may be the platform's (opened before the seller
  // moved to direct charges), so one the seller's account does not know is
  // closed there too: leaving it open would be a second way to pay.
  const expire = async (sessionId: string): Promise<CheckoutSessionExpiry> => {
    if (!sessionAccount) return deps.expireSession(sessionId)
    const result = await deps.expireSession(sessionId, sessionAccount)
    return result === 'missing' ? deps.expireSession(sessionId) : result
  }

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
      const previous = await expire(openedFor)
      if (previous === 'complete') {
        await claim.release()
        return refusal(409, 'paid', `This ${noun} has just been paid. Your receipt is on its way.`, { confirming: true })
      }
      if (previous === 'open') {
        await claim.release()
        return { status: 502, body: { error: 'Your payment could not be set up. Try again.' } }
      }
    }

    let taxRateId = ''
    if (charge.taxPct !== null && charge.taxableCents > 0) {
      const basis = kind === 'quote' ? payTax.basis : null
      taxRateId =
        (await deps.taxRateId({
          hostRef,
          taxPct: charge.taxPct,
          taxLabel:
            basis?.kind === 'rate'
              ? basis.label || `Tax (${charge.taxPct}%)`
              : 'Sales tax',
          headers: stripeKey(`tax-rate-${Math.round(charge.taxPct * 10_000)}`),
          // A platform rate id does not resolve on the seller's account.
          ...(sessionAccount ? { stripeAccount: sessionAccount } : {}),
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
      ...(direct ? { chargeModel } : {}),
      feeCents,
      taxRateId,
      returnUrl,
      paymentMethods,
      chargedTax: kind === 'quote' && payTax.source === 'current' ? payTax.basis : null,
    })
    if (nativeMode.native) {
      applyNativeCheckoutParams(params, params.get('success_url') ?? returnUrl)
    }
    // Apple Pay's domain is registered on the account the session lives on.
    const domainInput = {
      pageUrl: returnUrl,
      site,
      hostId,
      ...(sessionAccount ? { stripeAccount: sessionAccount } : {}),
    }
    const domain = nativeMode.native ? deps.ensureDomain(domainInput) : Promise.resolve(null)
    const created = await deps.createSession(params, {
      ...stripeKey('session'),
      ...nativeCheckoutStripeHeaders(nativeMode),
      ...onAccount,
    })
    await domain
    const payload = created.ok
      ? // A direct sale's in-page form opens Stripe.js on the seller's account, where the session is.
        readCheckoutSessionPayload(created.session, nativeMode, paymentMethods.wallets, sessionAccount)
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
      if (!current || CommerceModel.orderPayLinkKind(current) !== kind) return { outcome: NOT_FOUND_ANY, displaced: '' }
      if (current.status !== 'pending') {
        const closed = current.status === 'cancelled' || current.status === 'refunded'
        return {
          outcome: refusal(
            409,
            closed ? 'closed' : 'paid',
            CommerceModel.invoicePayRefusalMessage(closed ? 'closed' : 'paid', storeName, kind),
          ),
          displaced: '',
        }
      }
      if (CommerceModel.orderPayLinkVersion(current) !== openedAtVersion) {
        return {
          outcome: {
            status: 410,
            body: { replaced: true, error: `This ${noun} was updated, and ${storeName || 'the business'} sent you a newer link.` },
          },
          displaced: '',
        }
      }
      if (kind === 'quote' && (Number(current.quote?.updatedAtMs) || 0) !== openedAtEdit) {
        return { outcome: refusal(409, 'updated', QUOTE_UPDATED_MESSAGE), displaced: '' }
      }
      transaction.set(orderRef, { checkoutSessionId: minted }, { merge: true })
      const displaced = current.checkoutSessionId && current.checkoutSessionId !== openedFor ? current.checkoutSessionId : ''
      return { outcome: null, displaced }
    })
    if (settled.outcome) {
      await expire(minted)
      await claim.release()
      return settled.outcome
    }
    if (settled.displaced && settled.displaced !== minted) await expire(settled.displaced)
    await claim.record(200, payload)
    return { status: 200, body: payload as unknown as Record<string, unknown> }
  } catch (error) {
    console.error('quote pay failed', error)
    if (minted) await expire(minted).catch(() => 'open')
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
