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

import { normalizeAddress, pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  logOrgActivity,
  memberHasOrgPermission,
  readOrgBilling,
  resolveOrgMembership,
  writeOrgBilling,
} from '@aglyn/tenant-data-admin'
import { describeStripeModeSplit } from '../../_lib/stripe-customer-mode-notice'
// The shared shaper and the shared status list. The list is a deliberate
// SUPERSET of `isLiveSubscriptionStatus` (it adds `unpaid`) and answers a
// different question — "is there a subscription whose renewal would break if
// this card went away" — which is exactly what this route asks. Imported
// rather than restated: a third copy of those four words is the drift
// AGL-1715 exists to stop.
import {
  describeStripePaymentMethod,
  LIVE_SUBSCRIPTION_STATUSES,
} from '../../_lib/stripe-payment-method'
import { deploymentLivemode } from '@aglyn/aglyn/app-utils/stripe-deployment-mode'
import { platformPaymentsConfigured } from '../../../../utils/server/payments-platform'
import { stripeAddressDivergence } from '../../../../utils/stripe-address-divergence'
import { taxIdTypeLabel } from '../../../../utils/stripe-tax-id-types'

// lockdown-423: exempt — the same recovery reasoning as `/invoices` and
// `/subscription`. A billing-locked org has to be able to fix the billing
// email that never received the dunning notice, or replace the card that
// failed, or it can never pay its way out.

/**
 * The NATIVE billing settings surface.
 *
 * ## What this replaces
 *
 * Everything about an org's commercial identity — where invoices are sent,
 * which cards are on file, the billing address, the tax ID — used to be
 * reachable only inside Stripe's own checkout popup, and only at the moment
 * of purchase. That made three things impossible: editing any of it after the
 * fact, seeing any of it without starting a checkout, and declaring a tax ID
 * at all for an org that subscribed before `tax_id_collection` was turned on.
 *
 * This route is the server half of the settings cards that replace it. The
 * page around it is ours; Stripe stays the processor and the store of record.
 *
 * ## The line this route does not cross
 *
 * **No card number ever reaches this handler.** There is no action here that
 * accepts a PAN, a CVC or an expiry, and there must never be one: card entry
 * happens inside Stripe Elements' own iframes, and the only thing this route
 * does for it is mint a SetupIntent and hand back its client secret.
 * `billing-card-entry-stays-in-stripe.spec.ts` asserts that by reading this
 * file, so an action added later that took a card would fail the build.
 *
 * That guard matters MORE now than it did behind a hosted form, not less:
 * inline Elements are meant to look like our own inputs, so a hand-rolled
 * card field added beside them would look right and be catastrophic.
 *
 * **No entitlement is granted here.** Nothing writes `plan`, `entitlements`
 * or `subscription`. A plan change is requested through Stripe and applied by
 * `/api/billing/webhook`, which stays the only writer — the same boundary the
 * checkout route keeps.
 *
 * ## Self-host
 *
 * `platformPaymentsConfigured()` (a PREFIX test, so a `.env` holding a
 * placeholder reads as unconfigured rather than as configured-and-broken)
 * gates every action to a 501, which the cards render as a calm "billing is
 * not configured on this deployment" rather than an error. An operator
 * running the Docker image with no Stripe keys gets a page that says so.
 */

/** Read/write split: everything but `get` needs `billing.manage`. */
const READ_ACTIONS = new Set(['get'])

interface StripeResult {
  ok: boolean
  status: number
  payload: any
}

async function stripeRequest(
  secretKey: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: URLSearchParams,
  /** Stripe-side replay protection for the calls that create something. */
  idempotencyKey?: string,
): Promise<StripeResult> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(body ? { body: body.toString() } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, payload }
}

/**
 * What we are willing to put in a log line about a failed Stripe call.
 *
 * Deliberately NOT `error.message`. Stripe's rejection for a malformed tax ID
 * quotes the value back — "…is not a valid au_abn" with the number in it — and
 * that value is the customer's tax registration number. It is fine to show
 * them their own typo; it is not fine to copy it into a log that ships to a
 * drain and sits in a retention window. The customer gets the message, the log
 * gets the code.
 */
