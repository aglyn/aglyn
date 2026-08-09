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
  buildRoute,
  isCustomPricedPlan,
  isReleaseFlagOn,
  pluginRequestFromWeb,
  Route,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getServerReleaseFlagValues,
  isImpersonationSession,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { configuredPriceFault } from '../../../../utils/stripe-price-fault'
import { checkoutCustomerParams } from '../../../../utils/stripe-customer-identity'
import { meteredPriceId } from '../../../../utils/server/billing-addons'

const PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER,
  pro: process.env.STRIPE_PRICE_PRO,
  business: process.env.STRIPE_PRICE_BUSINESS,
  scale: process.env.STRIPE_PRICE_SCALE,
  advanced: process.env.STRIPE_PRICE_ADVANCED,
  agency: process.env.STRIPE_PRICE_AGENCY,
}

/** Annual prices (AGL-269); absent envs make the toggle degrade to 501. */
const YEARLY_PRICE_ENV: Record<string, string | undefined> = {
  starter: process.env.STRIPE_PRICE_STARTER_YEARLY,
  pro: process.env.STRIPE_PRICE_PRO_YEARLY,
  business: process.env.STRIPE_PRICE_BUSINESS_YEARLY,
  scale: process.env.STRIPE_PRICE_SCALE_YEARLY,
  advanced: process.env.STRIPE_PRICE_ADVANCED_YEARLY,
  agency: process.env.STRIPE_PRICE_AGENCY_YEARLY,
}



