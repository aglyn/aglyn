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
 * - the choice is remembered, so a reload does not ask again.
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
jest.mock('../app/(app)/[orgSlug]/hosts/[host]/host-settings-scope', () => ({
  __esModule: true,
  useHostSettingsScope: () => ({ hostId: 'host-1' }),
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
