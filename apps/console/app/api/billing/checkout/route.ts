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
  isOrgSubscriptionLive,
  isReleaseFlagOn,
  pluginRequestFromWeb,
  Route,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  featureLockdownRefusal,
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

// lockdown-423: exempt — the payment recovery path — a billing-locked org must be able to pay
// its way out (AGL-1501 keeps those sessions for exactly this). That exemption is about
// the SCOPE verdict (org/host/user) and it stands: paying an existing subscription rides
// the subscription/invoices routes, untouched. The CHECKOUT feature gate below (AGL-1510)
// is a different question — it refuses only NEW checkout sessions, platform-wide, when
// staff have turned checkout off over a live billing bug.

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
    // Feature lockdown: CHECKOUT (AGL-1510). Refuses creating a NEW Stripe
    // checkout session while staff have checkout off over a billing bug.
    // The 423 body is explicit that this is NOT a payment failure. The
    // verified `staff` claim is passed for the platform-scope un-panic
    // bypass only — at the feature stage there is deliberately NO staff
    // bypass (LOCKDOWN_FEATURE_STAFF_BYPASS.checkout = false): a
    // staff-created session is still a real charge against a real card,
    // and no incident-response step needs money to move.
    const locked = await featureLockdownRefusal({
      feature: 'checkout',
      staff: decoded['staff'] === true,
    })
    if (locked) return locked
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

    // The org's commercial record, read ONCE and used for two decisions
    // (AGL-941, AGL-1697): whether it may open a checkout at all, and which
    // customer that checkout attaches to. Read here rather than inside the
    // params so a Firestore hiccup cannot silently fall back to
    // `customer_email` and mint a duplicate — an absent id is a first
    // subscribe, and only that.
    const billing = await readOrgBilling(orgId)
    const existingCustomerId = billing.stripeCustomerId as string | undefined

    // One workspace, one subscription (AGL-1697). This route opens a
    // `mode: subscription` session and never asked whether the org already
    // had one, so two completed sessions subscribed the same org twice on the
    // same customer — two recurring charges, which the webhook cannot undo
    // because its job is to mirror whatever Stripe reports and it will mirror
    // the second one straight over the first.
    //
    // A guard existed, but only in a React callback: the Billing page sends a
    // plan change through the proration preview + subscription update, "never
    // a second Checkout (AGL-269)". That branch does not survive a stale tab,
    // a second window, a back-button re-submit, or a direct POST — none of
    // which are exotic on a page whose whole purpose is spending money.
    //
    // 409 rather than a silent redirect into the customer portal: the caller
    // asked for something that is not true of this org, and the Billing page
    // can say so. `code` is machine-readable so the client can distinguish
    // this from the payment failures that share the status.
    //
    // `isOrgSubscriptionLive` is deliberately a STATUS test rather than a "has
    // a subscription record" test: the record — and the customer id beside it
    // — survives cancellation, so the naive form would lock every churned
    // workspace out of ever paying us again. `incomplete`, `incomplete_expired`
    // and `unpaid` stay open from the other side: there is no live
    // subscription to protect and a new session is the buyer's only way
    // forward. It is imported rather than spelled out here because the Billing
    // page decides the same thing off the same list, and the two narrowing
    // apart is the double-billing shape (AGL-1715).
    if (isOrgSubscriptionLive(billing)) {
      return Response.json(
        {
          error:
            'This workspace already has a subscription — change plans from ' +
            'Billing instead of starting a new checkout.',
          code: 'subscription_exists',
        },
        { status: 409 },
      )
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
      // The buyer's GA client id, so the server-side `purchase` the webhook
      // sends can join the browser session that produced it (AGL-1561).
      // Carried on the SUBSCRIPTION rather than the session so renewals can
      // find it too. Validated to GA's `<digits>.<digits>` shape and dropped
      // otherwise: this string is client-supplied and ends up in Stripe
      // metadata, so it is not accepted on trust.
      ...(/^\d+\.\d+$/.test(String(body?.gaClientId ?? ''))
        ? { 'subscription_data[metadata][ga_client_id]': String(body.gaClientId) }
        : {}),
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
    // INTERVAL-MATCHED (AGL-1340, completed in AGL-1280). Stripe forbids
    // mixed `recurring.interval` on one subscription — proved read-only
    // against live Stripe with `GET /v1/invoices/upcoming`: Starter monthly +
    // monthly metered previews at $25.00, Starter yearly alone at $192.00,
    // and Starter yearly + MONTHLY metered hard-errors.
    //
    // AGL-1340 handled that by attaching the metered item to monthly
    // checkouts only, which left annual subscriptions carrying no metered
    // item at all — metered on paper, billed $0 in fact. Now each interval
    // has its own price on the same meter, so the item follows the plan and
    // the mixed-interval crash is structurally impossible: the yearly
    // subscription can only ever be handed the yearly id.
    const metered = meteredPriceId(interval)
    if (metered) {
      params.set('line_items[1][price]', metered)
    } else if (meteredPriceId(interval === 'year' ? 'month' : 'year')) {
      // Skipped, and SAID so — but only when the OTHER interval is configured.
      // That asymmetry is the actual fault: it means one interval's customers
      // are billed for overage and the other's silently are not, which is
      // invisible from every screen. Both unset is Stripe simply being
      // unprovisioned (local dev, a fresh environment) and warning on it
      // would train everyone to ignore the warning.
      console.warn('[billing/checkout] metered usage item not attached', {
        orgId,
        plan,
        interval,
        reason: `${
          interval === 'year'
            ? 'STRIPE_PRICE_METERED_YEARLY'
            : 'STRIPE_PRICE_METERED'
        } is unset while the other interval's metered price IS set, so ${interval}ly subscriptions accrue usage that reaches no invoice`,
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
