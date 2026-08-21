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
import { buildBookingPurchaseParams } from '../model/booking-purchase-analytics'

/** How long to wait out the `checkout.session.completed` webhook. */
const MAX_ATTEMPTS = 8
const RETRY_MS = 1_500
/** How long to wait for the consent-gated gtag script to exist. */
const GTAG_ATTEMPTS = 20
const GTAG_MS = 250

/**
 * Once per browser session per booking. `sessionStorage` survives the reload;
 * the in-memory set covers a page carrying more than one Booking widget, which
 * would otherwise race before either had written.
 */
const reported = new Set<string>()
const STORAGE_PREFIX = 'aglyn:booking-purchase-reported:'

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
 * Report a paid booking to the MERCHANT's GA4 property (AGL-2481).
 *
 * ## Why this exists
 *
 * The bookings plugin sent no analytics event of any kind. A merchant selling
 * appointments through Aglyn saw traffic on the page, and then nothing — which
 * does not read as "bookings are not measured", it reads as a 100% abandonment
 * rate on every service they sell, and GA4's ecommerce reports and shopping
 * funnel are all terminated by `purchase`. Commerce closed exactly this gap for
 * products (AGL-1641); services were left behind.
 *
 * ## Client-side, deliberately — the inverse of the call made for OUR revenue
 *
 * Aglyn's own cut of the booking is sent server-side from the Stripe webhook,
 * because a lost hit there is lost revenue reporting on our books. This one is
 * client-side, and the reasoning inverts with the consequence: server-side
 * would require collecting, encrypting and supporting a per-host Measurement
 * Protocol API secret we have nowhere to store, to buy accuracy against closed
 * tabs and ad blockers that every storefront on the internet already accepts.
 * `ga4-measurement-protocol.ts` is not that channel — it holds one global
 * credential pair, which is AGLYN's property.
 *
 * The two hits therefore land in two different properties carrying two
 * different figures — our fee there, the merchant's gross ex-tax here — and
 * neither double-counts the other.
 *
 * ## Where it fires
 *
 * On the page Stripe returns the guest to, which is the page they left: a
 * tenant site has no booking-confirmation route, so `success_url` comes back to
 * the site root carrying `?booking=paid&session_id=…`.
 *
 * ## The two waits
 *
 * The booking is confirmed by the webhook, which can land AFTER the guest is
 * back, so the lookup retries. And `window.gtag` only exists once the visitor
 * has granted analytics consent and the consent-gated script has loaded
 * post-hydration, so the send waits for it — otherwise the event would be built
 * correctly and dropped on the floor.
 *
 * Both waits are bounded, and a visitor who never granted consent simply times
 * out. That is the consent gate working, not a bug to route around:
 * `trackEvent` drops rather than queues, deliberately, so an event fired before
 * consent is gone for good instead of replaying a pre-consent hit later.
 */
export function useBookingPurchaseEvent(
  hostId: string,
  /** `Aglyn.useSiteFetch()`. A GET, so preview mode passes it straight through. */
  siteFetch: typeof fetch = fetch,
): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !hostId) return

    const params = new URLSearchParams(window.location.search)
    if (params.get('booking') !== 'paid') return
    const sessionId = params.get('session_id') ?? ''
    if (!sessionId || alreadyReported(sessionId)) return

    let active = true
    // Claimed up front so a sibling widget in the same document cannot start a
    // second poll for the same booking. Persisted only once the hit is sent.
    reported.add(sessionId)

    void (async () => {
      let source: Parameters<typeof buildBookingPurchaseParams>[0] | null = null
      for (let attempt = 0; attempt < MAX_ATTEMPTS && active; attempt += 1) {
        try {
          const response = await siteFetch(
            `/api/bookings/booking-analytics?hostId=${encodeURIComponent(
              hostId,
            )}&sessionId=${encodeURIComponent(sessionId)}`,
          )
          if (response.ok) {
            source = await response.json()
            break
          }
          // 404 means the webhook has not confirmed the booking yet; anything
          // else is terminal and retrying it would only add load.
          if (response.status !== 404) return
        } catch {
          // Network blip — treated like the race and retried.
        }
        await sleep(RETRY_MS)
      }
      if (!active || !source) return

      const purchase = buildBookingPurchaseParams(source)
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
