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
 * "Wait for confirmation across a consent group" (AGL-3316): one switch on the
 * organization's Topics page, off unless somebody turns it on, read from the
 * org document the shell keeps live and written only through
 * `/api/orgs/settings` — never Firestore, which denies the field to every
 * client. It moves only for a member holding both permissions that action
 * asks for, and says which one is missing to anybody else.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import ConsentGroupConfirmationCard from './consent-group-confirmation-card'
import { EmailOrgMountProvider } from './email-org-mount'

/** Documents the member may read, by path; absent paths do not exist. */
let mockDocs: Record<string, Record<string, unknown>> = {}
/** Paths whose read has not answered yet. */
let mockPending = new Set<string>()

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-1' } }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  /*
   * The real hook's contract, as far as the card depends on it: a reference
   * that is never built stays `loading`, and one that is built answers the
   * document or its absence.
   */
  useFirestoreDoc: (buildRef: () => { path: string } | null) => {
    const ref = buildRef()
    if (!ref || mockPending.has(ref.path)) return { data: undefined, status: 'loading' }
    return { data: mockDocs[ref.path], status: 'success' }
  },
}))

const mockAuthorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, header }: { children: ReactNode; header: ReactNode }) => (
    <section aria-label={String(header)}>{children}</section>
  ),
}))

const LABEL = 'Wait for confirmation across a consent group'
const MEMBER = 'orgs/org-1/members/uid-1'
const DECLARED = {
  consentGroups: { acme: { name: 'Acme', hostIds: ['site-a', 'site-b'] } },
}

function renderCard(org: Record<string, unknown> | null) {
  return render(
    <EmailOrgMountProvider
      mount={{
        orgId: 'org-1',
        orgSlug: 'acme',
        hosts: [],
        hostsReady: true,
        hostsPath: '/acme/hosts',
      }}
      basePath="/acme/emails"
    >
      <ConsentGroupConfirmationCard org={org} />
    </EmailOrgMountProvider>,
  )
}

const theSwitch = () => screen.getByLabelText(LABEL) as HTMLInputElement

beforeEach(() => {
  jest.clearAllMocks()
  mockDocs = { [MEMBER]: { role: 'owner', allHosts: true } }
  mockPending = new Set()
  mockAuthorizedFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, awaitConfirmation: true }),
  })
})

describe('what the switch shows', () => {
  it('is off for an org that never set it, and says so plainly', () => {
    renderCard(DECLARED)
    expect(theSwitch().checked).toBe(false)
    expect(screen.getByText(/the group’s other sites wait for the click too/)).toBeTruthy()
    expect(screen.getByText(/only to sites your organization has declared one sender/)).toBeTruthy()
    expect(screen.getByText(/off unless you turn it on/)).toBeTruthy()
  })

  it('reads the org document, and follows it when the listener delivers a change', () => {
    const { rerender } = renderCard(DECLARED)
    expect(theSwitch().checked).toBe(false)
    rerender(
      <EmailOrgMountProvider
        mount={{ orgId: 'org-1', orgSlug: 'acme', hosts: [], hostsReady: true, hostsPath: '/acme/hosts' }}
        basePath="/acme/emails"
      >
        <ConsentGroupConfirmationCard
          org={{ ...DECLARED, consentGroupsAwaitConfirmation: true }}
        />
      </EmailOrgMountProvider>,
    )
    expect(theSwitch().checked).toBe(true)
  })

  it('reads only a stored `true` as on', () => {
    renderCard({ ...DECLARED, consentGroupsAwaitConfirmation: 'true' })
    expect(theSwitch().checked).toBe(false)
  })

  it('says it changes nothing while the org has declared no consent group', () => {
    renderCard({})
    expect(screen.getByText(/has not declared a consent group/)).toBeTruthy()
  })

  it('CONTROL: says nothing of the kind once a group is declared', () => {
    renderCard(DECLARED)
    expect(screen.queryByText(/has not declared a consent group/)).toBeNull()
  })
})

describe('saving', () => {
  it('posts the action to the org settings route, and never writes Firestore', async () => {
    renderCard(DECLARED)
    fireEvent.click(theSwitch())
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1))
    const [user, url, init] = mockAuthorizedFetch.mock.calls[0]
    expect(user).toEqual({ uid: 'uid-1' })
    expect(url).toBe('/api/orgs/settings')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({
      orgId: 'org-1',
      action: 'set-consent-group-confirmation',
      awaitConfirmation: true,
    })
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/now wait for the confirmation click/),
        expect.objectContaining({ variant: 'success' }),
      ),
    )
  })

  it('turns it off the same way', async () => {
    renderCard({ ...DECLARED, consentGroupsAwaitConfirmation: true })
    fireEvent.click(theSwitch())
    await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(mockAuthorizedFetch.mock.calls[0][2].body)).toMatchObject({
      awaitConfirmation: false,
    })
  })

  it('snaps back and shows the route’s reason when the route refuses', async () => {
    mockAuthorizedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'data.manage required' }),
    })
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    renderCard(DECLARED)
    fireEvent.click(theSwitch())
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'data.manage required',
        expect.objectContaining({ variant: 'error' }),
      ),
    )
    expect(theSwitch().checked).toBe(false)
  })
})

describe('who may move it', () => {
  it('is disabled, with the missing permission named, for an editor', () => {
    mockDocs[MEMBER] = { role: 'editor', allHosts: true }
    renderCard(DECLARED)
    expect(theSwitch().disabled).toBe(true)
    expect(
      screen.getByText('You need the Organization settings permission to change this.'),
    ).toBeTruthy()
    fireEvent.click(theSwitch())
    expect(mockAuthorizedFetch).not.toHaveBeenCalled()
  })

  it('names the Emails console’s own permission when that is the one an override took', () => {
    mockDocs[MEMBER] = {
      role: 'admin',
      allHosts: true,
      permissions: { 'data.manage': false },
    }
    renderCard(DECLARED)
    expect(theSwitch().disabled).toBe(true)
    expect(screen.getByText('You need the Manage data permission to change this.')).toBeTruthy()
  })

  it('reads a custom role, so a role that grants both moves it', () => {
    mockDocs[MEMBER] = { role: 'editor', allHosts: true, roleId: 'role-ops' }
    mockDocs['orgs/org-1/roles/role-ops'] = {
      name: 'Ops',
      permissions: { 'org.settings': true, 'data.manage': true },
    }
    renderCard(DECLARED)
    expect(theSwitch().disabled).toBe(false)
    expect(screen.queryByText(/You need the/)).toBeNull()
  })

  it('holds, without a reason, until the membership read answers', () => {
    mockPending.add(MEMBER)
    renderCard(DECLARED)
    expect(theSwitch().disabled).toBe(true)
    expect(screen.queryByText(/You need the/)).toBeNull()
  })

  it('treats a membership it cannot find as no permission — the route decides either way', () => {
    delete mockDocs[MEMBER]
    renderCard(DECLARED)
    expect(theSwitch().disabled).toBe(true)
    expect(screen.getByText(/You need the Organization settings permission/)).toBeTruthy()
  })

  it('admits an admin as it admits an owner', () => {
    mockDocs[MEMBER] = { role: 'admin', allHosts: true }
    renderCard(DECLARED)
    expect(theSwitch().disabled).toBe(false)
  })
})
