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
 * The guided start is offered where a new site LANDS, once (AGL-3596).
 *
 * Creation adds `?start=site`; the host layout's gate draws the `hostFirstRun`
 * zone over the page only then, and only while the site is still empty. It
 * used to sit on Setup gated on "nothing published", and every visit to Setup
 * of a site with drafts and no live page drew it again.
 *
 * Reverting either condition — the parameter or the empty site — must turn
 * this file red.
 */

import { fireEvent, render, screen } from '@testing-library/react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

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
      <button type="button" onClick={props['leave'] as () => void}>
        {'Close after starting'}
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
  useUser: () => ({ data: mockUser }),
  useHost: () => ({ doc: { data: mockHost, status: mockHostStatus } }),
}))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearch),
  usePathname: () => '/acme/hosts/shop',
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}))
jest.mock('../utils/host-first-run', () => ({
  ...jest.requireActual('../utils/host-first-run'),
  requestStarterSite: (...args: unknown[]) => mockRequestStarter(...args),
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
let mockHost: Record<string, unknown> = {}
let mockHostStatus = 'success'
let mockSearch = 'start=site'
const mockReplace = jest.fn()
const mockRequestStarter = jest.fn(async (..._args: unknown[]) => true)

import HostFirstRunGate from '../components/host-first-run-gate.component'

beforeEach(() => {
  lastZoneProps = undefined
  mockHost = {}
  mockHostStatus = 'success'
  mockSearch = 'start=site'
  mockReplace.mockClear()
  mockRequestStarter.mockClear()
  mockWidgets = [
    { slot: 'hostFirstRun', widgetId: 'demo-start', Component: MockFirstRunWidget },
  ]
})

describe('the start a new site is offered', () => {
  it('is drawn when creation asked for it on an empty site, with the site, org and ways out', async () => {
    render(<HostFirstRunGate />)
    expect(await screen.findByText('guided start')).toBeTruthy()
    expect(lastZoneProps).toMatchObject({ hostId: 'host-1', orgId: 'org-1', orgSlug: 'acme', host: 'shop' })
    expect(typeof lastZoneProps?.['startBlank']).toBe('function')
    expect(typeof lastZoneProps?.['leave']).toBe('function')
  })

  it('is never drawn without the parameter creation adds', () => {
    mockSearch = ''
    render(<HostFirstRunGate />)
    expect(screen.queryByText('guided start')).toBeNull()
  })

  it('is never drawn on a site with a published page, or one that took the starter', () => {
    mockHost = { screens: { s1: '/', s2: '/about' } }
    const { unmount } = render(<HostFirstRunGate />)
    expect(screen.queryByText('guided start')).toBeNull()
    unmount()
    mockHost = { starterProvisionedAt: { seconds: 1 } }
    render(<HostFirstRunGate />)
    expect(screen.queryByText('guided start')).toBeNull()
  })

  it('waits for the site document rather than reading an unread one as empty', () => {
    mockHostStatus = 'loading'
    render(<HostFirstRunGate />)
    expect(screen.queryByText('guided start')).toBeNull()
  })

  it('asks for the starter on the blank path, closes, and drops the parameter', async () => {
    render(<HostFirstRunGate />)
    fireEvent.click(await screen.findByText('Skip and start blank'))
    expect(mockRequestStarter).toHaveBeenCalledWith(mockUser, 'host-1')
    expect(mockReplace).toHaveBeenCalledWith('/acme/hosts/shop')
    expect(screen.queryByText('guided start')).toBeNull()
  })

  it('closes after a guided start began without asking for the starter', async () => {
    render(<HostFirstRunGate />)
    fireEvent.click(await screen.findByText('Close after starting'))
    expect(mockRequestStarter).not.toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/acme/hosts/shop')
    expect(screen.queryByText('guided start')).toBeNull()
  })
})
