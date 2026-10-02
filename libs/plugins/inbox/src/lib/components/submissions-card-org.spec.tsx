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
 * EVERY SITE'S SUBMISSIONS IN ONE LIST — the Submissions card on the
 * organization's Inbox (AGL-3303).
 *
 * Two things can go wrong here that cannot go wrong under a site, and both
 * are silent. The read can fan out — a listener per site — or drop the
 * `orgId` clause the rules require, which the console renders as an empty
 * inbox. And a row can be acted on as the WRONG site: every act on a
 * submission is addressed by the site it lives under, and at this level the
 * card has no site of its own to fall back on.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { deleteDoc, updateDoc } from 'firebase/firestore'
import type { ReactNode } from 'react'
import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { messageSearchFields } from '@aglyn/aglyn/app-utils/message-search'
import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import SubmissionsCard from './submissions-card.component'
import { standInFormSubmissionList } from '../testing/stand-in-form-submissions'

/** Every query the card built: what it reads, and its predicates. */
let queries: Array<{ source: string; predicates: string[] }>
/** The submissions Firestore holds, answered through the list-query double. */
let rows: Array<Record<string, unknown>>
/** The list query the card opened last: its collection and its plan. */
let mockListQuery: { source: string; plan: any } | null = null

const mockRecountFormStats = jest.fn(async (_path: string, _body: unknown) => true)
jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The form counters' recount (AGL-3330); `form-stats.spec.ts` owns what it writes.
  usePluginApiPost: () => mockRecountFormStats,
  useFirestore: () => ({}),
  useFirestoreCollection: (factory: () => unknown) => ({
    data: factory() === null ? undefined : [],
    status: 'success',
    fromCache: false,
  }),
}))

