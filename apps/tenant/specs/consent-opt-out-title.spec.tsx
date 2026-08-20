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
 */

import ConsentBannerUi from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * The words the regulation specifies. Deliberately spelled out here instead
 * of imported: this literal IS the thing under test.
 */
const REQUIRED_TITLE = 'Your Privacy Choices'

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
