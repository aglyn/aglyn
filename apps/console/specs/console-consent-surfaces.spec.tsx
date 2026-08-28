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
 * The console's two consent surfaces: the account-menu panel, and the banner
 * that reaches a page which has no account menu.
 *
 * Three things are pinned here, and the second is the one that can be got
 * wrong silently.
 *
 * 1. **Reachability.** A signed-in person's persistent path to their own
 *    privacy choices is the account menu — there is no floating pill on this
 *    surface. The menu has to actually open the panel, so the case clicks
 *    through the real menu rather than asserting a row exists.
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
 *  3. Rename the account-menu row → all 6 fail, because every case reaches
 *     the panel through the menu rather than through the event the menu
 *     dispatches. That is deliberate: an event can be dispatched by a test
 *     whether or not anything in the product dispatches it.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PLATFORM_CONSENT_SUBJECT } from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { CONSENT_OPT_OUT_TITLE } from '@aglyn/aglyn/app-utils/consent-banner-ui'
import { visitorConsentStorageKey } from '@aglyn/aglyn/app-utils/visitor-consent'
import type { ReactNode } from 'react'
import VisitorConsent from '../components/visitor-consent.component'
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
    // The headerless visit — local dev, a self-hosted install, a stripped
    // proxy. It resolves to the strict side, so the control has to agree.
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

  it('never renders a persistent on-screen pill', async () => {
    // The explicit product decision, and the one thing this surface does
    // differently from a published customer site: the persistent control is
    // the account-menu row, not a floating widget. A regression here looks
    // like a working feature, which is why it is asserted rather than assumed.
    serveRegion('US')
    await act(async () => {
      render(<VisitorConsent />)
    })
    expect(document.querySelector('[data-aglyn-consent-pill]')).toBeNull()

    // …and the panel is still reachable without one, which is what makes its
    // absence acceptable rather than a removal.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('aglyn:consent:open'))
    })
    expect(
      screen.getByRole('heading', { name: CONSENT_OPT_OUT_TITLE }),
    ).toBeTruthy()
  })
})
