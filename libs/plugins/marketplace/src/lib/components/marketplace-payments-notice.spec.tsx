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
 * WHAT THIS DEPLOYMENT CANNOT DO, SAID BEFORE THE CLICK (AGL-2019).
 *
 * `release_marketplace` defaults ON, so a fresh self-host install shows the
 * whole Marketplace — browse, listing pages, a Buy button, a publisher payout
 * panel — all of it backed by AGLYN'S Stripe Connect platform, which the
 * operator does not have and cannot get. Nothing was hidden or disabled ahead
 * of the click; the explanation arrived afterwards as a snackbar that then
 * vanished.
 *
 * The sentence is this plugin's (AGL-3080) — it names what still works
 * without a Stripe platform — and the FACT is the deployment's, read from a
 * server-only secret by the console's org layout and handed down as a
 * capability. The console's own spec holds that half.
 */

import { DeploymentCapabilitiesContext } from '@aglyn/aglyn'
import { render, screen } from '@testing-library/react'
import MarketplacePaymentsNotice from './marketplace-payments-notice.component'

/** The alert MUI renders, by severity class (`MuiAlert-colorInfo` etc). */
const alertOfSeverity = (severity: 'info' | 'warning' | 'error') =>
  document.querySelector(
    `.MuiAlert-color${severity[0].toUpperCase()}${severity.slice(1)}`,
  )

const renderWith = (payments: boolean) =>
  render(
    <DeploymentCapabilitiesContext.Provider value={{ payments }}>
      <MarketplacePaymentsNotice />
    </DeploymentCapabilitiesContext.Provider>,
  )

describe('the marketplace capability notice (AGL-2019)', () => {
  it('SELF-HOST shape: no Stripe platform, so the notice appears', () => {
    renderWith(false)
    expect(screen.getByText(/Payments are not configured/i)).toBeTruthy()
    // It names the thing the operator would set, which is the only part of
    // this that is actionable.
    expect(screen.getByText(/STRIPE_SECRET_KEY/)).toBeTruthy()
  })

  it('is INFO — an unconfigured deployment has not failed at anything', () => {
    // The severity is the point. `warning` or `error` would tell an operator
    // something is wrong with their install when they have simply not set up
    // a feature they may not even want. This is the console half of the same
    // rule the storefront cart follows.
    renderWith(false)
    expect(alertOfSeverity('info')).toBeTruthy()
    expect(alertOfSeverity('warning')).toBeNull()
    expect(alertOfSeverity('error')).toBeNull()
  })

  it('AGLYN-OPERATED shape: a platform means no notice at all', () => {
    // Without this the widget could pass its first test by always rendering,
    // which would put a permanent "not configured" banner on our own console.
    const { container } = renderWith(true)
    expect(screen.queryByText(/Payments are not configured/i)).toBeNull()
    expect(container.textContent).toBe('')
  })

  it('draws NOTHING when nobody said what the deployment can do', () => {
    // The context default is CONFIGURED, and it has to be: a widget mounted
    // outside the provider — a test harness, a zone somewhere that does not
    // supply it — would otherwise put that permanent banner on a console
    // whose Stripe platform is working. The failure mode of a NOTICE is the
    // opposite of a gate's: silence, not a claim.
    const { container } = render(<MarketplacePaymentsNotice />)
    expect(screen.queryByText(/Payments are not configured/i)).toBeNull()
    expect(container.textContent).toBe('')
  })
})
