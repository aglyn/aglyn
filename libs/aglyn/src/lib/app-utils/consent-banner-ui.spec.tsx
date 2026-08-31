/**
 * @jest-environment jsdom
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
 * ONE consent component serves every surface, and the differences between them
 * are strings.
 *
 * There were two implementations of these three surfaces — a plain card with
 * bare checkboxes on published sites, a MUI dialog with switches and
 * descriptions on the console — and they had drifted into two different
 * designs for one product decision. This file is what stops that happening
 * again: it renders the SAME component under two surfaces' copy and asserts
 * that only the words move.
 *
 * The pairing is the whole method. "The console says console" passes on its
 * own against a component that hardcodes the console wording, so every case
 * below renders both surfaces and compares them.
 *
 * PLANTED REDS (all three run, counts observed):
 *  1. Hardcode either surface's wording instead of reading `copy` → 2 fail,
 *     the banner voice and the panel voice. The structural case stays green,
 *     which is exactly right: it asserts the controls do NOT move with the
 *     words, so it is the one case a copy regression must not be able to
 *     explain away.
 *  2. Drop `showPill` and always draw the pill → 1 fails, the case that says a
 *     surface with the control elsewhere gets none here.
 *  3. Persist directly when `onDecision` is set → 1 fails, and it is the one
 *     that keeps the console's own writer — and therefore its cross-hostname
 *     mirror — in the path.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import ConsentBannerUi, {
  CONSENT_OPT_OUT_TITLE,
  type ConsentCopy,
} from './consent-banner-ui'
import {
  readStoredVisitorConsent,
  visitorConsentStorageKey,
} from './visitor-consent'

/** The console's wording, as `visitor-consent.component.tsx` passes it. */
const CONSOLE_COPY: ConsentCopy = {
  panelIntro: 'Choose what this console may use.',
  strictlyNecessary: 'Signing in is always on.',
  bannerAnalyticsOnly: 'This console would like to use analytics.',
}

const HOST = 'consent-ui-host'

function renderAsk(copy?: ConsentCopy) {
  return render(
    <ConsentBannerUi hostId={HOST} stored={null} posture="opt-in" copy={copy} />,
  )
}

/** The implied posture with a record: the persistent control is what shows. */
function renderPill(props: { showPill?: boolean } = {}) {
  return render(
    <ConsentBannerUi
      hostId={HOST}
      stored={{ v: 1, at: 0, status: 'implied', analytics: true }}
      posture={null}
      {...props}
    />,
  )
}

beforeEach(() => window.localStorage.clear())

describe('one component, per-surface words', () => {
  it('asks in the SITE voice and the CONSOLE voice from the same component', () => {
    const site = renderAsk()
    expect(
      screen.getByText(/This site would like to use analytics/),
    ).toBeTruthy()
    site.unmount()

    renderAsk(CONSOLE_COPY)
    expect(
      screen.getByText(/This console would like to use analytics/),
    ).toBeTruthy()
    // …and the site's wording is gone, which is what says the copy is read
    // rather than concatenated.
    expect(screen.queryByText(/This site would like to use/)).toBeNull()
  })

  it('keeps the SAME controls under either voice', () => {
    // The half a copy assertion cannot cover: swapping the words must not swap
    // the design. Allow, Decline and Preferences are the banner's three
    // affordances on every surface, and Decline is never buried.
    for (const copy of [undefined, CONSOLE_COPY]) {
      const view = renderAsk(copy)
      expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Preferences' })).toBeTruthy()
      view.unmount()
    }
  })

  it('names the panel with the regulated title whatever the copy says', () => {
    // §7015 fixes these words. A `copy` prop that could reach them would be a
    // compliance surface disguised as a string.
    renderAsk(CONSOLE_COPY)
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }))
    expect(
      screen.getByRole('heading', { name: CONSENT_OPT_OUT_TITLE }),
    ).toBeTruthy()
    expect(screen.getByText('Choose what this console may use.', { exact: false }))
      .toBeTruthy()
  })
})

describe('where the persistent control is allowed to draw', () => {
  it('draws it by default — a published site has nowhere else to put it', () => {
    renderPill()
    expect(document.querySelector('[data-aglyn-consent-pill]')).not.toBeNull()
  })

  it('draws nothing when the surface says it has the control elsewhere', () => {
    // The console's signed-in pages carry it in the account menu. Floating a
    // second copy over the page is the same control drawn twice, which is the
    // defect this whole consolidation exists to remove.
    renderPill({ showPill: false })
    expect(document.querySelector('[data-aglyn-consent-pill]')).toBeNull()
  })
})

describe('who owns what a decision does', () => {
  it('persists through the shared writer when the caller says nothing', () => {
    renderAsk()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    expect(readStoredVisitorConsent(HOST)?.status).toBe('accepted')
  })

  it('hands the decision over when the caller owns persistence', () => {
    // The console writes through `storePlatformConsent`, which mirrors the
    // record across its hostnames; the region simulator writes nothing at all.
    // Either way this component must not write behind them.
    const decisions: string[] = []
    render(
      <ConsentBannerUi
        hostId={HOST}
        stored={null}
        posture="opt-in"
        onDecision={(status) => decisions.push(status)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))

    expect(decisions).toEqual(['accepted'])
    expect(
      window.localStorage.getItem(visitorConsentStorageKey(HOST)),
    ).toBeNull()
  })
})
