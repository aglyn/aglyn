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
 * Release flags resolve against the workspace the URL names — and against no
 * workspace when it names none (AGL-1935, found beside AGL-1937).
 *
 * The provider's own comment said so already:
 *
 *   > Outside an org scope there is no workspace to roll out to, so a null
 *   > subject resolves fully-enabled flags only.
 *
 * Two separate things stopped that being true.
 *
 * 1. `useCurrentOrg()` falls back to a remembered selection and then to the
 *    user's FIRST org, so `orgId` is undefined only for a user who belongs to
 *    no org at all — never merely because the route is the workspace picker,
 *    `/manage/*` or the staff console. The subject is now gated on
 *    `useUrlNamesOrg()`, the same predicate the chrome (AGL-1130) and the
 *    plugin gate (AGL-1937) use.
 *
 * 2. `ReleaseFlagsProvider` was mounted ABOVE `OrgScopeProvider` in
 *    `firebase-app.layout.tsx` — it predates the org scope (AGL-229 shipped
 *    before AGL-236) and the org scope was nested inside it. So its
 *    `useCurrentOrg()` read the OrgScopeContext DEFAULT, `currentOrg: null`,
 *    on EVERY route: the console bucketed every percentage rollout against a
 *    null subject and silently ignored every per-org override staff set from
 *    /admin/orgs (AGL-1635). React gives no signal for a consumer above its
 *    provider, so nothing failed — the feature was simply a void.
 *
 * Both directions are asserted, because a one-directional fix here is
 * indistinguishable from the bug: "resolves the global set" is also what a
 * provider that can no longer see any org at all would do.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReleaseFlagValue } from '@aglyn/aglyn'

const ORG_ID = 'org-fallback'
const FLAG = 'release_contacts'

const route = { pathname: '/', subdomainSlug: null as string | null }
let mockFlagValue: ReleaseFlagValue
let mockOrgOverrides: Record<string, unknown> | undefined

jest.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ orgSlug: route.subdomainSlug }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
  useRemoteConfig: () => ({ defaultConfig: {} }),
  useUser: () => ({
    data: { uid: 'u1', getIdTokenResult: async () => ({ claims: {} }) },
  }),
}))
jest.mock('firebase/remote-config', () => ({
  __esModule: true,
  fetchAndActivate: async () => true,
  getValue: (_config: unknown, key: string) => ({
    asString: () => (key === FLAG ? JSON.stringify(mockFlagValue) : ''),
  }),
}))
// The ambient fallback org: a real id and a real override set, which is what
// makes the org-less direction of this spec reachable at all.
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({
    org: { $id: ORG_ID, plan: 'pro', releaseFlags: mockOrgOverrides },
    orgId: ORG_ID,
    ready: true,
    entitlementsFromCache: false,
  }),
}))

import { ReleaseFlagsProvider, useReleaseFlag } from '../hooks/use-release-flags'

function Probe() {
  const { released, ready } = useReleaseFlag(FLAG)
  return (
    <span data-testid="verdict">{ready ? String(released) : 'pending'}</span>
  )
}

const mount = () =>
  render(
    <ReleaseFlagsProvider>
      <Probe />
    </ReleaseFlagsProvider>,
  )

const verdict = async (expected: string) => {
  await waitFor(() =>
    expect(screen.getByTestId('verdict').textContent).not.toBe('pending'),
  )
  expect(screen.getByTestId('verdict').textContent).toBe(expected)
}

describe('release flags on a route that names no workspace (AGL-1935)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    route.pathname = '/'
    route.subdomainSlug = null
    mockFlagValue = { enabled: false }
    mockOrgOverrides = undefined
  })

  it('IGNORES the fallback org’s force-ON override on the picker', async () => {
    mockOrgOverrides = { [FLAG]: true }
    mount()
    await verdict('false')
  })

  it('IGNORES it on /manage and on the staff console too', async () => {
    mockOrgOverrides = { [FLAG]: true }
    for (const pathname of ['/manage/user', '/admin/orgs']) {
      route.pathname = pathname
      const view = mount()
      await verdict('false')
      view.unmount()
    }
    // …including the staff console on a workspace SUBDOMAIN, which is the
    // platform's own view no matter what hostname it is served from.
    route.pathname = '/admin/orgs'
    route.subdomainSlug = 'business1'
    mount()
    await verdict('false')
  })

  it('buckets no percentage rollout there — a null subject is never in one', async () => {
    // 100% would be ON for ANY subject, so the only thing keeping it off is
    // the absence of one. That makes this fail the moment the subject leaks
    // the fallback org back in.
    mockFlagValue = { enabled: false, rolloutPercent: 100 }
    mount()
    await verdict('false')
  })

  it('APPLIES the override on the org’s own route', async () => {
    mockOrgOverrides = { [FLAG]: true }
    route.pathname = '/business1/hosts'
    mount()
    await verdict('true')
  })

  it('APPLIES a force-OFF override over a globally-enabled flag', async () => {
    mockFlagValue = { enabled: true }
    mockOrgOverrides = { [FLAG]: false }
    route.pathname = '/business1/hosts'
    mount()
    await verdict('false')
  })

  it('buckets the rollout against the org on its own route', async () => {
    mockFlagValue = { enabled: false, rolloutPercent: 100 }
    route.pathname = '/business1/hosts'
    mount()
    await verdict('true')
  })

  it('treats a workspace subdomain as naming the workspace', async () => {
    mockOrgOverrides = { [FLAG]: true }
    route.pathname = '/'
    route.subdomainSlug = 'business1'
    mount()
    await verdict('true')
  })
})

/**
 * The wiring half of the fix, which no render can observe.
 *
 * A React consumer mounted above its provider gets the context DEFAULT and
 * behaves plausibly — that is exactly how `ReleaseFlagsProvider` read
 * `currentOrg: null` on every route for the whole life of AGL-236 without a
 * single test noticing. The specs above mount the provider directly, so they
 * pass either way; only the app's own composition decides whether the org is
 * visible to it at runtime. Hence a check on that composition.
 */
describe('the layout mounts the org scope ABOVE the flags provider (AGL-1935)', () => {
  it('nests OrgScopeProvider outside ReleaseFlagsProvider', () => {
    const source = readFileSync(
      join(__dirname, '..', 'components', 'layouts', 'firebase-app.layout.tsx'),
      'utf8',
    )
    const orgScope = source.indexOf('<OrgScopeProvider>')
    const flags = source.indexOf('<ReleaseFlagsProvider>')
    expect(orgScope).toBeGreaterThan(-1)
    expect(flags).toBeGreaterThan(-1)
    expect(orgScope).toBeLessThan(flags)
  })
})
