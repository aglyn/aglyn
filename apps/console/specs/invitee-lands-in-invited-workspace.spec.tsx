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
 * AGL-4047 — a person invited to a workspace who signs up lands IN that
 * workspace, and is never also handed a workspace of their own built from the
 * name the sign-up form asked for.
 *
 * The form asks everyone for a name, because it cannot know about an
 * invitation before the account exists without telling a stranger which
 * addresses have one. The decision is made on the first verified session:
 * the workspace chooser holds the typed name back while an invitation is
 * waiting (or was just joined), and the automatic join opens the NEWEST
 * invited workspace. A person with no invitation still gets the workspace
 * they named, exactly as before.
 */

import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import {
  InviteAutoAcceptContext,
  type InviteAutoAcceptState,
} from '../hooks/use-invite-auto-accept'
import type { PendingInvite } from '../hooks/use-pending-invites'
import {
  inviteSentAtMs,
  latestInvite,
  newestInvitesFirst,
} from '../utils/invite-order'

const mockReplace = jest.fn()
const mockNavigate = jest.fn()
const mockAuthorizedFetch = jest.fn()
const mockRespond = jest.fn()
const mockFirestore = {}

let mockStoredUserDoc: Record<string, unknown> = {}
let mockInvites: PendingInvite[] = []
let mockPathname = '/'
const mockUser = {
  uid: 'u-invitee',
  emailVerified: true,
  providerData: [{ providerId: 'password' }],
  metadata: { creationTime: new Date().toUTCString() },
  getIdTokenResult: () => Promise.resolve({ claims: {} }),
}

jest.mock('../hooks/use-pinned-orgs', () => ({
  __esModule: true,
  usePinnedOrgs: () => ({ pinned: [], ready: true, toggle: () => undefined }),
  default: () => ({ pinned: [], ready: true, toggle: () => undefined }),
}))
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
    usePathname: () => mockPathname,
    useSearchParams: () => new URLSearchParams(),
  }
})
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ orgs: [], loading: false, confirmed: true }),
  useOrgSlug: () => '',
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({
    invites: mockInvites,
    loading: false,
    refresh: jest.fn(),
  }),
}))
jest.mock('../hooks/use-invite-response', () => ({
  useInviteResponse: () => ({ respond: mockRespond, busyId: null }),
}))
jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: async () => ({ data: () => mockStoredUserDoc }),
  setDoc: async () => undefined,
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
  default: () => null,
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
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  trackEventBeforeNavigation: async () => undefined,
}))
jest.mock('../utils/hard-navigate', () => ({
  __esModule: true,
  default: (url: string) => mockNavigate(url),
  hardNavigate: (url: string) => mockNavigate(url),
}))

const OrgJump = require('../app/(app)/(home)/page').default
const InviteAutoAcceptProvider =
  require('../components/invite-auto-accept-provider.component').default

const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  })
}

const held = () => ({
  name: 'Pat Lee Designs',
  nameWasTyped: true,
  provider: 'password',
  createdAtMs: Date.now(),
})

const orgCreateBodies = () =>
  mockAuthorizedFetch.mock.calls
    .filter(([, url]) => String(url).includes('/api/orgs/create'))
    .map(([, , init]) => JSON.parse(String((init as any)?.body ?? '{}')))

const autoJoin = (
  over: Partial<InviteAutoAcceptState> = {},
): InviteAutoAcceptState => ({
  enabled: true,
  statusOf: () => undefined,
  joinedSlugs: new Set(),
  joining: false,
  ...over,
})

const ACME: PendingInvite = {
  $id: 'inv-acme',
  orgId: 'org-acme',
  orgName: 'Acme Builders',
  orgSlug: 'acme-builders',
  role: 'editor',
  createdAtMs: Date.parse('2026-11-10T12:00:00Z'),
}
const OTHER: PendingInvite = {
  $id: 'inv-other',
  orgId: 'org-other',
  orgName: 'Other Co',
  orgSlug: 'other-co',
  role: 'viewer',
  createdAtMs: Date.parse('2026-11-14T12:00:00Z'),
}

beforeEach(() => {
  jest.clearAllMocks()
  mockStoredUserDoc = {}
  mockInvites = []
  mockPathname = '/'
  mockAuthorizedFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ orgId: 'o-1', slug: 'pat-lee-designs' }),
  })
  mockRespond.mockResolvedValue(true)
})

