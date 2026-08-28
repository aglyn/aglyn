/**
 * @jest-environment jsdom
 *
 * Pragma must lead the FIRST block comment — behind the license header jest
 * silently ignores it, this project's default environment is `node`, and the
 * suite then fails on `document is not defined` rather than on anything it
 * was written to check.
 *
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
 * A published site's consent surface wears the SITE's theme, not Aglyn's.
 *
 * This is the one Aglyn-authored component that appears on a customer's own
 * site, over their own design, and it is the component a visitor is asked to
 * read and trust. Rendered in Aglyn's default palette it reads as a third
 * party's interruption rather than as part of the site — which is both wrong
 * for the operator's brand and, for a consent notice, the wrong impression to
 * give about who is asking.
 *
 * The wiring it depends on is easy to break by accident and invisible when
 * broken. `SiteAnalytics` — which mounts this — is deliberately a SIBLING of
 * the page body and sits above the plugin gate, so it does not inherit
 * anything the page body provides. It is under the host's theme only because
 * `[host]/layout.tsx` wraps the whole route in `HostThemeProviders`. Moving
 * this mount, or moving that provider, would leave every consent surface on
 * every customer site silently unstyled, and no existing test would notice.
 *
 * The dialog is also a PORTAL, which is the specific reason to assert this
 * rather than assume it: portalled content escapes the DOM tree but not React
 * context, and it is a shape people expect to lose styling.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import ConsentBannerUi from './consent-banner-ui'

/**
 * A theme no default could produce by accident.
 *
 * Compared against these exact values rather than against "not the MUI
 * default", so a future change to MUI's own palette cannot make this suite
 * pass or fail for a reason that has nothing to do with the host.
 */
const HOST_PAPER = 'rgb(18, 25, 40)'
const HOST_PRIMARY = 'rgb(255, 92, 0)'

const hostTheme = createTheme({
  palette: {
    background: { paper: HOST_PAPER },
    text: { primary: 'rgb(240, 236, 220)', secondary: 'rgb(240, 236, 220)' },
    primary: { main: HOST_PRIMARY },
  },
})

/** A visitor who has already answered — the state that draws the pill. */
const props = {
  hostId: 'host-1',
  stored: { analytics: 'denied' } as never,
  posture: null,
  advertising: true,
}

function renderWith(theme?: ReturnType<typeof createTheme>) {
  const ui = <ConsentBannerUi {...props} />
  return render(
    theme ? <ThemeProvider theme={theme}>{ui}</ThemeProvider> : ui,
  )
}

/** The persistent "Your Privacy Choices" control every published site draws. */
const pill = () => screen.getByRole('button', { name: 'Your Privacy Choices' })

describe('the consent surface on a published site', () => {
  it('THE CONTROL: it renders something to theme at all', () => {
    // Without this, every assertion below could be reading nothing and
    // comparing two empty strings.
    renderWith(hostTheme)
    expect(pill()).toBeTruthy()
  })

  it('paints the persistent control from the site palette', () => {
    renderWith(hostTheme)
    expect(getComputedStyle(pill()).backgroundColor).toBe(HOST_PAPER)
  })

  it('THE CONTRAST: outside a host theme it is not that palette', () => {
    /*
     * Proves the assertion above is reading the provider and not a value the
     * component produces anywhere. Without it, the case above would pass on a
     * component that hardcoded this color.
     */
    renderWith()
    expect(getComputedStyle(pill()).backgroundColor).not.toBe(HOST_PAPER)
  })

  it('carries the palette into the preferences panel behind it', () => {
    /*
     * The panel is a PORTAL, which is the specific reason to assert this
     * rather than assume it: portalled content escapes the DOM tree but not
     * React context, and losing styling is exactly what people expect a
     * portal to do.
     */
    renderWith(hostTheme)
    fireEvent.click(pill())
    const surface = screen.getByRole('dialog')
    const paper = surface.querySelector('.MuiPaper-root') ?? surface
    expect(getComputedStyle(paper).backgroundColor).toBe(HOST_PAPER)
  })
})

describe('what the site theme may NOT repaint', () => {
  it('leaves the §7015 opt-out mark its regulated colors', () => {
    /*
     * The one deliberate exception. California's §7015 specifies the opt-out
     * icon's appearance, so it is drawn from fixed values rather than the
     * palette — a host whose brand happens to be blue-on-white would
     * otherwise be free to theme a compliance mark into invisibility.
     *
     * Asserted on the SVG's own fills rather than against the constants in
     * the component, so this fails if the mark is ever switched to palette
     * tokens by a sweep that did not know it was different.
     */
    renderWith(hostTheme)
    const fills = Array.from(
      document.querySelectorAll('[data-aglyn-consent-optout-icon] [fill]'),
    ).map((node) => (node.getAttribute('fill') ?? '').toUpperCase())

    expect(fills.length).toBeGreaterThan(0)
    expect(fills).toContain('#0066FF')
    expect(fills.join(' ')).not.toContain(HOST_PRIMARY.toUpperCase())
  })
})
