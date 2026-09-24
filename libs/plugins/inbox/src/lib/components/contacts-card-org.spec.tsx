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
 * Members & leads on the organization's Inbox (AGL-3303).
 *
 * With no site, the section is the organization's leads — one org collection,
 * read unscoped by an org-wide member — and names the sites that captured each
 * person. Members live under one site each, so none are read until a site is
 * picked. A lead's links go where the organization can open them: its CRM
 * page by id, and its attribution as the site whose capture made it.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ConsolePluginOrgMount } from '@aglyn/aglyn'

/** Every query the card built: what it reads, and its predicates. */
let mockQueries: Array<{ source: string; predicates: string[] }> = []
let mockLeads: Array<Record<string, unknown>> = []
let mockMembers: Array<Record<string, unknown>> = []

const mockFirestore = {}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  // The signed-in account a member removal is authorized as (AGL-3308).
  useUser: () => ({ data: null }),
  // The org the card is handed wins; a site resolves to its org.
  useOrgDataScope: ({
    hostId,
    orgId,
  }: {
    hostId?: string
    orgId?: string
  }) => ({
    orgId: orgId ?? (hostId ? 'org-1' : null),
    ready: true,
    scope: null,
  }),
  useFirestoreCollection: (factory: () => { __source: string } | null) => {
    const built = factory()
    const source = built?.__source ?? ''
    return {
      data: !built
        ? undefined
        : source.endsWith('/leads')
          ? mockLeads
          : source.endsWith('/siteMembers')
            ? mockMembers
            : [],
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (_db: unknown, ...segments: string[]) => ({
    __source: segments.join('/'),
  }),
  query: (source: { __source: string }, ...constraints: unknown[]) => {
    mockQueries.push({
      source: source.__source,
      predicates: constraints
        .filter(
          (constraint): constraint is { __predicate: string } =>
            Boolean(constraint) &&
            typeof (constraint as { __predicate?: string }).__predicate ===
              'string',
        )
        .map((constraint) => constraint.__predicate),
    })
    return source
  },
  where: (field: string, op: string) => ({
    __predicate: `where:${field} ${op}`,
  }),
  orderBy: (field: string, direction = 'asc') => ({
    __predicate: `orderBy:${field} ${direction}`,
  }),
  limit: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({
    header,
    children,
  }: {
    header: ReactNode
    children?: ReactNode
  }) => (
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

import { ContactsCard } from './contacts-card.component'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

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

const at = (iso: string) => ({ toDate: () => new Date(iso) })

beforeEach(() => {
  resetPluginServicesForTests()
  // The CRM's own grammar: an org-level lead page by id (AGL-3275).
  registerPluginRecordRoute(
    'lead',
    {
      list: ({ orgSlug, host }) =>
        host ? `/${orgSlug}/hosts/${host}/crm/leads` : `/${orgSlug}/crm/leads`,
      record: ({ orgSlug, host }, id) =>
        host
          ? `/${orgSlug}/hosts/${host}/crm/leads/${id}`
          : `/${orgSlug}/crm/leads/${id}`,
    },
    { pluginId: 'people' },
  )
  mockQueries = []
  mockMembers = [
    {
      $id: 'm1',
      email: 'member@example.com',
      createdAt: at('2026-09-01T00:00:00Z'),
    },
  ]
  mockLeads = [
    {
      $id: 'lead-ada',
      email: 'ada@example.com',
      capturedByHostIds: ['site-b', 'site-a'],
      createdAt: at('2026-09-10T00:00:00Z'),
    },
    {
      $id: 'lead-imported',
      email: 'cy@example.com',
      createdAt: at('2026-09-09T00:00:00Z'),
    },
  ]
})

const renderOrgCard = () =>
  render(<ContactsCard hostId={null} orgMount={ORG_MOUNT} />)
const grid = () => screen.getByRole('grid', { name: 'Site members and leads' })
const rowOf = (text: string) =>
  within(grid()).getByText(text).closest('[role="row"]') as HTMLElement

describe('Members & leads on the organization’s Inbox', () => {
  it('reads the organization’s leads unscoped, and no site’s members', () => {
    renderOrgCard()
    expect(mockQueries).toEqual([
      // No `visibleTo` clause: an org-wide member reads the whole collection,
      // and a clause would only narrow what the rules already admit.
      { source: 'orgs/org-1/leads', predicates: ['orderBy:createdAt desc'] },
    ])
    expect(screen.queryByText('member@example.com')).toBeNull()
    expect(screen.getByText('Leads')).toBeTruthy()
    expect(screen.getByText(/choose a site to list its members/)).toBeTruthy()
  })

  it('names every site that captured a person, in capture order', () => {
    renderOrgCard()
    expect(
      within(rowOf('ada@example.com')).getByText('Blog, Shop'),
    ).toBeTruthy()
  })

  it('opens a lead on the organization’s CRM page, by id', () => {
    renderOrgCard()
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for ada@example.com' }),
    )
    expect(
      screen
        .getByRole('menuitem', { name: 'Open in CRM' })
        .getAttribute('href'),
    ).toBe('/acme/crm/leads/lead-ada')
  })

  it('asks where a lead came from as the site whose capture made it', () => {
    renderOrgCard()
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for ada@example.com' }),
    )
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Where this came from' }),
    )
    expect(screen.getByText('attribution as site-b')).toBeTruthy()
  })

  it('offers no attribution for a lead no site captured', () => {
    renderOrgCard()
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for cy@example.com' }),
    )
    expect(
      screen.queryByRole('menuitem', { name: 'Where this came from' }),
    ).toBeNull()
  })
})

describe('THE CONTROL: under a site it is the site’s list', () => {
  it('reads the site’s members and its leads narrowed to it', () => {
    render(<ContactsCard hostId="site-a" />)
    expect(mockQueries).toEqual(
      expect.arrayContaining([
        {
          source: 'hosts/site-a/siteMembers',
          predicates: ['orderBy:createdAt desc'],
        },
        {
          source: 'orgs/org-1/leads',
          predicates: [
            'where:visibleTo array-contains-any',
            'orderBy:createdAt desc',
          ],
        },
      ]),
    )
    expect(screen.getByText('member@example.com')).toBeTruthy()
  })
})