function loggableStripeError(payload: any): Record<string, unknown> {
  return {
    type: payload?.error?.type ?? null,
    code: payload?.error?.code ?? null,
    param: payload?.error?.param ?? null,
  }
}

/**
 * Actions allowed to CREATE the org's Stripe customer if it has none.
 *
 * The three the owner named — billing email, billing address, payment method —
 * plus the tax id, which is the same kind of thing: a detail that belongs on
 * an invoice, decided before there is an invoice to put it on.
 */
const CREATES_CUSTOMER = new Set([
  'set-billing-email',
  'set-billing-address',
  'add-tax-id',
  'create-setup-intent',
])

/**
 * The org's Stripe customer, created ON DEMAND if it does not exist yet.
 *
 * Until now the only thing that ever minted one was Checkout, which is why
 * every billing field was gated behind a purchase. Creating one here costs
 * nothing, commits nobody to anything, and is what lets a workspace put its
 * finance address and its card in place before it decides to subscribe.
 *
 * ## The idempotency key is doing real work
 *
 * Two saves racing — a double-click, or the address and email cards being
 * saved together — would otherwise mint two customers, and only one would win
 * the Firestore write. The other becomes an orphan that later invoices could
 * scatter onto. The key is derived from the org and the Stripe mode, so it is
 * stable across retries and across the two cards, and Stripe returns the SAME
 * customer for all of them.
 *
 * `writeOrgBilling` is what persists it: it projects the id onto the
 * mode-scoped physical field, so a test-mode customer cannot overwrite the
 * live one, and it stamps the `stripeCustomers` reverse index the webhook
 * resolves through (AGL-2486, AGL-1028). Writing the field by hand here would
 * silently skip both.
 */
async function ensureStripeCustomer(
  secretKey: string,
  orgId: string,
  existing: string | undefined,
): Promise<string | undefined> {
  if (existing) return existing
  const org = await firebaseAdmin
    .app()
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .get()
  const name = String(org.get('name') ?? '').trim().slice(0, 200)
  const params = new URLSearchParams({ 'metadata[orgId]': orgId })
  if (name) params.set('name', name)
  const contactEmail = String(org.get('contact')?.email ?? '').trim()
  if (contactEmail) params.set('email', contactEmail.slice(0, 320))
  const created = await stripeRequest(
    secretKey,
    'POST',
    'customers',
    params,
    // Mode-scoped so a test-mode run and a live one do not collide on one key.
    `org-customer-${deploymentLivemode() ? 'live' : 'test'}-${orgId}`,
  )
  const id = typeof created.payload?.id === 'string' ? created.payload.id : null
  if (!created.ok || !id) {
    console.error(
      '[billing/profile] customer create failed',
      orgId,
      loggableStripeError(created.payload),
    )
    return undefined
  }
  await writeOrgBilling(orgId, { stripeCustomerId: id })
  return id
}

