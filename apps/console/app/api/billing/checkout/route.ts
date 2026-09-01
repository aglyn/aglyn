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
  claimAttempt,
  isCustomPricedPlan,
  isOrgSubscriptionLive,
  pluginRequestFromWeb,
  type AttemptClaim,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  featureLockdownRefusal,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_VALUE,
} from '../../../../utils/internal-traffic'
import { configuredPriceFault } from '../../../../utils/stripe-price-fault'
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
 * Pinned so the preview and the subscription are priced by the SAME Stripe
 * version. `invoices/upcoming` and the shape of an invoice's tax fields have
 * both moved between versions; letting the account default decide would mean
 * the number shown and the number charged could come from different rules.
 */
const STRIPE_API_VERSION = '2024-06-20'

/** The amounts a customer is shown, in one shape for the preview and the invoice. */
export interface InvoiceAmounts {
  subtotalCents: number
  taxCents: number
  totalCents: number
  currency: string
  /** True when Stripe actually finished computing tax for this address. */
  taxComplete: boolean
  /**
   * Stripe's own `taxability_reason` for the first tax line, when there is
   * one — `reverse_charge`, `customer_exempt`, `standard_rated`,
   * `taxable_basis_reduced` and so on.
   *
   * Carried because a ZERO has four meanings and the customer who cares most
   * cannot tell them apart without it. Reported, never inferred: this is
   * Stripe's verdict, and inventing one of our own would put OUR number in
   * front of a tax authority.
   */
  taxReason: string | null
  /**
   * What the invoice's discounts take off, as a POSITIVE number of cents.
   *
   * `subtotal` is PRE-discount and `total` is POST-discount, so on a
   * discounted invoice the two figures beside each other do not reconcile and
   * no arithmetic available to the reader closes the gap: a $25.00 subtotal,
   * $0.05 of tax and a $0.80 total is three numbers that cannot all be true
   * unless the missing line is named. This is that line, and it is carried
   * for every invoice — zero when nothing was discounted — so a caller can
   * render it on the one rule "show it when it is non-zero" rather than by
   * inferring a discount from a subtotal that failed to add up.
   */
  discountCents: number
}

/**
 * Flatten a Stripe invoice (real or previewed) into the figures the plan card
 * renders.
 *
 * `taxComplete` is separate from the tax amount on purpose. `automatic_tax`
 * answers `requires_location_inputs` when it cannot resolve an address, and in
 * that state the tax is legitimately `0` — indistinguishable from a genuinely
 * untaxed sale unless the status is carried alongside. A total that quietly
 * omits tax is the one number this whole flow exists to get right, so the
 * caller is told whether it is trustworthy rather than left to infer it.
 */
export function describeInvoiceAmounts(invoice: any): InvoiceAmounts {
  // Both spellings: `total_tax_amounts` on the pinned 2024-06-20 version,
  // `total_taxes` on newer ones. Read defensively so a version bump degrades
  // to "no reason given" rather than to a wrong one.
  const taxLines = Array.isArray(invoice?.total_tax_amounts)
    ? invoice.total_tax_amounts
    : Array.isArray(invoice?.total_taxes)
      ? invoice.total_taxes
      : []
  // The same defensive pair for the discount lines. `total_discount_amounts`
  // is the pinned version's spelling; `total_discounts` is read alongside it
  // so a version bump degrades to "no discount line shown" — the figures the
  // customer already sees, minus one explanatory row — rather than to a
  // number invented out of `subtotal - total`, which would also swallow tax
  // and credits and report them as a discount.
  const discountLines = Array.isArray(invoice?.total_discount_amounts)
    ? invoice.total_discount_amounts
    : Array.isArray(invoice?.total_discounts)
      ? invoice.total_discounts
      : []
  return {
    subtotalCents: Number(invoice?.subtotal ?? 0),
    taxCents: Number(invoice?.tax ?? 0),
    totalCents: Number(invoice?.total ?? 0),
    currency: String(invoice?.currency ?? 'usd'),
    taxComplete: invoice?.automatic_tax?.status === 'complete',
    taxReason: taxLines[0]?.taxability_reason ?? null,
    // Summed rather than read off `[0]`: several coupons can stack onto one
    // invoice, and showing only the first would understate the discount while
    // looking exactly as authoritative as the correct figure.
    discountCents: discountLines.reduce(
      (total: number, line: any) => total + Number(line?.amount ?? 0),
      0,
    ),
  }
}