// The list's query (AGL-3321), answered by the shared double: the real plan,
// every predicate applied as Firestore would.
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () => {
  const actual = jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query')
  const { useListQueryDouble } = jest.requireActual(
    '@aglyn/tenant-feature-instance/testing/list-query-double',
  )
  return {
    ...actual,
    useListQuery: (options: { collection: { __source: string } | null }) => {
      const result = useListQueryDouble(() => (options.collection ? rows : []), options)
      if (options.collection) {
        mockListQuery = { source: options.collection.__source, plan: result.plan }
      }
      return result
    },
  }
})

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    __source: segments.join('/'),
  }),
  collectionGroup: (_db: unknown, id: string) => ({ __source: `group:${id}` }),
  query: (source: { __source: string }, ...constraints: unknown[]) => {
    queries.push({
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
  limit: () => undefined,
  orderBy: (field: string, direction = 'asc') => ({
    __predicate: `orderBy:${field} ${direction}`,
  }),
  where: (field: string, op: string, value: string) => ({
    __predicate: `where:${field} ${op} ${value}`,
  }),
  doc: (_db: unknown, ...segments: string[]) => segments.join('/'),
  getDoc: jest.fn(),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('next/navigation', () => ({
  // The organization's Inbox: the URL names the org and no site.
  useParams: () => ({ orgSlug: 'acme' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/acme/inbox/submissions',
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    header,
    children,
  }: {
    header: ReactNode
    children: ReactNode
  }) => (
    <div>
      <h2>{header}</h2>
      {children}
    </div>
  ),
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
}))
// What the reader hands its three companions, read back as text.
jest.mock('./inbox-attribution-zone', () => ({
  InboxRecordAttributionZone: ({ hostId }: { hostId: string }) => (
    <p>{`attribution as ${hostId}`}</p>
  ),
}))
jest.mock('./submission-reply.component', () => ({
  __esModule: true,
  default: ({ hostId }: { hostId: string }) => <p>{`reply as ${hostId}`}</p>,
}))
jest.mock('./submission-list-assignment.component', () => ({
  __esModule: true,
  default: ({ hostId }: { hostId: string }) => <p>{`list as ${hostId}`}</p>,
}))

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

let minutesAgo = 0
/** A submission as the submit route writes one, each older than the last. */
const row = (
  id: string,
  hostId: string,
  email: string,
  extra: Record<string, unknown> = {},
) => ({
  $id: id,
  orgId: 'org-1',
  hostId,
  formName: 'Contact',
  read: false,
  fields: { email },
  ...messageSearchFields({ email }),
  createdAt: { seconds: 1_800_000_000 - (minutesAgo += 1) * 60 },
  ...extra,
})

beforeEach(() => {
  jest.clearAllMocks()
  resetPluginServicesForTests()
  // The submissions are the forms plugin's, walked and opened through the
  // list source it publishes (AGL-3080); stood in over this file's double.
  standInFormSubmissionList()
  queries = []
  rows = []
  mockListQuery = null
  minutesAgo = 0
})

const renderOrgCard = () =>
  render(<SubmissionsCard hostId={null} orgMount={ORG_MOUNT} />)
const grid = () => screen.getByRole('grid', { name: 'Form submissions' })
const rowOf = (text: string) =>
  within(grid()).getAllByText(text)[0].closest('[role="row"]') as HTMLElement

describe('the organization’s Submissions card', () => {
  it('reads every site with ONE collection-group query, filtered on the org, newest first', () => {
    renderOrgCard()
    expect(mockListQuery?.source).toBe('group:formSubmissions')
    expect(mockListQuery?.plan.filters).toEqual([{ path: 'orgId', op: '==', value: 'org-1' }])
    expect(mockListQuery?.plan.orderBy).toEqual({ path: 'createdAt', direction: 'desc' })
  })

  it('keeps the org clause under the search, on the same query', async () => {
    rows = [row('s1', 'site-a', 'ada@example.com'), row('s2', 'site-b', 'bo@example.com')]
    renderOrgCard()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bo' } })
    await waitFor(() => expect(within(grid()).queryByText('email: ada@example.com')).toBeNull())
    expect(mockListQuery?.plan.filters).toEqual([
      { path: 'orgId', op: '==', value: 'org-1' },
      { path: 'searchTokens', op: 'array-contains', value: 'bo' },
    ])
    expect(rowOf('bo@example.com')).toBeTruthy()
  })

  it('reads no form catalog: forms are one site’s, and picking a site is how to get one', () => {
    renderOrgCard()
    expect(queries.some((entry) => entry.source.endsWith('/forms'))).toBe(false)
    expect(screen.queryByLabelText('Form')).toBeNull()
  })

  it('names each row’s site, by name where the org can name it', () => {
    rows = [
      row('s1', 'site-a', 'ada@example.com'),
      row('s2', 'site-b', 'bo@example.com'),
      row('s3', 'site-gone', 'cy@example.com'),
    ]
    renderOrgCard()
    expect(within(rowOf('ada@example.com')).getByText('Shop')).toBeTruthy()
    expect(within(rowOf('bo@example.com')).getByText('Blog')).toBeTruthy()
    // A site the mount cannot name is shown by its id, never blank.
    expect(within(rowOf('cy@example.com')).getByText('site-gone')).toBeTruthy()
  })

  it('opens a row as the site it was sent to, and marks THAT document read', () => {
    rows = [
      row('s1', 'site-a', 'ada@example.com'),
      row('s2', 'site-b', 'bo@example.com'),
    ]
    renderOrgCard()
    fireEvent.click(
      within(rowOf('bo@example.com')).getByText('email: bo@example.com'),
    )
    expect(updateDoc).toHaveBeenCalledTimes(1)
    expect(updateDoc).toHaveBeenCalledWith('hosts/site-b/formSubmissions/s2', {
      read: true,
    })
    // The reader's reply, list and attribution act as the row's site too.
    expect(screen.getByText('reply as site-b')).toBeTruthy()
    expect(screen.getByText('list as site-b')).toBeTruthy()
    expect(screen.getByText('attribution as site-b')).toBeTruthy()
  })

  it('marks unread and deletes by the row’s own path', async () => {
    rows = [row('s2', 'site-b', 'bo@example.com', { read: true })]
    renderOrgCard()
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for bo@example.com' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark unread' }))
    expect(updateDoc).toHaveBeenCalledWith('hosts/site-b/formSubmissions/s2', {
      read: false,
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for bo@example.com' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    // Deleted once the confirmation answers, which it does asynchronously.
    await waitFor(() =>
      expect(deleteDoc).toHaveBeenCalledWith('hosts/site-b/formSubmissions/s2'),
    )
  })

  it('links a sender to the organization’s CRM, where no site is named', () => {
    registerPluginRecordRoute(
      'contact',
      {
        list: ({ orgSlug, host }) =>
          host
            ? `/${orgSlug}/hosts/${host}/crm/contacts`
            : `/${orgSlug}/crm/contacts`,
        record: () => null,
        byEmail: ({ orgSlug, host }, email) =>
          host
            ? null
            : `/${orgSlug}/crm/contacts?email=${encodeURIComponent(email)}`,
      },
      { pluginId: 'people' },
    )
    rows = [row('s2', 'site-b', 'bo@example.com')]
    renderOrgCard()
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for bo@example.com' }),
    )
    expect(
      screen
        .getByRole('menuitem', { name: 'Open contact in CRM' })
        .getAttribute('href'),
    ).toBe('/acme/crm/contacts?email=bo%40example.com')
  })

  it('says no site has any yet, rather than telling the reader to add a form', () => {
    renderOrgCard()
    expect(
      screen.getByText('No form submissions on any site yet.'),
    ).toBeTruthy()
  })
})

describe('THE CONTROL: under a site it is the site’s inbox', () => {
  it('reads that site’s own collection and its form catalog, with no org clause', () => {
    render(<SubmissionsCard hostId="site-a" />)
    expect(mockListQuery?.source).toBe('hosts/site-a/formSubmissions')
    expect(mockListQuery?.plan.filters).toEqual([])
    expect(queries).toEqual([
      { source: 'hosts/site-a/forms', predicates: ['orderBy:__name__ asc'] },
    ])
  })
})
