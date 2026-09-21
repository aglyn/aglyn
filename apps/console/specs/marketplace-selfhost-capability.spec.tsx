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

import { RELEASE_FLAGS } from '@aglyn/aglyn/app-utils/release-flags'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { platformPaymentsConfigured } from '../utils/server/payments-platform'

/** The alert MUI renders, by severity class (`MuiAlert-colorInfo` etc). */
const alertOfSeverity = (severity: 'info' | 'warning' | 'error') =>
  document.querySelector(
    `.MuiAlert-color${severity[0].toUpperCase()}${severity.slice(1)}`,
  )

describe('what the deployment can do is read on the SERVER (AGL-3080)', () => {
  /*
   * The console's half. The SENTENCE moved to the marketplace plugin, whose
   * own spec holds it; what stays here is the part only the app can get
   * wrong — reading a server-only secret in a server component, and drawing
   * the zone that carries the answer to the reader.
   */
  const source = (...segments: string[]) =>
    readFileSync(join(__dirname, '..', ...segments), 'utf8')

  it('reads the key in the org layout, which is a SERVER component', () => {
    // Read anywhere below it and the key — which carries no `NEXT_PUBLIC_`
    // prefix, so Next never inlines it — is `undefined` in the browser, and
    // every deployment reports a working Stripe platform as absent,
    // including ours.
    const layout = source('app', '(app)', '[orgSlug]', 'layout.tsx')
    expect(layout).not.toMatch(/'use client'/)
    expect(layout).toMatch(/payments=\{platformPaymentsConfigured\(\)\}/)
  })

  it('tests the key PREFIX, so a half-filled .env reads as unconfigured', () => {
    // A `.env` left holding the template's placeholder is truthy, and would
    // report a working Stripe platform to an operator who has none.
    expect(platformPaymentsConfigured('sk_test_abc123')).toBe(true)
    expect(platformPaymentsConfigured('rk_live_abc123')).toBe(true)
    expect(platformPaymentsConfigured('your-key-here')).toBe(false)
    expect(platformPaymentsConfigured('')).toBe(false)
    expect(platformPaymentsConfigured(undefined)).toBe(false)
  })

  it('draws the marketplace zone above the WHOLE subtree', () => {
    // On the layout rather than the pages, for the reason the check was:
    // it covers the sections, the listing, publish and publisher routes
    // without five copies of it.
    const layout = source(
      'app',
      '(app)',
      '[orgSlug]',
      'marketplace',
      'layout.tsx',
    )
    expect(layout).toMatch(/<PluginWidgetSlot slot="marketplaceCapability" \/>/)
  })
})

describe('the hub behind the flag is release-gated (AGL-2019)', () => {
  /*
   * The SECTIONS LAYOUT, which is where the gate has to be now that the
   * sections are routes (AGL-2501). On the old single page the wrapper sat
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
