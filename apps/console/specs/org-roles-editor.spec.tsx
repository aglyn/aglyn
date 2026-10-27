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
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: async () => undefined }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'token' } }),
}))
const mockOrg = { $id: 'org-1', role: 'owner', enabledPlugins: ['commerce', 'ai', 'waivers'] }
const mockScope = { currentOrg: mockOrg }
// The card gates on the key its route checks (AGL-4047), read through the
// permissions hook: this reader holds it, as the role above does.
jest.mock('../hooks/use-org-permissions', () => {
  const value = { loaded: true, can: () => true, permissions: {}, granted: {} }
  return { __esModule: true, default: () => value, useOrgPermissions: () => value }
})
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  default: () => mockScope,
  useOrgScope: () => mockScope,
}))
const mockFlags = { ready: true, isStaff: false, flags: {} }
jest.mock('../hooks/use-release-flags', () => ({
  useReleaseFlags: () => mockFlags,
}))

import { OrgRolesCard } from '../components/org-roles-card.component'

/**
 * The custom role editor (AGL-4047): every catalog key the workspace is
 * offered, core and plugin, grouped and searchable, in three states.
 */

const STORED_ROLE = {
  $id: 'cashier',
  name: 'Cashier',
  // `outreach.use` belongs to a plugin this workspace has switched off: not
  // offered, and kept as stored.
  permissions: { managePos: true, 'outreach.use': true },
}

beforeAll(async () => {
  await registerPluginDeclarations()
})

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockImplementation(async (_user: unknown, url: string, init?: { method?: string }) => ({
    ok: true,
    json: async () =>
      init?.method === 'POST' ? { ok: true, roleId: 'cashier' } : { roles: [STORED_ROLE], nextCursor: null },
  }))
})

function lastSave(): Record<string, unknown> {
  const call = [...mockFetch.mock.calls].reverse().find(([, , init]) => init?.method === 'POST')
  return JSON.parse(call?.[2]?.body ?? '{}')
}

describe('the custom role editor (AGL-4047)', () => {
  it('groups the offered keys, plugin keys included, and hides a switched-off plugin’s', async () => {
    render(<OrgRolesCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cashier' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('region', { name: 'Sites' })).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: 'Commerce' })).toBeTruthy()
    expect(within(dialog).getByRole('region', { name: 'Waivers' })).toBeTruthy()
    expect(within(dialog).queryByRole('region', { name: 'Sequences' })).toBeNull()
    const pos = within(dialog).getByRole('group', { name: 'Use the point of sale' })
    expect(within(pos).getByRole('button', { name: 'Allow' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('searches, sets three states and a whole group, and saves what it was given besides', async () => {
    render(<OrgRolesCard />)
    fireEvent.click(await screen.findByRole('button', { name: 'Cashier' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Search permissions'), { target: { value: 'billing' } })
    expect(within(dialog).queryByRole('region', { name: 'Commerce' })).toBeNull()
    fireEvent.click(
      within(within(dialog).getByRole('group', { name: 'Set every Billing permission' })).getByRole('button', {
        name: 'Deny',
      }),
    )
    fireEvent.change(within(dialog).getByLabelText('Search permissions'), { target: { value: '' } })
    fireEvent.click(
      within(within(dialog).getByRole('group', { name: 'Use the point of sale' })).getByRole('button', {
        name: 'Inherit',
      }),
    )
    fireEvent.click(
      within(within(dialog).getByRole('group', { name: 'Create sites' })).getByRole('button', { name: 'Allow' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save role' }))
    await waitFor(() => expect(lastSave()['action']).toBe('save'))
    expect(lastSave()['permissions']).toEqual({
      'outreach.use': true,
      'billing.view': false,
      'billing.manage': false,
      'hosts.create': true,
    })
  })
})
