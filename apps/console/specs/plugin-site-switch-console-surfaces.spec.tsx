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
 * A plugin on for every workspace, switched off for one site, in the console
 * shell (AGL-3028).
 *
 * Two answers have to hold at once, and they pull in opposite directions:
 *
 * - What a site's pages DRAW is narrowed by the site. Nav tabs, plugin pages
 *   and every widget zone read `useEnabledPluginIds`, so AI's dock, its cards
 *   and its editor controls vanish from a site that switched AI off.
 * - What WRAPS every page is not. Providers are nested around the whole route
 *   tree, so a provider that came and went per site would remount the tree —
 *   the app bar and every open listener — on each crossing between sites, and
 *   on every load of a switched-off site as its host document lands. They are
 *   listed against the workspace and told the site's set instead.
 *
 * The catalog resolver is REAL throughout: the workspace stores a switchboard
 * list that never named AI, so the union that keeps it on for the workspace
 * is exercised, not assumed.
 */

let mockHostDisabled: readonly string[] = []
let mockHostId: string | null = 'host-1'

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    // A switchboard saved before AI was a plugin: it never listed the id.
    org: { enabledPlugins: ['mui', 'commerce'] },
    orgId: 'org-1',
    ready: true,
  }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))
const mockNamedOrg = { id: 'org-1' }
jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamedOrg: () => mockNamedOrg,
  useUrlNamesOrg: () => true,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'user-1' } }),
}))
jest.mock('../hooks/use-permissions-on-host', () => {
  const held = { loaded: false, granted: {} }
  const usePermissionsOnHost = () => held
  return { __esModule: true, default: usePermissionsOnHost, usePermissionsOnHost }
})
jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: { ensure: jest.fn(async () => undefined), ensureAll: jest.fn() },
  pluginDeclarationsReady: Promise.resolve(),
}))
jest.mock('../utils/realm-plugins.client', () => ({
  loadOrgRealmPlugins: jest.fn(async () => undefined),
}))
jest.mock('../components/boot-splash.component', () => ({
  __esModule: true,
  default: () => <div data-testid="boot-splash" />,
}))

import { registerConsoleExtension } from '@aglyn/aglyn'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import ConsolePluginsGate, {
  useEnabledPluginIds,
  useWorkspacePluginIds,
} from '../components/console-plugins-gate.component'
import {
  HostDisabledPluginsContext,
  HostEnabledPluginsContext,
  HostIdContext,
} from '../components/host-id-provider'

const NO_OPT_IN: readonly string[] = []

/**
 * The site seam, supplied through the REAL host contexts rather than by
 * mocking `host-id-provider` (AGL-3145).
 *
 * A `jest.mock` of that module is a fork in the module registry: the spec
 * holds the factory's object and the component under test holds whichever
 * of the two the runtime handed it. Measured inside a loaded full-suite run,
 * those came apart — `useHostDisabledPlugins` was the mock for the spec and
 * the real `useContext` reader for `ConsolePluginsGate`, which then read the
 * context DEFAULT `[]` and answered with the un-narrowed set. There is no
 * fork to land on the wrong side of when nothing is mocked, and the real
 * readers are exercised instead of a stand-in for them.
 */
function SiteSeam({ children }: { children?: ReactNode }) {
  return (
    <HostIdContext.Provider value={mockHostId as string}>
      <HostDisabledPluginsContext.Provider value={mockHostDisabled}>
        <HostEnabledPluginsContext.Provider value={NO_OPT_IN}>
          {children}
        </HostEnabledPluginsContext.Provider>
      </HostDisabledPluginsContext.Provider>
    </HostIdContext.Provider>
  )
}

/** Every mount of the AI provider, and the site set it was last handed. */
const providerMounts: string[] = []
let providerSiteSet: readonly string[] | undefined

function AiProviderProbe(props: { enabledPluginIds?: readonly string[]; children?: ReactNode }) {
  providerSiteSet = props.enabledPluginIds
  useEffect(() => {
    providerMounts.push('mount')
  }, [])
  return <>{props.children}</>
}

function ChildProbe() {
  useEffect(() => {
    providerMounts.push('child-mount')
  }, [])
  return <span data-testid="page">{'page'}</span>
}

beforeAll(() => {
  registerConsoleExtension({
    pluginId: 'ai',
    displayName: 'AI',
    providers: [AiProviderProbe],
  })
})

beforeEach(() => {
  mockHostDisabled = []
  mockHostId = 'host-1'
  providerMounts.length = 0
  providerSiteSet = undefined
})

describe('what a site draws is narrowed by the site', () => {
  it('drops AI on a site that switched it off', () => {
    mockHostDisabled = ['ai']
    const { result } = renderHook(() => useEnabledPluginIds(), {
      wrapper: SiteSeam,
    })
    expect(result.current).not.toContain('ai')
    expect(result.current).toContain('commerce')
  })

  it('keeps AI on a site whose document predates the switch', () => {
    mockHostDisabled = ['commerce']
    const { result } = renderHook(() => useEnabledPluginIds(), {
      wrapper: SiteSeam,
    })
    expect(result.current).toContain('ai')
  })

  it('keeps AI off any site, where the workspace set is the answer', () => {
    mockHostId = null
    mockHostDisabled = []
    const { result } = renderHook(() => useEnabledPluginIds(), {
      wrapper: SiteSeam,
    })
    expect(result.current).toContain('ai')
  })
})

describe('what wraps every page is the workspace’s', () => {
  it('keeps AI in the workspace set on a site that switched it off', () => {
    mockHostDisabled = ['ai']
    const { result } = renderHook(() => useWorkspacePluginIds(), {
      wrapper: SiteSeam,
    })
    expect(result.current).toContain('ai')
  })

  it('keeps the AI provider mounted across the switch, and hands it the site’s set', async () => {
    const view = render(
      <SiteSeam>
        <ConsolePluginsGate>
          <ChildProbe />
        </ConsolePluginsGate>
      </SiteSeam>,
    )
    await waitFor(() => expect(screen.queryByTestId('page')).toBeTruthy())
    expect(providerSiteSet).toContain('ai')

    // The host document lands saying AI is off for this site.
    mockHostDisabled = ['ai']
    view.rerender(
      <SiteSeam>
        <ConsolePluginsGate>
          <ChildProbe />
        </ConsolePluginsGate>
      </SiteSeam>,
    )
    await waitFor(() => expect(providerSiteSet).not.toContain('ai'))
    // One mount of each: nothing beneath the providers was torn down.
    expect(providerMounts).toEqual(['child-mount', 'mount'])
    expect(screen.getByTestId('page')).toBeTruthy()
  })
})
