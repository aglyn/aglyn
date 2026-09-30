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

import type { PaymentMode, PaymentProvider, PaymentProviderEvent } from './payment-provider'

/**
 * The Stripe Connect adapter behind the payment-provider contract
 * (`payment-provider.ts`): a tenant's merchant account is a Stripe Connect
 * account, charged and paid out through the platform's Stripe key.
 *
 * This module is the part that is Stripe's — which mode a key states, how the
 * API is asked, which webhook events describe a connected account and where
 * each one keeps the account id. What an event WRITES lives in the two modules
 * it dispatches to, loaded only when such an event arrives, so the money doors
 * that import the contract for its readiness rule load no Firebase.
 *
 * ## Whether a stored Connect linkage can actually take money HERE (AGL-2471)
 *
 * THE DEFECT. Production Firestore held three Connect linkages and all three
 * named TEST-mode accounts. One — `profiles/7AVEMtDa…`, `stripeAccountId:
 * acct_1TulDeRbL3B9Ioqz` — also carried `stripeChargesEnabled: true`, which
 * was the entire payments-readiness test every money door made:
 *
 *     if (!accountId || !ownerProfile.get('stripeChargesEnabled')) …
 *
 * So three storefronts presented as payments-ready, minted a LIVE Checkout
 * session with a TEST-mode `payment_intent_data[transfer_data][destination]`,
 * and were refused by Stripe as a generic 502 at the shopper's checkout. A
 * merchant told they are ready to take money, who silently cannot.
 *
 * WHY THE ACCOUNT ID IS NOT THE EVIDENCE. `acct_1TulDeRbL3B9Ioqz` is a real
 * production value naming a TEST account. Stripe's account ids carry no mode
 * marker — live and test ids are the same shape — so no amount of reading the
 * string can tell them apart. What DOES tell them apart is Stripe itself:
 * retrieving that id with the live key answers
 *
 *     400 The account acct_1TulDeRbL3B9Ioqz was a test account created with a
 *         testmode key, and therefore can only be used with testmode keys.
 *
 * The Account object, notably, has NO `livemode` field of its own (verified
 * against the live API: the payload carries `charges_enabled`,
 * `payouts_enabled`, `capabilities` and no `livemode`). So the mode is
 * recorded at the two moments Stripe does state it:
 *
 *   1. `account.updated` — the EVENT carries `livemode`, and it is Stripe's
 *      own statement about the account the event is describing;
 *   2. onboarding — the account was just created or retrieved successfully
 *      with the platform key, and Stripe hard-refuses cross-mode retrieval
 *      (above), so the account's mode IS the key's mode; the key's mode is
 *      then confirmed against the API via `resolvePlatformStripeMode`.
 *
 * The profile field is `stripeAccountLivemode`, and the rule that reads it —
 * refused on a live deployment when absent, refused in both directions when
 * it disagrees — is the contract's `merchantAccountReadiness`, which says why
 * it is asymmetric.
 *
 * WHAT IS SNIFFED, AND WHY THAT ONE IS FAIR. The SECRET KEY states its own
 * mode — `sk_live_`, `sk_test_`, `rk_live_`, `rk_test_` — and that is a
 * documented, stable Stripe invariant, unlike the account id. It is used only
 * to answer "which mode is this deployment", never "which mode is this
 * account", and even there `resolvePlatformStripeMode` prefers the API.
 *
 * HOW IT GOT THERE. A developer machine runs against PRODUCTION Firestore
 * (`FIREBASE_PROJECT_ID=aglyn-main` in every dev env file) while
 * `apps/console/.env.development.local` sets `STRIPE_SECRET_KEY` to the
 * `sk_test_` key by deliberate policy (AGL-1137: localhost must never touch
 * live Stripe). The connect route then creates a test-mode Express account
 * and writes it into the production database. Nothing about that is going to
 * change — the split key is the right call — so the gate has to be the thing
 * that notices.
 */

/**
 * The mode a Stripe secret key states about itself, or `undefined` when the
 * string is not a Stripe secret key.
 *
 * Deliberately narrow: it matches `sk_`/`rk_` followed by `live`/`test`, and
 * refuses everything else rather than guessing. Handing it an `acct_…` id
 * returns `undefined` — the whole point is that account ids say nothing.
 */
