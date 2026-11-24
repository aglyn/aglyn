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
  getOrgForHost,
  isServerReleaseFlagOnForOrg,
} from '@aglyn/tenant-data-admin'
import {
  accountChargeModel,
  DIRECT_CHARGE_ACCOUNT_PARAMS,
  merchantAccountInOtherMode,
  merchantAccountReplacement,
  merchantRequirementsSummary,
  paymentProvider,
  PREVIOUS_MERCHANT_ACCOUNTS_FIELD,
} from '@aglyn/tenant-data-admin/server/payment-provider'
import { buildRoute, Route, type PluginApiHandler } from '@aglyn/aglyn/server'
import { CONNECT_RETURN_PARAM } from '../model/payments-setup-status'
import {
  missingBusinessProfilePrefill,
  stripeAccountPrefill,
  type StripePrefillHost,
} from './connect-prefill'

/** A Stripe refusal, carrying the HTTP status so a caller can tell a bad parameter from an outage. */
class StripeRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function stripe(path: string, params?: URLSearchParams) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(params && {
        'Content-Type': 'application/x-www-form-urlencoded',
      }),
    },
    ...(params && { body: params.toString() }),
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new StripeRequestError(
      payload?.error?.message ?? `Stripe ${path} failed`,
      response.status,
    )
  }
  return payload
}

/**
 * Merchant payments onboarding (AGL-284): a Stripe account for storefront
 * selling, the store's own full Stripe account for every new setup
 * (`DIRECT_CHARGE_ACCOUNT_PARAMS`, AGL-4245 for the prefill). Same account
 * storage the checkout reads
 * (`profiles/{ownerUid}.stripeAccountId`, AGL-46) but without the
 * marketplace-profile prerequisite — commerce merchants aren't necessarily
 * publishers. Only the owning org's owner may onboard (payouts land on
 * their account). 501 without Stripe env.
 */
