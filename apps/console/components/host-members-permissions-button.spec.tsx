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
 * A SITE'S USERS CARD ASKS WHAT ITS DOORS ASK (AGL-4047).
 *
 * `/api/hosts/members` and `/api/hosts/members/permissions` admit "Manage site
 * settings" on this site as well as the workspace's "Manage members". The card's
 * controls asked the second alone, so a site's own admin was refused what its
 * doors would have done.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockManageMembers = false
let mockCanManageSite = false
let mockSiteKnown = true
const mockDialog = jest.fn()

const mockFirestore = {}
const mockRows = [{ $id: 'member-1', uid: 'uid-1', email: 'person@example.test', role: 'editor' }]

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) => segments.join('/'),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  query: (path: string) => path,
  where: () => undefined,
  documentId: () => undefined,
  limit: () => undefined,
  getCountFromServer: jest.fn(() => Promise.resolve({ data: () => ({ count: 1 }) })),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: { uid: 'reader-1', getIdToken: async () => 'tok' } }),
}))
jest.mock('@aglyn/tenant-feature-instance/hooks/use-paged-collection', () => ({
  __esModule: true,
  usePagedCollection: () => ({
    rows: mockRows,
    hasMore: false,
    page: 0,
    setPage: () => undefined,
    pageSize: 10,
    setPageSize: () => undefined,
    data: mockRows,
    status: 'success',
    error: undefined,
    fromCache: false,
    serverDenied: false,
  }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { $id: 'org-1', plan: 'business', ownerUid: 'owner-1' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-org-scope', () => {
  const scope = {
    orgs: [],
    currentOrg: null,
    selectOrg: () => undefined,
    orgSlug: 'acme',
    pathOrgSlug: 'acme',
    loading: false,
    confirmed: true,
    slugExists: true,
    error: false,
    retry: () => undefined,
    hasMoreOrgs: false,
    loadMoreOrgs: () => undefined,
  }
  return { __esModule: true, useOrgSlug: () => 'acme', useOrgScope: () => scope, default: () => scope }
})
jest.mock('./console-plugins-gate.component', () => ({
  __esModule: true,
  useEnabledPluginIds: () => [],
  usePluginLoadScope: () => ({ orgId: null, user: undefined }),
}))
jest.mock('./host-id-provider', () => ({
  __esModule: true,
  useCanManageSite: () => mockCanManageSite,
  useCanManageSiteKnown: () => mockSiteKnown,
}))
jest.mock('../hooks/use-org-permissions', () => ({
  __esModule: true,
  default: () => ({ permissions: { manageMembers: mockManageMembers } }),
}))
jest.mock('../hooks/use-host-activity-logger', () => ({ __esModule: true, default: () => jest.fn() }))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: mockRows }),
}))
jest.mock('../hooks/use-firestore-doc', () => ({ __esModule: true, default: () => ({ data: null }) }))
jest.mock('./member-avatar.component', () => ({ __esModule: true, default: () => null }))
jest.mock('./site-permissions-dialog.component', () => ({
  __esModule: true,
  default: (props: { member: unknown; canManage: boolean }) => {
    mockDialog(props)
    return null
  },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({ useSnackbar: () => ({ enqueueSnackbar: jest.fn() }) }))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: jest.fn().mockResolvedValue(undefined) }),
}))

import HostMembersCard from './host-members-card.component'

const REFUSAL = 'Your role does not include "Manage site settings" — ask an organization admin'

const button = () => screen.getByRole('button', { name: 'Permissions' }) as HTMLButtonElement
const removeButton = () => screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement
const addButton = () => screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement
/** The role picker's input on the collaborator's row, after the Add form's own. */
const rolePicker = () => Array.from(document.querySelectorAll<HTMLInputElement>("input[value='editor']")).at(-1) as HTMLInputElement
const typeEmail = () =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), { target: { value: 'new@example.test' } })
const refusedBy = (element: Element) =>
  screen.queryAllByLabelText(REFUSAL).some((wrapper) => wrapper.contains(element))

beforeEach(() => {
  mockManageMembers = false
  mockCanManageSite = false
  mockSiteKnown = true
  mockDialog.mockClear()
})

describe('the Permissions button beside a site’s collaborator', () => {
  it('is on for a holder of the workspace’s Manage members', () => {
    mockManageMembers = true
    render(<HostMembersCard hostId="host-1" />)
    expect(button().disabled).toBe(false)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('is on for a holder of Manage site settings here, and its dialog can save', () => {
    mockCanManageSite = true
    render(<HostMembersCard hostId="host-1" />)
    expect(button().disabled).toBe(false)
    fireEvent.click(button())
    expect(mockDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ member: mockRows[0], canManage: true }),
    )
  })

  it('is off for a member with neither, naming the permission', () => {
    render(<HostMembersCard hostId="host-1" />)
    expect(button().disabled).toBe(true)
    expect(refusedBy(button())).toBe(true)
  })

  it('holds with no reason said while the site has not answered', () => {
    mockSiteKnown = false
    render(<HostMembersCard hostId="host-1" />)
    expect(button().disabled).toBe(true)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })
})

describe('a site’s role picker, Remove and Add', () => {
  it('are on for a holder of the workspace’s Manage members', () => {
    mockManageMembers = true
    render(<HostMembersCard hostId="host-1" />)
    typeEmail()
    expect(rolePicker().disabled).toBe(false)
    expect(removeButton().disabled).toBe(false)
    expect(addButton().disabled).toBe(false)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('are on for a holder of Manage site settings here, as the door admits them', () => {
    mockCanManageSite = true
    render(<HostMembersCard hostId="host-1" />)
    typeEmail()
    expect(rolePicker().disabled).toBe(false)
    expect(removeButton().disabled).toBe(false)
    expect(addButton().disabled).toBe(false)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })

  it('are off for a member with neither, naming the permission', () => {
    render(<HostMembersCard hostId="host-1" />)
    typeEmail()
    for (const control of [rolePicker(), removeButton(), addButton()]) {
      expect(control.disabled).toBe(true)
      expect(refusedBy(control)).toBe(true)
    }
  })

  it('hold with no reason said while the site has not answered', () => {
    mockSiteKnown = false
    render(<HostMembersCard hostId="host-1" />)
    typeEmail()
    expect(removeButton().disabled).toBe(true)
    expect(addButton().disabled).toBe(true)
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  })
})
