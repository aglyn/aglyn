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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { useInviteReview } from '../hooks/use-pending-invites'
import OrgInvitesBanner from './org-invites-banner.component'
import PendingInvitesProvider from './pending-invites-provider.component'

/**
 * Invitations take effect on their own (AGL-4023): nobody is shown a banner
 * or asked to accept, and a join the workspace refuses is not shown to the
 * invitee at all (its sender is told).
 *
 * The banner and its accept/decline dialog (AGL-3402) remain only for a
 * staff impersonation session, which never joins on the account holder's
 * behalf: there the shell copy steps aside for a page that renders the
 * invitation itself, Decline asks before answering, and a notification that
 * outlived its invitation says so rather than offering a choice.
 */

let mockClaims: Record<string, unknown> = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({
    data: {
      uid: 'user-ada',
      getIdTokenResult: () => Promise.resolve({ claims: mockClaims }),
    },
  }),
}))

const mockSelectOrg = jest.fn()
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ selectOrg: mockSelectOrg }),
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/',
}))

const mockSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))

const INVITE = {
  $id: 'invite-1',
  orgId: 'org-acme',
  orgName: 'Acme Builders',
  orgSlug: 'acme-builders',
  role: 'admin',
}
let mockPending: Array<typeof INVITE>
let mockRefuse = false
const mockPost = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      mockPost(body)
      if (mockRefuse) {
        return {
          ok: false,
          json: async () => ({
            error: 'Your access is still being set up.',
            blocked: true,
          }),
        }
      }
      mockPending = mockPending.filter((invite) => invite.$id !== body.inviteId)
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => ({ invites: mockPending }) }
  },
}))

function OpenReview({ inviteId }: { inviteId: string }) {
  const { review } = useInviteReview()
  useEffect(() => {
    review({ orgId: 'org-acme', inviteId })
  }, [review, inviteId])
  return null
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPending = [INVITE]
  mockRefuse = false
  mockClaims = {}
})

describe('an ordinary session (AGL-4023)', () => {
  it('joins the invitation with no click and no banner, and opens the workspace', async () => {
    render(
      <PendingInvitesProvider>
        <OrgInvitesBanner placement="shell" />
      </PendingInvitesProvider>,
    )
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'accept', inviteId: 'invite-1' }),
      ),
    )
    // From the console home, the joined workspace opens.
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/acme-builders'))
    expect(mockSelectOrg).toHaveBeenCalledWith('org-acme')
    expect(screen.queryByText(/You've been invited/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })

  it('shows the invitee nothing when the workspace refuses the join', async () => {
    mockRefuse = true
    render(
      <PendingInvitesProvider>
        <OrgInvitesBanner placement="shell" />
      </PendingInvitesProvider>,
    )
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockSnackbar).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.queryByText(/You've been invited/)).toBeNull()
  })
})

describe('a staff impersonation session, which never joins on its own', () => {
  beforeEach(() => {
    mockClaims = { impersonatedBy: 'staff-uid' }
  })

  it('shows the invitation in the shell banner', async () => {
    render(
      <PendingInvitesProvider>
        <OrgInvitesBanner placement="shell" />
      </PendingInvitesProvider>,
    )
    expect(
      await screen.findByText("You've been invited to Acme Builders as admin."),
    ).toBeTruthy()
  })

  it('steps the shell banner aside while a page renders the invitation inline', async () => {
    render(
      <PendingInvitesProvider>
        <OrgInvitesBanner placement="shell" />
        <OrgInvitesBanner placement="inline" />
      </PendingInvitesProvider>,
    )
    await screen.findByText("You've been invited to Acme Builders as admin.")
    expect(
      screen.getAllByText("You've been invited to Acme Builders as admin."),
    ).toHaveLength(1)
  })

  it('accepts, then opens the joined workspace', async () => {
    render(
      <PendingInvitesProvider>
        <OrgInvitesBanner placement="shell" />
      </PendingInvitesProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }))
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'accept', inviteId: 'invite-1' }),
      ),
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/acme-builders'))
    expect(mockSelectOrg).toHaveBeenCalledWith('org-acme')
    await waitFor(() =>
      expect(screen.queryByText(/You've been invited/)).toBeNull(),
    )
  })

  it('asks before declining, and declines only on confirmation', async () => {
    render(
      <PendingInvitesProvider>
        <OrgInvitesBanner placement="shell" />
      </PendingInvitesProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }))
    expect(
      await screen.findByText('Decline the invitation to Acme Builders?'),
    ).toBeTruthy()
    expect(mockPost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Decline invitation' }))
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'decline', inviteId: 'invite-1' }),
      ),
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('opens accept/decline for a reviewed invitation (the notification path)', async () => {
    render(
      <PendingInvitesProvider>
        <OpenReview inviteId="invite-1" />
      </PendingInvitesProvider>,
    )
    expect(await screen.findByText('Join Acme Builders?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
  })

  it('says so when the invitation is no longer pending', async () => {
    render(
      <PendingInvitesProvider>
        <OpenReview inviteId="invite-withdrawn" />
      </PendingInvitesProvider>,
    )
    expect(await screen.findByText('Invitation no longer pending')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})
