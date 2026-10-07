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

import { mockWindow, PHONE, TABLET } from '../spec-native-mocks'

const mockAccess = { role: 'owner' as string | null }
const mockWorkspace = {
  sites: [
    { id: 'site-1', name: 'Demo Site' },
    { id: 'site-2', name: 'Bloom Bakery' },
  ],
}

jest.mock('@aglyn/mobile-core', () => ({
  mobileBrandName: () => 'Aglyn',
  useOrgAccess: () => ({ loaded: true, role: mockAccess.role, orgWide: true, tokens: ['org'], member: null, hostAccess: {} }),
  useWorkspace: () => mockWorkspace,
}))

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { captureAlerts, fakeContext, type FakeContext } from '../spec-support'
import MemberScreen from './member-screen'
import { addOrInvite, type OrgInvite, type OrgMember } from './team-api'
import TeamScreen from './team-screen'

const OWNER: OrgMember = { $id: 'owner-uid', role: 'owner', allHosts: true, email: 'owner@example.test', displayName: 'Mobile Owner' }
const EDITOR: OrgMember = {
  $id: 'u-ed',
  role: 'editor',
  allHosts: false,
  hostAccess: { 'site-1': 'editor' },
  email: 'riley@example.test',
  displayName: 'Riley Chen',
}
const INVITE: OrgInvite = { $id: 'inv-1', email: 'sam@example.test', role: 'viewer', allHosts: false, hostAccess: { 'site-2': 'viewer' } }

const refusal = (message: string, status: number) => Object.assign(new Error(message), { status })

/** A fake console: the roster and invites routes, recording every write. */
function consoleApi(context: FakeContext, overrides: Record<string, (body: any) => unknown> = {}) {
  context.api.request.mockImplementation(async (path: string, init: { method?: string; body?: any } = {}) => {
    const key = `${init.method ?? 'GET'} ${path}${init.body?.action ? ` ${init.body.action}` : ''}`
    if (overrides[key]) return overrides[key](init.body)
    if (key === 'GET /api/orgs/members') return { members: [OWNER, EDITOR] }
    if (key === 'GET /api/orgs/invites') return { invites: [INVITE] }
    return { ok: true }
  })
  return context
}

const writes = (context: FakeContext) =>
  context.api.request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([path, init]) => [path, init.body])

beforeEach(() => {
  jest.clearAllMocks()
  mockWindow.size = PHONE
  mockAccess.role = 'owner'
})

afterEach(() => jest.restoreAllMocks())

describe('adding someone', () => {
  it('adds an existing account with one upsert', async () => {
    const api = { request: jest.fn(async () => ({})) }
    await expect(addOrInvite(api as never, 'org-1', { email: ' Riley@Example.test ', role: 'editor', allHosts: true, hostAccess: {} })).resolves.toEqual({
      kind: 'added',
    })
    expect(api.request).toHaveBeenCalledWith('/api/orgs/members', {
      method: 'POST',
      body: { orgId: 'org-1', action: 'upsert', email: 'riley@example.test', role: 'editor', allHosts: true },
    })
  })

  it("invites a new address after the upsert's 404, with the sites it names", async () => {
    const api = {
      request: jest.fn(async (path: string) => {
        if (path === '/api/orgs/members') throw refusal('No account with that identity — send an invite instead', 404)
        return { emailed: true }
      }),
    }
    await expect(
      addOrInvite(api as never, 'org-1', { email: 'sam@example.test', role: 'viewer', allHosts: false, hostAccess: { 'site-2': 'viewer' } }),
    ).resolves.toEqual({ kind: 'invited', emailed: true })
    expect(api.request).toHaveBeenLastCalledWith('/api/orgs/invites', {
      method: 'POST',
      body: {
        orgId: 'org-1',
        action: 'create',
        email: 'sam@example.test',
        role: 'viewer',
        allHosts: false,
        hostAccess: { 'site-2': 'viewer' },
      },
    })
  })

  it('stops at any other refusal, and never invites', async () => {
    const api = {
      request: jest.fn(async () => {
        throw refusal('Your plan has no manager seats left', 403)
      }),
    }
    await expect(addOrInvite(api as never, 'org-1', { email: 'a@b.co', role: 'admin', allHosts: false, hostAccess: {} })).rejects.toThrow(
      'no manager seats',
    )
    expect(api.request).toHaveBeenCalledTimes(1)
  })
})

