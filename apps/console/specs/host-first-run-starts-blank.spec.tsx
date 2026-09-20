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
 *
 * @jest-environment jsdom
 */

/**
 * The blank path is what a new site gets (AGL-2918).
 *
 * The page a newly created site lands on draws the `hostFirstRun` zone above
 * its own cards, where a widget may offer to start the site from a few
 * questions. This spec is the CONTROL on the way out of that offer, from the
 * console's side:
 *
 * - the page below the zone is the ordinary one, drawn whether a widget is
 *   there or not — so a workspace the feature is not released to loses
 *   nothing and gains no empty band;
 * - the zone is handed a `startBlank`, and taking it puts the person on that
 *   ordinary page with nothing created;
 * - the choice is remembered, so a reload does not ask again;
 * - and it is offered to a NEW site only, which is the condition that was
 *   missing (see `an established site` below).
 *
 * Reverting the skip — dropping `startBlank` from the zone's props, or
 * leaving the card up after it is taken — must turn this file red.
 */

import { fireEvent, render, screen } from '@testing-library/react'

/** The widgets the registry answers with for `hostFirstRun`. */
let mockWidgets: Array<Record<string, unknown>> = []
/** The props the zone handed the widget on its last render. */
let lastZoneProps: Record<string, unknown> | undefined

