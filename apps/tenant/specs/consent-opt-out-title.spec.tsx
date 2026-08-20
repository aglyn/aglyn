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
 * The persistent opt-out control must be titled **"Your Privacy Choices"**,
 * exactly.
 *
 * This is not a copy preference. Aglyn now deploys advertising technology
 * (Google Ads remarketing, Meta Pixel) on aglyn.com, which is a "share" of
 * personal information for cross-context behavioral advertising. CCPA
 * §1798.135(b) then requires a clear and conspicuous opt-out link, and CCPA
 * regs §7015 permit ONE combined link in place of two only when it carries
 * that exact title. The pill shipped as "Privacy choices", which is not it.
 *
 * A plain string constant cannot defend itself — a well-meaning copy edit
 * ("sentence case, like the rest of the overlay") silently drops Aglyn out of
 * compliance and nothing goes red. So this spec asserts the LITERAL words
 * against the RENDERED control rather than importing
 * `CONSENT_OPT_OUT_TITLE` and comparing it to itself, which would pass no
 * matter what the constant said.
 *
 * Red conditions, each verified by mutation:
 *  - set `CONSENT_OPT_OUT_TITLE` back to 'Privacy choices' → the visible
 *    label, the accessible name and the panel's region name all go red;
 *  - sentence-case it to 'Your privacy choices' → the exact-title assertions
 *    go red while a case-insensitive check would not;
 *  - drop `aria-label` from the pill → the accessible-name assertion goes
 *    red on its own.
 *
 * ## The ICON half (AGL-2011 follow-up)
 *
 * §7015 is a title **and** an icon: the combined link is only good for both
 * notices when it carries the opt-out icon the Attorney General publishes.
 * The title commit shipped the words and deliberately left the mark out
 * rather than draw a regulator's artwork from memory. It is now committed
 * verbatim, so the guard below pins the published geometry rather than the
 * mere presence of an `<svg>` — an approximation is the failure mode this
 * whole exercise exists to prevent.
 *
 * Red conditions, each verified by mutation in a scratch worktree:
 *  - remove `<CcpaOptOutIcon />` from the pill → 6 red;
 *  - swap the shell for a plausible hand-drawn toggle on a 24×24 grid → the
 *    official-artwork assertion goes red (a bare `querySelector('svg')`
 *    would not have);
 *  - recolour the blue to `currentColor`, i.e. to the theme → 2 red;
 *  - move the icon after the title → the §7015 ordering assertion goes red;
 *  - drop `aria-hidden` and give the icon its own `aria-label` → the
 *    decorative assertion goes red;
 *  - stamp the mark on the prior-consent ask banner as well → red;
 *  - give the icon a `<text>` node → the visible-label assertions go red.
 */

import ConsentBannerUi from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * The words the regulation specifies. Deliberately spelled out here instead
 * of imported: this literal IS the thing under test.
 */
const REQUIRED_TITLE = 'Your Privacy Choices'

/**
 * The official artwork's own geometry, spelled out here for the same reason
 * `REQUIRED_TITLE` is: importing the component's constants and comparing them
 * to themselves would pass whatever they said.
 *
 * `viewBox` and the toggle-shell outline are transcribed from the California
 * Attorney General's published `privacyoptions.svg`
 * (`oag.ca.gov/privacy/ccpa/icons-download`, sha256 `86f2eb97cc1f3909…`), the
 * unmodified copy of which is committed at
 * `apps/tenant/public/_static/images/legal/ccpa-opt-out-icon.svg`. The shell
 * is the discriminating path: a hand-drawn approximation of "a blue toggle"
 * would satisfy a mere `querySelector('svg')` and fail this.
 */
const OFFICIAL_VIEWBOX = '0 0 30 14'
const OFFICIAL_SHELL_PATH =
  'M22.6,0H7.4c-3.9,0-7,3.1-7,7s3.1,7,7,7h15.2c3.9,0,7-3.1,7-7S26.4,0,22.6,0z M1.6,7c0-3.2,2.6-5.8,5.8-5.8' +
  ' h9.9l-3.1,11.6H7.4C4.2,12.8,1.6,10.2,1.6,7z'