describe('TeamScreen', () => {
  it('shows the roster and, to an owner, the pending invites', async () => {
    const context = consoleApi(fakeContext())
    await render(<TeamScreen params={{}} context={context} />)
    await waitFor(() => expect(screen.getByText('Riley Chen')).toBeTruthy())
    expect(screen.getByText('Editor · 1 site · Site collaborator')).toBeTruthy()
    expect(screen.getByText('sam@example.test')).toBeTruthy()
    expect(context.api.request).toHaveBeenCalledWith('/api/orgs/members', { method: 'GET', query: { orgId: 'org-1' } })
    expect(context.api.request).toHaveBeenCalledWith('/api/orgs/invites', { method: 'GET', query: { orgId: 'org-1' } })
    expect(screen.getByTestId('team-invite')).toBeTruthy()
  })

  it('shows a viewer the roster only: no invites read, nothing to change', async () => {
    mockAccess.role = 'viewer'
    const context = consoleApi(fakeContext())
    await render(<TeamScreen params={{}} context={context} />)
    await waitFor(() => expect(screen.getByText('Riley Chen')).toBeTruthy())
    expect(screen.queryByTestId('team-invite')).toBeNull()
    expect(screen.queryByText('sam@example.test')).toBeNull()
    expect(context.api.request).not.toHaveBeenCalledWith('/api/orgs/invites', expect.anything())
  })

  it('says when the team could not be loaded', async () => {
    const context = consoleApi(fakeContext(), {
      'GET /api/orgs/members': () => {
        throw refusal('You are not a member of that organization', 403)
      },
    })
    await render(<TeamScreen params={{}} context={context} />)
    await waitFor(() => expect(screen.getByText('The team could not be loaded')).toBeTruthy())
    expect(screen.getByText('You are not a member of that organization')).toBeTruthy()
  })

  it('revokes an invite only after asking', async () => {
    const alerts = captureAlerts()
    const context = consoleApi(fakeContext())
    await render(<TeamScreen params={{}} context={context} />)
    await waitFor(() => expect(screen.getByTestId('invite-revoke-inv-1')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('invite-revoke-inv-1'))
    expect(alerts.last().title).toBe('Revoke this invite?')
    expect(writes(context)).toEqual([])
    alerts.press('Revoke')
    await waitFor(() =>
      expect(writes(context)).toEqual([['/api/orgs/invites', { orgId: 'org-1', action: 'revoke', inviteId: 'inv-1' }]]),
    )
  })

  it('resends an invite after asking, and shows a refusal', async () => {
    const alerts = captureAlerts()
    const context = consoleApi(fakeContext(), {
      'POST /api/orgs/invites resend': () => {
        throw refusal('Invite already accepted', 409)
      },
    })
    await render(<TeamScreen params={{}} context={context} />)
    await waitFor(() => expect(screen.getByTestId('invite-resend-inv-1')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('invite-resend-inv-1'))
    alerts.press('Resend')
    await waitFor(() => expect(alerts.last().message).toBe('Invite already accepted'))
    expect(writes(context)).toEqual([['/api/orgs/invites', { orgId: 'org-1', action: 'resend', inviteId: 'inv-1' }]])
  })

  it('invites by email with a role and named sites, asking first', async () => {
    const alerts = captureAlerts()
    const context = consoleApi(fakeContext(), {
      'POST /api/orgs/members upsert': () => {
        throw refusal('No account with that identity — send an invite instead', 404)
      },
      'POST /api/orgs/invites create': () => ({ emailed: true }),
    })
    await render(<TeamScreen params={{}} context={context} />)
    await waitFor(() => expect(screen.getByTestId('team-invite')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('team-invite'))
    await fireEvent.changeText(screen.getByTestId('invite-email'), 'new@example.test')
    await fireEvent.press(screen.getByTestId('invite-role-viewer'))
    await fireEvent.press(screen.getByTestId('access-all-sites'))
    await fireEvent.press(screen.getByTestId('access-site-2-author'))
    await fireEvent.press(screen.getByTestId('invite-submit'))
    expect(alerts.last().title).toBe('Add new@example.test?')
    expect(writes(context)).toEqual([])
    alerts.press('Add or invite')
    await waitFor(() => expect(alerts.last().title).toBe('Invited new@example.test'))
    expect(writes(context)).toEqual([
      ['/api/orgs/members', { orgId: 'org-1', action: 'upsert', email: 'new@example.test', role: 'viewer', allHosts: false, hostAccess: { 'site-2': 'author' } }],
      ['/api/orgs/invites', { orgId: 'org-1', action: 'create', email: 'new@example.test', role: 'viewer', allHosts: false, hostAccess: { 'site-2': 'author' } }],
    ])
  })

  it('pushes a member on a phone and shows them beside the roster on a tablet', async () => {
    const phone = consoleApi(fakeContext())
    const first = await render(<TeamScreen params={{}} context={phone} />)
    await waitFor(() => expect(screen.getByTestId('member-u-ed')).toBeTruthy())
    await fireEvent.press(screen.getByTestId('member-u-ed'))
    expect(phone.navigate).toHaveBeenCalledWith('workspace.member', { uid: 'u-ed' })
    await first.unmount()

    mockWindow.size = TABLET
    const tablet = consoleApi(fakeContext())
    await render(<TeamScreen params={{}} context={tablet} />)
    await waitFor(() => expect(screen.getByTestId('member-u-ed')).toBeTruthy())
    expect(screen.getByTestId('split-view')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('member-u-ed'))
    expect(tablet.navigate).not.toHaveBeenCalled()
    expect(screen.getByTestId('member-remove')).toBeTruthy()
  })
})

describe('a member', () => {
  const openMember = async (uid: string, context: FakeContext) => {
    await render(<MemberScreen params={{ uid }} context={context} />)
    await waitFor(() => expect(screen.queryByTestId('member-loading')).toBeNull())
  }

  it("offers nothing to change on the owner's row", async () => {
    const context = consoleApi(fakeContext())
    await openMember('owner-uid', context)
    expect(screen.getByText('Mobile Owner')).toBeTruthy()
    expect(screen.queryByTestId('member-role-picker')).toBeNull()
    expect(screen.queryByTestId('member-remove')).toBeNull()
  })

  it('offers nothing to change to a reader who does not manage the team', async () => {
    mockAccess.role = 'editor'
    const context = consoleApi(fakeContext())
    await openMember('u-ed', context)
    expect(screen.getByText('Riley Chen')).toBeTruthy()
    expect(screen.queryByTestId('member-role-picker')).toBeNull()
    expect(screen.queryByTestId('member-edit-access')).toBeNull()
  })

  it('changes a role after asking, keeping the reach as it stands', async () => {
    const alerts = captureAlerts()
    const context = consoleApi(fakeContext())
    await openMember('u-ed', context)
    await fireEvent.press(screen.getByTestId('member-role-picker-viewer'))
    expect(alerts.last().title).toBe('Make Riley Chen a viewer?')
    alerts.press('Change role')
    await waitFor(() =>
      expect(writes(context)).toEqual([
        [
          '/api/orgs/members',
          { orgId: 'org-1', action: 'upsert', uid: 'u-ed', role: 'viewer', allHosts: false, hostAccess: { 'site-1': 'editor' } },
        ],
      ]),
    )
  })

  it('saves site access after asking', async () => {
    const alerts = captureAlerts()
    const context = consoleApi(fakeContext())
    await openMember('u-ed', context)
    await fireEvent.press(screen.getByTestId('member-edit-access'))
    await fireEvent.press(screen.getByTestId('access-site-2-viewer'))
    await fireEvent.press(screen.getByTestId('member-save-access'))
    alerts.press('Save access')
    await waitFor(() =>
      expect(writes(context)).toEqual([
        [
          '/api/orgs/members',
          {
            orgId: 'org-1',
            action: 'upsert',
            uid: 'u-ed',
            role: 'editor',
            allHosts: false,
            hostAccess: { 'site-1': 'editor', 'site-2': 'viewer' },
          },
        ],
      ]),
    )
  })

  it("removes a member after the console's question, and shows a refusal", async () => {
    const alerts = captureAlerts()
    const context = consoleApi(fakeContext(), {
      'POST /api/orgs/members remove': () => {
        throw refusal('Managing members requires the members.manage permission', 403)
      },
    })
    await openMember('u-ed', context)
    await fireEvent.press(screen.getByTestId('member-remove'))
    expect(alerts.last()).toEqual(
      expect.objectContaining({
        title: 'Remove member?',
        message: 'riley@example.test loses access to every site in this organization.',
      }),
    )
    alerts.press('Cancel')
    expect(writes(context)).toEqual([])
    await fireEvent.press(screen.getByTestId('member-remove'))
    alerts.press('Remove')
    await waitFor(() => expect(alerts.last().message).toBe('Managing members requires the members.manage permission'))
    expect(writes(context)).toEqual([['/api/orgs/members', { orgId: 'org-1', action: 'remove', uid: 'u-ed' }]])
  })

  it("hands the console's Roles and Activity tabs back to the console", async () => {
    const context = consoleApi(fakeContext())
    await render(<MemberScreen params={{ uid: 'roles' }} context={context} />)
    expect(context.openConsolePath).toHaveBeenCalledWith('/team/roles', 'org')
    expect(context.api.request).not.toHaveBeenCalled()
  })
})
