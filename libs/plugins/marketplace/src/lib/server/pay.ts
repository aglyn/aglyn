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
  firebaseAdmin,
  logOrgActivity,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invoiceCardAuthenticationParams } from '@aglyn/tenant-data-admin/server/stripe-card-authentication'
import {
  readBillingDetails,
  type BillingDetails,
} from '@aglyn/tenant-data-admin/server/stripe-payment-method'
import {
  claimAttempt,
  deriveStripeObjectKey,
  type AttemptClaim,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import {
  invoicePaymentIntentId,
  isMarketplaceInvoice,
  marketplaceSaleMetadataParams,
} from '../model/marketplace-invoice'
import { recordMarketplaceInvoicePurchase } from './billing-webhook'
import { MARKETPLACE_TAX_CODE, resolveSale, type MarketplaceSale } from './sale'

/**
 * IN-APP PAYMENT FOR A MARKETPLACE LISTING (AGL-4049).
 *
 * The marketplace pays the way billing does: the workspace's card on file, in
 * the console, with the bank's own step when the bank asks for one. Nothing
 * redirects to a payment page.
 *
 * ## The shape of the charge, and what was measured
 *
 * An Invoice on the workspace's billing customer, driven in test mode before
 * this was built (see the PR):
 *
 *  - `automatic_tax` and a FIXED `transfer_data[amount]` work together. On a
 *    $10.00 sale to a Texas address the charge was $10.66, the 80% base and
 *    8.25% rate the filing describes (`MARKETPLACE_TAX_CODE`), and the seller's
 *    transfer was exactly $8.00, leaving the tax and the fee on the platform.
 *    That is the same split the hosted checkout makes (AGL-1544).
 *  - The invoice's metadata does NOT reach its PaymentIntent or its charge.
 *    The refund door reads `charge.metadata.type` during the window before
 *    the purchase exists (AGL-2148), so the intent is stamped after finalize
 *    and before paying, and the charge then carries it.
 *  - A customer with no address cannot finalize an `automatic_tax` invoice
 *    (`customer_tax_location_invalid`), so an address is a prerequisite, shown
 *    before the click rather than met as an error after it.
 *
 * ## Three actions, one door
 *
 *  - `quote`: every gate, then the total from a Stripe Tax calculation and the
 *    card that would be charged. Nothing is created. The window that asks the
 *    buyer to pay shows this, because a saved card charged without its total
 *    in front of the buyer is not a purchase they agreed to.
 *  - `pay` (the default): the Invoice, finalized and paid. Priced by the same
 *    engine, and refused if the total moved from the one the buyer saw.
 *  - `settle`: after the bank's step, whether that attempt paid.
 *
 * ## The purchase is written here as well as by the webhook
 *
 * Stripe's answer to `pay` is authoritative, and the picker's very next
 * request creates a site from what was just bought. Waiting for `invoice.paid`
 * would race it. The webhook remains the record of every other way an invoice
 * gets paid, and both write the same document by the invoice id, so whichever
 * lands second changes nothing.
 *
 * ## Nothing is left owing
 *
 * A declined attempt voids its invoice: the buyer has been told "no", and an
 * open invoice in Billing would tell them they owe it. An attempt abandoned at
 * the bank's step is voided by `settle`, or by the next attempt at the same
 * listing if the tab was closed.
 *
 * lockdown: `marketplace/pay` carries `checkout` and `marketplace-installs`,
 * like the hosted checkout (AGL-1545), and the dispatcher answers both.
 */

interface StripeAnswer {
  ok: boolean
  status: number
  payload: any
}

type StripeCaller = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: URLSearchParams,
  idempotencyKey?: string | null,
) => Promise<StripeAnswer>

function stripeCaller(secretKey: string): StripeCaller {
  return async (method, path, body, idempotencyKey) => {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body ? { body: body.toString() } : {}),
    })
    const payload = await response.json().catch(() => null)
    return { ok: response.ok, status: response.status, payload }
  }
}

