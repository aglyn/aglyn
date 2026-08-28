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
 * Google Ads conversions for Aglyn's own funnel — account created, and tier
 * subscribed.
 *
 * ## Why these are their own tag and not a GA4 import
 *
 * An imported GA4 key event lands in Google Ads as a conversion ACTION but
 * does not create a conversion GOAL, and only a goal can be selected for
 * bidding or reporting. `Sign-ups` sat with a live action and no goal for a
 * week: measured, and unusable. A conversion created against the Google tag
 * makes the goal, which is why these labels exist at all.
 *
 * ## Configuration, and why nothing is hardcoded
 *
 * ⛔ No default id. `analyticsMayEmit()` is true for ANY production build,
 * self-hosted ones included — so a hardcoded conversion id would have every
 * operator's console reporting signups into Aglyn's ad account. Unset means
 * unset: {@link platformAdConversionTarget} returns null and nothing fires,
 * which is the only correct behaviour for a deployment that has no ad account.
 *
 * The console reads its GA measurement id from `NEXT_PUBLIC_FIREBASE_...` for
 * the same reason; these follow that precedent.
 *
 * ⚠️ `process.env.NAME` is inlined at BUILD time by Next and never the bracket
 * form, so these are fixed when the image is built rather than when it starts.
 * An operator changing ad accounts rebuilds.
 */

/** The advertiser account, `AW-` and digits. */
export const PLATFORM_ADS_CONVERSION_ID =
  process.env.NEXT_PUBLIC_ADS_CONVERSION_ID || ''

/** The per-action labels, minted with each conversion action in Google Ads. */
export const PLATFORM_ADS_SIGNUP_LABEL =
  process.env.NEXT_PUBLIC_ADS_SIGNUP_LABEL || ''
export const PLATFORM_ADS_SUBSCRIBE_LABEL =
  process.env.NEXT_PUBLIC_ADS_SUBSCRIBE_LABEL || ''

export type PlatformAdConversion = 'signup' | 'subscribe'

const LABELS: Readonly<Record<PlatformAdConversion, string>> = {
  signup: PLATFORM_ADS_SIGNUP_LABEL,
  subscribe: PLATFORM_ADS_SUBSCRIBE_LABEL,
}

/**
 * The `send_to` for a conversion, or `null` when this build has none.
 *
 * Both halves are required. A `send_to` of `AW-123/` — an id with an empty
 * label — is not a no-op: gtag accepts it and reports against the account's
 * default, so a half-configured deployment would file its signups under
 * whatever conversion Google picks. Null is the honest answer.
 */
export function platformAdConversionTarget(
  kind: PlatformAdConversion,
): string | null {
  const label = LABELS[kind]
  if (!PLATFORM_ADS_CONVERSION_ID || !label) return null
  return `${PLATFORM_ADS_CONVERSION_ID}/${label}`
}

interface ConversionWindow {
  gtag?: (...args: unknown[]) => void
}

/**
 * Report one conversion, if this build has one and this visitor allows it.
 *
 * `allowed` is PASSED IN rather than read here, deliberately. The consent
 * verdict lives in the surface that resolved it — reaching back into that
 * module from here would make an analytics helper import a consent engine, and
 * would give this two reasons to fail. It is also how the caller stays
 * testable without a stubbed consent record.
 *
 * ⚠️ There is no queueing and no retry. `gtag` is defined by the Analytics
 * tag, so a conversion fired before the tag boots — or on a visitor who
 * refused, where the tag never boots at all — is simply not sent. Retrying
 * would mean holding a conversion for a visitor who has not consented to
 * being measured, which is the wrong end of the trade.
 *
 * Returns whether anything was sent, so a caller can assert on it rather than
 * on a spy for a global.
 */
export function reportPlatformAdConversion(
  kind: PlatformAdConversion,
  allowed: boolean,
  options: { transactionId?: string } = {},
): boolean {
  if (!allowed) return false
  const target = platformAdConversionTarget(kind)
  if (!target) return false
  const scope = globalThis as ConversionWindow
  if (typeof scope.gtag !== 'function') return false
  /*
   * `transaction_id` is what makes a conversion SAFE TO REPORT TWICE.
   *
   * Google Ads de-duplicates on it, so a caller no longer has to guarantee
   * exactly-once delivery from the browser — which is a guarantee a browser
   * cannot give. Without it, the only safe moment to report is the one the
   * visitor might close the tab on, and a missed conversion is invisible: the
   * money was spent, the customer converted, and the campaign shows nothing.
   *
   * ⚠️ It must be STABLE for the thing being counted, not per attempt. A fresh
   * id on every call de-duplicates nothing and quietly restores the double
   * count it exists to prevent.
   */
  scope.gtag('event', 'conversion', {
    send_to: target,
    ...(options.transactionId
      ? { transaction_id: options.transactionId }
      : {}),
  })
  return true
}

/**
 * Where a checkout that has STARTED but not yet been reported is remembered.
 *
 * The subscribe conversion can only be reported from the browser — an Ads
 * website conversion is matched to the ad click through the GCLID the tag
 * holds, and no webhook has one. That put the only reporting moment on
 * Stripe's `onComplete`, which a visitor can close the tab on: the money was
 * spent, the customer subscribed, and the campaign shows nothing. A missed
 * conversion is invisible, which is what makes it worth repairing.
 *
 * So the checkout marks itself pending when it opens, and the billing page
 * reports on the next visit if it finds the mark and a live subscription. The
 * customer always comes back — they are a customer now.
 *
 * ⚠️ Scoped to the org so a mark left by one workspace cannot report a
 * conversion for another, and paired with a stable `transaction_id` so the
 * belt and the braces cannot double count.
 *
 * `localStorage`, not `sessionStorage`: closing the tab is the case being
 * repaired, and a session store is exactly what closing the tab clears.
 */
export const PLATFORM_SUBSCRIBE_PENDING_KEY = 'aglyn:ads:subscribe-pending'

/** Remember that this org opened checkout, so a lost tab is recoverable. */
export function markSubscribeCheckoutPending(orgId: string): void {
  if (!orgId || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PLATFORM_SUBSCRIBE_PENDING_KEY, orgId)
  } catch {
    // Storage refused. The `onComplete` path still reports; only the repair
    // for a closed tab is lost, which is where this started.
  }
}

/** Whether this org has a checkout waiting to be reported. */
export function subscribeCheckoutPending(orgId: string): boolean {
  if (!orgId || typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(PLATFORM_SUBSCRIBE_PENDING_KEY) === orgId
  } catch {
    return false
  }
}

/** Forget it, once reported — or once the org is no longer subscribing. */
export function clearSubscribeCheckoutPending(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PLATFORM_SUBSCRIBE_PENDING_KEY)
  } catch {
    // A mark that cannot be cleared is re-reported, and `transaction_id`
    // makes that harmless. This is the reason it is not optional.
  }
}

export default reportPlatformAdConversion