function MockFirstRunWidget(props: Record<string, unknown>) {
  lastZoneProps = props
  return (
    <div>
      <span>{'guided start'}</span>
      <button type="button" onClick={props['startBlank'] as () => void}>
        {'Skip and start blank'}
      </button>
    </div>
  )
}

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  listConsoleWidgets: (slot: string) =>
    slot === 'hostFirstRun'
      ? mockWidgets.map((widget) => ({
          extension: { pluginId: 'demo', displayName: 'Demo' },
          widget,
        }))
      : [],
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'u1' } }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'pro' }, orgId: 'org-1', ready: true }),
  useCurrentOrg: () => ({ org: { $id: 'org-1', plan: 'pro' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: {}, can: () => true, loaded: true }),
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => ['demo'],
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgSlug: () => 'acme',
}))
jest.mock('../components/host-id-provider', () => ({
  __esModule: true,
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
/**
 * The site the page is looking at, as the settings layout hands it down.
 *
 * `screens` is the routing map publishing writes, and it is what says whether
 * this site is still blank — so it is a fixture here rather than a constant.
 * `hostHasEmitted` rides with it because "the document has not arrived" and
 * "the document says nothing is published" are the same shape and must not be
 * the same answer.
 */
let mockHost: Record<string, unknown> = {}
let mockHostHasEmitted = true

/** A site with pages a visitor can reach — what `aglyn-marketing` is. */
const ESTABLISHED_SITE = {
  screens: { 's1': 'home', 's2': 'about', 's3': 'contact' },
}

jest.mock('../app/(app)/[orgSlug]/hosts/[host]/host-settings-scope', () => ({
  __esModule: true,
  useHostSettingsScope: () => ({
    hostId: 'host-1',
    data: mockHost,
    hostHasEmitted: mockHostHasEmitted,
  }),
}))

// The page's own cards, which read the host document and are not what this
// spec is about. Each renders its name, so "the ordinary page is still here"
// is an assertion about the real list rather than about an empty container.
jest.mock('../components/logo-card.component', () => ({
  __esModule: true,
  default: () => <div>{'Logo card'}</div>,
}))
jest.mock('../components/business-details-card.component', () => ({
  __esModule: true,
  default: () => <div>{'Business details card'}</div>,
}))
jest.mock('../components/built-in-page-layout-card.component', () => ({
  __esModule: true,
  default: () => <div>{'Built-in page layout card'}</div>,
}))
jest.mock('../components/languages-card.component', () => ({
  __esModule: true,
  default: () => <div>{'Languages card'}</div>,
}))

import HostSetupDetailsSection from '../app/(app)/[orgSlug]/hosts/[host]/setup/(sections)/details/page'
import { hostStartedBlank } from '../utils/host-first-run'

/** Every card the page draws for itself, regardless of any widget above them. */
const ORDINARY_PAGE = [
  'Logo card',
  'Business details card',
  'Built-in page layout card',
  'Languages card',
]

const expectOrdinaryPage = () => {
  for (const card of ORDINARY_PAGE) expect(screen.getByText(card)).toBeTruthy()
}

beforeEach(() => {
  window.localStorage.clear()
  lastZoneProps = undefined
  // A site created a minute ago: its document has arrived and publishes
  // nothing. `/api/hosts/create` writes exactly `screens: {}` and seeds no
  // starter (AGL-687), so this is what a new site really looks like.
  mockHost = {}
  mockHostHasEmitted = true
  mockWidgets = [
    { slot: 'hostFirstRun', widgetId: 'demo-start', Component: MockFirstRunWidget },
  ]
})

describe('the page a new site lands on', () => {
  it('is the ordinary page, with the first-run zone above it', async () => {
    render(<HostSetupDetailsSection />)
    expect(await screen.findByText('guided start')).toBeTruthy()
    expectOrdinaryPage()
  })

  it('is the whole page when no widget offers a start', async () => {
    mockWidgets = []
    render(<HostSetupDetailsSection />)
    expectOrdinaryPage()
    expect(screen.queryByText('guided start')).toBeNull()
  })

  it('hands the zone the site, its org and the way back to the blank path', async () => {
    render(<HostSetupDetailsSection />)
    await screen.findByText('guided start')
    expect(lastZoneProps).toEqual(
      expect.objectContaining({
        hostId: 'host-1',
        orgId: 'org-1',
        orgSlug: 'acme',
        host: 'shop',
        startBlank: expect.any(Function),
      }),
    )
  })
})

/**
 * The condition that was missing (AGL-2918).
 *
 * Setup → Basic details is where a new site lands, and the zone was drawn on
 * it for that reason — but it is also the setup page of every site that has
 * ever existed, and the only thing gating the zone was `hostStartedBlank`,
 * which asks whether THIS BROWSER dismissed the offer. An established site
 * opened in a browser that had never dismissed anything got the guided start
 * over the top of it: reported on `aglyn-marketing`, 26 screens, where the
 * full screen dialog opened on a site years into its life.
 *
 * Each test here fails on the code that shipped, because on that code the
 * site's own state was not consulted at all. The blast radius was staff-only
 * while `release_ai_generative` was off — the widget is absent without it —
 * so these are written against the ZONE rather than against any widget: the
 * console's job is not to offer, and it must not be offering when the flag
 * moves.
 */
describe('an established site', () => {
  it('is not offered a start it is years past', async () => {
    mockHost = ESTABLISHED_SITE
    render(<HostSetupDetailsSection />)
    expectOrdinaryPage()
    expect(screen.queryByText('guided start')).toBeNull()
  })

  /**
   * The dismissal is not what is doing the work here.
   *
   * Every other path out of the offer runs through `hostStartedBlank`, so a
   * fix that only ever tightened THAT would pass a test written on a fresh
   * browser by accident. This one states the property on its own: nothing has
   * been dismissed, the browser is clean, and the site is still not asked.
   */
  it('is not offered one in a browser that has dismissed nothing', async () => {
    mockHost = ESTABLISHED_SITE
    expect(hostStartedBlank('host-1')).toBe(false)
    render(<HostSetupDetailsSection />)
    expect(screen.queryByText('guided start')).toBeNull()
  })

  /**
   * One published page is enough, because the question is whether a visitor
   * can reach anything — not how much there is. A site with a single live
   * page is a site somebody has started.
   */
  it('is past the offer from its first published page', async () => {
    mockHost = { screens: { 's1': 'home' } }
    render(<HostSetupDetailsSection />)
    expect(screen.queryByText('guided start')).toBeNull()
  })
})

/**
 * An unread document is not a blank site.
 *
 * `screens` is absent both before the host document arrives and on a site
 * that publishes nothing, so a gate that read the map without waiting would
 * mount the zone for every site for as long as the snapshot took — and the
 * widget on this zone takes the WHOLE SCREEN, so that is not a flicker in a
 * card, it is a dialog over somebody's settings page that then vanishes.
 */
describe('before the site has been read', () => {
  it('offers nothing until the document has arrived', async () => {
    mockHostHasEmitted = false
    render(<HostSetupDetailsSection />)
    expectOrdinaryPage()
    expect(screen.queryByText('guided start')).toBeNull()
  })
})

describe('starting blank', () => {
  it('leaves the person on the ordinary page with nothing created', async () => {
    render(<HostSetupDetailsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skip and start blank' }))
    expect(screen.queryByText('guided start')).toBeNull()
    expectOrdinaryPage()
  })

  it('is remembered, so the site does not ask again', async () => {
    const view = render(<HostSetupDetailsSection />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skip and start blank' }))
    expect(hostStartedBlank('host-1')).toBe(true)
    view.unmount()
    render(<HostSetupDetailsSection />)
    expect(screen.queryByText('guided start')).toBeNull()
    expectOrdinaryPage()
  })

  it('is remembered per site, not for every site the person makes next', () => {
    expect(hostStartedBlank('host-1')).toBe(false)
    render(<HostSetupDetailsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Skip and start blank' }))
    expect(hostStartedBlank('host-2')).toBe(false)
  })
})
