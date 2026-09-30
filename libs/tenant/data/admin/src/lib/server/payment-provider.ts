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

import { STRIPE_CONNECT_PAYMENT_PROVIDER } from './payment-provider-stripe-connect'

/**
 * The merchant's payment account — the one seam the payment vendor lives
 * behind when a TENANT takes money.
 *
 * ## Which money this is, and which it is not
 *
 * Two different accounts move money on this platform and only one of them is
 * here. The platform BILLS its customers — plans, add-ons, metered usage — on
 * its own account; that rail is infrastructure (`org-billing.ts`, the billing
 * webhook route, `api-idempotency.ts`, `stripe-deployment-mode.ts`) and names
 * its vendor where it runs. A tenant SELLS — a storefront order, a booked
 * appointment, a marketplace listing — into a connected merchant account of
 * its own, and every plugin that takes money reaches that account through
 * this contract: whether the account may be charged, which world (live or
 * test) the platform charges in, and what the provider says when the account
 * changes or a payout fails.
 *
 * Commerce's `PaymentProviderId` names the provider a CHECKOUT is created
 * with. This is the other half: the account the checkout pays into.
 *
 * ## One adapter, compiled in, and no registry — by failure direction
 *
 * Stripe Connect is the only adapter
 * (`payment-provider-stripe-connect.ts`), and {@link paymentProvider} returns
 * it without consulting any registry, the way the domain driver's built-ins
 * and the mail rail's are compiled into their libraries. A provider a plugin
 * registered could be ABSENT where a door reads it — a declaration that threw
 * part-way, a route bundle that evaluated the registry apart from boot's —
 * and every answer an absent provider could give at a money door is wrong: a
 * refusal takes every sale on every site down, and a default lets a checkout
 * proceed against an account nobody checked. Compiled in, it cannot be
 * absent, so neither can happen.
 *
 * It lives in this library rather than in a plugin because three plugins take
 * money into the same account — a storefront, a calendar and the marketplace
 * — and one plugin may not import another. A plugin that owned the adapter
 * would make the other two's sales depend on its install and on its
 * registration having run; the adapter itself sells nothing and holds no
 * product, only the platform's own connected-account integration.
 *
 * A second adapter is one module beside the first and a selector here. There
 * is no selector today because there is nothing to select: every plugin's
 * checkout is created against the same vendor.
 *
 * ## The contract every adapter owes
 *
 * 1. **An account the provider did not describe is never ready.** Every
 *    {@link MerchantAccountReadiness} other than `'ready'` refuses the charge,
 *    and only a literal boolean is a recorded answer.
 * 2. **Only what the provider stated is written.** An account event that
 *    states nothing writes nothing, and a written record never invents a
 *    `false` or a `true` from an absent field.
 * 3. **Failures propagate.** {@link PaymentProvider.applyAccountEvent} runs
 *    inside the platform's billing webhook, and a throw is what earns the
 *    redelivery; every write it makes is idempotent so that redelivery
 *    converges.
 */

/** Which world a platform credential or a merchant account charges in. */
export type PaymentMode = 'live' | 'test'

/**
 * Why a stored merchant account may not be charged against. Every value
 * other than `'ready'` is a refusal.
 */
export type MerchantAccountReadiness =
  /** Charge away. */
  | 'ready'
  /** No merchant account is stored at all — the onboarding call to action. */
  | 'not-connected'
  /** The provider will not let this account take charges. */
  | 'charges-disabled'
  /**
   * The account's mode was never recorded (AGL-2471) AND this deployment is
   * LIVE. The onboarding route and the provider's account event both record
   * it, so a genuine merchant self-heals on the next of either.
   */
  | 'mode-unverified'
  /** The account belongs to the OTHER world. The AGL-2471 defect. */
  | 'mode-mismatch'

export interface MerchantAccountReadinessInput {
  /** The stored account id, whatever shape the document has. */
  accountId?: unknown
  /** Whether the provider said the account may take charges. */
  chargesEnabled?: unknown
  /** Whether the provider said the account is live — absent before AGL-2471. */
  accountLivemode?: unknown
  /** Defaults to {@link PaymentProvider.platformMode}. */
  platformMode?: PaymentMode | undefined
}