/** Trim and cap, matching `/api/orgs/settings`'s handling of the same fields. */
const clean = (value: unknown, max = 200) =>
  String(value ?? '')
    .trim()
    .slice(0, max)

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!platformPaymentsConfigured(secretKey)) {
    // 501, the same word every other billing route uses for this, so the
    // cards can tell "this deployment has no Stripe" from "we could not
    // reach Stripe" — which are different sentences to show a customer.
    return Response.json(
      { error: 'Stripe is not configured' },
      { status: 501 },
    )
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = clean(body?.orgId, 120)
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })
  const action = clean(body?.action, 60)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    const needed = READ_ACTIONS.has(action) ? 'billing.view' : 'billing.manage'
    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, needed))
    ) {
      return Response.json({ error: `${needed} required` }, { status: 403 })
    }

    let customerId = (await readOrgBilling(orgId)).stripeCustomerId as
      | string
      | undefined

    // A read NEVER mints a customer. `get` runs on every visit to the Billing
    // page, so creating one here would leave an empty Stripe customer behind
    // for every org that has ever looked at its own billing — a mess someone
    // inherits later, and one that makes "has a customer" stop meaning
    // anything.
    if (action === 'get') {
      if (!customerId) {
        // Not an error and not a refusal: an org that has never saved a
        // billing detail. The cards render editable fields over this. The
        // mode notice distinguishes "never billed" from "billed in the Stripe
        // mode this deployment cannot see" (AGL-2486), which otherwise look
        // identical and are not.
        return Response.json(
          {
            configured: true,
            customer: null,
            taxIds: [],
            paymentMethods: [],
            ...(await describeStripeModeSplit(orgId)),
          },
          { status: 200 },
        )
      }
      return await readProfile(secretKey as string, orgId, customerId)
    }

    // Everything below is a WRITE, and a write is allowed to bring the
    // customer into existence.
    //
    // Setting a billing email, a billing address or a card is ordinary account
    // setup, and gating it behind a purchase had it backwards: someone putting
    // a card on file BEFORE upgrading is a customer trying to pay us. What
    // those fields need is a Stripe customer, which is free and carries no
    // commitment — not a subscription.
    //
    // Actions that act on an object which must already exist (removing a card
    // or a tax id, changing a default, finalizing a setup intent) are not in
    // `CREATES_CUSTOMER`: there is nothing for them to operate on, and minting
    // a customer to then fail against it would be worse than the 409 they get.
    const resolvedCustomerId = CREATES_CUSTOMER.has(action)
      ? await ensureStripeCustomer(secretKey as string, orgId, customerId)
      : customerId
    if (!resolvedCustomerId) {
      return Response.json(
        {
          error:
            'This workspace has no billing details yet. Save a billing email ' +
            'or address first.',
        },
        { status: 409 },
      )
    }
    // Every branch below reads this name; the original stays untouched so the
    // `get` path above cannot accidentally be given a just-created customer.
    customerId = resolvedCustomerId

    if (action === 'set-billing-email') {
      const email = clean(body?.email, 320)
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json(
          { error: 'Enter a valid billing email address' },
          { status: 400 },
        )
      }
      const params = new URLSearchParams({ email })
      const result = await stripeRequest(
        secretKey as string,
        'POST',
        `customers/${encodeURIComponent(customerId)}`,
        params,
      )
      if (!result.ok) {
        console.error(
          '[billing/profile] billing email update failed',
          orgId,
          loggableStripeError(result.payload),
        )
        return Response.json(
          { error: result.payload?.error?.message ?? 'Stripe rejected the billing email' },
          { status: 400 },
        )
      }
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Updated the billing email',
        { type: 'org', id: orgId },
      )
      return await readProfile(secretKey as string, orgId, customerId)
    }

    if (action === 'set-billing-address') {
      const name = clean(body?.name)
      // Read at FULL length and refuse, rather than truncating to two
      // characters. Truncation turns a typed "United States" into the country
      // `UN` — a syntactically valid ISO code for somewhere else — which
      // `normalizeAddress` then accepts, and the customer's invoices are
      // silently issued against the wrong jurisdiction with tax computed from
      // it. A country that is not already two letters is a mistake to report,
      // never one to shorten into a different answer.
      const countryInput = clean(body?.country, 120)
      if (countryInput && !/^[A-Za-z]{2}$/.test(countryInput)) {
        return Response.json(
          { error: 'Country must be a two-letter code, e.g. US' },
          { status: 400 },
        )
      }
      const address = normalizeAddress({
        line1: clean(body?.line1),
        line2: clean(body?.line2),
        city: clean(body?.city),
        state: clean(body?.state),
        postalCode: clean(body?.postalCode, 20),
        country: countryInput,
      })
      if (address && !address.country) {
        return Response.json(
          { error: 'A billing address needs a country' },
          { status: 400 },
        )
      }
      const params = new URLSearchParams()
      if (name) params.set('name', name)
      if (address) {
        if (address.line1) params.set('address[line1]', address.line1)
        if (address.line2) params.set('address[line2]', address.line2)
        if (address.city) params.set('address[city]', address.city)
        if (address.state) params.set('address[state]', address.state)
        if (address.postalCode) {
          params.set('address[postal_code]', address.postalCode)
        }
        params.set('address[country]', address.country as string)
      }
      if (![...params.keys()].length) {
        // Clearing here does NOT clear Stripe's copy — the same rule
        // `/api/orgs/settings` follows, and for the same reason: that address
        // is what an active subscription's invoices carry and what
        // `automatic_tax` computes from, so wiping it would put an
        // addressless invoice in front of a tax authority. Emptying a form is
        // not a request to do that.
        return Response.json(
          {
            error:
              'Enter a billing address, or leave it as it is — clearing the ' +
              'form does not remove the address your invoices are issued to.',
          },
          { status: 400 },
        )
      }
      const result = await stripeRequest(
        secretKey as string,
        'POST',
        `customers/${encodeURIComponent(customerId)}`,
        params,
      )
      if (!result.ok) {
        console.error(
          '[billing/profile] billing address update failed',
          orgId,
          loggableStripeError(result.payload),
        )
        return Response.json(
          {
            error:
              result.payload?.error?.message ??
              'Stripe rejected the billing address',
          },
          { status: 400 },
        )
      }
      // Mirror onto the org's own contact address, which is the field
      // `/api/orgs/settings` pushes to Stripe on every profile save. Writing
      // Stripe alone would leave that field stale, and the next unrelated
      // profile save would push the OLD address straight back over the one
      // just set here.
      await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .set(
          {
            contact: { address },
            billing: {
              ...stripeAddressDivergence({ pushed: true, pushOk: true }),
              addressCheckedAt:
                firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Updated the billing address',
        { type: 'org', id: orgId },
      )
      return await readProfile(secretKey as string, orgId, customerId)
    }

    if (action === 'add-tax-id') {
      const type = clean(body?.taxIdType, 40)
      const value = clean(body?.taxIdValue, 60)
      if (!type || !value) {
        return Response.json(
          { error: 'Choose a tax ID type and enter its value' },
          { status: 400 },
        )
      }
      // Deliberately NOT validated against a per-country regex here. Stripe
      // validates every type it accepts, its rules change with the law, and a
      // second validator of ours would eventually refuse an identifier Stripe
      // would have taken — which is a customer unable to put their VAT number
      // on their own invoice. The type is not pre-checked against the
      // generated list either: that list is a picker's source, and if it ever
      // trails Stripe the customer should still be able to save a type Stripe
      // accepts. Stripe is the validator; we report its verdict.
      const result = await stripeRequest(
        secretKey as string,
        'POST',
        `customers/${encodeURIComponent(customerId)}/tax_ids`,
        new URLSearchParams({ type, value }),
      )
      if (!result.ok) {
        console.error(
          '[billing/profile] tax id rejected',
          orgId,
          loggableStripeError(result.payload),
        )
        return Response.json(
          {
            // Stripe's OWN sentence. It names the format it expected for the
            // chosen type, which is more useful than anything this route
            // could invent and is the only copy that stays true as the rules
            // change.
            error:
              result.payload?.error?.message ??
              'Stripe rejected that tax ID. Check the type and the value.',
            stripeCode: result.payload?.error?.code ?? null,
          },
          { status: 400 },
        )
      }
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        // The TYPE, never the value. An activity entry is readable by every
        // org admin and is exported; the identifier itself lives in Stripe.
        `Added a tax ID (${taxIdTypeLabel(type)})`,
        { type: 'org', id: orgId },
      )
      return await readProfile(secretKey as string, orgId, customerId)
    }

    if (action === 'remove-tax-id') {
      const taxIdId = clean(body?.taxIdId, 60)
      if (!taxIdId) {
        return Response.json({ error: 'Missing tax ID' }, { status: 400 })
      }
      const result = await stripeRequest(
        secretKey as string,
        'DELETE',
        `customers/${encodeURIComponent(customerId)}/tax_ids/${encodeURIComponent(taxIdId)}`,
      )
      if (!result.ok) {
        console.error(
          '[billing/profile] tax id removal failed',
          orgId,
          loggableStripeError(result.payload),
        )
        return Response.json(
          { error: result.payload?.error?.message ?? 'Could not remove that tax ID' },
          { status: 400 },
        )
      }
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Removed a tax ID',
        { type: 'org', id: orgId },
      )
      return await readProfile(secretKey as string, orgId, customerId)
    }

    if (action === 'create-setup-intent') {
      // The ONLY thing this route does for card entry: mint a SetupIntent and
      // hand back its client secret. Stripe Elements mounts that secret and
      // renders its fields — each one its own cross-origin iframe on Stripe's
      // domain — inside our card. The card number is typed into Stripe's
      // document and posted to Stripe. It is never in our DOM, never in a
      // request to this server, and never in a log.
      //
      // A SetupIntent rather than the `mode: setup` Checkout session this
      // replaced: a session renders Stripe's whole checkout UI, which is a
      // second visual language for what is a settings action. The intent
      // gives the same iframe guarantee with fields we can style to match the
      // inputs beside them.
      //
      // `usage: off_session` is load-bearing. The card is being saved to be
      // charged on renewals with nobody present, and telling Stripe so at
      // setup time is what lets the issuer authenticate it NOW instead of
      // declining the first unattended renewal months later.
      const params = new URLSearchParams({
        customer: customerId,
        usage: 'off_session',
        'automatic_payment_methods[enabled]': 'true',
        'metadata[orgId]': orgId,
      })
      const result = await stripeRequest(
        secretKey as string,
        'POST',
        'setup_intents',
        params,
      )
      if (!result.ok || !result.payload?.client_secret) {
        console.error(
          '[billing/profile] setup intent failed',
          orgId,
          loggableStripeError(result.payload),
        )
        return Response.json(
          { error: 'Could not open the card form. Nothing has changed.' },
          { status: 502 },
        )
      }
      return Response.json(
        { clientSecret: result.payload.client_secret },
        { status: 200 },
      )
    }

    if (action === 'finalize-card-setup') {
      // The browser has confirmed a SetupIntent and hands back its id. Two
      // things happen here, and both are done SERVER-SIDE against Stripe
      // rather than on the browser's word:
      //
      //  1. the intent is re-read and checked — it must have succeeded, and it
      //     must belong to THIS org's customer. A client that supplied some
      //     other customer's intent id would otherwise attach a stranger's
      //     card to this workspace's billing.
      //  2. a FIRST card is made the default. Stripe does not do this on its
      //     own, and a customer whose only card is not the default has a
      //     subscription that renews against nothing — which surfaces weeks
      //     later as a failed payment rather than now as a visible mistake.
      const setupIntentId = clean(body?.setupIntentId, 80)
      if (!setupIntentId) {
        return Response.json({ error: 'Missing setup intent' }, { status: 400 })
      }
      const intent = await stripeRequest(
        secretKey as string,
        'GET',
        `setup_intents/${encodeURIComponent(setupIntentId)}`,
      )
      const intentCustomer =
        typeof intent.payload?.customer === 'string'
          ? intent.payload.customer
          : (intent.payload?.customer?.id ?? null)
      if (
        !intent.ok ||
        intent.payload?.status !== 'succeeded' ||
        intentCustomer !== customerId
      ) {
        console.error(
          '[billing/profile] setup intent not usable',
          orgId,
          // Never the intent id or the customer id — only WHY it was refused.
          {
            ok: intent.ok,
            status: intent.payload?.status ?? null,
            customerMatches: intentCustomer === customerId,
          },
        )
        return Response.json(
          { error: 'That card could not be saved. Nothing has changed.' },
          { status: 400 },
        )
      }
      const paymentMethodId =
        typeof intent.payload?.payment_method === 'string'
          ? intent.payload.payment_method
          : (intent.payload?.payment_method?.id ?? null)
      const customer = await stripeRequest(
        secretKey as string,
        'GET',
        `customers/${encodeURIComponent(customerId)}`,
      )
      const existingDefault =
        customer.payload?.invoice_settings?.default_payment_method ?? null
      if (paymentMethodId && !existingDefault) {
        await stripeRequest(
          secretKey as string,
          'POST',
          `customers/${encodeURIComponent(customerId)}`,
          new URLSearchParams({
            'invoice_settings[default_payment_method]': paymentMethodId,
          }),
        )
      }
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Added a payment method',
        { type: 'org', id: orgId },
      )
      return await readProfile(secretKey as string, orgId, customerId)
    }

    if (action === 'set-default-card') {
      const paymentMethodId = clean(body?.paymentMethodId, 60)
      if (!paymentMethodId) {
        return Response.json({ error: 'Missing payment method' }, { status: 400 })
      }
      const result = await stripeRequest(
        secretKey as string,
        'POST',
        `customers/${encodeURIComponent(customerId)}`,
        new URLSearchParams({
          'invoice_settings[default_payment_method]': paymentMethodId,
        }),
      )
      if (!result.ok) {
        console.error(
          '[billing/profile] default card update failed',
          orgId,
          loggableStripeError(result.payload),
        )
        return Response.json(
          { error: result.payload?.error?.message ?? 'Could not set the default card' },
          { status: 400 },
        )
      }
      // The customer default is NOT what a live subscription bills against.
      // Checkout writes the method onto the SUBSCRIPTION, and a subscription
      // carrying its own `default_payment_method` ignores the customer's —
      // which is the whole reason the staff card and the Stripe dashboard
      // once disagreed (AGL-940). Setting only `invoice_settings` here would
      // show the customer a new default and keep charging the old card.
      const subscriptions = await stripeRequest(
        secretKey as string,
        'GET',
        `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`,
      )
      const rows = Array.isArray(subscriptions.payload?.data)
        ? subscriptions.payload.data
        : []
      for (const subscription of rows) {
        if (!LIVE_SUBSCRIPTION_STATUSES.includes(String(subscription?.status))) {
          continue
        }
        await stripeRequest(
          secretKey as string,
          'POST',
          `subscriptions/${encodeURIComponent(String(subscription.id))}`,
          new URLSearchParams({ default_payment_method: paymentMethodId }),
        )
      }
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Changed the default payment method',
        { type: 'org', id: orgId },
      )
      return await readProfile(secretKey as string, orgId, customerId)
    }

    if (action === 'remove-card') {
      const paymentMethodId = clean(body?.paymentMethodId, 60)
      if (!paymentMethodId) {
        return Response.json({ error: 'Missing payment method' }, { status: 400 })
      }
      const [methods, subscriptions] = await Promise.all([
        stripeRequest(
          secretKey as string,
          'GET',
          `customers/${encodeURIComponent(customerId)}/payment_methods?limit=20`,
        ),
        stripeRequest(
          secretKey as string,
          'GET',
          `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`,
        ),
      ])
      const remaining = (
        Array.isArray(methods.payload?.data) ? methods.payload.data : []
      ).filter((pm: any) => String(pm?.id) !== paymentMethodId)
      const hasLiveSubscription = (
        Array.isArray(subscriptions.payload?.data)
          ? subscriptions.payload.data
          : []
      ).some((subscription: any) =>
        LIVE_SUBSCRIPTION_STATUSES.includes(String(subscription?.status)),
      )
      if (!remaining.length && hasLiveSubscription) {
        // Detaching the last card under a live subscription does not cancel
        // anything — it just makes the next renewal fail, days or weeks
        // later, with a dunning email as the first sign. Refuse it here and
        // say what to do instead; the customer who wants out cancels the
        // subscription, which is a different button with different copy.
        return Response.json(
          {
            error:
              'This is the only card on file and your subscription renews ' +
              'against it. Add another card first, or cancel the ' +
              'subscription if you meant to stop paying.',
          },
          { status: 409 },
        )
      }
      const result = await stripeRequest(
        secretKey as string,
        'POST',
        `payment_methods/${encodeURIComponent(paymentMethodId)}/detach`,
      )
      if (!result.ok) {
        console.error(
          '[billing/profile] card removal failed',
          orgId,
          loggableStripeError(result.payload),
        )
        return Response.json(
          { error: result.payload?.error?.message ?? 'Could not remove that card' },
          { status: 400 },
        )
      }
      void logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Removed a payment method',
        { type: 'org', id: orgId },
      )
      return await readProfile(secretKey as string, orgId, customerId)
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('[billing/profile]', error)
    return Response.json({ error: 'Billing profile request failed' }, { status: 500 })
  }
}

