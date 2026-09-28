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
 * Members & leads on the organization's Inbox (AGL-3303 → AGL-3321).
 *
 * With no site, the section is the organization's leads — one org collection,
 * read unscoped by an org-wide member — and names the sites that captured each
 * person. Members live under one site each, so none are read until a site is
 * picked. A lead's links go where the organization can open them: its CRM
 * page by id, and its attribution as the site whose capture made it.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ConsolePluginOrgMount } from '@aglyn/aglyn'

let mockLeads: Array<Record<string, unknown>> = []
let mockMembers: Array<Record<string, unknown>> = []
/** Every collection a list query was opened on. */
let mockOpened: string[] = []
/** The plan each collection's list asked last. */
let mockPlans: Record<string, any> = {}

const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  // The signed-in account a member removal is authorized as (AGL-3308).
  useUser: () => ({ data: null }),
  useScopeTokens: () => ({ tokens: ['org'], orgWide: true, loaded: true }),
  // The org the card is handed wins; a site resolves to its org.
  useOrgDataScope: ({ hostId, orgId }: { hostId?: string; orgId?: string }) => ({
    orgId: orgId ?? (hostId ? 'org-1' : null),
    ready: true,
    scope: null,
  }),
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({ __source: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

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

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: { header: ReactNode; children?: ReactNode }) => (
    <section>
      <h2>{header}</h2>
      {children}
    </section>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
jest.mock('./inbox-attribution-zone', () => ({
  InboxRecordAttributionZone: ({ hostId }: { hostId: string }) => (
    <p>{`attribution as ${hostId}`}</p>
  ),
}))

/** The organization's Inbox: the URL names the org and no site. */
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => ({ orgSlug: 'acme' }),
  usePathname: () => '/acme/inbox/contacts',
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}))

import { nameSearchTokens } from '@aglyn/aglyn/app-utils/name-search'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { ContactsCard } from './contacts-card.component'

const ORG_MOUNT: ConsolePluginOrgMount = {
  orgId: 'org-1',
  orgSlug: 'acme',
  hosts: [
    { id: 'site-a', name: 'Shop', subdomain: 'shop' },
    { id: 'site-b', name: 'Blog', subdomain: 'blog' },
  ],
  hostsReady: true,
  hostsPath: '/acme/hosts',
}

const at = (iso: string) => {
  const date = new Date(iso)
  return { seconds: date.getTime() / 1000, toDate: () => date }
}

beforeEach(() => {
  resetPluginServicesForTests()
  // The CRM's own grammar: an org-level lead page by id (AGL-3275).
  registerPluginRecordRoute(
    'lead',
    {
      list: ({ orgSlug, host }) =>
        host ? `/${orgSlug}/hosts/${host}/crm/leads` : `/${orgSlug}/crm/leads`,
      record: ({ orgSlug, host }, id) =>
        host ? `/${orgSlug}/hosts/${host}/crm/leads/${id}` : `/${orgSlug}/crm/leads/${id}`,
    },
    { pluginId: 'people' },
  )
  mockOpened = []
  mockPlans = {}
  mockMembers = [{ $id: 'm1', email: 'member@example.com', createdAt: at('2026-09-01T00:00:00Z') }]
  mockLeads = [
    {
      $id: 'lead-ada',
      email: 'ada@example.com',
      sources: ['booking'],
      capturedByHostIds: ['site-b', 'site-a'],
      visibleTo: ['host:site-a', 'host:site-b'],
      searchTokens: nameSearchTokens('ada@example.com'),
      createdAt: at('2026-09-10T00:00:00Z'),
    },
    {
      $id: 'lead-imported',
      email: 'cy@example.com',
      sources: ['import'],
      visibleTo: ['org'],
      searchTokens: nameSearchTokens('cy@example.com'),
      createdAt: at('2026-09-09T00:00:00Z'),
    },
  ]
})

const renderOrgCard = () => render(<ContactsCard hostId={null} orgMount={ORG_MOUNT} />)
const grid = () => screen.getByRole('grid', { name: 'Leads' })
const rowOf = (text: string) =>
  within(grid()).getByText(text).closest('[role="row"]') as HTMLElement

describe('Members & leads on the organization’s Inbox', () => {
  it('reads the organization’s leads unscoped, and no site’s members', () => {
    renderOrgCard()
    // No `visibleTo` clause: an org-wide member reads the whole collection,
    // and a clause would only narrow what the rules already admit.
    expect([...new Set(mockOpened)]).toEqual(['orgs/org-1/leads'])
    expect(mockPlans['orgs/org-1/leads'].filters).toEqual([])
    expect(mockPlans['orgs/org-1/leads'].orderBy).toEqual({ path: 'createdAt', direction: 'desc' })
    expect(screen.queryByText('member@example.com')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Leads' })).toBeTruthy()
    expect(screen.getByText(/choose a site to list its members/)).toBeTruthy()
    // Members is there, and says it waits for a site.
    expect((screen.getByRole('button', { name: 'Members' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('names every site that captured a person, in capture order', () => {
    renderOrgCard()
    expect(within(rowOf('ada@example.com')).getByText('Blog, Shop')).toBeTruthy()
  })

  it('searches the leads’ own tokens, with no scope to fold into', async () => {
    renderOrgCard()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cy' } })
    await waitFor(() => expect(within(grid()).queryByText('ada@example.com')).toBeNull())
    expect(mockPlans['orgs/org-1/leads'].filters).toEqual([
      { path: 'searchTokens', op: 'array-contains', value: 'cy' },
    ])
  })

  it('opens a lead on the organization’s CRM page, by id', () => {
    renderOrgCard()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for ada@example.com' }))
    expect(
      screen.getByRole('menuitem', { name: 'Open in CRM' }).getAttribute('href'),
    ).toBe('/acme/crm/leads/lead-ada')
  })

  it('asks where a lead came from as the site whose capture made it', () => {
    renderOrgCard()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for ada@example.com' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Where this came from' }))
    expect(screen.getByText('attribution as site-b')).toBeTruthy()
  })

  it('offers no attribution for a lead no site captured', () => {
    renderOrgCard()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for cy@example.com' }))
    expect(screen.queryByRole('menuitem', { name: 'Where this came from' })).toBeNull()
  })
})

describe('THE CONTROL: under a site it is the site’s list', () => {
  it('reads the site’s members, and its leads narrowed to it on the toggle', async () => {
    render(<ContactsCard hostId="site-a" />)
    expect(mockPlans['hosts/site-a/siteMembers'].filters).toEqual([])
    expect(screen.getByText('member@example.com')).toBeTruthy()
    expect(mockOpened).not.toContain('orgs/org-1/leads')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Leads' }))
    })
    expect(mockPlans['orgs/org-1/leads'].filters).toEqual([
      { path: 'visibleTo', op: 'array-contains-any', value: ['org', 'host:site-a'] },
    ])
    expect(screen.getByText('ada@example.com')).toBeTruthy()
    expect(screen.getByText('cy@example.com')).toBeTruthy()
  })
})
