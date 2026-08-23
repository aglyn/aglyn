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
 * The console plugins gate must not commit the session to a workspace the URL
 * never named (AGL-1937).
 *
 * `ConsolePluginsGate` is mounted in `app/providers.tsx`, above EVERY console
 * route — the workspace picker included, which is on the path every new
 * signup crosses. It read `useCurrentOrg().orgId`, which falls back to a
 * remembered selection and then to the user's first org, so landing on the
 * picker made the gate:
 *
 *   - `consolePluginLoader.ensure(...)` the fallback org's console chunks,
 *   - mint an ID token and `loadOrgRealmPlugins(fallbackOrgId, …)`, fetching
 *     trusted-realm marketplace bundles for a workspace nobody opened.
 *
 * A loaded chunk cannot unload and the ConsoleExtension registry is a
 * module-global union, so this is not a wasted fetch that a later navigation
 * corrects — the wrong org's code is resident for the rest of the session.
 *
 * The guard runs both directions, because the failure mode of an over-eager
 * fix is a console with no plugins in it at all: on a route that DOES name a
 * workspace both calls must still happen, and the boot splash must still hold
 * the first paint until they land (the empty-registry invariant, AGL-417).
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import ConsolePluginsGate, {
  useSitePluginsReady,
} from '../components/console-plugins-gate.component'

const route = { pathname: '/', subdomainSlug: null as string | null }

const mockEnsure = jest.fn().mockResolvedValue(undefined)
const mockLoadOrgRealmPlugins = jest.fn().mockResolvedValue(undefined)
const mockGetIdToken = jest.fn().mockResolvedValue('id-token')

jest.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ orgSlug: route.subdomainSlug }),
}))
jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: { ensure: (...args: unknown[]) => mockEnsure(...args) },
}))
jest.mock('../utils/realm-plugins.client', () => ({
  loadOrgRealmPlugins: (...args: unknown[]) => mockLoadOrgRealmPlugins(...args),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: mockGetIdToken } }),
}))
jest.mock('../components/host-id-provider', () => ({
  useHostDisabledPlugins: () => [] as string[],
  // Added by a9306382c and left out of this mock, which made the whole suite
  // throw rather than fail: the gate reads the host's default-off OPT-IN list
  // alongside the deny-list. Empty is the off-a-host-route value, which is
  // what every case here is.
  useHostEnabledPlugins: () => [] as string[],
  // Every case in this suite is a route that names no SITE — the workspace
  // picker, /manage, /admin, a workspace subdomain — so the provider's own
  // off-host-route value is the faithful one. A non-null id here would make
  // the gate answer a host question these pages never ask.
  useHostId: () => null as string | null,
}))
jest.mock('../components/boot-splash.component', () => ({
  __esModule: true,
  default: () => <div data-testid="boot-splash" />,
}))
// The fallback org the scope resolves to on an org-less route — a REAL org
// with a real id, which is precisely what makes the bug reachable.
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { enabledPlugins: ['commerce'] },
    orgId: 'org-fallback',
    ready: true,
  }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))

function SiteProbe() {
  const ready = useSitePluginsReady()
  return <span data-testid="site-ready">{String(ready)}</span>
}

const renderGate = (children?: ReactNode) =>
  render(<ConsolePluginsGate>{children}</ConsolePluginsGate>)

/** Let every queued microtask/effect in the gate settle. */
const settle = () =>
  waitFor(() => expect(mockEnsure.mock.calls.length).toBeGreaterThanOrEqual(0))

describe('ConsolePluginsGate on an org-less route (AGL-1937)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    route.pathname = '/'
    route.subdomainSlug = null
  })

  it('loads NOTHING on the workspace picker, even with a fallback org resolved', async () => {
    renderGate(<span data-testid="child" />)

    await settle()
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(mockLoadOrgRealmPlugins).not.toHaveBeenCalled()
    // No ID token is minted for a workspace the user has not opened either.
    expect(mockGetIdToken).not.toHaveBeenCalled()
    // And nothing is held back: the picker itself must render, not sit
    // behind a boot splash waiting for a load that will never start.
    expect(screen.queryByTestId('boot-splash')).toBeNull()
    expect(screen.getByTestId('child')).toBeTruthy()
  })

  it('loads NOTHING on /manage or /admin either', async () => {
    for (const pathname of ['/manage/user', '/admin/orgs']) {
      jest.clearAllMocks()
      route.pathname = pathname
      const view = renderGate()
      await settle()
      expect(mockEnsure).not.toHaveBeenCalled()
      expect(mockLoadOrgRealmPlugins).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('the staff console stays org-less on a workspace SUBDOMAIN', async () => {
    route.pathname = '/admin/orgs'
    route.subdomainSlug = 'business1'
    renderGate()

    await settle()
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(mockLoadOrgRealmPlugins).not.toHaveBeenCalled()
  })

  it('DOES load on a route that names a workspace, and holds the first paint', async () => {
    route.pathname = '/business1/hosts'
    renderGate(<span data-testid="child" />)

    // The empty-registry invariant: nothing renders until the load lands.
    expect(screen.getByTestId('boot-splash')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('child')).toBeTruthy())
    expect(mockEnsure).toHaveBeenCalledWith(
      expect.arrayContaining(['commerce']),
      ['console'],
    )
    expect(mockLoadOrgRealmPlugins).toHaveBeenCalledWith(
      'org-fallback',
      'id-token',
    )
  })

  it('DOES load on a workspace subdomain with no org path segment', async () => {
    route.pathname = '/'
    route.subdomainSlug = 'business1'
    renderGate()

    await waitFor(() => expect(mockEnsure).toHaveBeenCalled())
    expect(mockLoadOrgRealmPlugins).toHaveBeenCalledWith(
      'org-fallback',
      'id-token',
    )
  })
})

describe('useSitePluginsReady on an org-less route (AGL-1937)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    route.pathname = '/'
    route.subdomainSlug = null
  })

  it('loads no SITE bundles for the fallback org', async () => {
    render(<SiteProbe />)

    await settle()
    expect(mockEnsure).not.toHaveBeenCalled()
    expect(screen.getByTestId('site-ready').textContent).toBe('false')
  })

  it('still loads them on an editor route, which always names a workspace', async () => {
    route.pathname = '/business1/hosts/site-1/screens/s/versions/v/besigner'
    render(<SiteProbe />)

    await waitFor(() =>
      expect(screen.getByTestId('site-ready').textContent).toBe('true'),
    )
    expect(mockEnsure).toHaveBeenCalledWith(
      expect.arrayContaining(['commerce']),
      ['site'],
    )
  })
})
