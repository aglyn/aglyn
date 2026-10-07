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

'use client'

import { useEffect, useState } from 'react'

/**
 * The shopper-facing half of `server/checkout-status.ts` (AGL-3606): on the
 * page Stripe returned them to, say plainly when the payment did NOT go
 * through — a redirect-based method whose bank step failed comes back to the
 * same `?order=success&session_id=…` a paid order does.
 *
 * Silent for a paid session, and on every ordinary page view (no
 * `session_id`). Both the cart and the product page mount this, so the first
 * mount claims the session and any sibling stays quiet — one notice, not two.
 */

export interface CheckoutReturnNotice {
  severity: 'warning' | 'info'
  message: string
}

const claimed = new Set<string>()

/** Test seam: the claim set outlives a test otherwise. */
export function __resetCheckoutReturnNotice(): void {
  claimed.clear()
}

export function checkoutReturnNoticeFor(
  status: string,
  paymentStatus: string,
): CheckoutReturnNotice | null {
  if (status === 'open') {
    return {
      severity: 'warning',
      message:
        'Your payment was not completed and nothing was charged. Your items are still here, so you can check out again.',
    }
  }
  if (status === 'expired') {
    return {
      severity: 'warning',
      message:
        'That checkout expired before it was paid, and nothing was charged. You can check out again.',
    }
  }
  if (status === 'complete' && paymentStatus === 'unpaid') {
    return {
      severity: 'info',
      message: 'Your order was placed. Your payment is still processing.',
    }
  }
  return null
}

export function useCheckoutReturnNotice(
  hostId: string,
  siteFetch: typeof fetch = fetch,
): [CheckoutReturnNotice | null, () => void] {
  const [notice, setNotice] = useState<CheckoutReturnNotice | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined' || !hostId) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('order') !== 'success') return
    const sessionId = params.get('session_id') ?? ''
    if (!sessionId || claimed.has(sessionId)) return
    // Claimed for the document, not the effect run: under StrictMode the
    // effect runs twice and the second run must not start a second lookup —
    // nor may the first one's answer be thrown away, which is why there is no
    // `active` guard (a state update after unmount is a no-op).
    claimed.add(sessionId)
    void (async () => {
      try {
        const response = await siteFetch(
          `/api/commerce/checkout-status?hostId=${encodeURIComponent(
            hostId,
          )}&sessionId=${encodeURIComponent(sessionId)}`,
        )
        if (!response.ok) return
        const body = (await response.json()) as {
          status?: string
          paymentStatus?: string
        }
        setNotice(
          checkoutReturnNoticeFor(
            String(body?.status ?? ''),
            String(body?.paymentStatus ?? ''),
          ),
        )
      } catch {
        // Saying nothing is the pre-existing behavior, and the safe one.
      }
    })()
  }, [hostId, siteFetch])
  return [notice, () => setNotice(null)]
}
