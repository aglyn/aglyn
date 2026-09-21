/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * The console loads a plugin only where a screen draws one of its declared
 * contributions (AGL-3142).
 *
 * ## Why every case here has a control
 *
 * A plugin whose console code fails to load does not error. Its tab, its
 * panel or its widget is simply ABSENT — which is also what a workspace
 * without that plugin looks like, and what a zone nobody registered for looks
 * like. So "it did not load" is worthless on its own: it is what a broken
 * resolver, a typo'd zone id and a correct refusal all produce. Every refusal
 * below is therefore paired with a load that DOES happen through the same
 * code path, and the pair is what makes either assertion mean anything.
 *
 * The declarations are the REAL ones, read from the generated console
 * manifest that `plugins.config.json` produces. A fixture would let the
 * catalog and the loader drift apart in exactly the way this whole change
 * exists to close, and the drift would be invisible: the plugin that stopped
 * loading is the plugin whose tab is missing.
 */

import { render, waitFor } from '@testing-library/react'

const MOCK_ORG_ID = 'org-1'
const MOCK_USER = { uid: 'u1' }

/** Every `ensure` the render made: the ids, in the order asked. */
let mockEnsured: Array<{ ids: readonly string[]; surfaces: readonly string[] }>
/** Every realm load the render made, with the place it was made for. */
let mockRealmLoads: Array<{ orgId: string; where: unknown }>
/** What the workspace has switched on. */
let mockEnabledPlugins: string[]
/** Whether the URL names a workspace at all. */
let mockNamesOrg: boolean

jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: {
    ensure: (ids: readonly string[], surfaces: readonly string[]) => {
      mockEnsured.push({ ids, surfaces })
      return Promise.resolve()
    },
  },
  pluginDeclarationsReady: Promise.resolve(),
}))
jest.mock('../utils/realm-plugins.client', () => ({
  loadOrgRealmPlugins: (orgId: string, _user: unknown, where: unknown) => {
    mockRealmLoads.push({ orgId, where })
    return Promise.resolve()
  },
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: MOCK_USER }),
  useFirestore: () => ({}),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { $id: MOCK_ORG_ID, enabledPlugins: mockEnabledPlugins },
    orgId: MOCK_ORG_ID,
    ready: true,
  }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))
// The URL-scope seam the gate and every loading hook share (AGL-1937): both
// halves of it, because `useEnabledPluginIds` reads one and
// `usePluginLoadOrgId` the other, and mocking only one would let an org-less
// route still fetch a remembered workspace's realm installs.
jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamesOrg: () => mockNamesOrg,
  useUrlNamedOrg: () => (mockNamesOrg ? 'acme' : null),
}))
jest.mock('../components/host-id-provider', () => ({
  useHostDisabledPlugins: () => [] as string[],
  useHostEnabledPlugins: () => [] as string[],
  useHostId: () => 'host-1',
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ can: () => true, permissions: {}, loaded: true }),
}))
jest.mock('../components/dashboard-widget-prefs.context', () => ({
  useDashboardWidgetPrefs: () => ({
    prefs: { order: [] },
    ready: true,
    customizable: false,
  }),
}))

import { consolePluginsAt } from '../constants/console-plugin-load-points'
import {
  useConsoleRoutePlugins,
  useConsoleSlotPlugins,
} from '../hooks/use-console-plugins'
import PluginWidgetSlot from '../components/plugin-widget-slot.component'

/** Every plugin the catalog knows, as a workspace that enabled all of them. */
const ALL = [
  'mui',
  'forms',
  'bookings',
  'commerce',
  'marketplace',
  'crm',
  'outreach',
  'data',
  'email',
  'events-calendar',
  'inbox',
  'logic',
  'marketing',
  'redirects',
  'workflows',
  'ai',
  'video-delivery',
]

/** The ids of every `ensure` made for the console surface, flattened. */
const consoleEnsured = () =>
  mockEnsured.filter((call) => call.surfaces.includes('console')).flatMap((call) => call.ids)

function SlotProbe({ slots }: { slots: string[] }) {
  const ready = useConsoleSlotPlugins(slots)
  return <span data-testid="ready">{String(ready)}</span>
}

function RouteProbe({ href, level }: { href: string; level: 'site' | 'org' }) {
  const ready = useConsoleRoutePlugins(href, level)
  return <span data-testid="ready">{String(ready)}</span>
}

beforeEach(() => {
  mockEnsured = []
  mockRealmLoads = []
  mockEnabledPlugins = [...ALL]
  mockNamesOrg = true
})

