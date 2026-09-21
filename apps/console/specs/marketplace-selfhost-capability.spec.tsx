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

import {
  listConsoleOrgNavItems,
  resetPluginServicesForTests,
} from '@aglyn/aglyn'
import { RELEASE_FLAGS } from '@aglyn/aglyn/app-utils/release-flags'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'
import { releaseFlagForNavTab } from '../utils/plugin-hub-sections'
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

  it('hands the answer to every surface below the org layout', () => {
    // The fact travels as a deployment CAPABILITY on a context, which is
    // what lets any surface below say what it cannot do. It used to reach
    // the marketplace through a `marketplaceCapability` zone drawn by the
    // console's marketplace layout; AGL-3080 moved those routes into the
    // plugin, so the notice is a plain import there and the zone is gone.
    // What stays the app's job is putting the answer on the context.
    const layout = source('app', '(app)', '[orgSlug]', 'layout.tsx')
    expect(layout).toMatch(/payments=\{platformPaymentsConfigured\(\)\}/)
  })

  it('and the marketplace still says it, above its whole hub', () => {
    // The sentence is the plugin's — it names what still works without a
    // Stripe platform — and it is drawn once, by the hub, rather than per
    // section. Read from source for the reason the gate below is: rendering
    // the hub needs the shell's mount, its permission answers and a
    // Firestore instance, and a mock deep enough to reach this line would be
    // asserting on the mock.
    const hub = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'libs',
        'plugins',
        'marketplace',
        'src',
        'lib',
        'components',
        'marketplace-hub.component.tsx',
      ),
      'utf8',
    )
    expect(hub).toMatch(/<MarketplacePaymentsNotice \/>/)
  })
})

describe('the hub behind the flag is release-gated (AGL-2019)', () => {
  /*
   * The gate is the SHELL's now (AGL-3080). It was a `<FeatureGate>` in the
   * marketplace's own sections layout, because the hub was eight
   * hand-written console routes; it is an `orgNavItems` declaration served
   * by the generic org plugin route, which applies the release flag around
   * every plugin surface from the nav item's `navTabId`.
   *
   * So what has to hold moved with it, and got stronger: the id is RESOLVED
   * against the flag registry rather than matched as text, which is the
   * failure AGL-1654 found — `release_marketplace` named a nav tab that did
   * not exist, so its gate had never once matched anything.
   */
  const hub = listConsoleOrgNavItems().find(
    (entry) => entry.navItem.href === '/marketplace',
  )?.navItem

  beforeAll(async () => {
    resetPluginServicesForTests()
    const entry = CONSOLE_PLUGIN_MANIFEST.find((row) => row.id === 'marketplace')
    const loaded = (await entry?.load()) as Record<string, () => void>
    loaded[String(entry?.register?.console)]()
  })

  it('declares a nav tab id that resolves to release_marketplace', () => {
    const navItem = listConsoleOrgNavItems().find(
      (entry) => entry.navItem.href === '/marketplace',
    )?.navItem
    expect(navItem).toBeDefined()
    expect(releaseFlagForNavTab(navItem?.navTabId)).toBe('release_marketplace')
  })

  it('names a flag that actually exists — a typo would gate nothing', () => {
    // A `navTabId` resolving to nothing fails SILENTLY and in the safe
    // direction: the surface simply stays visible. Which is the worst way to
    // fail — staff flip the flag, watch nothing happen, and conclude the flag
    // is broken.
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
