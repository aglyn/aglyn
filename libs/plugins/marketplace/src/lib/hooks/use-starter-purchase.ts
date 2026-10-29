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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn/app-utils/lockdown'
import { readGaClientId } from '@aglyn/aglyn/app-utils/analytics-events'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef, useState } from 'react'
import { STARTER_CHECKOUT_PATH, starterCheckoutBody } from '../model/starter-query'

/** How one "Buy and continue" ended. */
export type StarterPurchaseOutcome =
  /** The payment page is opening: the person comes back to Create site on the same pick. */
  | 'opening'
  /** The workspace owns it already: nothing to pay, the site can be created. */
  | 'owned'
  /** It could not open; {@link StarterPurchase.error} says why. */
  | 'failed'

export interface StarterPurchase {
  buy: (listingId: string) => Promise<StarterPurchaseOutcome>
  /** A purchase is opening. */
  busy: boolean
  /** Why the last one did not open, or `null`. */
  error: string | null
}

/** Where the browser goes to pay: replaced in a spec. */
export const starterPurchaseNavigation = {
  assign: (url: string) => window.location.assign(url),
}

/**
 * "Buy and continue" for a priced starter in Create site (AGL-4049): opens
 * the marketplace's payment for it, licensed to the workspace the site is
 * for, and names Create site as the way back, so the person returns to the
 * same pick with the site still to be created. Today's payment page, until
 * the marketplace pays in-app.
 *
 * One attempt per starter: the same key goes with a second click, so a
 * double click cannot open a second payment (AGL-1697). A workspace that
 * already owns it is told so, not charged again.
 */
export function useStarterPurchase(orgId: string | undefined): StarterPurchase {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const attempts = useRef(new Map<string, string>())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buy = useCallback(
    async (listingId: string): Promise<StarterPurchaseOutcome> => {
      if (!orgId || !listingId) return 'failed'
      const key =
        attempts.current.get(listingId) ??
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
      attempts.current.set(listingId, key)
      setBusy(true)
      setError(null)
      // Busy until the page leaves for the payment, so a second click cannot
      // land in between.
      let opening = false
      try {
        const response = await authorizedFetch(userRef.current, STARTER_CHECKOUT_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
          body: JSON.stringify(
            starterCheckoutBody({
              listingId,
              orgId,
              gaClientId: await readGaClientId(process.env['NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID']),
            }),
          ),
        })
        const payload = (await response.json().catch((): null => null)) as
          | { url?: unknown; error?: unknown; code?: unknown }
          | null
        if (response.status === 409 && payload?.code === 'already_purchased') return 'owned'
        const locked = parseLockdownRefusal(response.status, payload)
        if (locked) {
          setError(lockdownRefusalText(locked))
          return 'failed'
        }
        if (response.status === 501) {
          setError('Purchases are not set up here yet, so a starter with a price cannot be bought.')
          return 'failed'
        }
        if (!response.ok || typeof payload?.url !== 'string' || !payload.url) {
          setError(typeof payload?.error === 'string' && payload.error ? payload.error : 'The payment could not open. Try again.')
          return 'failed'
        }
        opening = true
        starterPurchaseNavigation.assign(payload.url)
        return 'opening'
      } catch (caught) {
        console.error(caught)
        setError('The payment could not open. Check your connection and try again.')
        return 'failed'
      } finally {
        if (!opening) setBusy(false)
      }
    },
    [orgId],
  )

  return { buy, busy, error }
}
