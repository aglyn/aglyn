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
 * AGL-2590 — the workspace a sign-up asked for is created on the FIRST
 * VERIFIED SESSION, and this page is where that session arrives.
 *
 * Sign-up used to create it seconds after the Firebase account, three seconds
 * before the verification email. That workspace could not be opened by
 * anybody: `/api/auth/session` refuses to mint a session cookie while
 * `email_verified` is false, and 148 routes carry the same gate. All the eager
 * creation bought was a permanent claim on a workspace address — handed out
 * before anything showed the address belonged to the person typing it, which
 * is what AGL-2585 then had to reserve, expire and reap behind.
 *
 * The AGL-1115 promise is unchanged and is what these cases hold: a new
 * customer lands IN their workspace, under the name they typed, carrying the
 * plan they picked. It just happens one verification later — on the first
 * session that could have used the workspace at all.
 */

import { act, render, screen } from '@testing-library/react'
import React from 'react'

const mockReplace = jest.fn()
const mockNavigate = jest.fn()
const mockTrackEvent = jest.fn()
const mockAuthorizedFetch = jest.fn()
const mockFirestore = {}

/** The account document, as the page's transaction finds it. */
let mockStoredUserDoc: Record<string, unknown> = {}
let mockUser: { uid: string; providerData: { providerId: string }[] } | null =
  null
let mockScope: {
  orgs: Array<{ $id: string; slug: string; orgName?: string }>
  loading: boolean
  confirmed: boolean
}

jest.mock('next/navigation', () => {
  const router = {
    push: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
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
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => mockScope,
  useOrgSlug: () => '',
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: [], loading: false }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ data: () => mockStoredUserDoc }),
  setDoc: async () => undefined,
  // One in-memory document, so "claimed once" is a property of the store
  // rather than of a mock that agrees with the caller.
  runTransaction: async (_firestore: unknown, callback: any) =>
    callback({
      get: async () => ({ data: () => mockStoredUserDoc }),
      set: (_reference: unknown, value: Record<string, unknown>) => {
        mockStoredUserDoc = { ...mockStoredUserDoc, ...value }
      },
    }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: mockUser }),
}))
jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/create-host-dialog.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../components/create-org-dialog.component', () => ({
  __esModule: true,
  default: (props: { initialName?: string }) => (
    <div data-testid="create-org-dialog">{props.initialName ?? ''}</div>
  ),
}))
jest.mock('../components/org-invites-banner.component', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
// The navigation-safe door (AGL-2587) — the page awaits it BEFORE the hard
// navigation, because a continuation scheduled behind a document teardown
// never runs and that is how `org_created` reported zero for nine workspaces.
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEventBeforeNavigation: async (...args: unknown[]) =>
    mockTrackEvent(...args),
}))
// The navigation seam — jsdom's `location.assign` is read-only, so the page
// hard-navigates through this module precisely so specs can observe it.
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockNavigate(url),
  hardNavigate: (url: string) => mockNavigate(url),
}))

const OrgJump = require('../app/(app)/(home)/page').default

/** Let the claim, the create and the render that follows them settle. */
const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })
}

const held = (over: Record<string, unknown> = {}) => ({
  name: 'Acme Inc',
  nameWasTyped: true,
  provider: 'password',
  createdAtMs: Date.now(),
  ...over,
})

const orgCreateBodies = () =>
  mockAuthorizedFetch.mock.calls
    .filter(([, url]) => String(url).includes('/api/orgs/create'))
    .map(([, , init]) => JSON.parse(String((init as any)?.body ?? '{}')))

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredUserDoc = {}
  mockUser = { uid: 'u-1', providerData: [{ providerId: 'password' }] }
  mockScope = { orgs: [], loading: false, confirmed: true }
  mockAuthorizedFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ orgId: 'o-1', slug: 'acme-inc' }),
  })
})

