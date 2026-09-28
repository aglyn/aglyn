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
 *
 * @jest-environment jsdom
 */

/**
 * EVERY SITE'S TEMPLATES, IN ONE TABLE — AND EACH STILL ONE SITE'S.
 *
 * A template is a screen on one site, so the organization's list names the
 * site on every row, opens each on its own site's page, and makes a new one
 * AS a site: the same document a site's own list creates, then that site's
 * besigner. The reads are asserted in `emails-console-read-cost.spec.tsx`;
 * this file holds what the table says and where it sends people — and that
 * every clause and search word is on each site's QUERY (AGL-3321): the
 * Firestore double below answers the constraints the card built, so a row
 * the query would not return is never drawn.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { displayNameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import { answerListQuery } from '@aglyn/tenant-feature-instance/testing/list-query-double'

/** A screen as its writers store it: the name keys beside `displayName`. */
const stamped = (screen: Record<string, unknown>) => ({
  ...screen,
  ...displayNameSearchFields(screen['displayName']),
})

/** Every where-constraint the last read of each site asked for. */
const asked: Record<string, Array<{ path: string; op: string; value: unknown }>> = {}

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => '/acme/emails/templates',
}))

/** Each site's email screens, staged per case. */
let screensByHost: Record<string, Array<Record<string, unknown>>> = {}
/** Every site whose screens were read. */
const readFor = new Set<string>()
const NO_SCREENS: Array<Record<string, unknown>> = []
/** The answer each question got, per staged rows — see the double below. */
const answers = new Map<string, { staged: unknown; rows: unknown[] }>()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useOrgDataScope: () => ({
    scope: ['orgs', 'org-1'],
    orgId: 'org-1',
    ready: true,
  }),
  useHostResourceApi: () => jest.fn(),
  useHostVersionApi: () => jest.fn(),
  // Answers the QUERY the builder made, over the site its path names: every
  // `where`, the order (dropping a screen without the ordered field, as
  // `orderBy` does) and the limit — so each site's reader gets that site's
  // matching screens and nobody else's.
  useFirestoreCollection: (build: () => { path: string; constraints: any[] }) => {
    const built = build()
    const hostId = built.path.split('/')[1]
    readFor.add(hostId)
    const filters = built.constraints.filter((entry) => entry.where).map((entry) => entry.where)
    const order = built.constraints.find((entry) => entry.orderBy)?.orderBy
    const cap = built.constraints.find((entry) => typeof entry.limit === 'number')?.limit
    asked[hostId] = filters
    // One answer per snapshot, as the real hook holds one snapshot's rows
    // until the next arrives: the same question over the same rows answers
    // with the same array.
    const staged = screensByHost[hostId] ?? NO_SCREENS
    const key = JSON.stringify({ hostId, constraints: built.constraints })
    const held = answers.get(key)
    if (held && held.staged === staged) return { data: held.rows, status: 'success' }
    const answered = answerListQuery(staged, {
      filters,
      orderBy: order ?? { path: '__name__', direction: 'asc' },
    } as never)
    const rows = typeof cap === 'number' ? answered.slice(0, cap) : answered
    answers.set(key, { staged, rows })
    return { data: rows, status: 'success' }
  },
}))
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base.path,
    constraints: [...base.constraints, ...constraints],
  }),
  where: (path: string, op: string, value: unknown) => ({ where: { path, op, value } }),
  orderBy: (path: string, direction: string) => ({ orderBy: { path, direction } }),
  limit: (value: number) => ({ limit: value }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  Timestamp: { now: () => ({ seconds: 0 }), fromDate: (date: Date) => date },
  deleteField: () => '__deleteField',
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children, HeaderProps }: any) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  useConfirmationContext: () => ({ confirm: () => Promise.resolve(undefined) }),
  AppLink: ({ href, children, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
  MdiIcon: () => null,
}))

/** The site every create was made as, in order. */
const createdAs: string[] = []
jest.mock('../utils/create-email-screen', () => ({
  createEmailScreen: async (hostId: string) => {
    createdAs.push(hostId)
    return { screenId: 'scr_new', versionId: 'ver_new' }
  },
}))

import { EmailOrgMountProvider } from './email-org-mount'
import { OrgEmailTemplatesCard, orgTemplateSiteScope } from './org-email-templates-card'

const SITES = [
  { id: 'host-1', name: 'Store', subdomain: 'store' },
  { id: 'host-2', name: 'Blog', subdomain: 'blog' },
]

