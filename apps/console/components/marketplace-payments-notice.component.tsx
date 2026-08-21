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

import {
  operatorMarketplaceNotConfiguredText,
  operatorPaymentsNotConfiguredText,
} from '@aglyn/aglyn/app-utils/payments-configured'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'

/**
 * Says, BEFORE the click, that this deployment cannot take marketplace
 * payments (AGL-2019).
 *
 * `release_marketplace` defaults ON, so a fresh self-host install shows the
 * full Marketplace — browse, listing pages, a Buy button, a publisher payout
 * panel — all of it backed by AGLYN'S Stripe Connect platform, which the
 * operator does not have and cannot get. Nothing was hidden or disabled ahead
 * of the click, and the explanation arrived only afterwards, as a snackbar
 * that then vanished.
 *
 * ⚠️ `severity="info"`, NOT `error` or `warning`. This is the console half of
 * the same rule the storefront cart now follows: an unconfigured deployment
 * has not failed at anything. `warning` would read as "something is wrong with
 * your install" to an operator who has simply not set up a feature they may
 * not want. Nothing here is broken.
 *
 * Why a notice rather than hiding the Marketplace: browsing and free installs
 * genuinely work without Stripe, and they are most of what the marketplace is
 * for. Hiding the tab would remove working functionality to avoid explaining
 * one that is off — so the text leads with what still works.
 */
export default function MarketplacePaymentsNotice() {
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      <AlertTitle>{'Payments are not configured'}</AlertTitle>
      {`${operatorMarketplaceNotConfiguredText()} ${operatorPaymentsNotConfiguredText()}`}
    </Alert>
  )
}
