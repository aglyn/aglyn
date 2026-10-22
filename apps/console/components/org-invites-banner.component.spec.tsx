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
 * The invitation banner and its accept/decline dialog (AGL-3402): the shell
 * copy shows on any page and steps aside for a page that renders the
 * invitation itself, Decline asks before answering, and a notification that
 * outlived its invitation says so rather than offering a choice.
 */

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'user-ada' } }),
}))

const mockSelectOrg = jest.fn()
jest.mock('../hooks/use-org-scope', () => ({
  useOrgScope: () => ({ selectOrg: mockSelectOrg }),
}))

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockSnackbar }),
}))

const INVITE = {
  $id: 'invite-1',
  orgId: 'org-rtr',
  orgName: 'Ready To Roll',
  orgSlug: 'ready-to-roll',
  role: 'admin',
}
let mockPending: Array<typeof INVITE>
const mockPost = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      mockPost(body)
      mockPending = mockPending.filter((invite) => invite.$id !== body.inviteId)
      return { ok: true, json: async () => ({ ok: true }) }
    }
    return { ok: true, json: async () => ({ invites: mockPending }) }
  },
}))

function OpenReview({ inviteId }: { inviteId: string }) {
  const { review } = useInviteReview()
  useEffect(() => {
    review({ orgId: 'org-rtr', inviteId })
  }, [review, inviteId])
  return null
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPending = [INVITE]
})

it('shows the invitation in the shell banner', async () => {
  render(
    <PendingInvitesProvider>
      <OrgInvitesBanner placement="shell" />
    </PendingInvitesProvider>,
  )
  expect(
    await screen.findByText("You've been invited to Ready To Roll as admin."),
  ).toBeTruthy()
})

it('steps the shell banner aside while a page renders the invitation inline', async () => {
  render(
    <PendingInvitesProvider>
      <OrgInvitesBanner placement="shell" />
      <OrgInvitesBanner placement="inline" />
    </PendingInvitesProvider>,
  )
  await screen.findByText("You've been invited to Ready To Roll as admin.")
  expect(
    screen.getAllByText("You've been invited to Ready To Roll as admin."),
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
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/ready-to-roll'))
  expect(mockSelectOrg).toHaveBeenCalledWith('org-rtr')
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
    await screen.findByText('Decline the invitation to Ready To Roll?'),
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
  expect(await screen.findByText('Join Ready To Roll?')).toBeTruthy()
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
