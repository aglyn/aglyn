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
 * A site's members and leads, each its own list on its own query
 * (AGL-3045 → AGL-3321).
 *
 * The toggle over the grid picks the collection; each list's filters and
 * search are predicates on that collection's query, paged by the server, so a
 * match past the first page is found. What the table keeps from the one it
 * replaced: the shared grid, the name beside the address, and each kind's own
 * actions — removing a member, and opening a lead or asking where it came
 * from.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

/** The documents each collection holds. */
let mockMembers: Array<Record<string, unknown>> = []
let mockLeads: Array<Record<string, unknown>> = []
/** The reader's reach in the org: org-wide unless a spec says otherwise. */
let mockReach = { tokens: ['org'], orgWide: true, loaded: true }
/** Every collection a list query was opened on, in order. */
let mockOpened: string[] = []
/** The plan each collection's list asked last. */
let mockPlans: Record<string, any> = {}

/** Held: a Firestore handle minted per render would re-run every read. */
const mockFirestore = {}
/** The signed-in account a member removal is authorized as (AGL-3308). */
const mockUser = { getIdToken: async () => 'console-id-token' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  // The lead silo is the org's (AGL-3275), so these cards resolve it.
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1', ready: true }),
  useFirestore: () => mockFirestore,
  useUser: () => ({ data: mockUser }),
  useScopeTokens: () => mockReach,
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ __source: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

/*
 * The list query, answered by the shared double over the collection the card
 * opened: the real plan, every predicate applied as Firestore would, paged.
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query')
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...actual,
    useListQuery: (options: { collection: { __source: string } | null }) => {
      const source = options.collection?.__source ?? ''
      if (source) mockOpened.push(source)
      const result = useListQueryDouble(
        () =>
          source.endsWith('/siteMembers')
            ? mockMembers
            : source.endsWith('/leads')
              ? mockLeads
              : [],
        options,
      )
      if (source) mockPlans[source] = result.plan
      return result
    },
  }
})

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
import { nameSearchTokens, scopedSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { ContactsCard } from './contacts-card.component'

/** The plan the list over one collection asked last. */
const planOf = (source: string) => mockPlans[source]
const MEMBERS = 'hosts/host-1/siteMembers'
const LEADS = 'orgs/org-1/leads'

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

const at = (iso: string) => {
  const date = new Date(iso)
  return { seconds: date.getTime() / 1000, toDate: () => date }
}

/** A member as the register route writes one. */
const member = (id: string, email: string, displayName: string, iso: string) => ({
  $id: id,
  email,
  displayName,
  // The name's words; the writer adds the address's (`memberSearchTokens`).
  searchTokens: nameSearchTokens(displayName),
  createdAt: at(iso),
})

/** A lead as `addHostLead` and the CRM's list fields write one. */
const lead = (id: string, email: string, name: string, sources: string[], iso: string) => {
  const searchTokens = [...nameSearchTokens(name), ...nameSearchTokens(email)]
  return {
    $id: id,
    email,
    name,
    sources,
    visibleTo: ['host:host-1'],
    searchTokens,
    scopedSearchTokens: scopedSearchTokens(['host:host-1'], searchTokens),
    createdAt: at(iso),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRouteAnswer.ok = true
  mockRouteAnswer.body = { ok: true }
  mockReach = { tokens: ['org'], orgWide: true, loaded: true }
  mockOpened = []
  mockPlans = {}
  resetPluginServicesForTests()
  publishLeadRoutes()
  mockMembers = [member('same-id', 'ada@example.com', 'Ada', '2026-09-10T12:00:00Z')]
  mockLeads = [
    // The same person as the member: a lead in its own list, as it is in its
    // own collection.
    lead('lead-ada', 'ada@example.com', 'Ada', ['signup'], '2026-09-09T12:00:00Z'),
    // A lead whose document id happens to equal the member's.
    lead('same-id', 'lin@example.com', 'Lin', ['booking', 'form:contact'], '2026-09-08T12:00:00Z'),
  ]
})

const addresses = () =>
  Array.from(document.querySelectorAll('[role="row"][data-id]')).map(
    (row) => row.querySelector('[data-field="email"] p')?.textContent,
  )
const rowOf = (address: string) =>
  within(screen.getByRole('grid')).getByText(address).closest('[role="row"]') as HTMLElement
const showLeads = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Leads' }))
  })
}

