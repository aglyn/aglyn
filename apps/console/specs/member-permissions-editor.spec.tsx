/**
 * @jest-environment jsdom
 *
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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockFetch(...args),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
// One user object for the whole run, as the real hook holds one per session.
const mockUser = { data: { uid: 'admin-1', getIdToken: async () => 'token' } }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => mockUser,
}))
const mockScope = { currentOrg: { $id: 'org-1', role: 'admin', enabledPlugins: ['commerce', 'ai'] }, orgSlug: 'acme' }
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => mockScope,
  useOrgScope: () => mockScope,
  useOrgSlug: () => 'acme',
}))
const mockFlags = { ready: true, isStaff: false, flags: {} }
jest.mock('../hooks/use-release-flags', () => ({ useReleaseFlags: () => mockFlags }))

import { MemberPermissionsEditor } from '../components/member-permissions-editor.component'
import { SitePermissionsDialog } from '../components/site-permissions-dialog.component'

/** The member Permissions card and the per-site dialog (AGL-4047). */

beforeAll(async () => {
  await registerPluginDeclarations()
})

beforeEach(() => {
  mockFetch.mockReset()
})

function lastBody(): Record<string, unknown> {
  const call = [...mockFetch.mock.calls].reverse().find(([, , init]) => init?.method && init.method !== 'GET')
  return JSON.parse(call?.[2]?.body ?? '{}')
}

describe('the member Permissions card (AGL-4047)', () => {
  const member = {
    $id: 'm1',
    role: 'editor' as const,
    allHosts: true,
    roleId: 'cashier',
    permissions: { 'hosts.create': true },
    displayName: 'Pat Lee',
  }
  const roles = [{ $id: 'cashier', name: 'Cashier', permissions: { managePos: false } }]

  it('says where each verdict comes from and saves only what changed', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    const onSaved = jest.fn()
    render(<MemberPermissionsEditor layout="card" member={member} roles={roles} canManage onSaved={onSaved} />)
    expect(screen.getByText('Allowed · set for this member')).toBeTruthy()
    expect(screen.getByText('Not allowed · from the "Cashier" role')).toBeTruthy()
    expect(screen.getAllByText('Allowed · from the Editor role').length).toBeGreaterThan(0)
    fireEvent.click(within(screen.getByRole('group', { name: 'Create sites' })).getByRole('button', { name: 'Inherit' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Use the point of sale' })).getByRole('button', { name: 'Allow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(lastBody()).toEqual({
      orgId: 'org-1',
      action: 'permissions',
      uid: 'm1',
      permissions: { 'hosts.create': null, managePos: true },
    })
  })

  it('locks the owner’s row and offers no save', () => {
    render(<MemberPermissionsEditor layout="card" member={{ $id: 'o1', role: 'owner', allHosts: true }} roles={[]} canManage />)
    const deny = within(screen.getByRole('group', { name: 'Create sites' })).getByRole('button', { name: 'Deny' })
    expect((deny as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save permissions' })).toBeNull()
  })

  it('sends a site collaborator to their sites', () => {
    render(
      <MemberPermissionsEditor
        layout="card"
        member={{ $id: 'c1', role: 'editor', allHosts: false, hostAccess: { h1: 'editor' } }}
        roles={[]}
        canManage
      />,
    )
    expect(screen.getByText(/works on named sites/)).toBeTruthy()
  })
})

describe('the per-site Permissions dialog (AGL-4047)', () => {
  it('draws the site keys with the site access default and saves the change', async () => {
    mockFetch.mockImplementation(async (_user: unknown, _url: string, init?: { method?: string }) => ({
      ok: true,
      json: async () =>
        init?.method === 'PATCH'
          ? { ok: true }
          : {
              orgWide: false,
              role: 'author',
              keys: ['ai.use', 'ai.generate'],
              stored: { 'ai.generate': false },
              defaults: { 'ai.use': true, 'ai.generate': true },
              effective: { 'ai.use': true, 'ai.generate': false },
            },
    }))
    const onClose = jest.fn()
    render(
      <SitePermissionsDialog hostId="h1" member={{ $id: 'row-1', email: 'pat@example.com' }} canManage onClose={onClose} />,
    )
    const generate = await screen.findByRole('group', { name: 'Generate with AI' })
    expect(within(generate).getByRole('button', { name: 'Deny' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByText('Inherit: allowed for Author site access').length).toBeGreaterThan(0)
    fireEvent.click(within(generate).getByRole('button', { name: 'Inherit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(lastBody()).toEqual({ hostId: 'h1', memberId: 'row-1', permissions: { 'ai.generate': null } })
  })
})
