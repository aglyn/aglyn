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
 * A site's members and leads are one record list in the shared grid
 * (AGL-3045).
 *
 * The grid scrolls its own columns inside the card. What it has to keep from
 * the table it replaced: members first and then the leads that are not
 * already members, one person once whatever the case of their address, a
 * member and a lead that share a document id kept apart, and each kind's own
 * actions — removing a member, and opening a lead or asking where it came
 * from.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** The documents each collection holds, newest first. */
let mockMembers: Array<Record<string, unknown>> = []
let mockLeads: Array<Record<string, unknown>> = []

/** Held: a Firestore handle minted per render would re-run every read. */
const mockFirestore = {}
/** The signed-in account a member removal is authorized as (AGL-3308). */
const mockUser = { getIdToken: async () => 'console-id-token' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The lead silo is the org's (AGL-3275), so these cards resolve it.
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  __esModule: true,
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: mockUser }),
  useFirestoreCollection: (factory: () => { __name: string }) => {
    const name = factory().__name
    return {
      data: name === 'siteMembers' ? mockMembers : name === 'leads' ? mockLeads : [],
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  // The scope clause every lead read carries now (AGL-3275).
  where: (...args: unknown[]) => ({ __where: args }),
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    __name: segments[segments.length - 1],
  }),
  query: (source: { __name: string }) => source,
  orderBy: () => undefined,
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

/*
 * The route that owns member accounts (AGL-3308). A member's password hash is
 * out of any client's reach, so the card asks the route to remove both
 * documents rather than deleting the profile itself.
 */
const mockRouteAnswer = { ok: true, body: { ok: true } as Record<string, unknown> }
const mockAuthorizedFetch = jest.fn(async (..._args: unknown[]) => ({
  ok: mockRouteAnswer.ok,
  json: async () => mockRouteAnswer.body,
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

const mockConfirm = jest.fn().mockResolvedValue(undefined)
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

/* The zone a plugin that credits conversions draws in; a marker stands in. */
jest.mock('./inbox-attribution-zone', () => ({
  InboxRecordAttributionZone: () => <p>{'Attribution'}</p>,
}))

/** Held, so the CRM hub's address is built from one set of params. */
const mockParams = { orgSlug: 'acme', host: 'shop' }
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => mockParams,
  usePathname: () => '/acme/hosts/shop/inbox/contacts',
}))

import { deleteDoc } from 'firebase/firestore'
import { ContactsCard } from './contacts-card.component'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * A plugin that keeps people and says where a lead is read. The Inbox imports
 * none, so the spec stands one up the way a loaded plugin would.
 */
const publishLeadRoutes = () =>
  registerPluginRecordRoute(
    'lead',
    {
      list: ({ orgSlug, host }) => `/${orgSlug}/hosts/${host}/crm/leads`,
      record: ({ orgSlug, host }, id) => `/${orgSlug}/hosts/${host}/crm/leads/${id}`,
    },
    { pluginId: 'people' },
  )

const at = (iso: string) => ({ toDate: () => new Date(iso) })

beforeEach(() => {
  jest.clearAllMocks()
  mockRouteAnswer.ok = true
  mockRouteAnswer.body = { ok: true }
  resetPluginServicesForTests()
  publishLeadRoutes()
  mockMembers = [
    { $id: 'same-id', email: 'ada@example.com', displayName: 'Ada', createdAt: at('2026-09-10T12:00:00Z') },
  ]
  mockLeads = [
    // The same person as the member, in a different case: listed once.
    { $id: 'lead-dup', email: 'ADA@example.com', source: 'signup', createdAt: at('2026-09-09T12:00:00Z') },
    // A lead whose document id happens to equal the member's.
    { $id: 'same-id', email: 'lin@example.com', name: 'Lin', source: 'booking', createdAt: at('2026-09-08T12:00:00Z') },
  ]
})

const rowOf = (address: string) =>
  within(screen.getByRole('grid', { name: 'Site members and leads' }))
    .getByText(address)
    .closest('[role="row"]') as HTMLElement