describe('consolePluginsAt, against the real catalog (AGL-3142)', () => {
  it('puts on the shell every plugin that draws on every screen, and no other', () => {
    const shell = consolePluginsAt(ALL, { at: 'shell' })
    // A nav tab, an org tab, a staff tab, a provider or a custom field type:
    // these draw on the shell and must keep loading with it, or the tab is
    // simply gone.
    expect(shell).toEqual(
      expect.arrayContaining(['commerce', 'crm', 'ai', 'forms', 'outreach']),
    )
    // Neither of these registers a console surface at all, and before this
    // change both were handed to `ensure` on every screen anyway.
    expect(shell).not.toContain('mui')
    expect(shell).not.toContain('video-delivery')
  })

  it('loads a zone`s plugins for the zone, and nothing for a zone it does not fill', () => {
    expect(consolePluginsAt(ALL, { at: 'slots', slots: ['hostArtifactPublish'] })).toEqual([
      'marketplace',
    ])
    // The control: the same plugin, a zone it does not declare.
    expect(
      consolePluginsAt(ALL, { at: 'slots', slots: ['hostActivity'] }),
    ).not.toContain('marketplace')
    // One screen, several zones, one of them the plugin's.
    expect(
      consolePluginsAt(ALL, {
        at: 'slots',
        slots: ['hostDashboard', 'hostArtifactPublish'],
      }),
    ).toEqual(expect.arrayContaining(['marketplace', 'commerce', 'crm']))
  })

  it('serves a declared route and what lies beneath it, never a neighbor', () => {
    const site = (href: string) =>
      consolePluginsAt(ALL, { at: 'route', href, level: 'site' as const })
    expect(site('/products')).toEqual(['commerce'])
    expect(site('/products/orders')).toEqual(['commerce'])
    // The name this rule exists for: a sibling path that merely starts the
    // same way is a different surface.
    expect(site('/products-archive')).toEqual([])
    expect(site('/forms')).toEqual(['forms'])
  })

  it('never answers a site route with an organization surface, or the reverse', () => {
    expect(
      consolePluginsAt(ALL, { at: 'route', href: '/outreach', level: 'org' }),
    ).toEqual(['outreach'])
    expect(
      consolePluginsAt(ALL, { at: 'route', href: '/outreach', level: 'site' }),
    ).toEqual([])
  })

  it('serves the marketplace hub and its entity pages from one declaration', () => {
    // The surface owns its subtree (AGL-3080), so the loader has to name it
    // for a listing id it has never seen — which is the whole set of URLs
    // that used to be hand-written console routes. A `/marketplace` that
    // loaded the plugin and a `/marketplace/{id}` that did not would 404
    // every listing while the hub itself went on working.
    const org = (href: string) =>
      consolePluginsAt(ALL, { at: 'route', href, level: 'org' as const })
    expect(org('/marketplace')).toEqual(['marketplace'])
    expect(org('/marketplace/browse')).toEqual(['marketplace'])
    expect(org('/marketplace/lst_abc123')).toEqual(['marketplace'])
    expect(org('/marketplace/publish/plugin')).toEqual(['marketplace'])
    expect(org('/marketplace/publisher/acme-co')).toEqual(['marketplace'])
    // The control the subtree rule needs: a sibling path that merely starts
    // the same way is a different surface.
    expect(org('/marketplace-archive')).toEqual([])
  })

  it('never names a plugin the workspace has not enabled', () => {
    expect(
      consolePluginsAt(['crm'], { at: 'slots', slots: ['hostArtifactPublish'] }),
    ).toEqual([])
    // The control: enabled, and the zone loads it.
    expect(
      consolePluginsAt(['marketplace'], { at: 'slots', slots: ['hostArtifactPublish'] }),
    ).toEqual(['marketplace'])
  })
})

describe('a console zone loads the plugins that fill it (AGL-3142)', () => {
  it('loads the zone`s own plugin, and tells the realm loader which zone it is', async () => {
    render(<PluginWidgetSlot slot="hostArtifactPublish" />)

    await waitFor(() => expect(mockEnsured.length).toBeGreaterThan(0))
    expect(consoleEnsured()).toEqual(['marketplace'])
    // The realm half of the same rule: an install that declares this zone
    // loads here, so the host is composed here rather than on every screen.
    expect(mockRealmLoads).toEqual([
      { orgId: MOCK_ORG_ID, where: { at: 'slots', slots: ['hostArtifactPublish'] } },
    ])
  })

  it('does NOT load it on a screen that renders a different zone', async () => {
    render(<PluginWidgetSlot slot="hostActivity" />)

    // The zone's OWN plugin still loads through this path, which is what
    // makes the refusal below a refusal rather than a dead code path.
    await waitFor(() => expect(consoleEnsured()).toContain('workflows'))
    expect(consoleEnsured()).not.toContain('marketplace')
  })

  it('loads nothing at all on a route that names no workspace', async () => {
    mockNamesOrg = false
    const view = render(<SlotProbe slots={['orgMarketplace']} />)

    // Settled at once: there is nothing here to wait for, and a zone that
    // waited forever would hold the surface drawing it.
    await waitFor(() => expect(view.getByTestId('ready').textContent).toBe('true'))
    expect(mockEnsured).toEqual([])
    expect(mockRealmLoads).toEqual([])
  })
})

describe('a plugin route loads the plugins that serve it (AGL-3142)', () => {
  it('loads the plugin for the route and for what lies beneath it', async () => {
    const view = render(<RouteProbe href="/products/orders" level="site" />)

    await waitFor(() => expect(view.getByTestId('ready').textContent).toBe('true'))
    expect(consoleEnsured()).toEqual(['commerce'])
    expect(mockRealmLoads).toEqual([
      {
        orgId: MOCK_ORG_ID,
        where: { at: 'route', href: '/products/orders', level: 'site' },
      },
    ])
  })

  it('loads NOTHING for a neighbor that merely starts the same way', async () => {
    const view = render(<RouteProbe href="/products-archive" level="site" />)

    await waitFor(() => expect(view.getByTestId('ready').textContent).toBe('true'))
    expect(consoleEnsured()).toEqual([])
  })

  it('serves an organization route from the organization declarations alone', async () => {
    const view = render(<RouteProbe href="/outreach" level="org" />)
    await waitFor(() => expect(view.getByTestId('ready').textContent).toBe('true'))
    expect(consoleEnsured()).toEqual(['outreach'])
    view.unmount()

    // The control, on the level the plugin does not declare.
    mockEnsured = []
    const site = render(<RouteProbe href="/outreach" level="site" />)
    await waitFor(() => expect(site.getByTestId('ready').textContent).toBe('true'))
    expect(consoleEnsured()).toEqual([])
  })
})
