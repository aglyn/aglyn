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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { useCallback, useState, type ReactNode } from 'react'
import { useMarketplacePay, type PayListing } from './use-marketplace-pay'

/** How one "Buy and continue" ended. */
export type StarterPurchaseOutcome =
  /** Paid just now, or owned already: the site can be created. */
  | 'owned'
  /** Paid and still clearing: the site can be created once it has. */
  | 'pending'
  /** Closed, or it could not open; {@link StarterPurchase.error} says why. */
  | 'stopped'

export interface StarterPurchase {
  buy: (listing: PayListing) => Promise<StarterPurchaseOutcome>
  /** A purchase is opening or paying. */
  busy: boolean
  /** Why the last one did not open, or `null`. */
  error: string | null
  /** The payment, in place under the pick, or `null`. */
  panel: ReactNode
}

/**
 * "Buy and continue" for a priced starter in Create site (AGL-4049): pays in
 * the console, licensed to the workspace the site is for, so the person stays
 * on the same pick with the site still to be created. The purchase is on
 * record when it answers, so Create is ready on the next click.
 */
export function useStarterPurchase(orgId: string | undefined, orgSlug: string): StarterPurchase {
  const pay = useMarketplacePay({
    orgId,
    billingHref: orgSlug ? buildRoute(Route.MANAGE_BILLING, { orgSlug }) : null,
  })
  const [error, setError] = useState<string | null>(null)

  const buy = useCallback(
    async (listing: PayListing): Promise<StarterPurchaseOutcome> => {
      setError(null)
      const result = await pay.buy(listing)
      if (result.outcome === 'paid' || result.outcome === 'owned') return 'owned'
      if (result.outcome === 'pending') {
        setError('Your payment is going through. You can create this site as soon as it clears.')
        return 'pending'
      }
      setError(result.error)
      return 'stopped'
    },
    [pay.buy],
  )

  return { buy, busy: pay.busy, error, panel: pay.panel }
}