/** One event the platform's billing webhook received, as the provider sent it. */
export interface PaymentProviderEvent {
  /** The provider's own name for the event. */
  type: string
  /** The object the event describes. */
  object: unknown
  /** The whole event as delivered. */
  event: unknown
}

export interface PaymentProvider {
  /** Stable id, for log lines. Never a display name. */
  readonly id: string
  /**
   * The mode this deployment's platform credential states about itself, read
   * without a network call; `undefined` when there is no credential or it
   * states nothing.
   */
  platformMode(): PaymentMode | undefined
  /**
   * The platform's mode, asked of the provider first and the credential
   * second — what an onboarding route records against a merchant account it
   * has just retrieved.
   */
  resolvePlatformMode(): Promise<PaymentMode | undefined>
  /**
   * Applies an event about a connected merchant account — its readiness
   * changed, a payout to it failed, a later payout landed — to the documents
   * in `collection` that store it. A plugin passes the collection holding ITS
   * merchant profiles; a non-matching account updates nothing.
   *
   * @returns `true` when the event was about a merchant account and has been
   *   applied, so the caller's own sections have nothing to do with it;
   *   `false` for every other event.
   */
  applyAccountEvent(
    collection: string,
    delivered: PaymentProviderEvent,
  ): Promise<boolean>
}

/** The provider every merchant account on this deployment is held at. */
export function paymentProvider(): PaymentProvider {
  return STRIPE_CONNECT_PAYMENT_PROVIDER
}

/**
 * Decides whether a stored merchant account may be charged against.
 *
 * Order matters: the two refusals that existed before AGL-2471 are asked
 * first, so an unconnected or restricted merchant still gets the answer they
 * always got, and only an account that WOULD have passed reaches the mode
 * question.
 *
 * WHY THE MODE RULE IS ASYMMETRIC, AND NOT "REFUSE ANYTHING UNPROVEN". An
 * unrecorded mode refuses only on a LIVE deployment. That is where real money
 * moves, and a live deployment can always re-establish the field: the
 * merchant reconnects, or the provider sends one account event. Everywhere
 * else — a test deployment, a developer machine, a self-hosted install still
 * in sandbox, the whole test suite — an unverified account keeps the
 * behavior it had before, because no real money can move there and the
 * provider enforces the mode boundary itself. A PROVEN mismatch is refused in
 * both directions, because it costs nothing to detect and is never right.
 */
export function merchantAccountReadiness(
  input: MerchantAccountReadinessInput,
): MerchantAccountReadiness {
  const accountId =
    typeof input.accountId === 'string' ? input.accountId.trim() : ''
  if (!accountId) return 'not-connected'
  if (input.chargesEnabled !== true) return 'charges-disabled'
  const platformMode =
    'platformMode' in input
      ? input.platformMode
      : paymentProvider().platformMode()
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
 * The form every money door calls: `true` only when the account may be
 * charged, with the two mode refusals reported to the server log.
 *
 * The log line is the part the shopper's generic 409 cannot carry. Before
 * this, a mode mismatch surfaced as a 502 from the provider with nothing
 * anywhere naming the cause; the sale is still refused the same way, but now
 * somebody can find out why.
 */
export function merchantAccountIsReady(
  input: MerchantAccountReadinessInput,
  context?: { subject?: string },
): boolean {
  const readiness = merchantAccountReadiness(input)
  if (readiness === 'mode-mismatch' || readiness === 'mode-unverified') {
    console.error(
      `[AGL-2471] Refusing a charge against ${paymentProvider().id} account ` +
        `${String(input.accountId)}${
          context?.subject ? ` (${context.subject})` : ''
        }: ${readiness}. The stored account is not verified for this ` +
        `deployment's payment mode; the merchant must re-onboard.`,
    )
  }
  return readiness === 'ready'
}
