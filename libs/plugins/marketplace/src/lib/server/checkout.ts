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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { checkoutSessionCardAuthenticationParams } from '@aglyn/tenant-data-admin/server/stripe-card-authentication'
import {
  buildRoute,
  claimAttempt,
  Route,
  type AttemptClaim,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { siteCreateReturnQuery } from '@aglyn/aglyn/app-utils/site-create-return'
import { excludeBuyNowPayLater } from '@aglyn/aglyn/app-utils/buy-now-pay-later'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { readStarterCheckoutReturn } from '../model/starter-query'
import { MARKETPLACE_TAX_CODE, resolveSale } from './sale'

export { MARKETPLACE_TAX_CODE }

/**
 * Checkout for a paid marketplace listing (AGL-46): one-time destination
 * charge to the publisher's Express account. The platform's cut comes from
 * the seller org's ENTITLEMENTS (AGL-1543: 20%, 30% effective-free), sales
 * tax is collected platform-side per the marketplace-provider registration
 * (AGL-1544), and the seller receives a fixed transfer of their pre-tax
 * share. The webhook writes the purchase record on
 * `checkout.session.completed`; install stays gated on that record. 501
 * without Stripe env.
 */
export const checkoutHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res
      .status(501)
      .json({ error: 'Purchases are not configured (STRIPE_SECRET_KEY).' })
  }
  const listingId = String(req.body?.listingId ?? '')
  const hostId = String(req.body?.hostId ?? '')
  // The org this licence is being bought FOR (AGL-2331). Requested, never
  // trusted: it is resolved through the caller's own membership below, exactly
  // as `connect.ts` resolves the org a payout account is being set up for.
  const requestedOrgId = String(req.body?.orgId ?? '')
  // One purchase attempt, minted by the browser (AGL-1697). Node lowercases
  // incoming headers, but read both spellings — the plugin API request type
  // makes no promise about casing.
  const idempotencyKey = String(
    req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'] ?? '',
  )
    .trim()
    .slice(0, 200)
  if (!listingId) return res.status(400).json({ error: 'Missing listingId' })
  // Where the buyer comes back to (AGL-4049): the marketplace, or Create
  // site reopened on the starter they picked there. A name, never an
  // address the browser hands over.
  const returnTo = readStarterCheckoutReturn(req.body?.return)
  if (returnTo !== null && typeof returnTo === 'object') {
    return res.status(400).json({ error: returnTo.error })
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  let claim: AttemptClaim | null = null
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    // WHICH ORGANIZATION IS BUYING (AGL-2331).
    //
    // A marketplace purchase licenses an organization, not a person — see
    // `purchaseEntitlesOrg` in the model for why, and for what the published
    // Publisher Agreement §8.1 already says about it. So a Checkout session
    // that cannot name the org it licenses must not open: the purchase
    // document it produces would carry no `buyerOrgId`, and a half-populated
    // org field is a worse premise for an entitlement than an absent one —
    // the gate would have to guess whether a missing value means "legacy,
    // grandfathered" or "modern, but nobody wrote it".
    //
    // Resolved through `resolveOrgPermissions`, not from the body and not from
    // `hostIndex`. The old derivation was `hostId` → `hostIndex.orgId` with no
    // membership test at all, which is a real hole once the field grants
    // anything: post any host id and the purchase would be stamped with an org
    // the buyer has no standing in, entitling strangers. This is the same
    // resolution the seven install routes and `connect.ts` use, so the org
    // that gets the licence is by construction an org the buyer could install
    // into.
    //
    // `installPlugins` rather than a bare membership: buying is the act of
    // acquiring something to install, and a viewer who cannot install must not
    // be able to spend the workspace's money on one. It is also what keeps
    // this door and the install door agreeing about who the licence is for.
    const membership = await resolveOrgPermissions(decoded.uid, {
      orgId: requestedOrgId || null,
      hostId: requestedOrgId ? null : hostId || null,
    })
    const buyerOrgId = membership.orgId ?? ''
    if (!buyerOrgId) {
      return res.status(400).json({
        error:
          'A purchase is licensed to an organization — open the marketplace ' +
          'from the workspace you are buying for.',
      })
    }
    if (requestedOrgId && buyerOrgId !== requestedOrgId) {
      return res.status(403).json({ error: 'Not a member of that organization' })
    }
    const firestore = firebaseAdmin.app().firestore()
    // Everything a sale decides before Stripe (AGL-4049), shared with the
    // in-app payment so the two doors cannot disagree about what is on sale.
    const resolved = await resolveSale({
      firestore,
      listingId,
      buyer: { uid: decoded.uid, orgId: buyerOrgId, permissions: membership.permissions },
    })
    if ('refusal' in resolved) {
      return res.status(resolved.refusal.status).json(resolved.refusal.body)
    }
    const {
      listing,
      siteStarter,
      sellerOrgId,
      accountId,
      amountCents,
      feeCents,
      transferCents,
      platformSale,
    } = resolved.sale

    const origin = req.headers.origin ?? `https://${req.headers.host}`
    // Stripe returns the BUYER to the org marketplace (AGL-775) — the
    // per-site marketplace page it used to land on was retired. Only the
    // buyer's org slug is needed now (`sellerOrgId` is the wrong org), and
    // it's resolved from the host here since server code cannot call
    // useConsoleHostRoute. `/manage/marketplace` is the hostless fallback.
    //
    // The slug comes off the VALIDATED buyer org resolved at the top of the
    // handler now (AGL-2331) rather than a second, unvalidated `hostIndex`
    // read: one org id decides where the buyer lands, which org the licence
    // entitles, and which org's erasure sweeps the idempotency claim, so
    // having two derivations of it was a way for those three to disagree.
    const buyerOrgSlug = (
      await firestore.collection('orgs').doc(buyerOrgId).get()
    ).get('slug') as string | undefined
    // A site starter bought from Create site goes back to it (AGL-4049):
    // the workspace's sites page, which reopens Create site on the same
    // pick. Anything else, or a workspace with no slug to build that page
    // from, goes to the marketplace as before.
    const backToCreate =
      returnTo === 'create-site' && siteStarter && buyerOrgSlug
        ? siteCreateReturnQuery(listingId)
        : null
    const returnPath = backToCreate
      ? buildRoute(Route.HOST_LIST, { orgSlug: buyerOrgSlug as string })
      : buyerOrgSlug
        ? buildRoute(Route.ORG_MARKETPLACE, { orgSlug: buyerOrgSlug })
        : Route.ORG_MARKETPLACE
    // Each way back is built as a query, so `purchase` joins whatever the
    // page already asks for rather than being glued on as a second `?`.
    const returnUrl = (purchase: 'success' | 'canceled'): string => {
      const query = new URLSearchParams(backToCreate ?? undefined)
      query.set('purchase', purchase)
      return `${origin}${returnPath}?${query.toString()}`
    }
    // Tax + funds flow (AGL-1544). Aglyn registered as a marketplace
    // provider with the Texas Comptroller: it collects and remits sales tax
    // on sellers' behalf. That is the PLATFORM's charge — no `on_behalf_of`,
    // `automatic_tax` on the platform session, tax added ON TOP of the
    // listing price (`tax_behavior: exclusive`) with a full billing address
    // to compute from. The transfer is a FIXED amount (the seller's share of
    // the pre-tax price) rather than `application_fee_amount`, because the
    // fee form makes Stripe transfer `amount_total − fee` — and amount_total
    // includes the tax, which must stay with the platform that owes it.
    const params = new URLSearchParams({
      mode: 'payment',
      // 3-D Secure, from the one seam every card payment shares (AGL-3360).
      ...checkoutSessionCardAuthenticationParams('payment'),
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amountCents),
      'line_items[0][price_data][tax_behavior]': 'exclusive',
      'line_items[0][price_data][product_data][name]': String(
        listing.displayName ?? 'Marketplace component',
      ).slice(0, 120),
      // The classification, stated rather than inherited (AGL-1553). See
      // MARKETPLACE_TAX_CODE above: same value the account preset carries, so
      // the tax computed is unchanged, but it no longer depends on a Dashboard
      // field owned by Aglyn's subscription products.
      'line_items[0][price_data][product_data][tax_code]': MARKETPLACE_TAX_CODE,
      'automatic_tax[enabled]': 'true',
      billing_address_collection: 'required',
      // Nobody to pay when the platform's own org is the seller (AGL-4049):
      // the sale stays on the platform's account, tax and all.
      ...(platformSale
        ? {}
        : {
            'payment_intent_data[transfer_data][destination]': String(accountId),
            'payment_intent_data[transfer_data][amount]': String(transferCents),
          }),
      // THE DISCRIMINATOR THE REFUND DOOR HAS NO OTHER WAY TO GET (AGL-2148).
      //
      // `metadata[type]` below rides on the SESSION, and `charge.refunded`
      // never sees a session — its object is the charge. The platform
      // endpoint receives `charge.refunded` for storefront orders and
      // subscription charges too, so the webhook cannot tell a marketplace
      // refund from any other one except by joining on the payment intent,
      // which is exactly the join that comes up empty during the window this
      // metadata exists to close (the purchase document is written by
      // `checkout.session.completed`, and that delivery retries).
      //
      // Stripe copies a PaymentIntent's metadata onto the charge it creates,
      // so stamping it here makes `charge.metadata.type` readable straight
      // off the refund event — no Firestore join, no Stripe round trip, and
      // no orphan record written for the commerce and subscription refunds
      // that share this endpoint.
      //
      // `listingId`/`buyerUid` ride along for forensics only: an orphan that
      // never drains is a support case, and the payment intent alone does not
      // say whose purchase of what it was.
      'payment_intent_data[metadata][type]': 'marketplace-purchase',
      'payment_intent_data[metadata][listingId]': listingId,
      'payment_intent_data[metadata][buyerUid]': decoded.uid,
      'payment_intent_data[metadata][buyerOrgId]': buyerOrgId,
      success_url: returnUrl('success'),
      cancel_url: returnUrl('canceled'),
      client_reference_id: decoded.uid,
      'metadata[type]': 'marketplace-purchase',
      'metadata[listingId]': listingId,
      'metadata[buyerUid]': decoded.uid,
      // THE ORG THE LICENCE IS FOR (AGL-2331). The webhook writes the
      // purchase document from this metadata and had no buyer org to write,
      // which is why the entitlement could only ever be person-scoped: the
      // one field the gate needs was never carried across the Stripe
      // boundary. Validated above against the caller's own membership, so a
      // session can never license an org the buyer has no standing in.
      'metadata[buyerOrgId]': buyerOrgId,
      'metadata[sellerOrgId]': sellerOrgId,
      'metadata[feeCents]': String(feeCents),
      'metadata[transferCents]': String(transferCents),
      // The buyer's GA client id (AGL-1638), so the server-side `purchase`
      // the webhook sends joins the browser session that produced it. The
      // webhook has always READ `metadata.ga_client_id`; nothing wrote it,
      // so the read was dead and every marketplace sale fell through to a
      // synthesized, sessionless GA user — making plugin revenue permanently
      // unattributable to any channel.
      //
      // Carried on the SESSION rather than a subscription because this is a
      // one-time payment; `checkout.session.completed` is where it is read.
      //
      // Validated to GA's `<digits>.<digits>` shape and dropped otherwise:
      // the value is client-supplied and ends up in Stripe metadata, so it is
      // not accepted on trust. Same guard /api/billing/checkout applies.
      ...(/^\d+\.\d+$/.test(String(req.body?.gaClientId ?? ''))
        ? { 'metadata[ga_client_id]': String(req.body.gaClientId) }
        : {}),
      ...(decoded.email ? { customer_email: decoded.email } : {}),
    })
    // No buy-now-pay-later on a listing either (AGL-4198): a card or a
    // card-rate wallet, which the listing floor more than covers.
    excludeBuyNowPayLater(params)
    // Point of no return (AGL-1697). The purchase check above closes the
    // SEQUENTIAL duplicate — a second buy after the webhook has written the
    // first purchase — and cannot close the concurrent one, because between two
    // clicks a second apart there is no purchase record yet to find. The claim
    // is what covers that window: `create()` on a document Firestore refuses to
    // create twice.
    //
    // Scoped to the listing AND the buyer, so two people buying the same
    // component at the same moment never contend, and one person's two tabs
    // always do.
    //
    // The claim is taken here rather than at the top so that every deterministic
    // refusal above it — unknown listing, free listing, self-purchase, already
    // owned, publisher not paid out, seller cannot sell — answers without
    // burning the key. Those are all states a buyer or publisher fixes and then
    // presses the same button again.
    const claimed = await claimAttempt(firestore, {
      kind: 'marketplace-checkout',
      // Scoped to the ORG as well as the buyer since AGL-2331. The scope is
      // what decides which two attempts are allowed to contend, and a
      // licence for one workspace and a licence for another are now two
      // different goods — an agency owner buying for two clients from two
      // tabs must not have one of them read as a double-click of the other.
      scopeId: `${listingId}:${buyerOrgId}:${decoded.uid}`,
      // The BUYER's org, so `eraseOrgIdempotencyKeys` sweeps this with the
      // buyer's data (AGL-1448) — the seller keeps the sale.
      orgId: buyerOrgId,
      key: idempotencyKey,
      busyMessage: 'This purchase is already being processed',
    })
    if ('replay' in claimed) {
      return res.status(claimed.replay.status).json(claimed.replay.body)
    }
    claim = claimed.claim

    const response = await fetch(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          // The half that costs real money. Stripe replays the existing
          // session for a repeated key instead of opening a second one, which
          // covers the window where our own claim is written but the response
          // never arrives — the failure this route was most exposed to, since
          // it writes nothing of its own to reconcile against.
          ...(claim.stripeKey ? { 'Idempotency-Key': claim.stripeKey } : {}),
        },
        body: params.toString(),
      },
    )
    const session = (await response.json()) as { url?: string; error?: any }
    if (!response.ok || !session.url) {
      console.error('Stripe checkout error', session.error)
      // The purchase did not start — let the same key be tried again rather
      // than locking this buyer out of this listing over one flaky moment.
      await claim.release()
      return res.status(502).json({ error: 'Stripe checkout failed' })
    }
    const payload = { url: session.url }
    // A repeat of this attempt now replays the SAME session url. Better than
    // refusing it: the buyer lands back on the checkout they already had open.
    await claim.record(200, payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // and lock the buyer out of this listing until they reload.
    await claim?.release()
    return res.status(500).json({ error: 'Checkout failed' })
  }
}
