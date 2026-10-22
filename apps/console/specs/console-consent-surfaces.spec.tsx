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
 * @jest-environment jsdom
 */

/**
 * The console's consent surfaces, and WHERE each one belongs.
 *
 * Four things are pinned here, and the second is the one that can be got wrong
 * silently.
 *
 * 1. **Reachability, and placement.** The persistent control follows the
 *    account menu: signed in it is a row in that menu and nothing floats over
 *    the page; on the unauthenticated pages, which have no menu at all, it is
 *    the pill. Both cases click the real control rather than asserting one
 *    exists, and the pill's own case pairs with "no pill where the menu is",
 *    so neither placement can drift into the other.
 *
 * 2. **The switch is DERIVED from the resolved verdict.** Same component, two
 *    regions, opposite default states:
 *
 *    - Outside the prior-consent regions the visitor IS being measured under
 *      implied consent, so the switch must read ON. This control is their
 *      withdrawal path; showing it off would misdescribe what is happening to
 *      them.
 *    - Inside them nothing is collected until they accept, so it must read OFF
 *      — and no record may be written on their behalf. A ticked box shown to
 *      someone who has not consented misrepresents their state, and that is
 *      the failure that matters most.
 *
 *    The pair is what makes either half meaningful. An `unchecked` assertion
 *    on its own passes just as well against a switch hardcoded off, which is
 *    why the accept case below is here: same region, same absent record, one
 *    click between them.
 *
 * 3. **The banner covers what the menu cannot.** The console's most-collected
 *    public page is `/signin`, where there is no account menu and no signed-in
 *    user. The banner cases render the component WITHOUT the menu, which is
 *    what that page actually is, and pair "asks in a prior-consent region"
 *    with "asks nobody outside one" so neither reads as an accident.
 *
 * PLANTED REDS (all three run, counts observed):
 *  1. Pin the switch ON instead of reading the record → 3 fail: both
 *     prior-consent cases and the accept control. The rest-of-world case
 *     passes, and its passing is the tell — a hardcoded ON is indisting-
 *     uishable from a correct ON if that is the only case you have.
 *  2. Pin it OFF → the opposite 2 fail. Between them the two mutations leave
 *     no constant that satisfies this file.
 *  3. Rename the account-menu row → every account-menu case fails, because
 *     they reach the panel through the menu rather than through the event the
 *     menu dispatches. That is deliberate: an event can be dispatched by a
 *     test whether or not anything in the product dispatches it.
 *  4. Unmount the pill from the signed-out shell → 1 fails, the shell case,
 *     and the behavioural pill cases do not. That is the point of having both:
 *     the control can be perfectly correct and mounted nowhere.
 *  5. Draw the pill whenever the panel is closed, ignoring the request and the
 *     banner → 9 fail. Six are the account-menu cases, because a pill nobody
 *     asked for puts a second copy of the regulated title on the page and the
 *     menu row stops being unambiguous — which is the collision itself, in the
 *     accessibility tree rather than in pixels.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PLATFORM_CONSENT_SUBJECT } from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { CONSENT_OPT_OUT_TITLE } from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { visitorConsentStorageKey } from '@aglyn/aglyn/app-utils/visitor-consent'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import VisitorConsent, {
  VisitorConsentPill,
} from '../components/visitor-consent.component'
import { UserMenu } from '../components/user-menu.component'

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { email: 'person@example.com' } }),
  useUserName: () => 'A Person',
  useUserPhoto: () => '',
}))
jest.mock('@aglyn/aglyn', () => ({
  isEnterpriseOrg: () => false,
  PLAN_LABELS: {},
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  MdiIcon: () => null,
}))
// Every icon, by name, without listing them. A hand-written list is what made
// the first run of this file red for a reason that had nothing to do with
// consent: `shared-data-enums` builds its own `ICON_VARIANT_*` constants out of
// this module, so an unlisted glyph is `undefined.path` three files away.
jest.mock(
  '@aglyn/shared-data-mdi',
  () =>
    new Proxy(
      {},
      {
        get: (_target, key) =>
          key === '__esModule' ? true : { id: String(key), path: 'M0 0' },
      },
    ),
)
jest.mock('../components/member-avatar.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/report-issue-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: null, ready: true }),
}))
jest.mock('../hooks/use-is-staff', () => ({ useIsStaff: () => false }))
jest.mock('../hooks/use-org-reach', () => ({
  useOrgReach: () => ({ orgWide: false, ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: null }),
  useOrgSlug: () => '',
}))
jest.mock('../hooks/use-secondary-nav', () => ({ useUrlNamesOrg: () => false }))
// The colour-scheme hook needs a CssVars provider the console supplies in
// production and this case has no business standing up. Everything else in
// `@mui/material/styles` stays real, because the dialog is rendered for
// assertion, not stubbed.
jest.mock('@mui/material/styles', () => ({
  ...jest.requireActual('@mui/material/styles'),
  useColorScheme: () => ({ mode: 'light', setMode: jest.fn() }),
}))

/**
 * The zone the browser reports, driven per case. Only the READING is mocked;
 * the zone-to-posture mapping stays real.
 */
