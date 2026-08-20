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

/**
 * Whether a stored Connect linkage can actually take money HERE (AGL-2471).
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
 * WHY THE RULE IS ASYMMETRIC, AND NOT "REFUSE ANYTHING UNPROVEN". An absent
 * `stripeAccountLivemode` refuses only on a LIVE deployment. That is where
 * real money moves and where the defect was found, and a live deployment can
 * always re-establish the field: the merchant reconnects, or Stripe sends one
 * `account.updated`. Everywhere else — a test-key deployment, a developer
 * machine, a self-hosted install still in sandbox, the whole test suite — an
 * unverified linkage keeps the behaviour it had before, because no real money
 * can move there and Stripe enforces the mode boundary itself. Refusing
 * everywhere would have bought production nothing extra and broken every
 * non-production deployment.
 *
 * A PROVEN mismatch (`stripeAccountLivemode` recorded and disagreeing) is
 * refused in BOTH directions, because that costs nothing to detect and is
 * never right.
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

/** Which Stripe world a key or an account belongs to. */
export type StripeMode = 'live' | 'test'

/**
 * Why a stored linkage may not be charged against. Every value other than
 * `'ready'` is a refusal, and the mode ones are refusals the old two-field
 * test could not make.
 */
export type ConnectReadiness =
  /** Charge away. */
  | 'ready'
  /** No Connect account is stored at all — the onboarding call to action. */
  | 'not-connected'
  /** Stripe will not let this account take charges. */
  | 'charges-disabled'
  /**
   * The linkage predates AGL-2471 (or was written by something that did not
   * record mode), so its mode was never established — AND this deployment is
   * LIVE. This is the shape all three poisoned production records have.
   * The connect route and the `account.updated` sync both write the field, so
   * a genuine merchant self-heals on the next of either.
   */
  | 'mode-unverified'
  /** The account belongs to the OTHER Stripe world. The AGL-2471 defect. */
  | 'mode-mismatch'

export interface ConnectReadinessInput {
  /** `stripeAccountId` off the profile, whatever shape the document has. */
  accountId?: unknown
  /** `stripeChargesEnabled` off the profile. */
  chargesEnabled?: unknown
  /** `stripeAccountLivemode` off the profile — absent before AGL-2471. */
  accountLivemode?: unknown
  /** Defaults to the mode of `STRIPE_SECRET_KEY`. */
  platformMode?: StripeMode | undefined
}

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
): StripeMode | undefined {
  const match = /^[sr]k_(live|test)_/.exec(String(key ?? '').trim())
  return match ? (match[1] as StripeMode) : undefined
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
): Promise<StripeMode | undefined> {
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
 * Decides whether a stored Connect linkage may be charged against.
 *
 * Order matters: the two refusals that existed before AGL-2471 are asked
 * first, so an unconnected or restricted merchant still gets the answer they
 * always got, and only a linkage that WOULD have passed reaches the mode
 * question.
 */
export function connectReadiness(
  input: ConnectReadinessInput,
): ConnectReadiness {
  const accountId =
    typeof input.accountId === 'string' ? input.accountId.trim() : ''
  if (!accountId) return 'not-connected'
  if (input.chargesEnabled !== true) return 'charges-disabled'
  const platformMode =
    'platformMode' in input ? input.platformMode : platformStripeMode()
  // Three-valued on purpose, exactly as AGL-1997 reads `payoutsEnabled`: only
  // a literal boolean is a recorded answer. A string `'true'` or a `1` is a
  // field somebody else wrote, and inventing `true` from it would re-open the
  // hole this closes.
  if (typeof input.accountLivemode === 'boolean') {
    // A PROVEN mismatch is refused in either direction. It costs nothing to
    // detect and it is always wrong.
    if (!platformMode) return 'ready'
    return input.accountLivemode === (platformMode === 'live')
      ? 'ready'
      : 'mode-mismatch'
  }
  return platformMode === 'live' ? 'mode-unverified' : 'ready'
}

/**
 * The form every money door calls: `true` only when the linkage may be
 * charged, with the two mode refusals reported to the server log.
 *
 * The log line is the part the shopper's generic 409 cannot carry. Before
 * this, a mode mismatch surfaced as a 502 from Stripe with nothing anywhere
 * naming the cause; the sale is still refused the same way, but now somebody
 * can find out why.
 */
export function connectLinkageIsReady(
  input: ConnectReadinessInput,
  context?: { subject?: string },
): boolean {
  const readiness = connectReadiness(input)
  if (readiness === 'mode-mismatch' || readiness === 'mode-unverified') {
    console.error(
      `[AGL-2471] Refusing a charge against Connect account ` +
        `${String(input.accountId)}${
          context?.subject ? ` (${context.subject})` : ''
        }: ${readiness}. The stored linkage is not verified for this ` +
        `deployment's Stripe mode; the merchant must re-onboard.`,
    )
  }
  return readiness === 'ready'
}