describe('ContactsCard (AGL-3045)', () => {
  it('lists members, then leads that are not members, in the shared grid', () => {
    const { container } = render(<ContactsCard hostId="host-1" />)

    expect(container.querySelectorAll('table')).toHaveLength(0)
    const addresses = Array.from(document.querySelectorAll('[role="row"][data-id]')).map(
      (row) => row.querySelector('[data-field="email"] p')?.textContent,
    )
    expect(addresses).toEqual(['ada@example.com', 'lin@example.com'])
    expect(within(rowOf('ada@example.com')).getByText('Member')).toBeTruthy()
    expect(within(rowOf('lin@example.com')).getByText('Lead · booking')).toBeTruthy()
    expect(within(rowOf('lin@example.com')).getByText('Lin')).toBeTruthy()
  })

  it('removes a member from the member’s menu', async () => {
    render(<ContactsCard hostId="host-1" />)

    fireEvent.click(
      within(rowOf('ada@example.com')).getByRole('button', {
        name: 'More actions for ada@example.com',
      }),
    )
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Remove member',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove member' }))

    await screen.findByRole('grid')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockConfirm).toHaveBeenCalledTimes(1)
    // Through the route, as the signed-in account, never a client delete: the
    // profile's credential document is out of the browser's reach.
    expect(deleteDoc).not.toHaveBeenCalled()
    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    const [user, url, init] = mockAuthorizedFetch.mock.calls[0] as [
      unknown,
      string,
      { method: string; body: string },
    ]
    expect(user).toBe(mockUser)
    expect(url).toBe('/api/membership/admin-remove')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ hostId: 'host-1', memberId: 'same-id' })
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Member removed', {
      variant: 'success',
      persist: false,
    })
  })

  it('says so when the route refuses the removal', async () => {
    mockRouteAnswer.ok = false
    mockRouteAnswer.body = { error: 'Not permitted' }
    render(<ContactsCard hostId="host-1" />)

    fireEvent.click(
      within(rowOf('ada@example.com')).getByRole('button', {
        name: 'More actions for ada@example.com',
      }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove member' }))

    await screen.findByRole('grid')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Not permitted', {
      variant: 'warning',
      allowDuplicate: true,
    })
    expect(mockEnqueueSnackbar).not.toHaveBeenCalledWith(
      'Member removed',
      expect.anything(),
    )
  })

  it('opens a lead in the CRM, or asks where it came from, from the lead’s menu', () => {
    render(<ContactsCard hostId="host-1" />)

    fireEvent.click(
      within(rowOf('lin@example.com')).getByRole('button', {
        name: 'More actions for lin@example.com',
      }),
    )
    const open = screen.getByRole('menuitem', { name: 'Open in CRM' })
    expect(open.getAttribute('href')).toContain('same-id')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Where this came from' }))
    expect(screen.getByText('Attribution')).toBeTruthy()
  })

  it('offers no link to a lead’s record when no plugin publishes its address', () => {
    resetPluginServicesForTests()
    render(<ContactsCard hostId="host-1" />)

    fireEvent.click(
      within(rowOf('lin@example.com')).getByRole('button', {
        name: 'More actions for lin@example.com',
      }),
    )
    expect(screen.queryByRole('menuitem', { name: 'Open in CRM' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Where this came from' })).toBeTruthy()
  })
})

describe('the contacts list filters through the grid toolbar (AGL-3317)', () => {
  const addresses = () =>
    Array.from(document.querySelectorAll('[role="row"][data-id]')).map(
      (row) => row.querySelector('[data-field="email"] p')?.textContent,
    )

  it('searches names and addresses over every contact read', async () => {
    render(<ContactsCard hostId="host-1" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lin' } })
    await waitFor(() => expect(addresses()).toEqual(['lin@example.com']))
  })

  it('narrows by Type, member or lead by its source', async () => {
    render(<ContactsCard hostId="host-1" />)
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Column' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Type' }))
    })
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Value' }))
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Member' }))
    })
    await waitFor(() => expect(addresses()).toEqual(['ada@example.com']))
  })
})
