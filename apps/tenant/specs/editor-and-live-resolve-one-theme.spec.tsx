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
 * The besigner and the published page resolve ONE theme (AGL-3068).
 *
 * Both sides build the same three layers — platform base, the site's theme,
 * the site's overrides — but only the tenant chose its base from the site it
 * was serving. The canvas took the platform brand for every site, so a
 * customer that leaves slots on "Default" was authored over Aglyn's cyan and
 * published over the neutral tenant palette: different colors, and different
 * contrast, in the two places that must agree. The eval harness saw it as a
 * call to action at 2.42:1 on the canvas that passes on the site.
 *
 * Asserted by rendering BOTH paths — the tenant's own provider, and the
 * factory the canvas and Preview build from — and comparing the palette they
 * resolve. Colors rather than a base identity: the point is not which module
 * was picked, it is that what an author sees is what a visitor gets.
 */

import { createAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import type { HostTheme } from '@aglyn/shared-data-types'
import { useTheme, type Theme } from '@aglyn/shared-ui-theme'
import { render } from '@testing-library/react'
import { HostThemeProviders } from '../app/[host]/host-theme-providers'

/** A customer site with an attached domain of its own. */
const CUSTOMER_HOST = 'cname--ready-to-roll.example'
/** The operator's own marketing host, under the middleware's sentinel. */
const PLATFORM_HOST = 'cname--aglyn.com'

/** A site that opened the theme editor once and set a single accent. */
const ONE_ACCENT: HostTheme = {
  colorSchemes: { light: { primary: { main: '#6b4f3a' } } },
}

/**
 * The palette slots an author reads off a band: the accent, what it is drawn
 * on, and the text pairings a contrast check is made of.
 */
const SLOTS = [
  'primary.main',
  'primary.dark',
  'primary.contrastText',
  'secondary.main',
  'background.default',
  'background.paper',
  'text.primary',
  'text.secondary',
] as const

function readSlots(theme: Theme): Record<string, unknown> {
  const palette = theme.palette as unknown as Record<
    string,
    Record<string, unknown>
  >
  return Object.fromEntries(
    SLOTS.map((slot) => {
      const [group, key] = slot.split('.')
      return [slot, palette[group]?.[key]]
    }),
  )
}

/** What a VISITOR gets: the theme the tenant's own provider resolves. */
function publishedPalette(hostKey: string, hostTheme?: HostTheme) {
  let resolved: Record<string, unknown> | undefined
  function Probe() {
    resolved = readSlots(useTheme())
    return null
  }
  render(
    <HostThemeProviders hostTheme={hostTheme} hostKey={hostKey}>
      <Probe />
    </HostThemeProviders>,
  )
  if (!resolved) throw new Error('the tenant provider rendered no theme')
  return resolved
}

/** What an AUTHOR gets: the theme the canvas and Preview build. */
function canvasPalette(hostKey: string, hostTheme?: HostTheme) {
  return readSlots(
    createAglynSiteTheme({ host: hostKey, theme: hostTheme, scheme: 'light' }),
  )
}

describe('the editor and the published page resolve one theme (AGL-3068)', () => {
  it('agrees on a customer site that has authored no theme at all', () => {
    const live = publishedPalette(CUSTOMER_HOST)
    expect(canvasPalette(CUSTOMER_HOST)).toEqual(live)
    // The premise: this site really is on the neutral default, so the
    // comparison above is not two copies of the brand agreeing.
    expect(live['primary.main']).toBe('#1976d2')
  })

  it('agrees on a customer site whose palette is incomplete', () => {
    const live = publishedPalette(CUSTOMER_HOST, ONE_ACCENT)
    const canvas = canvasPalette(CUSTOMER_HOST, ONE_ACCENT)

    expect(canvas).toEqual(live)
    // The one slot the site set is its own on both sides...
    expect(canvas['primary.main']).toBe('#6b4f3a')
    // ...and the ones it did not are the tenant default's, not the brand's.
    expect(canvas['secondary.main']).toBe('#9c27b0')
  })

  it('keeps the platform brand on the operator’s own host', () => {
    const live = publishedPalette(PLATFORM_HOST)
    expect(canvasPalette(PLATFORM_HOST)).toEqual(live)
    // AGL-1205 in the other direction: the marketing site keeps its cyan in
    // the editor, which is what a tenant-default canvas would have taken away.
    expect(live['primary.main']).toBe('#00b0ff')
  })
})
