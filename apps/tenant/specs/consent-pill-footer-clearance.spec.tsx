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
 * The "Privacy choices" pill must not park on the footer's copyright line
 * (AGL-2205).
 *
 * Measured on the live aglyn.com/pricing before the fix: the pill occupied
 * x 12–126, y 680–711 and the copyright row x 24–258, y 669–689 — a 102 × 9
 * px overlap at 1440×723, and the same shape again at 375×812, where the
 * pill's 769–800 band cut into a 760–780 copyright row.
 *
 * jsdom has no layout engine, so the pill's box is planted rather than
 * measured; what these specs pin is the DECISION made from that box — how
 * much room is reserved, where it is reserved, and that a template which
 * already leaves enough is left alone. The geometry itself is pinned
 * separately against the numbers above, and the end-to-end proof is the
 * before/after `getBoundingClientRect()` pass on the rendered page.
 *
 * Red conditions, each verified by mutation:
 *  - drop the `useConsentPillClearance` call → no padding is reserved;
 *  - reserve a constant instead of the measured deficit → the
 *    already-roomy-footer case goes red;
 *  - target `document.body` instead of the footer landmark → the footer case
 *    goes red.
 */

import ConsentBannerUi, {
  consentPillClearance,
} from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { render } from '@testing-library/react'

/** The pill's real box on aglyn.com: 30.8px tall, sitting 12px off the bottom. */
const PILL_HEIGHT = 30.796875
const PILL_BOTTOM_OFFSET = 12
/** ceil(30.796875 + 12) + 8px clearance. */
const EXPECTED_RESERVED = '51px'

/**
 * jsdom reports a zero box for everything, which would make the pill look
 * like it sits at the very top of the viewport and ask for a viewport-tall
 * reservation. Only the PILL is planted — every other element keeps the
 * zero box, so nothing here can pass by accident of a stubbed layout.
 */
function plantPillBox(): void {
  const real = Element.prototype.getBoundingClientRect
  jest
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      if (!this.hasAttribute?.('data-aglyn-consent-pill')) {
        return real.call(this)
      }
      const top = window.innerHeight - PILL_BOTTOM_OFFSET - PILL_HEIGHT
      return {
        top,
        bottom: window.innerHeight - PILL_BOTTOM_OFFSET,
        left: 12,
        right: 126.34375,
        width: 114.34375,
        height: PILL_HEIGHT,
        x: 12,
        y: top,
        toJSON: () => ({}),
      } as DOMRect
    })
}

/** A page whose last row is the copyright line, as every marketing page is. */
function plantFooter(paddingBottom?: string): HTMLElement {
  const footer = document.createElement('footer')
  if (paddingBottom) footer.style.paddingBottom = paddingBottom
  footer.innerHTML = '<p>© 2026 Aglyn LLC. All rights reserved.</p>'
  document.body.appendChild(footer)
  return footer
}

/** The implied posture: no banner, no panel — the pill is the only surface. */
function renderPill() {
  return render(
    <ConsentBannerUi
      hostId="clearance-host"
      stored={{ status: 'implied', analytics: true } as any}
      posture={null}
    />,
  )
}

describe('consent pill footer clearance (AGL-2205)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    document.body.innerHTML = ''
    document.body.removeAttribute('style')
  })

  describe('the geometry, against the measured live boxes', () => {
    it('reserves the pill height, its offset and a gap', () => {
      // 723px viewport, pill top 680.203125 — the 1440-wide measurement.
      expect(consentPillClearance(723, 680.203125)).toBe(51)
      // 812px viewport, pill top 769.203125 — the 375-wide measurement.
      expect(consentPillClearance(812, 769.203125)).toBe(51)
    })

    it('follows a pill that grew, rather than trusting the constants', () => {
      // A wrapped two-line label: 20px taller pill, 20px more room.
      expect(consentPillClearance(723, 660.203125)).toBe(71)
    })

    it('asks for nothing it cannot measure', () => {
      expect(consentPillClearance(Number.NaN, 100)).toBe(0)
      expect(consentPillClearance(723, Number.NaN)).toBe(0)
      // A pill somehow below the fold reserves nothing, never a negative.
      expect(consentPillClearance(723, 900)).toBe(0)
    })
  })

  describe('what the mounted pill reserves', () => {
    it('clears the copyright row by reserving room in the footer', () => {
      plantPillBox()
      const footer = plantFooter()
      renderPill()
      expect(footer.style.paddingBottom).toBe(EXPECTED_RESERVED)
      // And the reservation is real: the last row now ends above the pill.
      const reserved = Number.parseFloat(footer.style.paddingBottom)
      const pillTop = window.innerHeight - PILL_BOTTOM_OFFSET - PILL_HEIGHT
      expect(window.innerHeight - reserved).toBeLessThan(pillTop)
    })

    it('adds only the DEFICIT, so a roomy footer is untouched', () => {
      plantPillBox()
      const footer = plantFooter('80px')
      renderPill()
      // 80px already clears a 51px pill zone — reserving on top of that is
      // the "odd gap" AGL-2205 warned about, so nothing is added.
      expect(footer.style.paddingBottom).toBe('80px')
    })

    it('falls back to the body when the page has no footer landmark', () => {
      plantPillBox()
      renderPill()
      expect(document.body.style.paddingBottom).toBe(EXPECTED_RESERVED)
    })

    it('finds a hand-rolled footer by its landmark role', () => {
      plantPillBox()
      const region = document.createElement('div')
      region.setAttribute('role', 'contentinfo')
      document.body.appendChild(region)
      renderPill()
      expect(region.style.paddingBottom).toBe(EXPECTED_RESERVED)
      expect(document.body.style.paddingBottom).toBe('')
    })

    it("gives back a footer's own padding on unmount", () => {
      plantPillBox()
      const footer = plantFooter('80px')
      const { unmount } = renderPill()
      unmount()
      expect(footer.style.paddingBottom).toBe('80px')
    })

    it('leaves no padding behind on a footer that had none', () => {
      plantPillBox()
      const footer = plantFooter()
      const { unmount } = renderPill()
      expect(footer.style.paddingBottom).toBe(EXPECTED_RESERVED)
      unmount()
      // Removed, not frozen at the value this effect invented.
      expect(footer.style.paddingBottom).toBe('')
    })

    it('re-measures on resize instead of ratcheting its own value up', () => {
      plantPillBox()
      const footer = plantFooter()
      renderPill()
      expect(footer.style.paddingBottom).toBe(EXPECTED_RESERVED)
      window.dispatchEvent(new Event('resize'))
      // Reading back its own reservation as the site's padding would give
      // 51 → 102 → 153px, a footer that grows every time the window moves.
      expect(footer.style.paddingBottom).toBe(EXPECTED_RESERVED)
    })
  })
})