/**
 * Look up a customer-typed promotion code.
 *
 * Stripe's `discounts[0][promotion_code]` takes the code's ID, not the string
 * a customer types, so this is a lookup and not a pass-through. `active=true`
 * means an expired or exhausted code is reported as unknown rather than
 * silently ignored — a discount that vanishes between the preview and the
 * charge is the worst version of this feature.
 *
 * Returns `{}` for an empty input so the common path costs no API call.
 *
 * ## Why the coupon's DURATION comes back with it
 *
 * `duration: once` discounts the first invoice and nothing after it. A
 * customer who is shown "$0.80" and enrolled at $26.65 a month has been told
 * the truth about today and misled about the subscription, which is the same
 * defect as showing a discount that never reaches the charge — only harder to
 * notice, because the first invoice agrees with the screen.
 *
 * The duration is taken from THIS lookup rather than from a second call or
 * from an expanded invoice field: a promotion code carries its coupon inline,
 * so the fact is already in a response the resolve path always reads, and
 * reading it here cannot add a request to the purchase path.
 */
export async function resolvePromotionCode(
  secretKey: string,
  code: string,
): Promise<{
  id?: string
  code?: string
  error?: string
  /** Stripe's `coupon.duration` — `once`, `repeating` or `forever`. */
  duration?: string | null
  /** Stripe's `coupon.duration_in_months`, set only for `repeating`. */
  durationInMonths?: number | null
}> {
  const wanted = String(code ?? '').trim()
  if (!wanted) return {}
  const response = await fetch(
    `https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(
      wanted,
    )}&active=true&limit=1`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  )
  const payload = await response.json()
  const found = Array.isArray(payload?.data) ? payload.data[0] : null
  if (!response.ok || !found?.id) {
    return { error: `We do not recognize the code “${wanted.slice(0, 40)}”.` }
  }
  return {
    id: String(found.id),
    code: String(found.code ?? wanted),
    // Reported, never defaulted. An absent duration answers "we do not know
    // whether this discount persists", and the confirm says exactly that —
    // guessing `forever` would promise a price nobody verified, and guessing
    // `once` would frighten a customer off a discount they actually keep.
    duration:
      typeof found?.coupon?.duration === 'string' ? found.coupon.duration : null,
    durationInMonths:
      typeof found?.coupon?.duration_in_months === 'number'
        ? found.coupon.duration_in_months
        : null,
  }
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
  // One upgrade attempt, minted by the Billing page (AGL-1697). The
  // subscription_exists guard below covers the SEQUENTIAL duplicate — once
  // the webhook has mirrored a first subscription. This key covers the window
  // before any subscription exists, where a double-click or a lost response
  // used to open two sessions that could both complete.
  const idempotencyKey = String(
    headers['idempotency-key'] ?? headers['Idempotency-Key'] ?? '',
  ).trim().slice(0, 200)

  let claim: AttemptClaim | null = null
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

    // ── The purchase, built out of the pieces the customer already has ──
    //
    // There is no checkout step here and no checkout surface. A workspace
    // reaches this point with a payment method and a billing address already
    // on file — both collected by the Billing page's own cards, in our own
    // design — so subscribing is a server-side call against a stored
    // `default_payment_method` rather than a page that collects anything.
    //
    // That is what removed the last Stripe-branded screen. Embedded Checkout
    // put Link and Amazon Pay buttons, a TEST MODE badge and Stripe's own
    // typography in front of a customer mid-upgrade; moving it inline did not
    // help, because the objection was arriving somewhere else, not the
    // container it arrived in. Every payment method it offered is still
    // available — the `PaymentElement` on the Billing page renders Link, bank
    // debits, Cash App and Klarna — they are simply collected before the plan
    // is chosen instead of during it.
    //
    // WHAT IS DELIBERATELY UNCHANGED ABOVE THIS LINE: the checkout feature
    // lockdown, the membership and `billing.manage` checks, the
    // `isOrgSubscriptionLive` duplicate-subscription guard, and the
    // `claimAttempt` below. None of them moved.

    // The PREVIEW, deliberately above the claim: it is read-only and re-run
    // whenever the plan or the promotion code changes, so it must not burn the
    // idempotency key — a customer who compares two plans would otherwise be
    // unable to buy either.
    //
    // This is what shows the tax-inclusive total on the plan card BEFORE
    // anything is clicked. It is reliable here in a way it could never be
    // inside a payment form, because the address is already known rather than
    // being typed as the number recalculates.
    if (String(body?.action ?? '') === 'preview') {
      if (!existingCustomerId) {
        return Response.json({ needsBillingDetails: true }, { status: 200 })
      }
      // The ADDRESS is a prerequisite of the QUOTE, not only of the purchase.
      //
      // Subscribe already refused without one. The preview needed only a
      // customer id, so a quote could be produced for an addressless customer
      // — `automatic_tax` then answers `requires_location_inputs`, the tax is
      // `0`, and the total silently excludes it. Stated as its own check so a
      // future reordering cannot reintroduce an addressless quote by
      // accident.
      const quoteCustomer = await fetch(
        // `tax_ids` expanded on the SAME read the address check already
        // makes. A business tax ID is an input to what Stripe charges — it is
        // what makes reverse charge apply — and it has to be known BEFORE the
        // quote, not discovered on the invoice.
        `https://api.stripe.com/v1/customers/${encodeURIComponent(existingCustomerId)}?expand[]=tax_ids`,
        { headers: { Authorization: `Bearer ${secretKey}` } },
      )
      const quoteCustomerRecord = await quoteCustomer.json()
      if (!quoteCustomerRecord?.address?.country) {
        return Response.json({ needsBillingAddress: true }, { status: 200 })
      }
      const preview = new URLSearchParams({
        customer: existingCustomerId,
        'subscription_details[items][0][price]': priceId,
        'automatic_tax[enabled]': 'true',
      })
      const meteredPreview = meteredPriceId(interval)
      if (meteredPreview) {
        preview.set('subscription_details[items][1][price]', meteredPreview)
      }
      const promo = await resolvePromotionCode(
        secretKey,
        String(body?.promotionCode ?? ''),
      )
      if (promo.error) return Response.json({ error: promo.error }, { status: 400 })
      if (promo.id) preview.set('discounts[0][promotion_code]', promo.id)
      const upcoming = await fetch(
        `https://api.stripe.com/v1/invoices/upcoming?${preview.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Stripe-Version': STRIPE_API_VERSION,
          },
        },
      )
      const invoice = await upcoming.json()
      if (!upcoming.ok) {
        console.error('[billing/checkout] preview failed', invoice?.error?.code)
        return Response.json(
          { error: 'We could not price that plan just now.' },
          { status: 502 },
        )
      }
      return Response.json(
        {
          preview: describeInvoiceAmounts(invoice),
          // Never read anywhere before this. `exempt` and `reverse` are why a
          // legitimately zero tax is zero, and without them the customer who
          // is specifically checking cannot tell it from a bug.
          customerTaxExempt: quoteCustomerRecord?.tax_exempt ?? null,
          // Whether a business tax ID is on file. NOT a claim that one would
          // change this quote — that is Stripe's determination and depends on
          // jurisdiction. It is the fact needed to ask the question at the
          // right moment: before the charge, while the answer can still
          // affect it.
          hasTaxId: Array.isArray(quoteCustomerRecord?.tax_ids?.data)
            ? quoteCustomerRecord.tax_ids.data.length > 0
            : false,
          promotionCodeApplied: promo.id ? promo.code : null,
          // How long the discount lasts, so the purchase confirm can quote the
          // RENEWAL and not only today. Everything above this pair describes
          // the first invoice; a `once` coupon makes the first invoice the one
          // month that does not represent the subscription, and there is no
          // other field on this response from which that can be worked out.
          promotionCodeDuration: promo.id ? (promo.duration ?? null) : null,
          promotionCodeDurationInMonths: promo.id
            ? (promo.durationInMonths ?? null)
            : null,
        },
        { status: 200 },
      )
    }

    // The two things the new flow requires, refused SEPARATELY so the page can
    // say which one is missing. Neither is a payment failure and neither is a
    // dead end: both are cards on the same page, above the plan grid.
    if (!existingCustomerId) {
      return Response.json(
        {
          error:
            'Add a payment method and a billing address before subscribing.',
          code: 'billing_details_required',
        },
        { status: 409 },
      )
    }
    const customerRead = await fetch(
      `https://api.stripe.com/v1/customers/${encodeURIComponent(existingCustomerId)}`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    const customerRecord = await customerRead.json()
    const defaultPaymentMethod =
      typeof customerRecord?.invoice_settings?.default_payment_method === 'string'
        ? customerRecord.invoice_settings.default_payment_method
        : (customerRecord?.invoice_settings?.default_payment_method?.id ?? null)
    if (!defaultPaymentMethod) {
      return Response.json(
        {
          error:
            'Add a payment method before subscribing — it is charged for the ' +
            'first invoice and every renewal.',
          code: 'payment_method_required',
        },
        { status: 409 },
      )
    }
    if (!customerRecord?.address?.country) {
      // Without an address `automatic_tax` reports `requires_location_inputs`
      // and charges no tax at all — which looks like it worked and puts an
      // untaxed invoice in front of a tax authority.
      return Response.json(
        {
          error:
            'Add a billing address before subscribing — sales tax is ' +
            'calculated from it.',
          code: 'billing_address_required',
        },
        { status: 409 },
      )
    }

    // Point of no return (AGL-1697): the only thing left is the subscription
    // itself. Every refusal — lockdown, membership, permission, the
    // subscription_exists guard, and the two above — sits above this line, so
    // none of them burns the key; a churned org that is refused today pays
    // with the same button tomorrow.
    const claimed = await claimAttempt(firebaseAdmin.app().firestore(), {
      kind: 'console-checkout',
      scopeId: orgId,
      orgId,
      key: idempotencyKey,
      busyMessage: 'This checkout is already being processed',
    })
    if ('replay' in claimed) {
      return Response.json(claimed.replay.body as object, {
        status: claimed.replay.status,
      })
    }
    claim = claimed.claim

    const subParams = new URLSearchParams({
      customer: existingCustomerId,
      'items[0][price]': priceId,
      default_payment_method: defaultPaymentMethod,
      // A property of the SUBSCRIPTION, never of Checkout — which is why
      // dropping Checkout costs no tax behaviour at all.
      'automatic_tax[enabled]': 'true',
      // Stripe opens the first invoice and its PaymentIntent but charges
      // nothing until it is confirmed. On a saved card Stripe confirms it
      // itself; the status only stays open when an ISSUER demands
      // authentication, which is the one case the page still has to handle.
      payment_behavior: 'default_incomplete',
      'payment_settings[save_default_payment_method]': 'on_subscription',
      'expand[]': 'latest_invoice.payment_intent',
      'metadata[orgId]': orgId,
      'metadata[plan]': plan,
      /*==========================================
       * WHO CLICKED (AGL-118), carried to the only writer that logs.
       *
       * The subscription lifecycle is logged FROM THE WEBHOOK, because the
       * webhook reports what HAPPENED and this route reports what was
       * ATTEMPTED — and because Stripe ends subscriptions on its own, which
       * this route never hears about at all. The cost of that choice is that
       * the webhook has no session and no idea who a person is, so the actor
       * has to travel with the object.
       *
       * `actorAction` travels WITH the uid and is not decoration. Stripe
       * metadata persists on the subscription forever, so a bare `actorUid`
       * stamped here would still be sitting on the object a year later when
       * dunning cancels it — and the webhook would name this person as having
       * cancelled a subscription they did nothing to. Pairing the uid with
       * the act it authorized means a stamp can only ever sign the kind of
       * event it was written for; see the reader in the webhook.
       *=========================================*/
      'metadata[actorUid]': decoded.uid,
      'metadata[actorAction]': 'subscribe',
    })
    // The SAME metered item the session attached, resolved the same way, so
    // the interval-matching rule (AGL-1340) holds identically: Stripe rejects
    // mixed `recurring.interval` on one subscription, and each interval has
    // its own metered price.
    const meteredNative = meteredPriceId(interval)
    if (meteredNative) {
      subParams.set('items[1][price]', meteredNative)
    } else if (meteredPriceId(interval === 'year' ? 'month' : 'year')) {
      // Skipped, and SAID so — but only when the OTHER interval is
      // configured. That asymmetry is the actual fault: it means one
      // interval's customers are billed for overage and the other's silently
      // are not, which is invisible from every screen. Both unset is Stripe
      // simply being unprovisioned and warning on it would train everyone to
      // ignore the warning.
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
    // The attribution metadata the session put on `subscription_data`, now set
    // directly on the subscription — same destination, one hop fewer. Both are
    // client-supplied and neither is accepted on trust.
    if (/^\d+\.\d+$/.test(String(body?.gaClientId ?? ''))) {
      subParams.set('metadata[ga_client_id]', String(body.gaClientId))
    }
    if (body?.internalTraffic === true) {
      subParams.set(`metadata[${INTERNAL_TRAFFIC_PARAM}]`, INTERNAL_TRAFFIC_VALUE)
    }
    const promo = await resolvePromotionCode(
      secretKey,
      String(body?.promotionCode ?? ''),
    )
    if (promo.id) subParams.set('discounts[0][promotion_code]', promo.id)

    const created = await fetch('https://api.stripe.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': STRIPE_API_VERSION,
        // The same Stripe-side replay protection the session had, on the same
        // claim key: a lost response cannot open a second subscription.
        ...(claim.stripeKey ? { 'Idempotency-Key': claim.stripeKey } : {}),
      },
      body: subParams.toString(),
    })
    const subscription = await created.json()
    if (!created.ok) {
      console.error('[billing/checkout] subscription failed', subscription?.error)
      // Stripe answered, so nothing needs reconciling — hand the key back and
      // let the same button work once the config or the network does.
      await claim.release()
      claim = null
      const missing = configuredPriceFault(subscription?.error, plan, interval)
      if (missing) return Response.json({ error: missing }, { status: 501 })
      return Response.json(
        { error: 'Could not start the subscription. Nothing has been charged.' },
        { status: 502 },
      )
    }
    const invoice = subscription?.latest_invoice ?? null
    let intent = invoice?.payment_intent ?? null

    // ── The confirm, SERVER-SIDE, and nothing works without it ──
    //
    // `payment_behavior: default_incomplete` deliberately leaves the first
    // invoice's PaymentIntent unconfirmed: Stripe opens it and charges
    // nothing. On a stored payment method there is no form to submit and no
    // data to gather, so the confirm is ours to make — and until it is made
    // the intent sits at `requires_confirmation`, the subscription sits at
    // `incomplete`, and no money moves.
    //
    // It has to happen HERE rather than in the browser. `handleNextAction` —
    // the one method this flow can use, because a server-confirmed intent has
    // no Payment Element behind it — is defined for `requires_action` alone
    // and THROWS an `IntegrationError` on anything else. Driven against a
    // real test-mode subscription, `requires_confirmation` produced
    // "The PaymentIntent supplied is not in the requires_action state", which
    // the page catches as a generic failure: an ordinary card never activated
    // and a 3DS card never reached its challenge.
    //
    // Confirming here also produces the ONLY status from which SCA makes
    // sense. An ordinary card goes straight to `succeeded` and the
    // subscription is active; a card whose issuer wants authentication moves
    // to `requires_action` with a next action attached, which is exactly what
    // the browser is handed below.
    //
    // ⚠️ This still grants nothing. `succeeded` here means Stripe accepted the
    // charge, and the plan is mirrored onto the org by the webhook and by
    // nothing in this handler.
    if (intent?.id && intent?.status === 'requires_confirmation') {
      const confirmed = await fetch(
        `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(
          String(intent.id),
        )}/confirm`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Stripe-Version': STRIPE_API_VERSION,
            // Same claim, distinct operation. Without its own suffix a retry
            // would present the subscription's key to a different endpoint,
            // which Stripe rejects outright.
            ...(claim.stripeKey
              ? { 'Idempotency-Key': `${claim.stripeKey}-confirm` }
              : {}),
          },
          body: new URLSearchParams({ 'expand[]': 'payment_method' }).toString(),
        },
      )
      const confirmedIntent = await confirmed.json()
      if (confirmed.ok) {
        intent = confirmedIntent
      } else {
        // Stripe refused the confirm outright — a hard decline, a method that
        // vanished between the two calls. Reported through the SAME
        // `declined` branch a failed charge uses rather than as a server
        // fault, because from the customer's side it is the same event and
        // the subscription is `incomplete` either way.
        console.error(
          '[billing/checkout] intent confirm failed',
          confirmedIntent?.error?.code,
        )
        intent = { ...intent, status: 'requires_payment_method' }
      }
    }

    // An issuer demanding authentication is the ONE Stripe-rendered thing the
    // customer may still see, and it is the bank's, not a checkout page.
    //
    // Handled explicitly rather than left to the webhook: a subscription that
    // stays `incomplete` because nobody dealt with this status is a customer
    // who believes they subscribed and did not. The client secret goes back so
    // the page can run `handleNextAction`; the plan itself is still granted by
    // the webhook and by nothing here.
    //
    // `requires_action` ALONE, now that the confirm above has run.
    // `requires_confirmation` used to be treated as the same thing, which is
    // what sent an unconfirmable intent to a method that refuses them.
    const requiresAction = intent?.status === 'requires_action'
    const payload = {
      // The status AT CREATION, which the confirm above may already have moved
      // past. Left as Stripe first reported it rather than re-read, because
      // nothing may act on it: what the org is entitled to is decided by the
      // webhook, and a fresher number here would only be a more convincing
      // reason for some future caller to trust the wrong source.
      subscriptionStatus: String(subscription?.status ?? ''),
      invoice: describeInvoiceAmounts(invoice),
      ...(requiresAction && intent?.client_secret
        ? { requiresAction: true, paymentClientSecret: intent.client_secret }
        : {}),
      // A first invoice that failed outright — a declined saved card. Named so
      // the page can say "your card was declined" rather than "checkout
      // failed", which is the opposite of what happened.
      ...(intent?.status === 'requires_payment_method'
        ? { declined: true }
        : {}),
    }
    await claim.record(200, payload)
    return Response.json(payload, { status: 200 })
  } catch (error) {
    console.error(error)
    // Release on the way out so a transient failure does not strand the key
    // (AGL-1691's rule): no local writes happened, and a session Stripe did
    // create replays under the re-derived digest.
    await claim?.release()
    return Response.json({ error: 'Checkout failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
