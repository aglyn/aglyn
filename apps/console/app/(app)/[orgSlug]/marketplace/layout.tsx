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

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import MarketplacePaymentsNotice from '../../../../components/marketplace-payments-notice.component'
import { platformPaymentsConfigured } from '../../../../utils/server/payments-platform'
import { segmentTitle } from '../../../page-title'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout.  re-declares the brand template so
// it keeps applying to the titled routes nested below (AGL-1059).
export const metadata: Metadata = { title: segmentTitle('Marketplace') }

/**
 * …and, since AGL-2019, the marketplace's Stripe capability check.
 *
 * It lives HERE because this is the only server component in the marketplace
 * subtree — every page under it is `'use client'`, and the fact being checked
 * is `STRIPE_SECRET_KEY`, a server-only secret that must never be inlined into
 * a browser bundle. Placing it on the layout also means it covers the listing,
 * publish and publisher routes without five copies of the same test.
 *
 * `platformPaymentsConfigured()` rather than a bare
 * `Boolean(process.env.STRIPE_SECRET_KEY)`: it tests the key's PREFIX, so a
 * `.env` still holding a placeholder reads as unconfigured instead of as
 * configured-and-broken.
 *
 * A capability check, NOT a release flag. The two answer different questions
 * and both are needed: the flag asks "should this deployment show the
 * marketplace", which the page's own `<FeatureGate>` now answers; this asks
 * "can this deployment take money", which no flag knows.
 */
export default function MarketplaceTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  const paymentsConfigured = platformPaymentsConfigured()
  return (
    <>
      {paymentsConfigured ? null : <MarketplacePaymentsNotice />}
      {children}
    </>
  )
}