async function mount(hosts = SITES) {
  mockPush.mockClear()
  createdAs.length = 0
  readFor.clear()
  window.sessionStorage.clear()
  render(
    (
      <EmailOrgMountProvider
        mount={{
          orgId: 'org-1',
          orgSlug: 'acme',
          hosts,
          hostsReady: true,
          hostsPath: '/acme/hosts',
        }}
        basePath="/acme/emails"
      >
        <OrgEmailTemplatesCard />
      </EmailOrgMountProvider>
    ) as ReactNode as never,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const rowFor = (name: string) =>
  Array.from(document.querySelectorAll('[role="row"][data-id]')).find((row) =>
    row.textContent?.includes(name),
  ) as HTMLElement

beforeEach(() => {
  screensByHost = {
    'host-1': [
      stamped({
        $id: 'scr_1',
        displayName: 'Spring promo',
        kind: 'email',
        versionId: 'v1',
      }),
      // A page on the same site: the email scope is on the query.
      stamped({ $id: 'scr_home', displayName: 'Home', kind: 'page' }),
    ],
    'host-2': [
      stamped({
        $id: 'scr_1',
        displayName: 'Weekly digest',
        kind: 'email',
        versionId: 'v2',
      }),
      // Deleted: the delete cleared its name keys, so the order leaves it out.
      {
        $id: 'scr_gone',
        displayName: 'Deleted one',
        kind: 'email',
        deletedAt: { seconds: 1 },
      },
    ],
  }
})

describe('the organization’s templates', () => {
  it('lists every site’s templates, each named by its site', async () => {
    await mount()

    expect(rowFor('Spring promo').textContent).toContain('Store')
    expect(rowFor('Weekly digest').textContent).toContain('Blog')
    // A deleted template is not a row, on this list or a site's own.
    expect(screen.queryByText('Deleted one')).toBeNull()
    expect(screen.queryByText('Home')).toBeNull()
    expect(asked['host-1']).toEqual([{ path: 'kind', op: '==', value: 'email' }])
  })

  it('keeps two sites’ same-id screens apart', async () => {
    // Both sites hold a `scr_1`; a table keyed on the screen id alone would
    // draw one of them twice and lose the other.
    await mount()
    expect(rowFor('Spring promo')).toBeTruthy()
    expect(rowFor('Weekly digest')).toBeTruthy()
  })

  it('opens a template on its own site’s page', async () => {
    await mount()

    expect(
      screen.getByText('Weekly digest').closest('a')?.getAttribute('href'),
    ).toBe('/acme/hosts/blog/emails/templates/scr_1')
  })

  it('makes a new template as the chosen site, and opens that site’s besigner', async () => {
    await mount()
    fireEvent.click(screen.getByText('New template'))
    expect(createdAs).toHaveLength(0)

    fireEvent.mouseDown(screen.getByLabelText('Site'))
    fireEvent.click(screen.getByRole('option', { name: 'Blog' }))
    await act(async () => {
      fireEvent.click(screen.getByText('Create and open'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(createdAs).toEqual(['host-2'])
    expect(mockPush).toHaveBeenCalledWith(
      '/acme/hosts/blog/screens/scr_new/versions/ver_new/besigner',
    )
  })

  it('does not ask which site when the organization has one', async () => {
    await mount([SITES[0]])
    await act(async () => {
      fireEvent.click(screen.getByText('New template'))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(createdAs).toEqual(['host-1'])
    expect(screen.queryByText('Create and open')).toBeNull()
  })

  it('says when a site holds more templates than the list reads', async () => {
    screensByHost['host-1'] = Array.from({ length: 51 }, (_, index) =>
      stamped({
        $id: `scr_${index}`,
        displayName: `Template ${index}`,
        kind: 'email',
      }),
    )
    await mount()

    expect(screen.getByText(/Store has more than 50 templates/)).toBeTruthy()
    expect(
      screen
        .getByText('See all of its templates')
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/acme/hosts/store/emails/templates')
  })
})

describe('an organization with more sites than one page', () => {
  const MANY = Array.from({ length: 12 }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    return { id: `site-${n}`, name: `Site ${n}`, subdomain: `site-${n}` }
  })

  it('reads one page of sites, and the next page only when it is chosen', async () => {
    screensByHost = {
      'site-01': [stamped({ $id: 'a', displayName: 'First page', kind: 'email' })],
      'site-12': [stamped({ $id: 'b', displayName: 'Last page', kind: 'email' })],
    }
    await mount(MANY)

    expect(readFor.size).toBe(10)
    expect(readFor.has('site-12')).toBe(false)
    expect(rowFor('First page')).toBeTruthy()

    fireEvent.mouseDown(screen.getByLabelText('Sites'))
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Sites 11–12 of 12' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(readFor.has('site-12')).toBe(true)
    expect(rowFor('Last page')).toBeTruthy()
    expect(rowFor('First page')).toBeUndefined()
  })

  it('THE CONTROL: an organization within one page has no Sites filter', async () => {
    await mount()
    expect(screen.queryByLabelText('Sites')).toBeNull()
  })

  it('pages the templates themselves on the shared footer', async () => {
    screensByHost = {
      'host-1': Array.from({ length: 12 }, (_, index) =>
        stamped({
          $id: `scr_${index}`,
          displayName: `Template ${String(index).padStart(2, '0')}`,
          kind: 'email',
        }),
      ),
    }
    await mount()

    expect(rowFor('Template 00')).toBeTruthy()
    expect(rowFor('Template 11')).toBeUndefined()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next page/i }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(rowFor('Template 11')).toBeTruthy()
  })
})

describe('the organization’s templates filter on every site’s query (AGL-3321)', () => {
  it('puts the search word on each site’s query, not over the rows read', async () => {
    await mount()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'digest' } })
    await waitFor(() => {
      expect(rowFor('Weekly digest')).toBeTruthy()
      expect(rowFor('Spring promo')).toBeUndefined()
    })
    for (const hostId of ['host-1', 'host-2']) {
      expect(asked[hostId]).toEqual([
        { path: 'kind', op: '==', value: 'email' },
        { path: 'nameTokens', op: 'array-contains', value: 'digest' },
      ])
    }
  })
})

describe('the Site clause chooses which sites are read', () => {
  it('reads the sites a clause names', () => {
    expect(orgTemplateSiteScope([{ field: 'site', op: 'isAnyOf', value: 'a, b' }])).toEqual(['a', 'b'])
  })

  it('reads the sites every clause names, when there are several', () => {
    expect(
      orgTemplateSiteScope([
        { field: 'site', op: 'isAnyOf', value: 'a,b' },
        { field: 'site', op: 'equals', value: 'b' },
      ]),
    ).toEqual(['b'])
  })

  it('THE CONTROL: no Site clause reads the page of sites', () => {
    expect(orgTemplateSiteScope([{ field: 'displayName', op: 'contains', value: 'x' }])).toBeNull()
  })
})
