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
 * A stale tab must heal itself when the SESSION comes back.
 *
 * Reported first-hand: a besigner tab left open long enough for the ID token
 * to expire showed "Couldn't load this workspace's sites. Check your
 * connection and try again." A re-auth dialog came up and then vanished on
 * its own about two seconds later, before anything was typed — the token had
 * been refreshed. A NEW tab on the same URL loaded fine. The stale one never
 * recovered.
 *
 * Two separate defects, and this spec pins both, because fixing either alone
 * still leaves a user staring at a wrong sentence or a dead page:
 *
 *  1. the error was TERMINAL. `useHostResolution`'s effect keys on
 *     `[firestore, subdomain, uid, orgId, attempt]`, and a token refresh
 *     moves none of them (`useUser()` re-emits the same `User` for the same
 *     uid), so nothing re-read. AGL-1200's `retry()` was the only way out and
 *     it needs a human;
 *  2. the copy blamed the network for a session fault, which is the giveaway
 *     that the two were never told apart at all — both catch blocks threw the
 *     error object away.
 *
 * The recovery is deliberately EVENT-driven and deliberately auth-only. A
 * network fault gets no self-heal on purpose: nothing tells a page that a
 * connection came back, so a poll is the only way to find out, and the
 * manual retry is the honest alternative. The CONTROLs below are what stop
 * this from being "quietly retry everything forever".
 *
 * Rendered against the REAL `useHostResolution`, the real provider and the
 * real guard. A hook-level assertion would pass with nothing wired to the
 * screen, which is exactly the class of fix AGL-1200's own spec was written
 * to catch.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import HostGuard from '../components/host-guard.component'
import HostIdProvider from '../components/host-id-provider'

const mockGetDocs = jest.fn()
const mockGetDocsFromServer = jest.fn()
/** Live `onIdTokenChanged` callbacks, in subscribe order. */
const mockTokenListeners: Array<(user: unknown) => void> = []
/** Live AGL-1066 session-heal subscribers. */
const mockHealListeners: Array<() => void> = []
const mockAuthUser = { uid: 'user-1' }

/**
 * Paths are real here (rather than `() => ({})`) so a test can tell the two
 * `getDocs` callers apart: resolution's own reads, and the provider's
 * cross-org `hostIndex` lookup, which fires on exactly the same
 * `ready && !hostId` state the error branch produces. Counting them together
 * would make "did anything re-read?" unanswerable.
 */
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
  onIdTokenChanged: (_auth: unknown, next: (user: unknown) => void) => {
    mockTokenListeners.push(next)
    // Firebase replays the CURRENT user SYNCHRONOUSLY on subscribe, and
    // reproducing that is the point rather than an accident: the hook
    // subscribes the instant the failure latches, so the replay carries the
    // very token that was just refused. An implementation that reads it as
    // news retries at once, fails, latches, resubscribes, replays — a hot
    // loop with no backoff. The CONTROL below is what sees that.
    next(mockAuthUser)
    return () => {
      const at = mockTokenListeners.indexOf(next)
      if (at >= 0) mockTokenListeners.splice(at, 1)
    }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => {
  // Stable identities, as the real provider gives: `firestore` and `auth` are
  // effect deps, so a fresh object per render would restart everything.
  const firestore = {}
  const auth = {}
  const user = { data: { uid: 'user-1' } }
  const hostDoc = { doc: { data: undefined, status: 'loading' } }
  return {
    useFirestore: () => firestore,
    useAuth: () => auth,
    useUser: () => user,
    useHost: () => hostDoc,
    subscribeFirestoreSessionHeal: (listener: () => void) => {
      mockHealListeners.push(listener)
      return () => {
        const at = mockHealListeners.indexOf(listener)
        if (at >= 0) mockHealListeners.splice(at, 1)
      }
    },
  }
})

/**
 * A HEALTHY org read. This suite is about host resolution; the org side has
 * the same latch and the same cure, pinned where it lives (`useOrgScope`).
 */
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    orgs: [{ $id: 'org-1', slug: 'aglyn-org' }],
    currentOrg: { $id: 'org-1', slug: 'aglyn-org' },
    selectOrg: jest.fn(),
    orgSlug: null,
    pathOrgSlug: 'aglyn-org',
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
    useParams: () => ({ orgSlug: 'aglyn-org', host: 'aglyn-marketing' }),
    usePathname: () =>
      '/aglyn-org/hosts/aglyn-marketing/screens/q3RLZRAhLZ/versions/WBEWmOHq6l/besigner',
    notFound: () => {
      // A guard bug must fail loudly, never pass as an empty render.
      throw new Error('notFound() called')
    },
  }
})

const snap = (docs: Array<{ id: string; data?: Record<string, unknown> }>) => ({
  empty: docs.length === 0,
  docs: docs.map((entry) => ({
    id: entry.id,
    get: (field: string) => entry.data?.[field],
  })),
})

const denied = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  })
const offline = () =>
  Object.assign(new Error('Failed to get documents from server.'), {
    code: 'unavailable',
  })

/** Resolution reads only — the provider's `hostIndex` lookup is excluded. */
let resolutionReads = 0
/** What the next resolution read does; reassigned mid-test to recover. */
let respond: () => Promise<unknown> = () => Promise.reject(denied())

function renderRoute() {
  return render(
    <HostIdProvider>
      <HostGuard>
        <div>{'editor'}</div>
      </HostGuard>
    </HostIdProvider>,
  )
}