/** The two colours the regulation's artwork is published in. */
const OFFICIAL_BLUE = '#0066FF'
const OFFICIAL_WHITE = '#FFFFFF'

/**
 * The implied posture with a decision already on file — no banner, no panel,
 * so the pill is the only surface up. This is the state a US visitor to
 * aglyn.com is in on every page after the first, and the state in which the
 * pill is the sole opt-out affordance that exists.
 */
function renderPill(advertising = true) {
  return render(
    <ConsentBannerUi
      hostId="opt-out-title-host"
      stored={{ status: 'implied', analytics: true } as any}
      posture={null}
      advertising={advertising}
    />,
  )
}

function pill(): HTMLElement | null {
  return document.querySelector('[data-aglyn-consent-pill]')
}

describe('the persistent opt-out control carries the CPRA title', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('the pill itself', () => {
    it('renders the exact regulatory title as its visible label', () => {
      renderPill()
      const control = pill()
      expect(control).not.toBeNull()
      // `textContent`, not a substring match: "Privacy choices" is a
      // substring of nothing here, but "Your Privacy Choices and more" would
      // pass a `toContain` and is not the specified title either.
      expect(control?.textContent).toBe(REQUIRED_TITLE)
    })

    it('exposes the same exact title as its accessible name', () => {
      renderPill()
      expect(pill()?.getAttribute('aria-label')).toBe(REQUIRED_TITLE)
      // And the accessible name resolves through the a11y tree, not just the
      // attribute — a screen reader must announce the regulation's words.
      expect(
        screen.getByRole('button', { name: REQUIRED_TITLE }),
      ).toBe(pill())
    })

    it('is case-sensitive: the sentence-cased variant is NOT the title', () => {
      renderPill()
      const label = pill()?.textContent
      expect(label).not.toBe('Privacy choices')
      expect(label).not.toBe('Your privacy choices')
      expect(label).not.toBe('your privacy choices')
    })

    it('is titled the same whether or not the site shares for advertising', () => {
      // A site with advertising off still shows the control, and the title is
      // not conditional on the category set — a visitor cannot be expected to
      // know which link to look for.
      renderPill(false)
      expect(pill()?.textContent).toBe(REQUIRED_TITLE)
    })
  })

  describe('the opt-out ICON that must accompany the title (§7015)', () => {
    const icon = () =>
      pill()?.querySelector('svg[data-aglyn-consent-optout-icon]') ?? null

    it('renders an icon inside the pill at all', () => {
      renderPill()
      expect(icon()).not.toBeNull()
    })

    it('is the OFFICIAL artwork, not an approximation of it', () => {
      renderPill()
      const svg = icon()
      // The AG file's own coordinate space. A redrawn mark on a 24×24 grid —
      // the shape every icon set reaches for — goes red here.
      expect(svg?.getAttribute('viewBox')).toBe(OFFICIAL_VIEWBOX)

      const paths = Array.from(svg?.querySelectorAll('path') ?? [])
      const outlines = paths.map((p) => p.getAttribute('d'))
      // Exact path data, not a fuzzy match: this is the published mark.
      expect(outlines).toContain(OFFICIAL_SHELL_PATH)
      // All four shapes of the published file: the white left field, the
      // blue shell, the white cross, the blue check.
      expect(paths).toHaveLength(4)

      const fills = paths.map((p) => p.getAttribute('fill'))
      expect(fills).toEqual([
        OFFICIAL_WHITE,
        OFFICIAL_BLUE,
        OFFICIAL_WHITE,
        OFFICIAL_BLUE,
      ])
    })

    it('is not recoloured to a theme', () => {
      renderPill()
      // Every painted colour is one of the regulation's two. A tenant palette
      // leaking in here — `currentColor` included, which would take the
      // pill's `#333` — is a modification of a regulator's mark.
      const fills = Array.from(icon()?.querySelectorAll('path') ?? []).map(
        (p) => p.getAttribute('fill'),
      )
      // Counted first: `[].every(…)` is `true`, so a missing icon would
      // otherwise certify its own colours.
      expect(fills).toHaveLength(4)
      expect(fills.every((f) => f === OFFICIAL_BLUE || f === OFFICIAL_WHITE))
        .toBe(true)
    })

    it('sits immediately BEFORE the title, per §7015', () => {
      renderPill()
      const control = pill() as HTMLElement
      // The icon is the pill's first child, and the words follow it.
      // Asserted non-null on its own line: `firstElementChild` is also null
      // when there is no icon, and `expect(null).toBe(null)` is a pass.
      expect(icon()).not.toBeNull()
      expect(control.firstElementChild).toBe(icon())
      expect(control.lastChild?.textContent).toBe(REQUIRED_TITLE)
    })

    it('is decorative: it does not say the title a second time', () => {
      renderPill()
      expect(icon()?.getAttribute('aria-hidden')).toBe('true')
      // Nothing inside the icon contributes an accessible name of its own.
      expect(icon()?.querySelector('title')).toBeNull()
      expect(icon()?.getAttribute('aria-label')).toBeNull()
      // …and the accessible name of the CONTROL is still exactly the title,
      // announced once.
      expect(screen.getByRole('button', { name: REQUIRED_TITLE })).toBe(pill())
    })

    it('adds no text of its own to the visible label', () => {
      // Guards the title assertions above against a future icon that carries
      // a `<text>` node: `textContent` would then read "Your Privacy Choices"
      // plus whatever it said, and the exact-title check would go red for a
      // reason nobody would guess.
      renderPill()
      expect(pill()?.textContent).toBe(REQUIRED_TITLE)
    })

    it('renders whether or not the site shares for advertising', () => {
      renderPill(false)
      expect(icon()).not.toBeNull()
    })

    it('does NOT appear on the one-time prior-consent ask banner', () => {
      // That banner is a consent solicitation, not the persistent §7015 link
      // — it is deliberately titled "Privacy choices" and stamping the
      // regulator's mark on it would advertise it as the thing it is not.
      render(
        <ConsentBannerUi
          hostId="opt-out-icon-ask-host"
          stored={null}
          posture="opt-in"
          advertising
        />,
      )
      const banner = document.querySelector('[data-aglyn-consent-banner]')
      expect(banner).not.toBeNull()
      expect(
        banner?.querySelector('[data-aglyn-consent-optout-icon]'),
      ).toBeNull()
    })
  })

  describe('reachability', () => {
    it('opens the preferences panel when the pill is activated', () => {
      renderPill()
      fireEvent.click(pill() as HTMLElement)
      expect(
        document.querySelector('[data-aglyn-consent-preferences]'),
      ).not.toBeNull()
    })

    it('still opens from an `#aglyn-consent` link anywhere on the page', () => {
      // The documented alternative entry point. A site that puts its own
      // footer link in place of the pill still has to land the visitor on the
      // same mechanism, so this path may not rot.
      renderPill()
      const anchor = document.createElement('a')
      anchor.setAttribute('href', '/somewhere#aglyn-consent')
      anchor.textContent = 'Your Privacy Choices'
      document.body.appendChild(anchor)

      fireEvent.click(anchor)

      expect(
        document.querySelector('[data-aglyn-consent-preferences]'),
      ).not.toBeNull()
    })

    it('names the panel the pill opens with the same exact title', () => {
      // The consumer activates a control called "Your Privacy Choices"; the
      // region they land in announces itself the same way.
      renderPill()
      fireEvent.click(pill() as HTMLElement)
      const panel = document.querySelector('[data-aglyn-consent-preferences]')
      expect(panel?.getAttribute('aria-label')).toBe(REQUIRED_TITLE)
    })
  })
})