let mockTimeZone = 'Etc/GMT+3'
jest.mock('@aglyn/aglyn/app-utils/timezone-geo-hint', () => ({
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/timezone-geo-hint',
  ),
  readBrowserTimeZone: () => mockTimeZone,
}))

const savedFetch = (global as unknown as { fetch?: unknown }).fetch

/** Answer the region endpoint with one country, as the edge would. */
function serveRegion(country: string | null): void {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ country }),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  mockTimeZone = 'Etc/GMT+3'
})
afterAll(() => {
  ;(global as unknown as { fetch?: unknown }).fetch = savedFetch
})

/** Mount the two surfaces that make this path work, and settle the decision. */
async function mountConsole(country: string | null): Promise<void> {
  serveRegion(country)
  await act(async () => {
    render(
      <>
        <VisitorConsent />
        <UserMenu />
      </>,
    )
  })
}

/** Walk the account menu the way a person does. */
async function openPanelFromAccountMenu(): Promise<void> {
  fireEvent.click(screen.getByLabelText('Manage account', { selector: 'button' }))
  fireEvent.click(await screen.findByText(CONSENT_OPT_OUT_TITLE))
  await screen.findByRole('dialog')
}

const analyticsSwitch = (): HTMLInputElement =>
  screen.getByRole('switch', { name: 'Analytics' }) as HTMLInputElement

const storedRecord = (): string | null =>
  window.localStorage.getItem(visitorConsentStorageKey(PLATFORM_CONSENT_SUBJECT))