/** Runs the whole 12.4 s retry ladder out, plus slack. */
async function exhaustRetries() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60_000)
  })
}

/** Lets an already-scheduled promise chain settle without moving the clock. */
async function settle() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0)
  })
}

/** A token refresh AFTER the subscribe-time replay — the recovery signal. */
function refreshToken(user: unknown = mockAuthUser) {
  act(() => {
    for (const listener of [...mockTokenListeners]) listener(user)
  })
}

const errorText = () => screen.queryByText(/Couldn't load/)?.textContent ?? null

describe('a stale tab recovers when the session does', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockGetDocs.mockReset()
    mockGetDocsFromServer.mockReset()
    mockTokenListeners.length = 0
    mockHealListeners.length = 0
    resolutionReads = 0
    respond = () => Promise.reject(denied())
    mockGetDocs.mockImplementation((target: { path: string }) => {
      // The provider's cross-org redirect probe. Inert, and never counted.
      if (target.path === 'hostIndex') return Promise.resolve(snap([]))
      resolutionReads += 1
      return respond()
    })
    mockGetDocsFromServer.mockImplementation(() => respond())
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('REGRESSION — a refreshed token clears the error with no user action', async () => {
    renderRoute()
    await exhaustRetries()
    expect(errorText()).toMatch(/Couldn't load this workspace's sites/)

    // The token comes back — Firebase's own hourly refresh, or a sibling
    // tab's restore landing in shared auth state. Before the fix this
    // changed nothing at all: no dep moved, so no effect re-ran, and the
    // page stayed on the error until somebody pressed the button.
    respond = () => Promise.resolve(snap([{ id: 'host-1' }]))
    refreshToken()
    await settle()

    expect(screen.getByText('editor')).toBeTruthy()
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
    // The whole point: the recovery happened with nothing clicked.
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('REGRESSION — the AGL-1066 heal broadcast clears it too', async () => {
    // The reported episode literally: a re-auth prompt went up and then stood
    // down on its own, which is the falling edge `utils/session-heal.ts`
    // broadcasts on. Every listener-based hook in the tenant library already
    // reopens on this; the console's two latching reads never subscribed.
    renderRoute()
    await exhaustRetries()
    expect(errorText()).toMatch(/Couldn't load this workspace's sites/)
    expect(mockHealListeners.length).toBe(1)

    respond = () => Promise.resolve(snap([{ id: 'host-1' }]))
    act(() => {
      for (const listener of [...mockHealListeners]) listener()
    })
    await settle()

    expect(screen.getByText('editor')).toBeTruthy()
  })

  it('names the session, and does NOT tell the user to check their connection', async () => {
    renderRoute()
    await exhaustRetries()

    // "Check your connection" for an expired token is what sent the report
    // looking at the network in the first place.
    expect(errorText()).toMatch(/session expired/i)
    expect(errorText()).not.toMatch(/connection/i)
  })

  it('CONTROL — the subscribe-time token replay is not a recovery', async () => {
    renderRoute()
    await exhaustRetries()
    const afterLatch = resolutionReads
    expect(errorText()).toBeTruthy()

    // The replay already fired, synchronously, when the hook subscribed at
    // the moment of the latch. Nothing may have come of it: no re-read, and
    // the guard still on its error branch rather than back on the spinner.
    // Without the `seenReplay` guard this test does not merely fail — it
    // spins, because each retry re-subscribes and replays again.
    await exhaustRetries()
    expect(resolutionReads).toBe(afterLatch)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(errorText()).toBeTruthy()
  })

  it('CONTROL — a NETWORK failure keeps its copy and does not self-heal', async () => {
    respond = () => Promise.reject(offline())
    renderRoute()
    await exhaustRetries()
    expect(errorText()).toMatch(/Check your connection and try again/)

    // An auth event says nothing about a connection, so it must not be
    // allowed to look like a fix. If this ever passes, the classifier has
    // gone back to treating every failure as a session fault.
    const afterLatch = resolutionReads
    respond = () => Promise.resolve(snap([{ id: 'host-1' }]))
    refreshToken()
    await settle()

    expect(resolutionReads).toBe(afterLatch)
    expect(screen.queryByText('editor')).toBeNull()
    expect(errorText()).toMatch(/Check your connection and try again/)

    // …and the manual recovery it keeps instead still works.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await settle()
    expect(screen.getByText('editor')).toBeTruthy()
  })

  it('CONTROL — a signed-OUT token emission is not a recovery', async () => {
    renderRoute()
    await exhaustRetries()
    const afterLatch = resolutionReads

    respond = () => Promise.resolve(snap([{ id: 'host-1' }]))
    refreshToken(null)
    await settle()

    // Signing out is handled by leaving the route, not by re-reading a
    // workspace the user no longer has a session for.
    expect(resolutionReads).toBe(afterLatch)
    expect(screen.queryByText('editor')).toBeNull()
  })

  it('CONTROL — a healthy page holds no auth listener at all', async () => {
    respond = () => Promise.resolve(snap([{ id: 'host-1' }]))
    renderRoute()
    await settle()

    expect(screen.getByText('editor')).toBeTruthy()
    // The subscription is gated on an OUTSTANDING auth failure, which is what
    // keeps an hourly token refresh from reopening reads across the console —
    // the very reason `utils/session-heal.ts` refuses to broadcast on tokens.
    expect(mockTokenListeners).toHaveLength(0)
    expect(mockHealListeners).toHaveLength(0)
  })
})