export const connectHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res
      .status(501)
      .json({ error: 'Payments are not configured (STRIPE_SECRET_KEY).' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const ownerOrg = await getOrgForHost(hostId)
    const ownerUid = ownerOrg?.org?.ownerUid
    if (!ownerUid) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    if (String(ownerUid) !== decoded.uid) {
      return res
        .status(403)
        .json({ error: 'Only the organization owner can set up payments' })
    }
    const firestore = firebaseAdmin.app().firestore()
    const profileRef = firestore.collection('profiles').doc(decoded.uid)
    // The site's platform SUBDOMAIN, read once: the return links below need
    // it, and so does the prefill's site address.
    let subdomainRead: Promise<string | undefined> | undefined
    const hostSubdomain = () =>
      (subdomainRead ??= firestore
        .collection('hostIndex')
        .doc(hostId)
        .get()
        .then((index) => index.get('subdomain') as string | undefined))
    // WHAT THE OWNER ALREADY TOLD US (AGL-4245): the site's business details
    // and public address as Stripe `business_profile` fields, so Stripe's form
    // opens filled in. Read from the site the owner is setting up from; a read
    // that fails is no prefill, never a failed setup.
    const readPrefill = async (): Promise<Record<string, string>> => {
      try {
        const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
        return stripeAccountPrefill(
          (hostSnapshot?.exists ? hostSnapshot.data() : null) as StripePrefillHost | null,
          { subdomain: await hostSubdomain() },
        )
      } catch (error) {
        console.warn('[AGL-4245] Stripe prefill skipped: the site could not be read', error)
        return {}
      }
    }
    const profileSnapshot = await profileRef.get()

    // This deployment's Stripe mode, asked first: whether the stored account
    // can be used here at all depends on it (AGL-2471).
    const platformMode = await paymentProvider().resolvePlatformMode()
    let accountId = profileSnapshot.get('stripeAccountId') as
      | string
      | undefined
    // AN ACCOUNT FROM THE OTHER STRIPE MODE IS REPLACED, NEVER RESUMED.
    //
    // A test account on a live deployment (a localhost session onboarded with
    // the test key while writing production Firestore, see
    // `payment-provider-stripe-connect.ts`) can never take a live payment, and
    // a live key cannot even read it: Stripe refuses the retrieve. This route
    // used to retrieve it anyway, so the owner pressing "Set up payments" got
    // "Payment setup failed" every time and the store could not sell. Two
    // ways in:
    //
    //  - `mode-mismatch`: the profile RECORDS the other mode. Not read at all,
    //    since the read cannot succeed.
    //  - `mode-unverified` (and any recorded mode Stripe contradicts): the
    //    account is read, and a read that succeeds is the proof it is in this
    //    mode, recorded below exactly as before. Only Stripe's own cross-mode
    //    refusal retires it; any other failure is the 502 it always was.
    //
    // A new account is then created in this mode, of the shape every new
    // setup takes (direct charges, below), and the replaced id is kept on the
    // profile (`merchantAccountReplacement`).
    let account: any
    let replacedAccountId: string | undefined
    if (
      accountId &&
      merchantAccountInOtherMode(
        profileSnapshot.get('stripeAccountLivemode'),
        platformMode,
      )
    ) {
      replacedAccountId = accountId
    } else if (accountId) {
      try {
        account = await stripe(`accounts/${accountId}`)
      } catch (error) {
        if (!paymentProvider().refusedAsOtherMode((error as Error)?.message)) {
          throw error
        }
        replacedAccountId = accountId
      }
      // RE-ENTRY BEFORE ONBOARDING IS FINISHED (AGL-4245). `business_profile`
      // stays writable by the platform on this account shape after the first
      // onboarding link, so an owner who left Stripe's form part way gets the
      // site's details on the way back in. Only the fields the account does
      // not hold yet, so nothing typed in Stripe is overwritten, and any
      // failure is logged and setup carries on.
      if (account && account.details_submitted !== true) {
        const missing = missingBusinessProfilePrefill(await readPrefill(), account)
        if (Object.keys(missing).length) {
          try {
            account = await stripe(`accounts/${accountId}`, new URLSearchParams(missing))
          } catch (error) {
            console.warn(
              `[AGL-4245] Stripe refused the business profile update for ` +
                `profiles/${decoded.uid} (${(error as Error)?.message}); ` +
                `continuing setup without it.`,
            )
          }
        }
      }
    }
    if (!accountId || replacedAccountId) {
      // The seller's OWN Stripe account (direct charges): Stripe bills it,
      // underwrites it and gives it the full Stripe Dashboard, so the seller
      // is the merchant of record on every site sale and can refund, answer
      // a dispute and manage tax registrations there. See
      // `DIRECT_CHARGE_ACCOUNT_PARAMS`. `release_direct_charges` is on for
      // every store (default on, and on in Remote Config), so this is the
      // account every new setup gets. The flag is still read so it can be
      // turned off: off, or unreadable, gives the platform-managed Express
      // account and its destination charges, the shape stores had before.
      // The shape cannot be changed once the account exists, so this is the
      // one place it is decided.
      let ownsAccount = false
      try {
        ownsAccount = await isServerReleaseFlagOnForOrg(
          'release_direct_charges',
          String(ownerOrg?.org?.id ?? ownerOrg?.orgId ?? '') || null,
        )
      } catch {
        ownsAccount = false
      }
      // Everything the account is created with except the prefill: the
      // shape, the capabilities and the bookkeeping. Kept apart so a create
      // Stripe refuses over a prefill field can be sent again without it.
      const accountParams: Record<string, string> = {
        ...(ownsAccount ? DIRECT_CHARGE_ACCOUNT_PARAMS : { type: 'express' }),
        // Explicit capabilities (AGL-1994): `card_payments` for the
        // charges, and `transfers` because a destination charge (every sale
        // on an Express account, and the register and Tap to Pay on one)
        // requires the destination to hold it.
        'capabilities[card_payments][requested]': 'true',
        'capabilities[transfers][requested]': 'true',
        'metadata[profileId]': decoded.uid,
        'metadata[purpose]': 'commerce',
        ...(replacedAccountId
          ? { 'metadata[replacesAccount]': replacedAccountId }
          : {}),
        ...(decoded.email ? { email: decoded.email } : {}),
      }
      const prefill = await readPrefill()
      let created: any
      try {
        created = await stripe(
          'accounts',
          new URLSearchParams({ ...prefill, ...accountParams }),
        )
      } catch (error) {
        // A prefill field Stripe will not take (a phone it cannot parse, a
        // site address it will not accept) must not stop setup: the owner can type
        // it in Stripe's own form. Only a 400 with a prefill sent is retried;
        // anything else is the 502 it always was.
        if (
          !Object.keys(prefill).length ||
          !(error instanceof StripeRequestError) ||
          error.status !== 400
        ) {
          throw error
        }
        console.warn(
          `[AGL-4245] Stripe refused the account prefill for ` +
            `profiles/${decoded.uid} (${error.message}); creating the ` +
            `account without it.`,
        )
        created = await stripe('accounts', new URLSearchParams(accountParams))
      }
      accountId = String(created.id)
      if (replacedAccountId) {
        console.warn(
          `[AGL-2471] Replacing Stripe account ${replacedAccountId} on ` +
            `profiles/${decoded.uid}: it belongs to the other Stripe mode ` +
            `from this ${platformMode ?? 'unknown'}-mode deployment. New ` +
            `account ${accountId}.`,
        )
        await profileRef.set(
          merchantAccountReplacement({
            previousAccountIds: profileSnapshot.get(
              PREVIOUS_MERCHANT_ACCOUNTS_FIELD,
            ),
            replacedAccountId,
            newAccountId: accountId,
          }),
          { merge: true },
        )
      } else {
        await profileRef.set(
          { stripeAccountId: accountId, stripeChargesEnabled: false },
          { merge: true },
        )
      }
      account = await stripe(`accounts/${accountId}`)
    }

    const chargesEnabled = Boolean(account?.charges_enabled)
    // WHICH STRIPE WORLD THIS ACCOUNT LIVES IN (AGL-2471).
    //
    // Three production linkages named TEST-mode accounts, one of them with
    // `stripeChargesEnabled: true`, so its storefronts read as payments-ready
    // and could not take a payment. Nothing recorded the mode, and nothing
    // could recover it later: the Account object carries no `livemode` field
    // and an `acct_…` id is the same shape in both worlds.
    //
    // The retrieve above IS the proof. Stripe refuses cross-mode account
    // access outright — "was a test account created with a testmode key" —
    // so an account this key just fetched is in this key's mode, and the
    // payment provider asks Stripe (`/v1/balance.livemode`) what that mode is
    // rather than reading the key string (`platformMode`, asked first).
    // Payout readiness rides along (AGL-1994): the sale gate stays on
    // charges_enabled — that is what Stripe checks at charge time — but
    // charges-yes/payouts-no was invisible to the storefront, because
    // commerce wrote only `stripeChargesEnabled`. Recording
    // `payouts_enabled` is what lets a console surface warn a merchant
    // BEFORE the first sale strands funds in a Connect account that
    // cannot pay them out.
    const payoutsEnabled = Boolean(account?.payouts_enabled)
    // Which charge shape this account takes, read off the account itself
    // every time, so a re-onboarded seller can never inherit the last
    // account's answer.
    const chargeModel = accountChargeModel(account)
    // What Stripe still needs, read off the same account (AGL-4245): the
    // Payments card warns from it before a deadline stops anything.
    const requirements = merchantRequirementsSummary(account)
    const needsDetails = Boolean(
      requirements &&
        (requirements.stripeRequirementsDueCount > 0 ||
          requirements.stripeRequirementsPastDueCount > 0),
    )
    await profileRef.set(
      {
        ...(requirements ?? {}),
        stripeChargesEnabled: chargesEnabled,
        stripeChargeModel: chargeModel,
        stripePayoutsEnabled: payoutsEnabled,
        // ALWAYS written, and `null` when Stripe would not say (AGL-2471).
        // Writing unconditionally is what makes re-onboarding safe: a fresh
        // `stripeAccountId` on a document that still carried the PREVIOUS
        // account's verdict would otherwise inherit it. `null` is not a
        // boolean, so the gate reads it as `mode-unverified` and refuses —
        // never a fabricated `true`.
        stripeAccountLivemode: platformMode ? platformMode === 'live' : null,
      },
      { merge: true },
    )
    const origin = req.headers.origin ?? `https://${req.headers.host}`
    // Stripe bakes these into the onboarding link, so they have to be real
    // console paths. They were `/{hostDocId}/products` — the pre-AGL-621/622
    // shape — so finishing Connect onboarding dropped the seller on a 404
    // (AGL-685). Console products is the plugin route under the org slug and
    // the host SUBDOMAIN, both of which have to be resolved here; the client
    // hook (useConsoleHostRoute) is not available to server code.
    const subdomain = await hostSubdomain()
    const orgSlug = ownerOrg?.org?.slug as string | undefined
    // No slug/subdomain means no route to send them to; Stripe requires
    // both URLs, so fall back to the origin root rather than a fabricated
    // path that 404s.
    //
    // The PAYMENTS section, not bare `/products` (AGL-4245): the bare hub
    // redirects to the first section, Catalog, where nothing read the
    // parameter, so an owner back from Stripe saw no result at all.
    const paymentsUrl =
      orgSlug && subdomain
        ? `${origin}${buildRoute(Route.HOST_PLUGIN, {
            orgSlug,
            host: subdomain,
            pluginSlug: 'products',
          })}/payments`
        : origin
    const onboardingLink = () =>
      stripe(
        'account_links',
        new URLSearchParams({
          account: accountId as string,
          type: 'account_onboarding',
          refresh_url: `${paymentsUrl}?${CONNECT_RETURN_PARAM}=refresh`,
          return_url: `${paymentsUrl}?${CONNECT_RETURN_PARAM}=done`,
        }),
      )
    // A CONNECTED MERCHANT STILL NEEDS A DOOR INTO STRIPE.
    //
    // This route used to return here the moment `charges_enabled` was true,
    // with a status and no link of any kind, and both console cards read the
    // `chargesEnabled` flag before they ever looked for a url. So the one
    // state that most needs Stripe — charges on, payouts NOT released, funds
    // accumulating in a Connect account that cannot pay them out — offered a
    // button labelled "Finish payout setup in Stripe" that raised a toast and
    // went nowhere. An Express account has no password and no direct login, so
    // a link minted here is the merchant's ONLY way in; without one the money
    // is unreachable and no surface says why.
    if (chargesEnabled) {
      if (!payoutsEnabled) {
        // The remediation flow, which is what Stripe points an account with
        // outstanding requirements at. Failures are NOT swallowed: answering
        // 200 with no link is precisely the dead end being closed here, so a
        // mint that fails surfaces as the handler's 502 and the merchant is
        // told to try again rather than left pressing a dead button.
        const fix = await onboardingLink()
        return res.status(200).json({
          accountId,
          chargesEnabled: true,
          payoutsEnabled,
          needsDetails,
          url: fix.url,
        })
      }
      // Payouts flowing, and Stripe asking for more before a deadline
      // (AGL-4245): the same onboarding form fixes it, so the answer carries
      // its link beside the dashboard. The card follows it only when the
      // owner pressed "Continue setup"; a status check stays a status check.
      const fixUrl = needsDetails
        ? String((await onboardingLink())?.url ?? '') || undefined
        : undefined
      const detailsLink = {
        needsDetails,
        ...(fixUrl ? { url: fixUrl } : {}),
      }
      // Payouts are flowing, so this is the VIEW: balance, payout schedule,
      // and the reason a payout failed — none of which Aglyn records and none
      // of which the merchant could otherwise reach. Best-effort on purpose:
      // a login link is a convenience, and failing to mint one must never turn
      // a working status check into an error.
      let dashboardUrl: string | undefined
      if (chargeModel === 'direct') {
        // A full Stripe account signs in to Stripe itself; login links exist
        // only for Express accounts.
        return res.status(200).json({
          accountId,
          chargesEnabled: true,
          payoutsEnabled,
          ...detailsLink,
          dashboardUrl: 'https://dashboard.stripe.com/',
        })
      }
      try {
        const login = await stripe(
          `accounts/${accountId}/login_links`,
          new URLSearchParams(),
        )
        dashboardUrl = typeof login?.url === 'string' ? login.url : undefined
      } catch (error) {
        console.error('Stripe Express dashboard link failed', error)
      }
      return res.status(200).json({
        accountId,
        chargesEnabled: true,
        payoutsEnabled,
        ...detailsLink,
        ...(dashboardUrl ? { dashboardUrl } : {}),
      })
    }

    const link = await onboardingLink()
    return res
      .status(200)
      .json({ accountId, chargesEnabled: false, url: link.url })
  } catch (error) {
    console.error(error)
    return res.status(502).json({ error: 'Payment setup failed' })
  }
}
