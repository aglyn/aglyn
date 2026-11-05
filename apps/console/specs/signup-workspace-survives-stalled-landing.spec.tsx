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
 * AGL-4117 — a verified, signed-in account with no workspace gets the one it
 * named, even when its landing stalls.
 *
 * Production, 2026-11-04 23:11Z: a password sign-up on Android Chrome,
 * verified on the auth host with two console tabs open. `app.` `/` restored
 * the session from the shared cookie (200), was bounced to `/signin` anyway,
 * came back, and never sent `/api/orgs/create`. The account was left with
 * its typed name held and no workspace.
 *
 * Two joins are held here:
 * 1. the auth guard waits for the load-time cookie restore before it bounces
 *    a signed-out tab to `/signin`;
 * 2. the chooser's provisioning cannot be held forever by Firestore calls a
 *    frozen sibling tab never lets answer: the plan read reads as "none"
 *    after its deadline, and a claim that never answers hands the create to
 *    the server, which uses the held typed name.
 */

import { act, render } from '@testing-library/react'
import React from 'react'

const mockPush = jest.fn()
const mockNavigate = jest.fn()
const mockAuthorizedFetch = jest.fn()
const mockFirestore = {}

/** Firestore calls that never answer: the frozen-lease shape. */
const never = () => new Promise<never>(() => undefined)
let mockFirestoreStalls = true
let mockStoredUserDoc: Record<string, unknown> = {}
let mockUser: Record<string, unknown> | null = null
let mockSigninCheck: { status: string; data: unknown }
let mockScope: { orgs: unknown[]; loading: boolean; confirmed: boolean }

jest.mock('next/navigation', () => {
  const router = {
    push: (...args: unknown[]) => mockPush(...args),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
  }
  return {
    ...jest.requireActual('next/navigation'),
    useRouter: () => router,
    useParams: () => ({}),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
  }
})
jest.mock('@aglyn/shared-ui-jsx/components/splash-screen', () => ({
  SplashScreen: () => null,
}))
jest.mock('../hooks/use-idle-logout', () => ({
  __esModule: true,
  default: () => undefined,
}))
for (const path of [
  '../components/impersonation-banner.component',
  '../components/session-health-banner.component',
  '../components/session-reauth-dialog.component',
  '../components/layouts/dashboard.layout',
  '../components/create-host-dialog.component',
  '../components/create-org-dialog.component',
  '../components/org-invites-banner.component',
]) {
  jest.doMock(path, () => ({
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) => (
      <>{children ?? null}</>
    ),
  }))
}
jest.mock('../hooks/use-pinned-orgs', () => ({
  __esModule: true,
  usePinnedOrgs: () => ({ pinned: [], ready: true, toggle: () => undefined }),
  default: () => ({ pinned: [], ready: true, toggle: () => undefined }),
}))
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => mockScope,
  useOrgSlug: () => '',
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () =>
    mockFirestoreStalls ? never() : { data: () => mockStoredUserDoc },
  setDoc: async () => (mockFirestoreStalls ? never() : undefined),
  runTransaction: async (_firestore: unknown, callback: any) =>
    mockFirestoreStalls
      ? never()
      : callback({
          get: async () => ({ data: () => mockStoredUserDoc }),
          set: (_reference: unknown, value: Record<string, unknown>) => {
            mockStoredUserDoc = { ...mockStoredUserDoc, ...value }
          },
        }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: mockUser }),
  useSigninCheck: () => mockSigninCheck,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEventBeforeNavigation: async () => undefined,
}))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockNavigate(url),
  hardNavigate: (url: string) => mockNavigate(url),
}))

const AuthenticatedLayout =
  require('../components/layouts/authenticated.layout').default
const OrgJump = require('../app/(app)/(home)/page').default
const {
  beginSessionRestore,
  settleSessionRestore,
} = require('../utils/session-restore-pending')
const { PLAN_INTENT_DEADLINE_MS } = require('../utils/onboarding-plan-intent')
const { SIGN_UP_CLAIM_DEADLINE_MS } = require('../utils/signup-workspace')

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve()
  })
}
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
  await flush()
}

const orgCreateBodies = () =>
  mockAuthorizedFetch.mock.calls
    .filter(([, url]) => String(url).includes('/api/orgs/create'))
    .map(([, , init]) => JSON.parse(String((init as any)?.body ?? '{}')))

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
  settleSessionRestore()
  setVisibility('visible')
  mockFirestoreStalls = true
  mockStoredUserDoc = {}
  mockSigninCheck = { status: 'success', data: { signedIn: false } }
  mockScope = { orgs: [], loading: false, confirmed: true }
  // Two minutes old, verified: young enough for the AGL-4021 backstop.
  mockUser = {
    uid: 'u-1',
    emailVerified: true,
    displayName: 'Ada Example',
    email: 'ada@example.test',
    metadata: { creationTime: new Date(Date.now() - 120_000).toUTCString() },
    providerData: [{ providerId: 'password' }],
    getIdToken: async () => 'token',
  }
  mockAuthorizedFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ orgId: 'o-1', slug: 'acme-inc' }),
  })
})

