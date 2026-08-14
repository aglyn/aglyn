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

import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import { useEffect } from 'react'
import { buildStorefrontPurchaseParams } from '../model/purchase-analytics'

/** How long to wait out the `checkout.session.completed` webhook. */
const MAX_ATTEMPTS = 8
const RETRY_MS = 1_500
/** How long to wait for the consent-gated gtag script to exist. */
const GTAG_ATTEMPTS = 20
const GTAG_MS = 250

/**
 * Once per browser session per order, across both mount points. `sessionStorage`
 * survives the reload; the in-memory set covers a page carrying BOTH a Cart and
 * a ProductDetail, which would otherwise race before either had written.
 */
const reported = new Set<string>()
const STORAGE_PREFIX = 'aglyn:purchase-reported:'

function alreadyReported(sessionId: string): boolean {
  if (reported.has(sessionId)) return true
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + sessionId) === '1'
  } catch {
    // Private mode / storage disabled. GA4's own de-duplication on
    // `transaction_id` is the real guarantee; this is only the cheap half.
    return false
  }
}

function markReported(sessionId: string): void {
  reported.add(sessionId)
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + sessionId, '1')
  } catch {
    /* see above */
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Report a completed storefront order to the MERCHANT's GA4 property
 * (AGL-1641).
 *
 * ## Why this exists at all
 *
 * The commerce plugin instrumented `view_item`, `add_to_cart` and
 * `begin_checkout` and then stopped. GA4's built-in ecommerce reports and the
 * shopping-behaviour funnel are all terminated by `purchase`, so without it a
 * merchant's property did not merely lack one number — it rendered an
 * authoritative-looking 0% conversion rate and zero revenue. The console's own
 * commerce analytics card meanwhile promised merchants that `purchase` already
 * mirrored into their Google Analytics.
 *
 * ## Client-side, deliberately — the opposite of the call made for OUR revenue
 *
 * Aglyn's own `purchase` is sent server-side over the Measurement Protocol,
 * because a lost hit there is lost revenue reporting on our books. This one is
 * client-side, and the reasoning inverts with the consequence: server-side
 * would require collecting, encrypting and supporting a per-host Measurement
 * Protocol API secret we have nowhere to store, to buy accuracy against
 * closed tabs and ad blockers that every storefront on the internet already
 * accepts. For a merchant's product analytics that is the industry norm; for
 * our revenue it would not have been.
 *
 * ## Where it fires
 *
 * On the page Stripe returns the shopper to, which is the page they left —
 * there is no order-confirmation surface on a tenant storefront. That is the
 * Cart for a cart checkout and the ProductDetail for a single-product buy,
 * which is exactly why both call this hook.
 *
 * ## The two waits
 *
 * The order is written by the webhook, which can land AFTER the shopper is
 * back, so the lookup retries. And `window.gtag` only exists once the visitor
 * has granted analytics consent and the consent-gated script has loaded
 * post-hydration, so the send waits for it — otherwise the event would be
 * built correctly and dropped on the floor. Both waits are bounded; an
 * ungranted visitor simply times out, which is the consent gate working.
 */
export function useStorefrontPurchaseEvent(
  hostId: string,
  /** `Aglyn.useSiteFetch()`. A GET, so preview mode passes it straight through. */
  siteFetch: typeof fetch = fetch,
): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !hostId) return

    const params = new URLSearchParams(window.location.search)
    if (params.get('order') !== 'success') return
    const sessionId = params.get('session_id') ?? ''
    if (!sessionId || alreadyReported(sessionId)) return

    let active = true
    // Claimed up front so a sibling mount in the same document cannot start a
    // second poll for the same order. Persisted only once the hit is sent.
    reported.add(sessionId)

    void (async () => {
      let source: Parameters<typeof buildStorefrontPurchaseParams>[0] | null =
        null
      for (let attempt = 0; attempt < MAX_ATTEMPTS && active; attempt += 1) {
        try {
          const response = await siteFetch(
            `/api/commerce/order-analytics?hostId=${encodeURIComponent(
              hostId,
            )}&sessionId=${encodeURIComponent(sessionId)}`,
          )
          if (response.ok) {
            source = await response.json()
            break
          }
          // 404 means the webhook has not written the order yet; anything
          // else is terminal and retrying it would only add load.
          if (response.status !== 404) return
        } catch {
          // Network blip — treated like the race and retried.
        }
        await sleep(RETRY_MS)
      }
      if (!active || !source) return

      const purchase = buildStorefrontPurchaseParams(source)
      if (!purchase) return

      // `trackEvent` no-ops when `window.gtag` is absent and never queues, so
      // waiting for the tag IS the delivery mechanism here.
      for (let attempt = 0; attempt < GTAG_ATTEMPTS && active; attempt += 1) {
        if (typeof (window as any).gtag === 'function') {
          trackEvent('purchase', purchase)
          markReported(sessionId)
          return
        }
        await sleep(GTAG_MS)
      }
    })()

    return () => {
      active = false
    }
    // `siteFetch` is deliberately out of the dep list: it is a `useCallback`
    // that changes identity on a preview toggle, and re-running this effect
    // would restart a poll that has already claimed its session id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId])
}