export function platformStripeMode(
  key: string | undefined = process.env.STRIPE_SECRET_KEY,
): PaymentMode | undefined {
  const match = /^[sr]k_(live|test)_/.exec(String(key ?? '').trim())
  return match ? (match[1] as PaymentMode) : undefined
}

/**
 * The platform's mode, asked of Stripe and only then of the key.
 *
 * `GET /v1/balance` is a singleton that carries `livemode`, so it states the
 * mode of whatever key made the call — no object has to be created to find
 * out. The key prefix is the fallback for a restricted key that cannot read
 * balance; without it, a self-hosted install with a scoped key could not
 * finish onboarding at all.
 */
export async function resolvePlatformStripeMode(
  key: string | undefined = process.env.STRIPE_SECRET_KEY,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentMode | undefined> {
  const fromKey = platformStripeMode(key)
  if (!key) return fromKey
  try {
    const response = await fetchImpl('https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })
    if (response.ok) {
      const payload = await response.json()
      if (typeof payload?.livemode === 'boolean') {
        return payload.livemode ? 'live' : 'test'
      }
    }
  } catch {
    // Network or transport failure — fall through to the key, which is the
    // same answer we would have recorded before this existed.
  }
  return fromKey
}

/**
 * A Stripe webhook event about a connected account, applied to the profiles in
 * `collection` that store it — the contract's `applyAccountEvent`.
 *
 * Three events describe a connected account, and each keeps the account id
 * somewhere different:
 *
 *  - `account.updated` — its readiness changed (AGL-1997). The object IS the
 *    Account, and the EVENT carries `livemode` (AGL-2471): the Account object
 *    has no such field, and the event's is what lets a linkage whose mode was
 *    never recorded heal itself instead of staying refused forever.
 *  - `payout.failed` / `transfer.failed` — money headed for the account never
 *    landed. A payout is the connected account's balance failing to reach its
 *    bank, so its account id is `event.account`: the Payout's own
 *    `destination` names the BANK. A transfer is the platform's balance
 *    failing to reach the connected account, a platform event whose
 *    `destination` IS the account. Recorded and surfaced, never retried:
 *    Stripe runs its own retry schedule, and a second transfer against an
 *    account that has just refused one is how a duplicate lands.
 *  - `payout.paid` — a later payout landed, which retires the warning the
 *    failure left on the profile. The history is kept.
 *
 * Every other event answers `false` without loading anything. A write that
 * fails throws, and the webhook's 500 earns the redelivery; every write
 * mirrors current state or is keyed by Stripe's id, so a redelivery converges.
 */
export async function applyStripeConnectAccountEvent(
  collection: string,
  delivered: PaymentProviderEvent,
): Promise<boolean> {
  const type = delivered?.type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const object = delivered?.object as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = delivered?.event as any
  if (type === 'account.updated') {
    const { syncConnectAccountStatus } = await import(
      './payment-provider-stripe-connect-status'
    )
    await syncConnectAccountStatus(collection, object, event?.livemode)
    return true
  }
  if (type === 'payout.failed' || type === 'transfer.failed') {
    const failedAccountId =
      type === 'payout.failed'
        ? String(event?.account ?? '')
        : String(object?.destination?.id ?? object?.destination ?? '')
    const { recordConnectPayoutFailure } = await import(
      './payment-provider-stripe-connect-payouts'
    )
    await recordConnectPayoutFailure(collection, {
      kind: type === 'payout.failed' ? 'payout' : 'transfer',
      object,
      accountId: failedAccountId,
      livemode: event?.livemode,
    })
    return true
  }
  if (type === 'payout.paid') {
    const { clearConnectPayoutFailure } = await import(
      './payment-provider-stripe-connect-payouts'
    )
    await clearConnectPayoutFailure(collection, String(event?.account ?? ''))
    return true
  }
  return false
}

/** The adapter the contract returns. */
export const STRIPE_CONNECT_PAYMENT_PROVIDER: PaymentProvider = {
  id: 'stripe-connect',
  // Called with no argument, so the key is read when asked — not when this
  // module was first evaluated.
  platformMode: () => platformStripeMode(),
  resolvePlatformMode: () => resolvePlatformStripeMode(),
  applyAccountEvent: applyStripeConnectAccountEvent,
}