describe('the console privacy control in the account menu', () => {
  it('opens the privacy panel from the account menu', async () => {
    await mountConsole('US')
    await openPanelFromAccountMenu()
    // The title is the regulated one, taken from the shared constant, so this
    // also fails if the row and the panel ever stop naming the same thing.
    expect(
      screen.getByRole('heading', { name: CONSENT_OPT_OUT_TITLE }),
    ).toBeTruthy()
  })

  it('reads ON for a rest-of-world visitor, who is being measured', async () => {
    await mountConsole('US')
    await openPanelFromAccountMenu()
    expect(analyticsSwitch().checked).toBe(true)
    // Because implied consent was actually recorded — the switch is describing
    // the record, not a preference.
    expect(JSON.parse(storedRecord() ?? '{}')).toMatchObject({
      status: 'implied',
      analytics: true,
      country: 'US',
    })
  })

  it('reads OFF for a prior-consent-region visitor who has not accepted', async () => {
    await mountConsole('DE')
    await openPanelFromAccountMenu()
    expect(analyticsSwitch().checked).toBe(false)
    // And nothing was written on their behalf. Backfilling an `accepted`
    // record for an existing user would fabricate a consent nobody gave, and
    // here it would fabricate the kind that may not be assumed at all.
    expect(storedRecord()).toBeNull()
  })

  it('reads OFF for an unknown region too', async () => {
    // No geo header AND a zone that says nothing. It resolves to the strict
    // side, so the control has to agree.
    mockTimeZone = 'Etc/GMT+3'
    await mountConsole(null)
    await openPanelFromAccountMenu()
    expect(analyticsSwitch().checked).toBe(false)
    expect(storedRecord()).toBeNull()
  })

  it('reads ON in the same region once they accept — the control for OFF', async () => {
    // Same region and same absent record as the case above; one click between
    // them. Without this, "unchecked" would pass against a switch that is
    // simply never checked.
    await mountConsole('DE')
    await openPanelFromAccountMenu()
    expect(analyticsSwitch().checked).toBe(false)

    fireEvent.click(analyticsSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Save choices' }))
    await waitFor(() => expect(storedRecord()).not.toBeNull())
    expect(JSON.parse(storedRecord() ?? '{}')).toMatchObject({
      status: 'accepted',
      analytics: true,
      country: 'DE',
    })

    await openPanelFromAccountMenu()
    expect(analyticsSwitch().checked).toBe(true)
  })

  it('records a WITHDRAWAL, not a decline, for a visitor who was defaulted in', async () => {
    // The two refusals are the same gate and a different record, and the
    // distinction is the answer to "how many visitors were tracked before they
    // said no". A rest-of-world visitor was; a European one never was.
    await mountConsole('US')
    await openPanelFromAccountMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Decline all' }))
    await waitFor(() =>
      expect(JSON.parse(storedRecord() ?? '{}').status).toBe('opted-out'),
    )
    expect(JSON.parse(storedRecord() ?? '{}')).toMatchObject({
      analytics: false,
      advertising: false,
    })
  })
})

describe('the console consent banner', () => {
  const banner = () => document.querySelector('[data-aglyn-consent-banner]')

  it('asks a prior-consent-region visitor, on a page with no account menu', async () => {
    // `/signin` is this surface's most-collected page and it has no account
    // menu at all, so the menu cannot be the only control. Rendered here
    // WITHOUT the menu, which is what that page looks like.
    serveRegion('DE')
    await act(async () => {
      render(<VisitorConsent />)
    })
    expect(banner()).not.toBeNull()
    /*
     * `Allow all`, not `Allow` — the label follows
     * `platformAsksAboutAdvertising`, which is derived from the shipped
     * consent-mode declaration. Asserting the bare word would pass whether or
     * not the advertising question is being asked, which is the thing this
     * banner most has to get right.
     */
    expect(screen.getByRole('button', { name: 'Allow all' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
  })

  it('asks NOBODY outside those regions — the control for the case above', async () => {
    // Implied consent means no banner and no notice: the account menu is the
    // opt-out surface. A banner shown to everyone would make the case above
    // pass for no reason at all.
    serveRegion('US')
    await act(async () => {
      render(<VisitorConsent />)
    })
    expect(banner()).toBeNull()
  })

  it('goes away once answered, and records the answer', async () => {
    serveRegion('DE')
    await act(async () => {
      render(<VisitorConsent />)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }))
    await waitFor(() => expect(banner()).toBeNull())
    expect(JSON.parse(storedRecord() ?? '{}')).toMatchObject({
      status: 'accepted',
      analytics: true,
      country: 'DE',
    })
  })

  it('floats no pill over a page that has an account menu', async () => {
    // Where the persistent control lives is decided by whether the page has
    // an account menu, and a signed-in console page does. Nothing floats over
    // it — the control is the menu row the cases above click through.
    serveRegion('US')
    await act(async () => {
      render(
        <>
          <VisitorConsent />
          <UserMenu />
        </>,
      )
    })
    expect(document.querySelector('[data-aglyn-consent-pill]')).toBeNull()
  })
})

describe('the console privacy control where there is no account menu', () => {
  // The unauthenticated pages — sign-in, sign-up, account recovery, SSO,
  // email verification, sign-out. `/signin` is the console's most-collected
  // page and it has no menu to put a row in, so the same control takes the
  // form a page with no chrome can carry.

  it('is reachable, and opens the same panel', async () => {
    // Implied posture, so there is no banner and this control is the only
    // thing on the page a visitor can use to change their mind.
    serveRegion('US')
    await act(async () => {
      render(
        <>
          <VisitorConsent />
          <VisitorConsentPill />
        </>,
      )
    })
    const pill = document.querySelector('[data-aglyn-consent-pill]')
    expect(pill).not.toBeNull()

    fireEvent.click(pill as Element)
    expect(
      screen.getByRole('heading', { name: CONSENT_OPT_OUT_TITLE }),
    ).toBeTruthy()
  })

  it('carries the words and the mark the regulation specifies', async () => {
    // CCPA regs §7015 fixes the title of a single combined opt-out control and
    // requires the opt-out icon immediately to its left. Both come from the
    // shared overlay rather than being restated here, so this fails if either
    // is swapped for a local approximation.
    serveRegion('US')
    await act(async () => {
      render(
        <>
          <VisitorConsent />
          <VisitorConsentPill />
        </>,
      )
    })
    const pill = document.querySelector('[data-aglyn-consent-pill]') as Element
    expect(pill.textContent).toContain(CONSENT_OPT_OUT_TITLE)
    expect(pill.querySelector('svg')).not.toBeNull()
  })

  it('yields to the banner rather than stacking under it', async () => {
    // Both are fixed to the bottom of the viewport, and a visitor being asked
    // does not also need a control telling them they may choose. The ask wins;
    // the control returns the moment it is answered.
    serveRegion('DE')
    await act(async () => {
      render(
        <>
          <VisitorConsent />
          <VisitorConsentPill />
        </>,
      )
    })
    expect(document.querySelector('[data-aglyn-consent-banner]')).not.toBeNull()
    expect(document.querySelector('[data-aglyn-consent-pill]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }))
    await waitFor(() =>
      expect(document.querySelector('[data-aglyn-consent-pill]')).not.toBeNull(),
    )
  })

  it('is drawn for a page that asks, and for no other — the control', () => {
    // The pill is a request, not a widget: a page with an account menu never
    // mounts one, and the owner draws nothing. Without this the "no pill where
    // the menu is" case above could pass for the wrong reason.
    serveRegion('US')
    render(<VisitorConsent />)
    expect(document.querySelector('[data-aglyn-consent-pill]')).toBeNull()
  })

  it('draws the SHARED component, not a console copy of it', () => {
    // The consolidation, pinned where it can regress: the console used to have
    // its own dialog and the published sites their own card, and the two had
    // already become different designs for one product decision. What stops
    // that returning is not a convention — it is that this file contains no
    // overlay of its own to drift.
    const component = readFileSync(
      resolve(__dirname, '../components/visitor-consent.component.tsx'),
      'utf8',
    )
    expect(component).toMatch(
      /from '@aglyn\/aglyn\/app-utils\/consent-banner-ui'/,
    )
    expect(component).toMatch(/<ConsentBannerUi/)
    // …and none of the pieces it would need to draw one itself.
    for (const own of ['<Dialog', '<DialogTitle', '<Switch', '<Paper']) {
      expect(component).not.toContain(own)
    }
  })

  it('is mounted by the signed-out SHELL, not page by page', () => {
    // The placement rule, pinned as source because that is what it is a claim
    // about: every unauthenticated route renders through this layout, so the
    // control is inherited rather than remembered. A page-by-page mount would
    // pass every behaviour test above and still leave the next auth route
    // without a control.
    const layout = readFileSync(
      resolve(__dirname, '../components/layouts/authenticating.layout.tsx'),
      'utf8',
    )
    expect(layout).toMatch(/<VisitorConsentPill \/>/)
    expect(layout).toMatch(
      /from '\.\.\/visitor-consent\.component'/,
    )
  })
})
