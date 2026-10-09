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
 * AGL-3596, on screen: a deleted site is "This site doesn't exist anymore",
 * and nothing under `[host]` mounts beneath it.
 *
 * Rendered against the REAL provider, resolution hook and guard, because the
 * production failure was a page mounted against a cached id — the hook's own
 * spec (`use-host-resolution-server-confirmed.spec.ts`) proves the id, and
 * this one proves the pages under the shell never see the wrong one. The
 * `site page` child stands in for every page under `[host]`, the plugin
 * catch-all (AI jobs, the build page) included: they sit under the same
 * layout and the same guard.
 */
import { act, render, screen } from '@testing-library/react'
import HostGuard from '../components/host-guard.component'
import HostIdProvider, { useHostId } from '../components/host-id-provider'

const mockGetDocs = jest.fn()
const mockGetDocsFromServer = jest.fn()
/** What the open host-doc listener currently reports. */
let mockHostDoc: Record<string, unknown> = {
  data: undefined,
  status: 'loading',
  fromCache: true,
  serverDenied: false,
}
const mockHostDocRenders = new Set<() => void>()

jest.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (target: { path: string }) => target,
  where: () => ({}),
  limit: () => ({}),
  getDocs: (target: { path: string }) => mockGetDocs(target),
  getDocsFromServer: (target: { path: string }) =>
    mockGetDocsFromServer(target),
}))

jest.mock('firebase/auth', () => ({
  onIdTokenChanged: () => () => undefined,
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  const firestore = {}
  const auth = {}
  const user = { data: { uid: 'user-1' } }
  return {
    useFirestore: () => firestore,
    useAuth: () => auth,
    useUser: () => user,
    subscribeFirestoreSessionHeal: () => () => undefined,
  }
})

jest.mock('../hooks/use-host', () => {
  const { useEffect, useReducer } = jest.requireActual('react')
  return {
    useHost: () => {
      const [, rerender] = useReducer((count: number) => count + 1, 0)
      useEffect(() => {
        const listener = () => rerender()
        mockHostDocRenders.add(listener)
        return () => {
          mockHostDocRenders.delete(listener)
        }
      }, [])
      return { doc: mockHostDoc, setDoc: jest.fn() }
    },
  }
})

jest.mock('../hooks/use-org-scope', () => ({
  useOrgSlug: () => 'acme',
  useOrgScope: () => ({
    orgs: [{ $id: 'org-1', slug: 'acme' }],
    currentOrg: { $id: 'org-1', slug: 'acme' },
    selectOrg: jest.fn(),
    orgSlug: null,
    pathOrgSlug: 'acme',
    loading: false,
    confirmed: true,
    slugExists: true,
    error: false,
    authError: false,
    retry: jest.fn(),
    hasMoreOrgs: false,
    loadMoreOrgs: jest.fn(),
  }),
}))

jest.mock('next/navigation', () => {
  const router = { replace: jest.fn(), push: jest.fn(), prefetch: jest.fn() }
  return {
    useRouter: () => router,
    useParams: () => ({ orgSlug: 'acme', host: 'hillside-dog-grooming' }),
    usePathname: () => '/acme/hosts/hillside-dog-grooming/ai-jobs',
    notFound: () => {
      throw new Error('notFound() called')
    },
  }
})

const DELETED_ID = '3n8xbujR3b'

const snap = (docs: Array<{ id: string; data?: Record<string, unknown> }>) => ({
  empty: docs.length === 0,
  docs: docs.map((entry) => ({
    id: entry.id,
    get: (field: string) => entry.data?.[field],
  })),
})

/** Every id a page under the shell was mounted with. */
let mountedWith: Array<string | null> = []
function SitePage() {
  const hostId = useHostId()
  mountedWith.push(hostId)
  return <div>{`site page ${hostId}`}</div>
}

function renderShell() {
  return render(
    <HostIdProvider>
      <HostGuard>
        <SitePage />
      </HostGuard>
    </HostIdProvider>,
  )
}

async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0)
  })
}

function hostDocBecomes(next: Record<string, unknown>) {
  mockHostDoc = next
  act(() => {
    for (const listener of [...mockHostDocRenders]) listener()
  })
}

describe('a deleted site renders as gone, with nothing beneath it (AGL-3596)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mountedWith = []
    mockHostDoc = {
      data: undefined,
      status: 'loading',
      fromCache: true,
      serverDenied: false,
    }
    mockGetDocs.mockReset()
    mockGetDocsFromServer.mockReset()
    // The browser cache still maps the subdomain to the deleted site.
    mockGetDocs.mockResolvedValue(
      snap([{ id: DELETED_ID, data: { orgId: 'org-1' } }]),
    )
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('REGRESSION — a cached mapping to a deleted site shows "doesn\'t exist anymore", not the site', async () => {
    mockGetDocsFromServer.mockResolvedValue(snap([]))

    renderShell()
    await settle()

    expect(screen.getByText('This site doesn’t exist anymore')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Back to Sites' }).getAttribute('href'),
    ).toBe('/acme/hosts')
    // No page under `[host]` mounted, so none opened a listener to be refused.
    expect(mountedWith).toEqual([])
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })

  it('REGRESSION — a site deleted while open is re-resolved and replaced by the not-found state', async () => {
    mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'host-1' }]))
    renderShell()
    await settle()
    expect(screen.getByText('site page host-1')).toBeTruthy()

    // The site is deleted: the server now confirms the doc is absent, and the
    // membership is gone with it.
    mockGetDocsFromServer.mockResolvedValue(snap([]))
    hostDocBecomes({
      data: undefined,
      status: 'success',
      fromCache: false,
      serverDenied: false,
    })
    await settle()

    expect(screen.getByText('This site doesn’t exist anymore')).toBeTruthy()
    expect(screen.queryByText(/site page/)).toBeNull()
  })

  it('a refused host doc is re-resolved the same way', async () => {
    mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'host-1' }]))
    renderShell()
    await settle()

    mockGetDocsFromServer.mockResolvedValue(snap([]))
    hostDocBecomes({
      data: { memberRoles: {} },
      status: 'error',
      fromCache: true,
      serverDenied: true,
    })
    await settle()

    expect(screen.getByText('This site doesn’t exist anymore')).toBeTruthy()
    expect(screen.queryByText(/site page/)).toBeNull()
  })

  it('CONTROL — a refusal re-resolution cannot explain re-checks once, then leaves the site', async () => {
    mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'host-1' }]))
    renderShell()
    await settle()
    const readsBefore = mockGetDocsFromServer.mock.calls.length

    // The server still maps the subdomain to the same site: the refusal is
    // something else (a session fault, healed by the listeners' own path).
    hostDocBecomes({
      data: undefined,
      status: 'error',
      fromCache: true,
      serverDenied: true,
    })
    await settle()
    await settle()

    expect(screen.getByText('site page host-1')).toBeTruthy()
    // One re-resolution, not a loop: one pass is the projection and the
    // authoritative query, started together since AGL-3718.
    expect(mockGetDocsFromServer.mock.calls.length - readsBefore).toBe(2)
  })

  it('CONTROL — a live site mounts its pages with its server-confirmed id', async () => {
    mockGetDocsFromServer.mockResolvedValue(snap([{ id: 'host-1' }]))
    renderShell()
    await settle()
    hostDocBecomes({
      data: { subdomain: 'hillside-dog-grooming' },
      status: 'success',
      fromCache: false,
      serverDenied: false,
    })
    await settle()

    expect(screen.getByText('site page host-1')).toBeTruthy()
    expect(mountedWith.every((id) => id === 'host-1')).toBe(true)
  })
})
