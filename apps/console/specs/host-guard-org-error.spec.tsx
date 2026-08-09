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
 * AGL-1260: a host route must not spin forever when the ORG read dies.
 *
 * `hostReady` collapses "no org yet" and "host not resolved yet" into one
 * boolean, and host resolution HOLDS while the org is unknown — so a
 * terminally failed membership read left `hostReady` false forever and
 * HostGuard on its spinner branch: no copy, no button, no way out. This spec
 * renders the REAL provider over the real guard (the retry hook alone would
 * pass with nothing wired to it) and pins the derivation:
 *  - a latched org error SETTLES readiness into the error branch, whose copy
 *    names the workspaces and whose button retries the ORG read;
 *  - a merely loading org is still the spinner — the error state is gated on
 *    the latch, never on the loading default;
 *  - a host-resolution failure keeps its own copy and its own retry.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import HostGuard from '../components/host-guard.component'
import HostIdProvider from '../components/host-id-provider'

const mockOrgRetry = jest.fn()
const mockHostRetry = jest.fn()

/** Reassigned per test; the provider reads these through the mocked hooks. */
let mockScope: Record<string, unknown>
let mockResolution: Record<string, unknown>

jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => mockScope,
}))

jest.mock('../hooks/use-host-resolution', () => ({
  useHostResolution: () => mockResolution,
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  // Stable identities, as reactfire provides — effect deps include these.
  const firestore = {}
  const user = { data: { uid: 'user-1' } }
  // The host plugin-policy bridge (AGL-1014) reads the host doc once a
  // hostId resolves; a loading doc is the honest default here.
  const hostDoc = { doc: { data: undefined, status: 'loading' } }
  return {
    useFirestore: () => firestore,
    useUser: () => user,
    useHost: () => hostDoc,
  }
})

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  limit: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}))

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
    useParams: () => ({ orgSlug: 'acme', host: 'my-site' }),
    usePathname: () => '/acme/hosts/my-site',
    notFound: () => {
      // A guard bug must fail the test loudly, never pass as an empty render.
      throw new Error('notFound() called')
    },
  }
})

const ORG = { $id: 'org-1', slug: 'acme' }

function scope(overrides: Record<string, unknown>) {
  return {
    orgs: [],
    currentOrg: null,
    selectOrg: jest.fn(),
    orgSlug: null,
    pathOrgSlug: 'acme',
    loading: false,
    confirmed: false,
    slugExists: null,
    error: false,
    retry: mockOrgRetry,
    ...overrides,
  }
}

function resolution(overrides: Record<string, unknown>) {
  return {
    hostId: null,
    ready: false,
    error: false,
    retry: mockHostRetry,
    ...overrides,
  }
}

function renderRoute() {
  return render(
    <HostIdProvider>
      <HostGuard>
        <div>{'site'}</div>
      </HostGuard>
    </HostIdProvider>,
  )
}

describe('HostGuard when the org read dies (AGL-1260)', () => {
  beforeEach(() => {
    mockOrgRetry.mockClear()
    mockHostRetry.mockClear()
  })

  it('REGRESSION — a latched org error is an error screen, not a spinner', () => {
    // The reported state: the membership listen exhausted its budget, so
    // resolution is still holding (`ready: false`) and always will be.
    mockScope = scope({ error: true })
    mockResolution = resolution({})
    renderRoute()

    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(
      screen.getByText(/Couldn't load your workspaces/),
    ).toBeTruthy()
    expect(screen.queryByText('site')).toBeNull()
  })

  it("the error's Try again retries the ORG read, not host resolution", () => {
    mockScope = scope({ error: true })
    mockResolution = resolution({})
    renderRoute()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mockOrgRetry).toHaveBeenCalledTimes(1)
    expect(mockHostRetry).not.toHaveBeenCalled()
  })

  it('CONTROL — an org still loading is the spinner, not a flashed error', () => {
    mockScope = scope({ loading: true })
    mockResolution = resolution({})
    renderRoute()

    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })

  it('recovers — org and host resolving after a retry renders the route', () => {
    mockScope = scope({ error: true })
    mockResolution = resolution({})
    const view = renderRoute()
    expect(screen.queryByText('site')).toBeNull()

    mockScope = scope({ orgs: [ORG], currentOrg: ORG })
    mockResolution = resolution({ hostId: 'host-1', ready: true })
    view.rerender(
      <HostIdProvider>
        <HostGuard>
          <div>{'site'}</div>
        </HostGuard>
      </HostIdProvider>,
    )
    expect(screen.getByText('site')).toBeTruthy()
  })

  it('a HOST resolution failure keeps its own copy and its own retry', () => {
    mockScope = scope({ orgs: [ORG], currentOrg: ORG })
    mockResolution = resolution({ ready: true, error: true })
    renderRoute()

    expect(
      screen.getByText(/Couldn't load this workspace's sites/),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mockHostRetry).toHaveBeenCalledTimes(1)
    expect(mockOrgRetry).not.toHaveBeenCalled()
  })
})