/**
 * One read of everything the four cards render.
 *
 * Every mutation above returns this rather than its own narrow payload, so a
 * save never leaves one card holding a stale copy of what another card
 * changed — and so the page never has to guess when to refetch.
 */
async function readProfile(
  secretKey: string,
  orgId: string,
  customerId: string,
): Promise<Response> {
  const [customer, taxIds, methods, subscriptions] = await Promise.all([
    stripeRequest(secretKey, 'GET', `customers/${encodeURIComponent(customerId)}`),
    stripeRequest(
      secretKey,
      'GET',
      `customers/${encodeURIComponent(customerId)}/tax_ids?limit=20`,
    ),
    stripeRequest(
      secretKey,
      'GET',
      `customers/${encodeURIComponent(customerId)}/payment_methods?limit=20`,
    ),
    stripeRequest(
      secretKey,
      'GET',
      `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20&expand[]=data.default_payment_method`,
    ),
  ])
  if (!customer.ok) {
    console.error(
      '[billing/profile] customer read failed',
      orgId,
      loggableStripeError(customer.payload),
    )
    return Response.json(
      { error: 'Could not read your billing details' },
      { status: 502 },
    )
  }
  const subscriptionRows = Array.isArray(subscriptions.payload?.data)
    ? subscriptions.payload.data
    : []
  const billing = subscriptionRows.find((subscription: any) =>
    LIVE_SUBSCRIPTION_STATUSES.includes(String(subscription?.status)),
  )
  // The subscription's own default outranks the customer's: it is the one
  // Stripe actually charges, and Checkout routinely sets it while leaving
  // `invoice_settings` empty (AGL-940).
  const subscriptionDefault =
    typeof billing?.default_payment_method === 'string'
      ? billing.default_payment_method
      : (billing?.default_payment_method?.id ?? null)
  const customerDefault =
    typeof customer.payload?.invoice_settings?.default_payment_method === 'string'
      ? customer.payload.invoice_settings.default_payment_method
      : (customer.payload?.invoice_settings?.default_payment_method?.id ?? null)
  const address = customer.payload?.address ?? null
  return Response.json(
    {
      configured: true,
      customer: {
        // The customer id is deliberately absent. Nothing on the page needs
        // it, and it is the manager-gated key AGL-1028 moved off the org doc.
        email: customer.payload?.email ?? null,
        name: customer.payload?.name ?? null,
        address: address
          ? {
              line1: address.line1 ?? '',
              line2: address.line2 ?? '',
              city: address.city ?? '',
              state: address.state ?? '',
              postalCode: address.postal_code ?? '',
              country: address.country ?? '',
            }
          : null,
      },
      taxIds: (Array.isArray(taxIds.payload?.data) ? taxIds.payload.data : []).map(
        (taxId: any) => ({
          id: taxId.id,
          type: taxId.type ?? null,
          value: taxId.value ?? null,
          // Stripe verifies some types asynchronously; `verification.status`
          // is `pending`/`verified`/`unverified`, and a customer whose number
          // came back unverified needs to see that rather than a green tick.
          verification: taxId.verification?.status ?? null,
        }),
      ),
      paymentMethods: (
        Array.isArray(methods.payload?.data) ? methods.payload.data : []
      ).map((pm: any) => ({
        id: pm.id,
        // Shaped by the shared describer rather than by reading `.card`:
        // Link, Amazon Pay, Cash App and Klarna have no `.card` at all, and
        // reading it is why such a method once rendered as "No payment
        // method" (AGL-940).
        ...describeStripePaymentMethod(pm),
        isDefault:
          pm.id === (subscriptionDefault ?? customerDefault),
      })),
      hasBillableSubscription: Boolean(billing),
    },
    { status: 200 },
  )
}

export const dynamic = 'force-dynamic'
export { handler as POST }
