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
 * The Besigner loads the marketplace plugins its site runs that contribute
 * site elements, and offers their elements (AGL-3391).
 *
 * A realm install used to load in the console only for its console surfaces,
 * so a plugin whose manifest declares `contributes.site.components` had no
 * Elements-panel entry and drew nothing on the canvas. The editor gate now
 * loads the site's installs at the `editor` load point, alongside the
 * first-party canvas bundles, and adds the ids their presets carry to the set
 * the drawer filters by.
 */

let mockRealmInstalls: Array<Record<string, unknown>>
let mockResolveRealm: (() => void) | null

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: {}, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))
jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamedOrg: () => ({ id: 'org-1' }),
  useUrlNamesOrg: () => true,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'user-1' } }),
}))
jest.mock('../components/host-id-provider', () => ({
  useHostDisabledPlugins: () => [],
  useHostEnabledPlugins: () => [],
  useHostId: () => 'host-1',
}))
jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: { ensure: jest.fn(async () => undefined), ensureAll: jest.fn() },
  pluginDeclarationsReady: Promise.resolve(),
}))
jest.mock('../utils/realm-plugins.client', () => ({
  loadOrgRealmPlugins: jest.fn(
    () =>
      new Promise((resolve) => {
        mockResolveRealm = () => resolve(mockRealmInstalls)
      }),
  ),
}))
jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    resolveEnabledPlugins: () => ['mui'],
  }
})

import { act, render, screen, waitFor } from '@testing-library/react'
import { useEnabledPlugins } from '@aglyn/aglyn'
import { withSitePlugins } from '../components/console-plugins-gate.component'
import { loadOrgRealmPlugins } from '../utils/realm-plugins.client'

const CALCULATOR = {
  listingId: 'listing-calc',
  pluginId: 'calculator',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  trust: 'realm',
  contributes: { site: { components: ['aglyn.calculator.scope'] } },
}

function Canvas() {
  const ids = useEnabledPlugins()
  return <div data-testid="canvas">{(ids ?? []).join(',')}</div>
}
const EditorPage = withSitePlugins(Canvas)

beforeEach(() => {
  mockRealmInstalls = [CALCULATOR]
  mockResolveRealm = null
  jest.mocked(loadOrgRealmPlugins).mockClear()
})

describe('the Besigner loads the site plugins it offers (AGL-3391)', () => {
  it("loads the site's installs at the editor load point", async () => {
    render(<EditorPage />)
    await waitFor(() => expect(loadOrgRealmPlugins).toHaveBeenCalled())

    const [orgId, , where, options] = jest.mocked(loadOrgRealmPlugins).mock.calls[0]
    expect(orgId).toBe('org-1')
    expect(where).toEqual({ at: 'editor' })
    // The site's list, not the workspace's: host pins win, as on its pages.
    expect(options).toEqual({ hostId: 'host-1' })
  })

  it('holds the canvas until the installs have loaded', async () => {
    render(<EditorPage />)
    await waitFor(() => expect(mockResolveRealm).not.toBeNull())

    // An element whose component never registered renders nothing (AGL-52),
    // so the canvas must not mount ahead of the bundles that register them.
    expect(screen.queryByTestId('canvas')).toBeNull()

    await act(async () => mockResolveRealm?.())
    expect(await screen.findByTestId('canvas')).toBeTruthy()
  })

  it("offers the plugin's elements under every id its presets may carry", async () => {
    render(<EditorPage />)
    await waitFor(() => expect(mockResolveRealm).not.toBeNull())
    await act(async () => mockResolveRealm?.())

    const ids = (await screen.findByTestId('canvas')).textContent?.split(',')
    expect(ids).toEqual(expect.arrayContaining(['mui', 'calculator', 'listing-calc']))
  })

  it('leaves the site set alone when the site runs no such plugin', async () => {
    mockRealmInstalls = []
    render(<EditorPage />)
    await waitFor(() => expect(mockResolveRealm).not.toBeNull())
    await act(async () => mockResolveRealm?.())

    expect((await screen.findByTestId('canvas')).textContent).toBe('mui')
  })
})