describe('AGL-4047 · the workspace chooser holds the typed name for an invitee', () => {
  it('creates no workspace for a person with an invitation waiting', async () => {
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    mockInvites = [ACME]
    render(
      <InviteAutoAcceptContext.Provider value={autoJoin()}>
        <OrgJump />
      </InviteAutoAcceptContext.Provider>,
    )
    await flush()

    // Red before the fix: "Pat Lee Designs" was claimed, created, and the page
    // hard-navigated into it with Create site open.
    expect(orgCreateBodies()).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
    // Not claimed either: kept for the case the invitation is withdrawn.
    expect(mockStoredUserDoc['pendingSignUpWorkspace']).toEqual(
      expect.objectContaining({ name: 'Pat Lee Designs' }),
    )
  })

  it('creates none in the gap after the automatic join accepted it', async () => {
    // Accepted: the invitation has left the pending list, and the membership
    // has not reached the workspace list yet.
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    mockInvites = []
    render(
      <InviteAutoAcceptContext.Provider value={autoJoin({ joining: true })}>
        <OrgJump />
      </InviteAutoAcceptContext.Provider>,
    )
    await flush()
    expect(orgCreateBodies()).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('still gives a person with no invitation the workspace they named', async () => {
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    render(
      <InviteAutoAcceptContext.Provider value={autoJoin()}>
        <OrgJump />
      </InviteAutoAcceptContext.Provider>,
    )
    await flush()
    expect(orgCreateBodies()).toEqual([{ name: 'Pat Lee Designs' }])
    expect(mockNavigate).toHaveBeenCalledWith('/pat-lee-designs/hosts')
  })

  it('joins and opens the invited workspace, with nothing created, end to end', async () => {
    mockStoredUserDoc = { pendingSignUpWorkspace: held() }
    mockInvites = [ACME]
    render(
      <InviteAutoAcceptProvider>
        <OrgJump />
      </InviteAutoAcceptProvider>,
    )
    await flush()
    await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(1))
    expect(mockRespond).toHaveBeenCalledWith(ACME, 'accept', {
      navigate: true,
      quiet: true,
    })
    expect(orgCreateBodies()).toEqual([])
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe('AGL-4047 · of several invitations, the newest is opened', () => {
  const navigated = () =>
    mockRespond.mock.calls
      .filter(([, , options]) => options?.navigate)
      .map(([invite]) => invite.$id)

  it('opens only the newest from the console home', async () => {
    // Listed oldest first, as an older answer could come back.
    mockInvites = [ACME, OTHER]
    render(<InviteAutoAcceptProvider>{null}</InviteAutoAcceptProvider>)
    await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(2))

    // Red before the fix: both joins navigated, and whichever answered last
    // decided where the person landed.
    expect(navigated()).toEqual(['inv-other'])
  })

  it('still opens the invitation whose workspace page the person is on', async () => {
    mockPathname = '/acme-builders/hosts'
    mockInvites = [ACME, OTHER]
    render(<InviteAutoAcceptProvider>{null}</InviteAutoAcceptProvider>)
    await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(2))
    expect(navigated()).toEqual(['inv-acme'])
  })

  it('says a join is under way until it fails', async () => {
    mockInvites = [ACME]
    let state: InviteAutoAcceptState | null = null
    function Probe() {
      state = React.useContext(InviteAutoAcceptContext)
      return null
    }
    mockRespond.mockResolvedValue(false)
    render(
      <InviteAutoAcceptProvider>
        <Probe />
      </InviteAutoAcceptProvider>,
    )
    await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(1))
    await flush()
    // A refused join leaves the account free to be provisioned later.
    expect(state!.joining).toBe(false)
  })
})

describe('AGL-4047 · invitation order', () => {
  it('sorts newest first and keeps undated ones last, in their order', () => {
    const undatedA = { $id: 'a' }
    const undatedB = { $id: 'b', createdAtMs: null }
    expect(
      newestInvitesFirst([undatedA, ACME, undatedB, OTHER]).map((i) => i.$id),
    ).toEqual(['inv-other', 'inv-acme', 'a', 'b'])
    expect(latestInvite([ACME, OTHER])?.$id).toBe('inv-other')
    expect(latestInvite([])).toBeNull()
  })

  it('reads a Firestore timestamp, and nothing else, as the sent time', () => {
    expect(inviteSentAtMs({ toMillis: () => 1234 })).toBe(1234)
    expect(inviteSentAtMs(null)).toBeNull()
    expect(inviteSentAtMs('NOW')).toBeNull()
  })
})
