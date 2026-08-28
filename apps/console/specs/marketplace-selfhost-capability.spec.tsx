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
 * The Marketplace says what this deployment can do BEFORE the click
 * (AGL-2019).
 *
 * `release_marketplace` defaults ON, so a fresh self-host install showed the
 * whole Marketplace — browse, listings, a Buy button, a publisher payout panel
 * — backed by AGLYN'S Stripe Connect platform, which the operator does not
 * have. Nothing was hidden or disabled ahead of the click; the explanation
 * arrived afterwards as a snackbar that then vanished.
 *
 * And "just turn the flag off" was not an available answer either: the flag
 * feeds the plugin LOADER, so off subtracted the backend while this page went
 * on rendering in full. Both halves are covered here — the capability notice
 * and the page gate — because fixing either alone swaps one bad state for
 * another.
 */

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RELEASE_FLAGS } from '@aglyn/aglyn/app-utils/release-flags'
import MarketplaceTitleLayout from '../app/(app)/[orgSlug]/marketplace/layout'

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY
})

/** The alert MUI renders, by severity class (`MuiAlert-colorInfo` etc). */
const alertOfSeverity = (severity: 'info' | 'warning' | 'error') =>
  document.querySelector(
    `.MuiAlert-color${severity[0].toUpperCase()}${severity.slice(1)}`,
  )

describe('the Stripe capability notice (AGL-2019)', () => {
  it('SELF-HOST shape: no Stripe key, so the notice appears above the marketplace', () => {
    delete process.env.STRIPE_SECRET_KEY
    render(
      <MarketplaceTitleLayout>
        <div>{'marketplace body'}</div>
      </MarketplaceTitleLayout>,
    )
    expect(screen.getByText(/Payments are not configured/i)).toBeTruthy()
    expect(screen.getByText(/STRIPE_SECRET_KEY/)).toBeTruthy()
    // The body is still rendered — browsing and free installs genuinely work,
    // so this informs, it does not replace the feature.
    expect(screen.getByText('marketplace body')).toBeTruthy()
  })

  it('is INFO — an unconfigured deployment has not failed at anything', () => {
    // The severity is the point. `warning` or `error` would tell an operator
    // something is wrong with their install when they have simply not set up
    // a feature they may not even want. This is the console half of the same
    // rule the storefront cart follows.
    delete process.env.STRIPE_SECRET_KEY
    render(
      <MarketplaceTitleLayout>
        <div />
      </MarketplaceTitleLayout>,
    )
    expect(alertOfSeverity('info')).toBeTruthy()
    expect(alertOfSeverity('warning')).toBeNull()
    expect(alertOfSeverity('error')).toBeNull()
  })

  it('AGLYN-OPERATED shape: a real key means no notice at all', () => {
    // Without this the guard would pass by always rendering the notice, which
    // would put a permanent "not configured" banner on our own console.
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123'
    render(
      <MarketplaceTitleLayout>
        <div>{'marketplace body'}</div>
      </MarketplaceTitleLayout>,
    )
    expect(screen.queryByText(/Payments are not configured/i)).toBeNull()
    expect(screen.getByText('marketplace body')).toBeTruthy()
  })

  it('a half-filled .env reads as UNCONFIGURED, not as configured', () => {
    // `platformPaymentsConfigured` tests the key's PREFIX rather than its
    // truthiness, so a placeholder left in the template does not silently
    // pass for a working Stripe platform.
    process.env.STRIPE_SECRET_KEY = 'your-key-here'
    render(
      <MarketplaceTitleLayout>
        <div />
      </MarketplaceTitleLayout>,
    )
    expect(screen.getByText(/Payments are not configured/i)).toBeTruthy()
  })
})

describe('the hub behind the flag is release-gated (AGL-2019)', () => {
  /*
   * The SECTIONS LAYOUT, which is where the gate has to be now that the
   * sections are routes (AGL-693). On the old single page the wrapper sat
   * around the tab panels; a layout wraps every section route instead, so one
   * gate still covers the whole hub — and a per-section copy would be eight
   * chances to leave one out.
   */
  const layoutSource = readFileSync(
    join(
      __dirname,
      '..',
      'app',
      '(app)',
      '[orgSlug]',
      'marketplace',
      '(sections)',
      'layout.tsx',
    ),
    'utf8',
  )

  // A STRUCTURAL assertion on the source, deliberately. Rendering this layout
  // needs the org scope, the Firestore instance, the hosts hook and the plugin
  // widget host; a mock deep enough to reach the gate would be asserting on
  // the mock. What has to stay true is narrow and textual — the wrapper is
  // present, and the flag it names is a real one.
  it('wraps its body in <FeatureGate flag="release_marketplace">', () => {
    expect(layoutSource).toMatch(/<FeatureGate flag="release_marketplace">/)
    expect(layoutSource).toMatch(/<\/FeatureGate>/)
    expect(layoutSource).toMatch(
      /import FeatureGate from '.*components\/feature-gate\.component'/,
    )
  })

  it('names a flag that actually exists — a typo would gate nothing', () => {
    // `useReleaseFlag` on an unknown key would resolve to an undefined state,
    // and the gate would silently pass everyone through.
    const keys = RELEASE_FLAGS.map((definition) => definition.key)
    expect(keys).toContain('release_marketplace')
  })

  it('the flag still defaults ON, so this is a gate and not a removal', () => {
    // If someone "fixes" the self-host complaint by flipping the default off,
    // every Aglyn-operated org loses the Marketplace. The answer to an
    // operator who does not want one is now that the flag genuinely works.
    const marketplace = RELEASE_FLAGS.find(
      (definition) => definition.key === 'release_marketplace',
    )
    expect(marketplace?.defaultEnabled).toBe(true)
  })
})