describe('AGL-2590 · the first verified session gets the workspace', () => {
  it('creates it under the name the person typed and lands in it', async () => {
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(<OrgJump />)
    await flush()

    // The whole of "Do not lose": someone who typed "Acme Inc" gets Acme Inc,
    // not whatever `derivePersonalOrgName` would have produced.
    expect(orgCreateBodies()).toEqual([{ name: 'Acme Inc' }])
    expect(mockNavigate).toHaveBeenCalledWith('/acme-inc/hosts')
  })

  it('counts the activation where the workspace is actually created', async () => {
    // `org_created` used to fire at sign-up, counting workspaces whose owner
    // never confirmed an address. It now counts workspaces that exist and can
    // be opened, which is what the metric's name claims.
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(<OrgJump />)
    await flush()
    expect(mockTrackEvent).toHaveBeenCalledWith('org_created', {})
  })

  it('carries the plan the visitor picked into the new workspace', async () => {
    mockStoredUserDoc = {
      pendingSignUpWorkspace: held(),
      onboardingPlanIntent: {
        query: 'plan=pro&interval=year',
        createdAtMs: Date.now(),
      },
    }
    render(<OrgJump />)
    await flush()

    // Both records cross the verification wall on the same document, and the
    // landing has to resolve them together — a workspace created before the
    // plan answered would send a buyer to their sites to go find billing.
    expect(mockNavigate).toHaveBeenCalledWith('/acme-inc/billing?plan=pro&interval=year')
  })

  it('holds the empty state until the account has answered', async () => {
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(<OrgJump />)
    // Before the claim settles, "Create your first site" is a question that is
    // about to answer itself. A redirect is not a render you can correct a
    // beat later, and neither is an empty state somebody has already read.
    expect(screen.queryByText('Create your first site')).toBeNull()
  })

  it('asks nothing of an account with no held workspace', async () => {
    render(<OrgJump />)
    await flush()
    expect(orgCreateBodies()).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByText('Create your first site')).toBeTruthy()
  })

  it('leaves a member who already has workspaces alone', async () => {
    // A returning member never pays for the claim, and a held record must
    // never be able to mint a second workspace behind somebody's back.
    mockScope = {
      orgs: [{ $id: 'o-1', slug: 'first-org', orgName: 'First Org' }],
      loading: false,
      confirmed: true,
    }
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(<OrgJump />)
    await flush()
    expect(orgCreateBodies()).toEqual([])
  })

  it('waits for a CONFIRMED workspace list, not a cached one', async () => {
    // The console runs a multi-tab Firestore cache and `loading` goes false on
    // the first snapshot, which is the cached one (AGL-1149). Creating a
    // workspace for somebody whose memberships had merely not arrived yet is
    // not a render you can correct — it is a workspace they have to delete.
    mockScope = { orgs: [], loading: false, confirmed: false }
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(<OrgJump />)
    await flush()
    expect(orgCreateBodies()).toEqual([])
  })

  it('⚠️ refuses a held name the account no longer has the credential for', async () => {
    // The pre-hijacking case, from this page's side. An attacker signed up as
    // the victim with a password, never verified, and typed a workspace name;
    // Google then took the account over on the same uid and destroyed the
    // password credential. The record is all that survived, and honouring it
    // would put the attacker's name on the victim's workspace address.
    mockUser = { uid: 'u-1', providerData: [{ providerId: 'google.com' }] }
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(<OrgJump />)
    await flush()

    expect(orgCreateBodies()).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
    expect(screen.getByText('Create your first site')).toBeTruthy()
  })

  it('quotes a TYPED name back when the create is refused', async () => {
    // Best-effort never meant silent (AGL-1523). The failure used to reach
    // this page through a sessionStorage marker set on /signup; the create now
    // happens HERE, so the notice has to be raised from the same place.
    mockAuthorizedFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'That workspace URL is taken' }),
    })
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(<OrgJump />)
    await flush()

    expect(
      screen.getByText(/We couldn’t create your workspace “Acme Inc”/),
    ).toBeTruthy()
    expect(screen.getByTestId('create-org-dialog').textContent).toBe('Acme Inc')
  })

  it('says nothing about a DERIVED name that failed', async () => {
    // The notice quotes the name back, which only reads as an answer when it
    // is what somebody entered.
    mockAuthorizedFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'That workspace URL is taken' }),
    })
    mockStoredUserDoc = {
      pendingSignUpWorkspace: held({ nameWasTyped: false, name: 'ada' }),
    }
    render(<OrgJump />)
    await flush()

    expect(screen.queryByText(/We couldn’t create your workspace/)).toBeNull()
    expect(screen.getByText('Create your first site')).toBeTruthy()
  })
})