afterEach(() => {
  settleSessionRestore()
  jest.useRealTimers()
})

describe('AGL-4117 · the guard waits for the shared-cookie restore', () => {
  it('does not bounce to /signin while the load-time restore is out', async () => {
    beginSessionRestore()
    render(<AuthenticatedLayout>{'page'}</AuthenticatedLayout>)
    await flush()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('stays put when the restore signs the tab in', async () => {
    beginSessionRestore()
    const view = render(<AuthenticatedLayout>{'page'}</AuthenticatedLayout>)
    mockSigninCheck = {
      status: 'success',
      data: { signedIn: true, user: { emailVerified: true } },
    }
    view.rerender(<AuthenticatedLayout>{'page'}</AuthenticatedLayout>)
    await act(async () => settleSessionRestore())
    await flush()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('still sends a genuinely signed-out visitor to /signin once it answers', async () => {
    beginSessionRestore()
    render(<AuthenticatedLayout>{'page'}</AuthenticatedLayout>)
    await act(async () => settleSessionRestore())
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(String(mockPush.mock.calls[0][0])).toContain('/signin')
  })

  it('never waits past the cap for a restore that never answers', async () => {
    beginSessionRestore()
    render(<AuthenticatedLayout>{'page'}</AuthenticatedLayout>)
    await advance(8_000)
    expect(String(mockPush.mock.calls[0]?.[0])).toContain('/signin')
  })
})

describe('AGL-4117 · provisioning is never held forever by a stalled tab', () => {
  it('creates the workspace through the server when the plan read and the claim never answer', async () => {
    render(<OrgJump />)
    await flush()
    expect(orgCreateBodies()).toEqual([])

    await advance(PLAN_INTENT_DEADLINE_MS)
    expect(orgCreateBodies()).toEqual([])
    await advance(SIGN_UP_CLAIM_DEADLINE_MS)

    // `derived`, so `/api/orgs/create` uses the held TYPED name and spends
    // the hold (the server half is held by org-create-honors-held-name).
    expect(orgCreateBodies()).toEqual([
      expect.objectContaining({ derived: true }),
    ])
    expect(mockNavigate).toHaveBeenCalledWith(
      '/acme-inc/hosts',
    )
  })

  it('waits for a hidden tab to be looked at before it asks the server', async () => {
    setVisibility('hidden')
    render(<OrgJump />)
    await advance(PLAN_INTENT_DEADLINE_MS)
    await advance(SIGN_UP_CLAIM_DEADLINE_MS)
    expect(orgCreateBodies()).toEqual([])

    await act(async () => setVisibility('visible'))
    await flush()
    expect(orgCreateBodies()).toHaveLength(1)
  })

  it('asks the server once per browser, so a second stalled tab makes no second workspace', async () => {
    const first = render(<OrgJump />)
    await advance(PLAN_INTENT_DEADLINE_MS + SIGN_UP_CLAIM_DEADLINE_MS)
    first.unmount()
    render(<OrgJump />)
    await advance(PLAN_INTENT_DEADLINE_MS + SIGN_UP_CLAIM_DEADLINE_MS)
    expect(orgCreateBodies()).toHaveLength(1)
  })

  it('hands nothing to the server for an account too old for the backstop', async () => {
    mockUser = {
      ...mockUser,
      metadata: { creationTime: new Date(Date.now() - 3 * 86_400_000).toUTCString() },
    }
    render(<OrgJump />)
    await advance(PLAN_INTENT_DEADLINE_MS + SIGN_UP_CLAIM_DEADLINE_MS)
    expect(orgCreateBodies()).toEqual([])
  })

  it('still claims in the browser, under the typed name, when Firestore answers', async () => {
    mockFirestoreStalls = false
    mockStoredUserDoc = {
      pendingSignUpWorkspace: {
        name: 'Acme Inc',
        nameWasTyped: true,
        provider: 'password',
        createdAtMs: Date.now(),
      },
    }
    render(<OrgJump />)
    await flush()
    expect(orgCreateBodies()).toEqual([{ name: 'Acme Inc' }])
    expect(mockStoredUserDoc['pendingSignUpWorkspace']).toBeNull()
  })
})