/** Why a workspace cannot be charged yet, and whether this person can fix it here. */
function prerequisiteRefusal(
  code: 'card_required' | 'billing_address_required',
  canManageBilling: boolean,
): { status: number; body: Record<string, unknown> } {
  return {
    status: 412,
    body: {
      error:
        code === 'card_required'
          ? 'Add a card in Billing first'
          : 'Add a billing address in Billing first: sales tax is calculated from it.',
      code,
      canManageBilling,
    },
  }
}

/** What this person may do with the workspace's billing, as billing itself asks it. */
async function billingAccess(
  decoded: { uid: string; [claim: string]: unknown },
  orgId: string,
): Promise<{ canManage: boolean; canView: boolean }> {
  if (decoded['staff'] === true) return { canManage: true, canView: true }
  const actor = await resolveOrgMembership(decoded.uid, orgId)
  const [canManage, canView] = await Promise.all([
    memberHasOrgPermission(orgId, actor?.member, 'billing.manage'),
    memberHasOrgPermission(orgId, actor?.member, 'billing.view'),
  ])
  return { canManage, canView }
}

/** The Stripe Tax calculation a quote reads, or `null` when Stripe refused it. */
async function priceSale(
  stripe: StripeCaller,
  customerId: string,
  listingId: string,
  sale: MarketplaceSale,
): Promise<{ taxCents: number; totalCents: number } | null | 'no-tax-location'> {
  const calculation = await stripe(
    'POST',
    'tax/calculations',
    new URLSearchParams({
      currency: 'usd',
      customer: customerId,
      'line_items[0][amount]': String(sale.amountCents),
      'line_items[0][reference]': listingId.slice(0, 200),
      'line_items[0][tax_behavior]': 'exclusive',
      'line_items[0][tax_code]': MARKETPLACE_TAX_CODE,
    }),
  )
  if (!calculation.ok) {
    // Measured: an address Stripe cannot place (a country and nothing else)
    // answers a 400 on the `customer` param with no code. The invoice's own
    // refusal, `customer_tax_location_invalid`, is the same fact.
    const refused = calculation.payload?.error
    if (refused?.code === 'customer_tax_location_invalid' || refused?.param === 'customer') {
      return 'no-tax-location'
    }
    console.error('Stripe tax calculation failed', refused?.code ?? null)
    return null
  }
  return {
    taxCents: Math.round(Number(calculation.payload?.tax_amount_exclusive ?? 0)),
    totalCents: Math.round(Number(calculation.payload?.amount_total ?? sale.amountCents)),
  }
}

/** Takes an attempt back: a draft is deleted, a finalized invoice is voided. */
async function withdrawInvoice(
  stripe: StripeCaller,
  invoiceId: string,
  state: 'draft' | 'open',
): Promise<void> {
  const answer =
    state === 'draft'
      ? await stripe('DELETE', `invoices/${encodeURIComponent(invoiceId)}`)
      : await stripe('POST', `invoices/${encodeURIComponent(invoiceId)}/void`)
  if (!answer.ok) {
    console.error('Marketplace invoice not withdrawn', invoiceId, answer.payload?.error?.code ?? null)
  }
}

/**
 * Voids an earlier attempt at this listing that was left open at the bank's
 * step, by a closed tab for instance. Left there it is a second way to pay for
 * the same licence, sitting in Billing as money owed.
 */
async function voidAbandonedAttempts(
  stripe: StripeCaller,
  customerId: string,
  listingId: string,
  orgId: string,
): Promise<void> {
  const open = await stripe(
    'GET',
    `invoices?customer=${encodeURIComponent(customerId)}&status=open&limit=20`,
  )
  const invoices: any[] = Array.isArray(open.payload?.data) ? open.payload.data : []
  for (const invoice of invoices) {
    if (
      isMarketplaceInvoice(invoice) &&
      invoice?.metadata?.listingId === listingId &&
      invoice?.metadata?.buyerOrgId === orgId
    ) {
      await withdrawInvoice(stripe, String(invoice.id), 'open')
    }
  }
}

