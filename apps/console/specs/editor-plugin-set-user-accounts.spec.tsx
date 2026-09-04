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
 * The set the EDITOR reads honours the per-site user-accounts opt-in
 * (AGL-2486).
 *
 * `useEnabledPluginIds` feeds nav tabs, plugin pages, widget slots and —
 * through `EnabledPluginsContext` — the besigner component drawer. It
 * subtracted the host's `disabledPlugins` deny-list and stopped there, which
 * is the whole story for the twelve ordinary bundles and exactly wrong for a
 * `defaultOffPerSite` one: an absent field means OFF for `accounts`, so a
 * resolver that only ever subtracts reported it as ON everywhere.
 *
 * That is the second half of the defect. Teaching the component drawer to
 * filter by capability buys nothing while the set it filters against still
 * contains the capability.
 */

let mockEnabledKey: string
let mockHostDisabled: readonly string[]
let mockHostOptIn: readonly string[]
let mockHostId: string | null
let mockNamedOrg: unknown

jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: {}, ready: true }),
}))
// Faithful to the real hook's shape: the gate reads
// `flags[key]?.released`, not an `isOn()` predicate. A double with the wrong
// shape here threw inside the resolver and produced five red tests that had
// nothing to do with the capability.
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlags: () => ({ ready: true, isStaff: false, flags: {} }),
}))
jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamedOrg: () => mockNamedOrg,
  useUrlNamesOrg: () => true,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ uid: 'user-1' }),
}))
jest.mock('../components/host-id-provider', () => ({
  useHostDisabledPlugins: () => mockHostDisabled,
  useHostEnabledPlugins: () => mockHostOptIn,
  useHostId: () => mockHostId,
}))
jest.mock('../constants/console-plugin-loader', () => ({
  consolePluginLoader: { ensure: jest.fn(), ensureAll: jest.fn() },
}))
jest.mock('../utils/realm-plugins.client', () => ({
  loadOrgRealmPlugins: jest.fn(async () => []),
}))

import { renderHook, waitFor } from '@testing-library/react'
import { ACCOUNTS_PLUGIN_ID } from '@aglyn/aglyn'
import { useEnabledPluginIds } from '../components/console-plugins-gate.component'

// The org enables everything, which is the default for a workspace that has
// never touched the switchboard — so anything missing below was subtracted
// by a SITE, which is the thing under test.
const ORG_SET = ['mui', 'commerce', ACCOUNTS_PLUGIN_ID].join(',')

beforeEach(() => {
  mockEnabledKey = ORG_SET
  mockHostDisabled = []
  mockHostOptIn = []
  mockHostId = 'host-1'
  mockNamedOrg = { id: 'org-1' }
})

// `useEffectiveEnabledPlugins` is module-private, so the org set reaches the
// hook the same way it does in production: through the org doc. Stubbing the
// org's plugin list here keeps the REAL resolver in the path.
jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    resolveEnabledPlugins: () => mockEnabledKey.split(',').filter(Boolean),
  }
})

/*==========================================
 * EVERY READ WAITS FOR THE SETTLED VALUE (AGL-2530).
 *
 * `useEnabledPluginIds` narrows the org set through `loadOrgRealmPlugins`,
 * which this suite stubs as an `async` function — so at least one promise has
 * to settle before the narrowed set exists. `result.current` read straight
 * after `renderHook` is the value of the FIRST render. On an idle machine the
 * microtask drains inside `renderHook`'s own `act` and the read is correct by
 * luck; under contention it does not, and the assertion sees `ORG_SET`
 * verbatim: `["mui", "commerce", "accounts"]`, the value before any narrowing.
 *
 * Measured once on a full `apps/console` run at `--maxWorkers=2`, on the two
 * cases asserting the NARROWED outcome. They are the only two that can fail
 * this way, and they are NOT the only two that were wrong.
 *
 * ⚑ The other three assert values that are identical before and after
 * narrowing, so they never went red — and could not have. `toContain('mui')`
 * holds on the unnarrowed set too, which means those cases were passing
 * without ever observing the behaviour they name. Waiting fixes a flake in two
 * of them and a vacuous pass in the other three, which is why the whole file
 * changes rather than the two that fired.
 *
 * `waitFor` costs nothing when the value is already settled, and RTL's
 * `asyncUtilTimeout` is lifted to 5s workspace-wide (AGL-2382).
 *==========================================*/
describe('the editor plugin set honours the user-accounts opt-in (AGL-2486)', () => {
  it('drops accounts on a site that never opted in', async () => {
    const { result } = renderHook(() => useEnabledPluginIds())
    await waitFor(() =>
      expect(result.current).not.toContain(ACCOUNTS_PLUGIN_ID),
    )
  })

  it('keeps accounts once the site opts in', async () => {
    mockHostOptIn = [ACCOUNTS_PLUGIN_ID]
    const { result } = renderHook(() => useEnabledPluginIds())
    await waitFor(() => expect(result.current).toContain(ACCOUNTS_PLUGIN_ID))
  })

  it('an explicit deny still beats the opt-in', async () => {
    mockHostOptIn = [ACCOUNTS_PLUGIN_ID]
    mockHostDisabled = [ACCOUNTS_PLUGIN_ID]
    const { result } = renderHook(() => useEnabledPluginIds())
    await waitFor(() =>
      expect(result.current).not.toContain(ACCOUNTS_PLUGIN_ID),
    )
  })

  it('leaves the ordinary bundles exactly as they were', async () => {
    // The regression fence: this must be invisible to the twelve plugins
    // that are not default-off.
    const { result } = renderHook(() => useEnabledPluginIds())
    await waitFor(() => {
      expect(result.current).toContain('mui')
      expect(result.current).toContain('commerce')
    })
  })

  it('OFF a host route the org set is unchanged', async () => {
    // There is no site to have opted in, so subtracting here would answer a
    // question nobody asked — and would differ from how the deny-list
    // behaves off host routes, where [] subtracts nothing.
    mockHostId = null
    const { result } = renderHook(() => useEnabledPluginIds())
    await waitFor(() => expect(result.current).toContain(ACCOUNTS_PLUGIN_ID))
  })
})
