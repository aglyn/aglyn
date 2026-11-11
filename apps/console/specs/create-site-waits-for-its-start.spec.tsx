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
 * AGL-4152 · `?create=site` on a cold load opens the guided start, not the
 * plain dialog.
 *
 * "Create site" waits for the start's widget to say whether it draws, and
 * falls back to the plain dialog when no answer comes. That wait used to be
 * timed from the dialog opening. A deep link opens it on the page's first
 * render, so a cold load spent the ten seconds loading the AI plugin, the
 * plain dialog was drawn, and the start zone, now unmounted, could never
 * answer. A click on a loaded page had the plugin in hand and got the start.
 *
 * Pinned here:
 * - the widget's ten seconds start once the zone has loaded, however long
 *   the load took;
 * - a load that never settles still ends in the plain dialog, at its own,
 *   longer ceiling;
 * - a workspace without the start's plugin gets the plain dialog as soon as
 *   the zone has loaded, with no wait;
 * - a fallback, once drawn, is not swapped for the start.
 */

import { act, render, screen } from '@testing-library/react'
import React from 'react'

jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
  }
  return {
    useRouter: () => router,
    usePathname: () => '/acme/hosts',
    useSearchParams: () => new URLSearchParams(),
  }
})
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlag: () => ({
    released: false,
    visible: false,
    staffPreview: false,
    isStaff: false,
    ready: true,
  }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u-1' } }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEvent: jest.fn(),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ subdomainValid: true, subdomainTaken: false, suggestions: [] }),
  })),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business', slug: 'acme' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ can: () => true, loaded: true }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ currentOrg: { $id: 'org-1', slug: 'acme' } }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('../utils/account-acquisition', () => ({ firstTouchField: () => ({}) }))
jest.mock('../utils/hard-navigate', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../utils/host-first-run', () => ({ requestStarterSite: jest.fn(async () => true) }))
jest.mock('../components/host-first-run-gate.component', () => ({
  SITE_START_PARAM: 'start',
  SITE_START_VALUE: 'site',
  SITE_START_LIVE_VALUE: 'live',
  SITE_LIVE_STARTER_PARAM: 'starterName',
}))

/** The zone's plugin: still loading, then loaded with or without the start. */
let mockZoneReady = false
let mockWidgets: unknown[] = []
let mockReady: ((shown: boolean) => void) | null = null
jest.mock('../components/plugin-widget-slot.component', () => ({
  __esModule: true,
  useSlotWidgets: (zones: string[]) => ({
    widgets: zones.length ? mockWidgets : [],
    ready: zones.length ? mockZoneReady : true,
  }),
  default: (props: { pendingSite?: { ready: (shown: boolean) => void } }) => {
    mockReady = props.pendingSite?.ready ?? null
    return <div data-testid="start-zone" />
  },
}))

const {
  CreateHostDialog,
  SITE_START_LOAD_TIMEOUT_MS,
  SITE_START_VERDICT_TIMEOUT_MS,
} = jest.requireActual(
  '../components/create-host-dialog.component',
) as typeof import('../components/create-host-dialog.component')

const START = [{ widgetId: 'ai-site-start' }]

/** Renders the dialog as the deep link does: open on the first render. */
const openOnFirstRender = () => {
  const view = render(<CreateHostDialog open onClose={jest.fn()} />)
  const rerender = () => view.rerender(<CreateHostDialog open onClose={jest.fn()} />)
  return { rerender }
}
const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms))
const plainDialog = () => screen.queryByText('Create a new site')

beforeEach(() => {
  jest.useFakeTimers()
  mockZoneReady = false
  mockWidgets = []
  mockReady = null
})
afterEach(() => {
  jest.useRealTimers()
})

describe('AGL-4152 · the start waits for its plugin on a cold load', () => {
  it('gives the widget its whole verdict time after a load longer than that time', () => {
    const { rerender } = openOnFirstRender()
    // The cold load: the zone's plugin takes longer than the verdict's time.
    advance(SITE_START_VERDICT_TIMEOUT_MS + 2_000)
    // Red before the fix: the plain dialog, drawn while the plugin loaded.
    expect(plainDialog()).toBeNull()
    expect(screen.queryByTestId('start-zone')).toBeNull()

    mockZoneReady = true
    mockWidgets = START
    rerender()
    // The widget is mounted and asks; the answer takes a few seconds.
    expect(screen.getByTestId('start-zone')).toBeTruthy()
    advance(SITE_START_VERDICT_TIMEOUT_MS - 1_000)
    expect(plainDialog()).toBeNull()
    act(() => mockReady?.(true))
    expect(screen.getByTestId('start-zone')).toBeTruthy()
    expect(plainDialog()).toBeNull()
  })

  it('still falls back when the loaded widget never answers', () => {
    const { rerender } = openOnFirstRender()
    advance(5_000)
    mockZoneReady = true
    mockWidgets = START
    rerender()
    advance(SITE_START_VERDICT_TIMEOUT_MS)
    expect(plainDialog()).toBeTruthy()
    expect(screen.queryByTestId('start-zone')).toBeNull()
  })

  it('falls back at the load ceiling when the zone never loads, and holds it', () => {
    const { rerender } = openOnFirstRender()
    advance(SITE_START_LOAD_TIMEOUT_MS - 1)
    expect(plainDialog()).toBeNull()
    advance(1)
    expect(plainDialog()).toBeTruthy()

    // The plugin lands after all: the dialog already drawn stays.
    mockZoneReady = true
    mockWidgets = START
    rerender()
    advance(SITE_START_VERDICT_TIMEOUT_MS)
    expect(plainDialog()).toBeTruthy()
    expect(screen.queryByTestId('start-zone')).toBeNull()
  })

  it('a load that finished before the ceiling is not cut off by it', () => {
    const { rerender } = openOnFirstRender()
    advance(SITE_START_LOAD_TIMEOUT_MS - 2_000)
    mockZoneReady = true
    mockWidgets = START
    rerender()
    // Past the load ceiling, inside the verdict's own time.
    advance(5_000)
    expect(plainDialog()).toBeNull()
    act(() => mockReady?.(true))
    expect(screen.getByTestId('start-zone')).toBeTruthy()
  })

  it('without the start’s plugin, draws the plain dialog as soon as the zone has loaded', () => {
    const { rerender } = openOnFirstRender()
    expect(plainDialog()).toBeNull()
    mockZoneReady = true
    mockWidgets = []
    rerender()
    expect(plainDialog()).toBeTruthy()
  })
})