/** Records a paid invoice and answers the buyer. The money has moved: nothing here may undo that. */
async function completePurchase(
  invoice: any,
  actor: { uid: string; email?: string },
  orgId: string,
  listingName: string,
): Promise<{ paid: true; invoiceId: string }> {
  const invoiceId = String(invoice?.id ?? '')
  try {
    await recordMarketplaceInvoicePurchase(invoice)
  } catch (error) {
    // The webhook writes the same document: this is a race lost, not a sale.
    console.error('Marketplace purchase left for the webhook to record', invoiceId, error)
  }
  await logOrgActivity(
    orgId,
    { uid: actor.uid, email: actor.email },
    `Bought "${listingName}" from the marketplace`,
    { type: 'org', id: orgId },
  ).catch((error: unknown) => console.error('Marketplace purchase not logged', error))
  return { paid: true, invoiceId }
}

const listingNameOf = (sale: MarketplaceSale) =>
  String(sale.listing['displayName'] ?? 'Marketplace component').slice(0, 120)

export const payHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const secretKey = process.env['STRIPE_SECRET_KEY']
  if (!secretKey) {
    return res
      .status(501)
      .json({ error: 'Purchases are not configured (STRIPE_SECRET_KEY).' })
  }
  const listingId = String(req.body?.listingId ?? '').trim()
  const orgId = String(req.body?.orgId ?? '').trim()
  const action = String(req.body?.action ?? 'pay')
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  if (!orgId) return res.status(400).json({ error: 'Missing orgId' })
  if (action !== 'quote' && action !== 'pay' && action !== 'settle') {
    return res.status(400).json({ error: 'Unknown action' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const stripe = stripeCaller(secretKey)
  let claim: AttemptClaim | null = null
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    // The org this licence is for is asked of the person's own membership,
    // as the hosted checkout does (AGL-2331). It is the org whose card pays,
    // so naming one you are not in is refused before anything is read.
    const membership = await resolveOrgPermissions(decoded.uid, { orgId, hostId: null })
    if (membership.orgId !== orgId) {
      return res.status(403).json({ error: 'Not a member of that organization' })
    }
    const firestore = firebaseAdmin.app().firestore()
    const buyerOrg = await firestore.collection('orgs').doc(orgId).get()
    // The dispatcher reads a lock off a site, and this door names none.
    if (buyerOrg.get('suspendedAt') != null) {
      return res.status(403).json({ error: 'This organization is locked, so it cannot buy anything.' })
    }
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId as string | undefined

    if (action === 'settle') {
      return await settle({ req, res, stripe, decoded, orgId, listingId, customerId })
    }

    const resolved = await resolveSale({
      firestore,
      listingId,
      buyer: { uid: decoded.uid, orgId, permissions: membership.permissions },
    })
    if ('refusal' in resolved) {
      return res.status(resolved.refusal.status).json(resolved.refusal.body)
    }
    const { sale } = resolved

    const billing: BillingDetails | null = customerId
      ? await readBillingDetails(secretKey, customerId)
      : { paymentMethodId: null, method: null, hasAddress: false }
    if (!billing) {
      return res.status(502).json({ error: 'We could not read your billing details just now.' })
    }
    const needed = !billing.paymentMethodId
      ? 'card_required'
      : !billing.hasAddress
        ? 'billing_address_required'
        : null
    if (needed || !customerId || !billing.paymentMethodId) {
      const access = await billingAccess(decoded, orgId)
      const refusal = prerequisiteRefusal(needed ?? 'card_required', access.canManage)
      return res.status(refusal.status).json(refusal.body)
    }

    if (action === 'quote') {
      const priced = await priceSale(stripe, customerId, listingId, sale)
      if (priced === 'no-tax-location') {
        const access = await billingAccess(decoded, orgId)
        const refusal = prerequisiteRefusal('billing_address_required', access.canManage)
        return res.status(refusal.status).json(refusal.body)
      }
      if (!priced) {
        return res.status(502).json({ error: 'We could not price that just now.' })
      }
      const access = await billingAccess(decoded, orgId)
      return res.status(200).json({
        quote: {
          listingName: listingNameOf(sale),
          amountCents: sale.amountCents,
          ...priced,
          currency: 'usd',
          // The card itself is billing's to show: someone who may buy but may
          // not see billing is told "the card on file" and nothing about it.
          card: access.canView ? billing.method : null,
        },
      })
    }

    // Point of no return (AGL-1697): every refusal above answered without
    // burning the key. Required here: this door is new, so no older bundle
    // needs the no-key path, and a money call with no key is the hole
    // `claimAttempt` warns about.
    const idempotencyKey = String(
      req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
    )
      .trim()
      .slice(0, 200)
    if (!idempotencyKey) {
      return res.status(400).json({ error: 'Missing Idempotency-Key' })
    }
    const claimed = await claimAttempt(firestore, {
      kind: 'marketplace-pay',
      scopeId: `${listingId}:${orgId}:${decoded.uid}`,
      orgId,
      key: idempotencyKey,
      busyMessage: 'This purchase is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim
    const objectKey = (object: string) =>
      deriveStripeObjectKey((claim as AttemptClaim).stripeKey, object)

    await voidAbandonedAttempts(stripe, customerId, listingId, orgId)

    const saleMetadata = marketplaceSaleMetadataParams({
      listingId,
      buyerUid: decoded.uid,
      buyerOrgId: orgId,
      sellerOrgId: sale.sellerOrgId,
      feeCents: sale.feeCents,
      transferCents: sale.transferCents,
      gaClientId: String(req.body?.gaClientId ?? ''),
    })
    const created = await stripe(
      'POST',
      'invoices',
      new URLSearchParams({
        customer: customerId,
        collection_method: 'charge_automatically',
        // Charged here, now, once: no retry schedule and no dunning. Nobody
        // is owed a marketplace sale that did not go through.
        auto_advance: 'false',
        // ONLY this sale. The account's default API version sweeps a
        // customer's pending invoice items onto any new invoice, which would
        // put the workspace's metered usage on a charge with a seller's
        // transfer on it.
        pending_invoice_items_behavior: 'exclude',
        default_payment_method: billing.paymentMethodId,
        // Tax and funds flow exactly as the hosted checkout's (AGL-1544): the
        // platform's charge, tax on top, and a FIXED transfer of the seller's
        // pre-tax share, because the tax must stay with the platform that
        // owes it. No transfer at all when the platform's own org is selling.
        'automatic_tax[enabled]': 'true',
        ...(sale.platformSale
          ? {}
          : {
              'transfer_data[destination]': String(sale.accountId),
              'transfer_data[amount]': String(sale.transferCents),
            }),
        // 3-D Secure, from the one seam every card payment shares (AGL-3360).
        ...invoiceCardAuthenticationParams('one-time'),
        ...saleMetadata,
      }),
      objectKey('invoice'),
    )
    const invoiceId = String(created.payload?.id ?? '')
    if (!created.ok || !invoiceId) {
      console.error('Marketplace invoice not created', created.payload?.error?.code ?? null)
      await claim.release()
      return res.status(502).json({ error: 'The payment could not start. Nothing has been charged.' })
    }
    const item = await stripe(
      'POST',
      'invoiceitems',
      new URLSearchParams({
        customer: customerId,
        invoice: invoiceId,
        amount: String(sale.amountCents),
        currency: 'usd',
        tax_behavior: 'exclusive',
        tax_code: MARKETPLACE_TAX_CODE,
        description: listingNameOf(sale),
      }),
      objectKey('item'),
    )
    if (!item.ok) {
      console.error('Marketplace invoice item not created', item.payload?.error?.code ?? null)
      await withdrawInvoice(stripe, invoiceId, 'draft')
      await claim.release()
      return res.status(502).json({ error: 'The payment could not start. Nothing has been charged.' })
    }
    const finalized = await stripe(
      'POST',
      `invoices/${encodeURIComponent(invoiceId)}/finalize`,
      new URLSearchParams({ auto_advance: 'false' }),
      objectKey('finalize'),
    )
    if (!finalized.ok) {
      await withdrawInvoice(stripe, invoiceId, 'draft')
      await claim.release()
      if (finalized.payload?.error?.code === 'customer_tax_location_invalid') {
        const access = await billingAccess(decoded, orgId)
        const refusal = prerequisiteRefusal('billing_address_required', access.canManage)
        return res.status(refusal.status).json(refusal.body)
      }
      console.error('Marketplace invoice not finalized', finalized.payload?.error?.code ?? null)
      return res.status(502).json({ error: 'The payment could not start. Nothing has been charged.' })
    }
    // The total the buyer agreed to. A listing repriced or an address changed
    // since the quote is a different purchase, and they see it first.
    const expected = Number(req.body?.expectedTotalCents)
    if (
      Number.isFinite(expected) &&
      Math.round(Number(finalized.payload?.amount_due ?? 0)) !== Math.round(expected)
    ) {
      await withdrawInvoice(stripe, invoiceId, 'open')
      await claim.release()
      return res.status(409).json({
        error: 'The total changed. Check the new total and pay again.',
        code: 'total_changed',
      })
    }
    const intentId = invoicePaymentIntentId(finalized.payload)
    if (!intentId) {
      console.error('Marketplace invoice has no payment intent', invoiceId)
      await withdrawInvoice(stripe, invoiceId, 'open')
      await claim.release()
      return res.status(502).json({ error: 'The payment could not start. Nothing has been charged.' })
    }
    // WHAT THE REFUND DOOR READS (AGL-2148). Stripe does not copy an invoice's
    // metadata to its PaymentIntent, and the charge inherits the intent's, so
    // without this the charge says nothing about whose sale it is. Before the
    // payment, because a charge never picks up a later change.
    const stamped = await stripe(
      'POST',
      `payment_intents/${encodeURIComponent(intentId)}`,
      new URLSearchParams(saleMetadata),
      objectKey('intent'),
    )
    if (!stamped.ok) {
      console.error('Marketplace payment not stamped', stamped.payload?.error?.code ?? null)
      await withdrawInvoice(stripe, invoiceId, 'open')
      await claim.release()
      return res.status(502).json({ error: 'The payment could not start. Nothing has been charged.' })
    }

    const paid = await stripe(
      'POST',
      `invoices/${encodeURIComponent(invoiceId)}/pay`,
      undefined,
      objectKey('pay'),
    )
    const actor = { uid: decoded.uid, email: decoded.email }
    if (paid.ok && paid.payload?.status === 'paid') {
      const payload = await completePurchase(paid.payload, actor, orgId, listingNameOf(sale))
      await claim.record(200, payload)
      return res.status(200).json(payload)
    }
    if (paid.ok) {
      // Accepted and not yet settled: a bank debit, for one. `invoice.paid`
      // records it when it clears.
      const payload = { submitted: true, invoiceId }
      await claim.record(200, payload)
      return res.status(200).json(payload)
    }
    // The bank wants the buyer. As `pay-invoice` found against a real test
    // invoice, the secret is not in this error: it is on the invoice's intent,
    // so it takes one read, made only for this code.
    let intent = paid.payload?.error?.payment_intent ?? null
    if (
      !intent?.client_secret &&
      paid.payload?.error?.code === 'invoice_payment_intent_requires_action'
    ) {
      const expanded = await stripe(
        'GET',
        `invoices/${encodeURIComponent(invoiceId)}?expand[]=payment_intent`,
      )
      if (expanded.ok) intent = expanded.payload?.payment_intent ?? null
    }
    if (intent?.client_secret && intent?.status === 'requires_action') {
      const payload = {
        requiresAction: true,
        paymentClientSecret: intent.client_secret,
        invoiceId,
      }
      await claim.record(200, payload)
      return res.status(200).json(payload)
    }
    // Anything but a decline leaves the charge unknown, so it is read rather
    // than assumed: a void of a paid invoice is refused, and a buyer who was
    // charged must not be told they were not.
    if (paid.status !== 402) {
      const state = await stripe('GET', `invoices/${encodeURIComponent(invoiceId)}`)
      if (state.payload?.status === 'paid') {
        const payload = await completePurchase(state.payload, actor, orgId, listingNameOf(sale))
        await claim.record(200, payload)
        return res.status(200).json(payload)
      }
    }
    await withdrawInvoice(stripe, invoiceId, 'open')
    console.error('Marketplace payment declined', orgId, paid.payload?.error?.code ?? null)
    const declined = {
      // Stripe's own reason: the buyer needs to know whether to try another card.
      error:
        paid.payload?.error?.message ??
        'That payment did not go through. Nothing has been charged.',
      declined: true,
    }
    // Finished, and recorded as finished: a repeat of this attempt hears the
    // same answer, and pressing Pay again is a new attempt with a new key.
    await claim.record(402, declined)
    return res.status(402).json(declined)
  } catch (error) {
    console.error(error)
    await claim?.release()
    return res.status(500).json({ error: 'The payment failed. Check Billing before trying again.' })
  }
}

/**
 * After the bank's step: whether that attempt paid.
 *
 * Only the person who started it, for the listing it was for, on this
 * workspace's customer: the invoice id comes from the browser, and an id from
 * elsewhere must not read as anything but unknown.
 */
async function settle(input: {
  req: Parameters<PluginApiHandler>[0]
  res: Parameters<PluginApiHandler>[1]
  stripe: StripeCaller
  decoded: { uid: string; email?: string }
  orgId: string
  listingId: string
  customerId: string | undefined
}) {
  const { req, res, stripe, decoded, orgId, listingId, customerId } = input
  const invoiceId = String(req.body?.invoiceId ?? '').trim()
  if (!invoiceId) return res.status(400).json({ error: 'Missing invoice' })
  const read = await stripe(
    'GET',
    `invoices/${encodeURIComponent(invoiceId)}?expand[]=payment_intent`,
  )
  const invoice = read.payload
  const invoiceCustomer =
    typeof invoice?.customer === 'string' ? invoice.customer : (invoice?.customer?.id ?? null)
  if (
    !read.ok ||
    !customerId ||
    invoiceCustomer !== customerId ||
    !isMarketplaceInvoice(invoice) ||
    invoice?.metadata?.listingId !== listingId ||
    invoice?.metadata?.buyerUid !== decoded.uid
  ) {
    return res.status(404).json({ error: 'That payment is not on this workspace.' })
  }
  if (invoice.status === 'paid') {
    const name = String(invoice?.lines?.data?.[0]?.description ?? listingId)
    return res.status(200).json(await completePurchase(invoice, decoded, orgId, name))
  }
  // Authenticated and still landing: never voided under the charge.
  const intentStatus = String(invoice?.payment_intent?.status ?? '')
  if (intentStatus === 'succeeded' || intentStatus === 'processing') {
    return res.status(200).json({ submitted: true, invoiceId })
  }
  if (invoice.status === 'open') await withdrawInvoice(stripe, invoiceId, 'open')
  return res.status(402).json({
    error: 'That payment was not completed. Nothing has been charged.',
    declined: true,
  })
}