/**
 * Creates a Stripe Checkout session for a plan upgrade. Uses Stripe's REST
 * API directly (no SDK dependency); degrades to 501 when Stripe isn't
 * configured so the Billing UI can message it. Auth: Firebase ID token in
 * the Authorization header; the tenant doc is keyed by the caller's uid
 * (billing v1 single-user tenancy).
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const secretKey = process.env.STRIPE_SECRET_KEY
  const plan = String(body?.plan ?? '')
  // Enterprise is quoted per deal and provisioned by staff (AGL-1110/1118) —
  // it is never sold through checkout. Rejected EXPLICITLY rather than left to
  // fall through the missing-price branch below, which would answer "billing
  // is not configured" (a 501 that reads as our bug) and would start selling
  // the plan the moment someone added a STRIPE_PRICE_ENTERPRISE env.
  if (isCustomPricedPlan(plan as OrgPlan)) {
    return Response.json(
      { error: 'Enterprise is custom-priced — contact sales.' },
      { status: 400 },
    )
  }
  // Billing interval (AGL-269): 'year' maps to the *_YEARLY price ids.
  const interval = body?.interval === 'year' ? 'year' : 'month'
  const priceId =
    interval === 'year' ? YEARLY_PRICE_ENV[plan] : PRICE_ENV[plan]
  if (!secretKey || !priceId) {
    return Response.json({
      error:
        'Billing is not configured (missing STRIPE_SECRET_KEY / price ids).',
    }, { status: 501 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    // Org metadata (AGL-445): orgId is the only billing key — the webhook
    // mirrors the subscription onto this org doc. Explicit orgId from
    // the workspace-scoped console wins; otherwise the user's first org.
    const orgMembership = await resolveOrgMembership(
      decoded.uid,
      String(body?.orgId ?? '') || null,
    )
    if (!orgMembership) {
      return Response.json({ error: 'No workspace to bill' }, { status: 403 })
    }
    const orgId = orgMembership.orgId
    // Opening a checkout session commits the org to a plan/charge, so it is
    // billing.manage-gated (AGL-511) like subscription management — not just
    // any-member as before.
    if (
      !(await memberHasOrgPermission(orgId, orgMembership.member, 'billing.manage'))
    ) {
      return Response.json({ error: 'billing.manage required' }, { status: 403 })
    }
    const origin = headers.origin ?? `https://${headers.host}`
    // Stripe sends the browser back to these, so they have to be real console
    // paths. Billing moved under the org slug (AGL-621), leaving `/org/billing`
    // a dead route — every post-checkout return landed on a 404. Falling back
    // to the org jump page keeps that true even if the slug is missing.
    const orgSlug = (await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .get()).get('slug') as string | undefined
    const billingPath = orgSlug
      ? buildRoute(Route.MANAGE_BILLING, { orgSlug })
      : '/'

    // The customer this org already has, if any (AGL-941). Read here rather
    // than inside the params so a Firestore hiccup cannot silently fall back
    // to `customer_email` and mint a duplicate — an absent id is a first
    // subscribe, and only that.
    const existingCustomerId = (await readOrgBilling(orgId)).stripeCustomerId as
      | string
      | undefined

    // In-page checkout (AGL-1132), behind `release_native_checkout` and OFF by
    // default. Embedded mode was chosen for the console over the Payment
    // Element deliberately: this is our own chrome, so nobody expects the form
    // branded, and keeping Stripe's own form means tax, wallets and 3DS do not
    // have to be rebuilt and re-verified. The storefront is the opposite case
    // and wants the Payment Element — tracked separately, not folded in here.
    //
    // The redirect stays the default until a real card has been through this,
    // which is not something a test suite can do for us.
    const flagValues = await getServerReleaseFlagValues()
    // BOTH conditions, not just the flag. An embedded session returns a client
    // secret and no `url`, so if the browser cannot mount it — which needs a
    // publishable key that is currently set nowhere — flipping the flag would
    // strand a paying customer with a dead Upgrade button. Requiring the key
    // here means the worst case of a premature flag flip is the redirect we
    // already ship.
    const embedded =
      Boolean(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) &&
      isReleaseFlagOn(
        'release_native_checkout',
        flagValues['release_native_checkout'],
        // Bucket by org, so a rollout moves a whole workspace together rather
        // than showing one owner a different checkout from their colleague.
        orgId,
      )
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      // Embedded sessions take a single `return_url` and REJECT
      // success_url/cancel_url; the hosted redirect requires the pair. The
      // session id rides the return so the page can show a result without
      // being told the outcome by the client — see the fulfilment note below.
      ...(embedded
        ? {
            ui_mode: 'embedded',
            return_url: `${origin}${billingPath}?status=success&session_id={CHECKOUT_SESSION_ID}`,
          }
        : {
            success_url: `${origin}${billingPath}?status=success`,
            cancel_url: `${origin}${billingPath}?status=canceled`,
          }),
      client_reference_id: orgId,
      'subscription_data[metadata][orgId]': orgId,
      'subscription_data[metadata][plan]': plan,
      // Self-serve promo codes (AGL-1105): show the "Add promotion code" field
      // so a customer can redeem a staff-created code (Coupons page) at
      // checkout. Stripe validates the code and the discount rides the
      // resulting subscription; the webhook mirrors it onto org.discount.
      allow_promotion_codes: 'true',
      // Billing identity on the customer (AGL-1133). An invoice that has to
      // satisfy a tax authority needs an address on it, and a B2B one needs
      // the buyer's tax id.
      //
      // The address was NOT simply absent, contrary to the issue: Stripe's
      // default `billing_address_collection` is `auto`, so it collects one
      // when the payment method requires it. The live customer for the one
      // paying org does carry a full US address — measured, not assumed.
      // `required` makes that a guarantee rather than a side effect of which
      // card someone used, which is what an invoice needs.
      //
      // Phone and tax id were genuinely never collected: neither is ever
      // required by a card, so `auto` never asks for them.
      billing_address_collection: 'required',
      'phone_number_collection[enabled]': 'true',
      'tax_id_collection[enabled]': 'true',
      // Stripe computes and charges tax (AGL-1133). Decision by Zach — this
      // changes what customers pay, so it was never mine to switch on.
      //
      // The address collection above is its PREREQUISITE, not decoration:
      // automatic tax on a session with no address reports
      // `requires_location_inputs` and charges nothing, so enabling this
      // without `billing_address_collection: required` would look enabled
      // and quietly collect no tax at all.
      //
      // The prices all carry `tax_behavior: unspecified`, which sounds fatal
      // and is not — the account's Tax default is `inferred_by_currency`,
      // which covers them. Measured before shipping, not assumed: a live
      // session created with this flag was accepted.
      'automatic_tax[enabled]': 'true',
      // The org's own Stripe customer, reused for life (AGL-941).
      //
      // `customer_email` does NOT reuse anything — it mints a fresh Customer
      // on every checkout. An org that subscribed, cancelled and resubscribed
      // therefore accumulated duplicates, while `stripeCustomerId` only ever
      // pointed at the most recent one, so earlier invoices scattered onto
      // customers the Billing page never queries. That is a plausible cause
      // of invoices appearing "missing".
      //
      // The two are mutually exclusive — Stripe rejects a session carrying
      // both — which is why the choice is a tested function rather than an
      // inline ternary: getting it wrong breaks every upgrade.
      ...checkoutCustomerParams(existingCustomerId, decoded.email),
      // Also on the SESSION, not only the subscription: `client_reference_id`
      // is a single opaque string, and session metadata is what the Payments
      // view can be filtered by.
      'metadata[orgId]': orgId,
    })

    // Attach the shared metered price (AGL-635) as a second subscription
    // item so usage overage — storage AND API requests, both reported to
    // the aglyn_metered_usage Billing Meter by the report-usage cron —
    // actually lands on the invoice. Metered prices carry no quantity in
    // Checkout, and the item bills $0 until usage is reported, so it is safe
    // on every paid plan. Absent env (Stripe unprovisioned) → plan-only.
    //
    // MONTHLY ONLY (AGL-1340). `aglyn_metered_usage` is a monthly price, and
    // Stripe forbids mixed `recurring.interval` on one subscription — proved
    // read-only against live Stripe with `GET /v1/invoices/upcoming`:
    // Starter monthly + metered previews at $25.00, Starter yearly alone at
    // $192.00, Starter yearly + metered hard-errors. Attaching it
    // unconditionally meant annual checkout worked in production only
    // because STRIPE_PRICE_METERED happens to be UNSET there — setting it
    // would have broken every annual sale. There is no yearly metered price
    // to fall back to; minting one is a product call (AGL-1137).
    const metered = meteredPriceId()
    if (metered && interval === 'month') {
      params.set('line_items[1][price]', metered)
    } else if (metered) {
      // Skipped, and SAID so. A silently absent metered item means reported
      // usage never reaches an invoice and the org bills $0 of overage
      // forever, with nothing anywhere explaining why.
      console.warn('[billing/checkout] metered usage item not attached', {
        orgId,
        plan,
        interval,
        reason:
          'STRIPE_PRICE_METERED is a monthly price; Stripe forbids mixed intervals on one subscription',
      })
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    const session = (await response.json()) as {
      url?: string
      client_secret?: string
      error?: any
    }
    // An embedded session has NO `url` — mounting its client secret is the
    // whole point — so the old `!session.url` guard would have rejected every
    // successful embedded session as a Stripe failure.
    const token = embedded ? session.client_secret : session.url
    if (!response.ok || !token) {
      console.error('Stripe checkout error', session.error)
      // A price id that is SET but does not exist in this Stripe mode is a
      // configuration fault, not a Stripe outage, and it used to read as
      // "Stripe checkout failed" (AGL-1137). The guard above only catches an
      // ABSENT env var; a stale id — the shape you get when the secret key is
      // switched from test to live and the price ids are not — sails past it
      // and dies here, indistinguishable from a network blip.
      //
      // Stripe names the offending parameter, so map it back to the env var
      // that supplied it rather than making someone guess which of ~60 it was.
      const missing = configuredPriceFault(session.error, plan, interval)
      if (missing) {
        return Response.json({ error: missing }, { status: 501 })
      }
      return Response.json({ error: 'Stripe checkout failed' }, { status: 502 })
    }
    // Never both: the client picks its path by which key is present, so
    // returning one shape per mode keeps that unambiguous.
    return Response.json(
      embedded ? { clientSecret: token } : { url: token },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Checkout failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