describe('ContactsCard (AGL-3045 → AGL-3321)', () => {
  it('lists a site’s members, newest first, and opens no lead read until asked', () => {
    const { container } = render(<ContactsCard hostId="host-1" />)

    expect(container.querySelectorAll('table')).toHaveLength(0)
    expect(screen.getByRole('grid', { name: 'Site members' })).toBeTruthy()
    expect(addresses()).toEqual(['ada@example.com'])
    expect(within(rowOf('ada@example.com')).getByText('Ada')).toBeTruthy()
    expect(mockOpened.every((source) => source === 'hosts/host-1/siteMembers')).toBe(true)
    expect(planOf(MEMBERS).orderBy).toMatchObject({ path: 'createdAt', direction: 'desc' })
  })

  it('lists the site’s leads on the Leads toggle, each with where it came from', async () => {
    render(<ContactsCard hostId="host-1" />)
    await showLeads()

    expect(screen.getByRole('grid', { name: 'Leads' })).toBeTruthy()
    // Every lead, the one who is also a member included: no dedupe across
    // two paged collections.
    expect(addresses()).toEqual(['ada@example.com', 'lin@example.com'])
    expect(within(rowOf('ada@example.com')).getByText('Sign-up')).toBeTruthy()
    expect(within(rowOf('lin@example.com')).getByText('Booking')).toBeTruthy()
    expect(within(rowOf('lin@example.com')).getByText('Form')).toBeTruthy()
    expect(within(rowOf('lin@example.com')).getByText('Lin')).toBeTruthy()
    // Narrowed to what this site may see, on the query.
    expect(planOf(LEADS).filters).toEqual([
      { path: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:host-1'] },
    ])
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
    expect(mockEnqueueSnackbar).not.toHaveBeenCalledWith('Member removed', expect.anything())
  })

  it('opens a lead in the CRM, or asks where it came from, from the lead’s menu', async () => {
    render(<ContactsCard hostId="host-1" />)
    await showLeads()

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

  it('offers no link to a lead’s record when no plugin publishes its address', async () => {
    resetPluginServicesForTests()
    render(<ContactsCard hostId="host-1" />)
    await showLeads()

    fireEvent.click(
      within(rowOf('lin@example.com')).getByRole('button', {
        name: 'More actions for lin@example.com',
      }),
    )
    expect(screen.queryByRole('menuitem', { name: 'Open in CRM' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Where this came from' })).toBeTruthy()
  })
})

describe('each list searches on its query (AGL-3321)', () => {
  it('finds a member by name past the first page, through `searchTokens`', async () => {
    mockMembers = [
      ...Array.from({ length: 14 }, (_, at) =>
        member(`m-${at}`, `person${at}@example.com`, `Person ${at}`, `2026-09-${String(20 - at).padStart(2, '0')}T00:00:00Z`),
      ),
      member('m-late', 'grace@example.com', 'Grace Hopper', '2026-08-01T00:00:00Z'),
    ]
    render(<ContactsCard hostId="host-1" />)
    expect(addresses()).not.toContain('grace@example.com')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hopp' } })
    await waitFor(() => expect(addresses()).toEqual(['grace@example.com']))
    expect(planOf(MEMBERS).filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'hopp' },
    ])
  })

  it('folds a lead search into the site’s scope for an org-wide reader', async () => {
    render(<ContactsCard hostId="host-1" />)
    await showLeads()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lin' } })

    await waitFor(() => expect(addresses()).toEqual(['lin@example.com']))
    expect(planOf(LEADS).filters).toEqual([
      {
        path: 'scopedSearchTokens',
        op: 'array-contains-any',
        value: ['org~lin', 'host:host-1~lin'],
      },
    ])
  })

  it('asks a site collaborator’s lead search as the start of the address, beside the scope', async () => {
    // The rules prove a query without the scope clause only for an org-wide
    // member, so this reader keeps the clause, and the search becomes a
    // prefix range on the stored address — which the rules also prove.
    mockReach = { tokens: ['org', 'host:host-1'], orgWide: false, loaded: true }
    render(<ContactsCard hostId="host-1" />)
    await showLeads()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lin' } })

    await waitFor(() => expect(addresses()).toEqual(['lin@example.com']))
    expect(planOf(LEADS).filters).toEqual([
      { path: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:host-1'] },
      { path: 'email', op: '>=', value: 'lin' },
      { path: 'email', op: '<=', value: 'lin\uf8ff' },
    ])
    expect(screen.getByText(/matches the start of the address/)).toBeTruthy()
    expect(screen.queryByText(/Search is not applied/)).toBeNull()
  })

  it('starts the other list clean', async () => {
    render(<ContactsCard hostId="host-1" />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ada' } })
    await waitFor(() => expect(addresses()).toEqual(['ada@example.com']))
    await showLeads()

    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
    expect(addresses()).toEqual(['ada@example.com', 'lin@example.com'])
  })
})
