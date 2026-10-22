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
 * AGL-4023 — an invitation takes effect on its own. A person who signs up
 * with the address they were invited by joins the workspace (or takes it
 * over, for a hand-off) the moment they are in the console, through the same
 * accept request the banner sends, so the server keeps every check it makes.
 * Nobody presses Accept, and the email's link does not end on a 404.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import { useContext } from 'react'
import InviteAutoAcceptProvider from '../components/invite-auto-accept-provider.component'
import {
  InviteAutoAcceptContext,
  autoJoinOpensWorkspace,
} from '../hooks/use-invite-auto-accept'
import type { PendingInvite } from '../hooks/use-pending-invites'

let mockClaims: Record<string, unknown> = {}
let mockPathname = '/acme-builders/billing'
let mockInvites: PendingInvite[] = []
const mockRespond = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({
    data: {
      uid: 'u-new-owner',
      getIdTokenResult: () => Promise.resolve({ claims: mockClaims }),
    },
  }),
}))
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))
jest.mock('../hooks/use-pending-invites', () => ({
  usePendingInvites: () => ({ invites: mockInvites, loading: false, refresh: jest.fn() }),
}))
jest.mock('../hooks/use-invite-response', () => ({
  useInviteResponse: () => ({ respond: mockRespond, busyId: null }),
}))

const HANDOFF: PendingInvite = {
  $id: 'inv-handoff',
  orgId: 'org-edr',
  orgName: 'Acme Builders',
  orgSlug: 'acme-builders',
  role: 'owner',
  handoff: { previousOwner: 'stay' },
}
const SITE_EDITOR: PendingInvite = {
  $id: 'inv-editor',
  orgId: 'org-other',
  orgName: 'Other Co',
  orgSlug: 'other-co',
  role: 'editor',
}

function Status({ inviteId }: { inviteId: string }) {
  const { enabled, statusOf, joinedSlugs } = useContext(InviteAutoAcceptContext)
  return (
    <span data-testid={inviteId}>
      {`${String(enabled)}|${statusOf(inviteId) ?? 'none'}|${[...joinedSlugs].join(',')}`}
    </span>
  )
}

beforeEach(() => {
  mockClaims = {}
  mockPathname = '/acme-builders/billing'
  mockInvites = []
  mockRespond.mockReset()
  mockRespond.mockResolvedValue(true)
})

describe('an invitation is joined without pressing Accept', () => {
  it('accepts each pending invitation once, through the banner’s own request', async () => {
    mockInvites = [HANDOFF, SITE_EDITOR]
    const { rerender } = render(
      <InviteAutoAcceptProvider>
        <Status inviteId="inv-handoff" />
      </InviteAutoAcceptProvider>,
    )
    await waitFor(() => expect(mockRespond).toHaveBeenCalledTimes(2))
    expect(mockRespond).toHaveBeenCalledWith(HANDOFF, 'accept', { navigate: true, quiet: true })
    // Working on Acme Builders' page: Other Co is joined without leaving it.
    expect(mockRespond).toHaveBeenCalledWith(SITE_EDITOR, 'accept', { navigate: false, quiet: true })
    await waitFor(() =>
      expect(screen.getByTestId('inv-handoff').textContent).toBe(
        'true|joined|acme-builders,other-co',
      ),
    )
    // A re-render with the same list asks nothing twice.
    rerender(
      <InviteAutoAcceptProvider>
        <Status inviteId="inv-handoff" />
      </InviteAutoAcceptProvider>,
    )
    await act(async () => undefined)
    expect(mockRespond).toHaveBeenCalledTimes(2)
  })

  it('leaves a refused invitation pending and quiet: its sender is told, not the invitee', async () => {
    mockInvites = [HANDOFF]
    mockRespond.mockResolvedValue(false)
    render(
      <InviteAutoAcceptProvider>
        <Status inviteId="inv-handoff" />
      </InviteAutoAcceptProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('inv-handoff').textContent).toBe('true|failed|'),
    )
  })

  it('never joins on the account holder’s behalf in a staff impersonation session', async () => {
    mockInvites = [HANDOFF]
    mockClaims = { impersonatedBy: 'staff-uid' }
    render(
      <InviteAutoAcceptProvider>
        <Status inviteId="inv-handoff" />
      </InviteAutoAcceptProvider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('inv-handoff').textContent).toBe('false|none|'),
    )
    expect(mockRespond).not.toHaveBeenCalled()
  })
})

describe('whether joining also opens the workspace', () => {
  it.each([
    ['/acme-builders/billing', 'acme-builders', true],
    ['/acme-builders', 'acme-builders', true],
    ['/', 'acme-builders', true],
    ['/acme/hosts', 'acme-builders', false],
    // A slug that merely starts the same is a different workspace.
    ['/acme-builders-2/billing', 'acme-builders', false],
    ['/acme', null, false],
  ])('on %s for %s → %s', (pathname, slug, expected) => {
    expect(autoJoinOpensWorkspace(pathname, slug)).toBe(expected)
  })
})
