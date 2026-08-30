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
 * What the content surfaces COST, and what they are still allowed to answer.
 *
 * A spec written against rendered output cannot tell a paged list from a big
 * read sliced small: both put ten rows on screen, and only one of them bills
 * for two hundred documents to do it. A spec that asserts "the list renders"
 * cannot tell them apart either, and would go on passing if the cap crept back
 * to three hundred. So the meter sits at the Firestore boundary and records
 * every listen as `path#limit` — that limit is the billable ceiling, and a
 * listener re-registered under a new query identity is a new subscription.
 *
 * Four contracts, and the third is the one the ceiling exists to protect:
 *
 *  1. THE WINDOW IS THE QUERY. One page plus a single probe row, and the probe
 *     is what makes "there is more" a fact rather than a comparison against
 *     the cap. Paging forward widens by one page, not by a collection.
 *  2. THE WALK NAMES ITS ORDER, and orders on the document NAME. Ordering on
 *     `createdAt` would not mis-sort this list, it would HIDE from it every
 *     entry `/api/hosts/import` wrote — `cleanDoc` stamps `updatedAt` alone.
 *     Nothing re-sorts the page it was handed, either: rows in one order
 *     within a page and another across pages is the same lie an unordered cap
 *     tells.
 *  3. OPENING AN ENTRY DOES NOT DEPEND ON THE WINDOW. The entry the address
 *     names is read BY KEY, so an entry the current page does not hold still
 *     opens — mounted with the target deliberately off the page, which is the
 *     only version of this assertion that can fail.
 *  4. THE ADDRESS CHECK ASKS THE COLLECTION. A slug already taken by an entry
 *     off the page is still a collision, and a check run over the rows on
 *     screen would clear it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { TABLE_PAGE_SIZE_DEFAULT } from '../constants/shared'

/** One page and its probe row — the whole ceiling this suite defends. */
const WINDOW = TABLE_PAGE_SIZE_DEFAULT + 1

/**
 * ONE Firestore handle for the whole suite.
 *
 * Every listener's dependency list names it, so a factory that answered with
 * a fresh object would re-open every listen on every render — which is a
 * render loop, and a meter reading whatever the loop happened to reach.
 */
const FIRESTORE = {}
const mockUser = { data: { uid: 'uid-editor', getIdToken: jest.fn() } }
const ENTRIES_PATH = 'hosts/host-1/collections/col-1/entries'

/**
 * Every listen the tree opens.
 *
 * A COLLECTION listen is recorded as `path#limit`, because the limit is what
 * is billed; a DOCUMENT listen as its path, because one document is one
 * document. Module-scoped and `mock`-prefixed so the `jest.mock` factories may
 * close over them — jest's out-of-scope-variable guard admits that prefix.
 */
const mockListens: string[] = []
/** The query objects themselves, for the constraints they carry. */
const mockQueries: Array<Record<string, any>> = []

/** The collection under test, as many entries deep as a test wants. */
const mockEntryDocs: Array<Record<string, any>> = []
const mockCollections: Array<Record<string, any>> = []
const mockNav = {
  params: {} as { collectionSlug?: string; entryId?: string },
  pushed: [] as string[],
  replaced: [] as string[],
}

/**
 * `Entry 07`, `entry-07`, created SEVENTH.
 *
 * The stamps ascend with the ids, so a client `.sort()` by `createdAt desc`
 * and the id-ordered walk disagree about every row — which is what lets the
 * ordering assertion below distinguish them instead of passing on both.
 */
const entryAt = (index: number) => ({
  $id: `entry-${String(index).padStart(2, '0')}`,
  title: `Entry ${String(index).padStart(2, '0')}`,
  slug: `entry-${String(index).padStart(2, '0')}`,
  status: 'draft',
  body: `body ${index}`,
  createdAt: { seconds: index, toDate: () => new Date(index * 1000) },
})

const fillCollection = (count: number) => {
  mockEntryDocs.length = 0
  for (let index = 0; index < count; index += 1) {
    mockEntryDocs.push(entryAt(index))
  }
}

jest.mock('firebase/firestore', () => {
  const marker =
    (kind: string) =>
    (...args: unknown[]) => ({ __constraint: kind, args })
  /** The documents a path serves, before the query's own constraints. */
  const sourceFor = (path: string): Array<Record<string, any>> => {
    if (path === 'hosts/host-1/collections') return mockCollections
    if (path.endsWith('/entries')) {
      // Only the collection under test has entries; the placeholder path the
      // provider opens before the collections listener answers has none.
      return path === 'hosts/host-1/collections/col-1/entries'
        ? mockEntryDocs
        : []
    }
    return []
  }
  return {
    __esModule: true,
    collection: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
      type: 'collection',
      path: segments.join('/'),
    }),
    doc: (_db: unknown, ...segments: string[]) => ({
      __path: segments.join('/'),
      __doc: true,
      parent: { path: segments.slice(0, -1).join('/') },
    }),
    query: (base: { __path?: string }, ...constraints: any[]) => ({
      __path: base?.__path ?? '(unknown)',
      __constraints: constraints,
      __limit: Math.max(
        0,
        ...constraints
          .filter((item) => item?.__constraint === 'limit')
          .map((item) => Number(item.args[0])),
      ),
      type: 'query',
      path: base?.__path,
    }),
    limit: marker('limit'),
    where: marker('where'),
    orderBy: marker('orderBy'),
    documentId: () => '__name__',
    deleteField: () => '__delete__',
    setDoc: jest.fn(async () => undefined),
    updateDoc: jest.fn(async () => undefined),
    deleteDoc: jest.fn(async () => undefined),
    getDocsFromServer: async () => ({ docs: [] }),
    onSnapshot: (ref: any, _options: unknown, next: (snap: any) => void) => {
      const metadata = { fromCache: false, hasPendingWrites: false }
      if (ref?.__doc) {
        mockListens.push(ref.__path)
        const id = String(ref.__path).split('/').pop()
        const found = ref.__path.includes('/entries/')
          ? mockEntryDocs.find((entry) => entry.$id === id)
          : {}
        next({
          exists: () => Boolean(found),
          data: () => ({ ...(found ?? {}) }),
          id,
          metadata,
        })
        return () => undefined
      }
      mockListens.push(`${ref.__path}#${ref.__limit}`)
      mockQueries.push(ref)
      const wheres = (ref.__constraints ?? []).filter(
        (item: any) => item?.__constraint === 'where',
      )
      const rows = sourceFor(ref.__path)
        .filter((row) =>
          wheres.every((item: any) => {
            const [field, , value] = item.args
            return row[field] === value
          }),
        )
        // Document-ID order is what Firestore answers an `orderBy(__name__)`
        // walk in, and the ids here are already in it.
        .slice(0, ref.__limit || undefined)
      next({
        docs: rows.map((row) => ({ id: row.$id, data: () => ({ ...row }) })),
        metadata,
      })
      return () => undefined
    },
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => ({
  // The REAL hooks — `usePagedCollection`, `collectionPage`,
  // `useFirestoreCollection`, `useFirestoreDoc` and the seed guard. A
  // re-implemented paging hook would make every number below an assertion
  // about this file rather than about the query the console issues.
  ...jest.requireActual('@aglyn/tenant-feature-instance'),
  useFirestore: () => FIRESTORE,
  useUser: () => mockUser,
  useHostResourceApi: () => jest.fn(async () => ({ id: 'created-id' })),
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: {
    now: () => ({ seconds: 999_999 }),
    fromDate: (date: Date) => ({ seconds: Math.floor(date.getTime() / 1000) }),
  },
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  GridItems: ({ items }: { items: Array<{ children: ReactNode }> }) => (
    <div>
      {items.map((item, index) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
  AppLink: ({ children, href }: { children?: unknown; href?: string }) => (
    <a href={href}>{children as never}</a>
  ),
  HelpTip: () => null,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(true),
  }),
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({
    children,
    header,
    headerRight,
  }: {
    children?: ReactNode
    header?: { children?: ReactNode }
    headerRight?: ReactNode
  }) => (
    <div>
      <h1>{header?.children}</h1>
      {headerRight}
      {children}
    </div>
  ),
}))
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/host-display-name.component', () => nullCard)
jest.mock('../components/media/media-picker-dialog.component', () => nullCard)
/*
  Both read live data of their own — day counters, the workspace's plugins —
  and neither is what this suite meters. Stubbed so their reads cannot be
  mistaken for the two this file is about.
*/
jest.mock(
  '../components/analytics/entry-analytics-card.component',
  () => nullCard,
)
jest.mock('../components/plugin-widget-slot.component', () => nullCard)
jest.mock('@aglyn/aglyn-markdown-editor', () => ({
  __esModule: true,
  MarkdownEditorToolbar: () => null,
  MarkdownVisualEditor: () => null,
  MARKDOWN_SOURCE_HINT: '',
  applyCommandToSource: (body: string, start: number, end: number) => ({
    body,
    start,
    end,
  }),
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' }, orgId: 'org-1', ready: true }),
}))
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  default: () => ({
    branding: { productName: 'Aglyn' },
    whiteLabel: false,
    ready: true,
  }),
}))
jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ ...mockNav.params }),
  useRouter: () => ({
    push: (url: string) => mockNav.pushed.push(url),
    replace: (url: string) => mockNav.replaced.push(url),
  }),
  usePathname: () => '/acme/hosts/shop/content',
}))

/** `require` after the mocks — the modules must see every factory. */
const {
  ContentScopeProvider,
} = require('../components/content/content-scope.context')
const CollectionEntriesPage =
  require('../components/content/collection-entries-page.component').default
const EntryDetailPage =
  require('../components/content/entry-detail-page.component').default

const List = () => (
  <ContentScopeProvider>
    <CollectionEntriesPage />
  </ContentScopeProvider>
)
const Detail = () => (
  <ContentScopeProvider>
    <EntryDetailPage />
  </ContentScopeProvider>
)

/** Every listen against the collection under test, deduped. */
const entriesListens = () => [
  ...new Set(mockListens.filter((listen) => listen.startsWith(ENTRIES_PATH))),
]
/** The ceilings those listens carried, largest first. */
const entriesCeilings = () =>
  entriesListens()
    .filter((listen) => listen.includes('#'))
    .map((listen) => Number(listen.split('#')[1]))
    .sort((a, b) => b - a)

/** The titles the entries table is showing, in the order it shows them. */
const renderedTitles = () =>
  screen
    .getAllByText(/^Entry \d\d$/)
    .map((node) => node.textContent ?? '')

beforeEach(() => {
  jest.clearAllMocks()
  mockListens.length = 0
  mockQueries.length = 0
  mockNav.params = { collectionSlug: 'blog' }
  mockNav.pushed = []
  mockNav.replaced = []
  mockCollections.length = 0
  mockCollections.push({
    $id: 'col-1',
    displayName: 'Blog',
    slug: 'blog',
    kind: 'content',
  })
  fillCollection(25)
})

describe('the entries window IS the query', () => {
  it('THE CONTROL: the meter records the ceiling a listen carries', () => {
    // Guard the guard. A meter that recorded no limit would make every
    // number below vacuously equal to every other.
    render(<List />)
    expect(entriesListens().length).toBeGreaterThan(0)
    expect(entriesCeilings().every((ceiling) => ceiling > 0)).toBe(true)
  })

  it('reads ONE page and a probe row, and nothing wider', () => {
    render(<List />)

    // The number, not "some cap": eleven is ten rows and the one document
    // that turns "there is more" into a fact. A read of 200 sliced to 10
    // renders identically and costs eighteen times as much.
    expect(entriesListens()).toContain(`${ENTRIES_PATH}#${WINDOW}`)
    expect(Math.max(...entriesCeilings())).toBe(WINDOW)
    expect(WINDOW).toBe(11)
  })

  it('draws exactly that page, and says there is more without counting', () => {
    render(<List />)

    expect(renderedTitles()).toHaveLength(TABLE_PAGE_SIZE_DEFAULT)
    expect(screen.queryByText('Entry 10')).toBeNull()
    // Nobody has paid to learn the total, so the footer does not claim one.
    expect(screen.getByText(/1–10 of more than 10/)).toBeTruthy()
  })

  it('paging forward widens by ONE page, not by the collection', () => {
    render(<List />)

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))

    // Page one is covered as well as page two — a live listener cannot resume
    // from a page it never read — so the window is 2 x 10 + the probe.
    expect(entriesListens()).toContain(
      `${ENTRIES_PATH}#${TABLE_PAGE_SIZE_DEFAULT * 2 + 1}`,
    )
    expect(Math.max(...entriesCeilings())).toBe(TABLE_PAGE_SIZE_DEFAULT * 2 + 1)
    expect(renderedTitles()[0]).toBe('Entry 10')
  })

  it('states the real total on the LAST page, where it is known', () => {
    fillCollection(15)
    render(<List />)

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))

    // `page x size + rows` IS the total once the probe comes back empty, and
    // handing MUI the real number is what disables Next.
    expect(screen.getByText('11–15 of 15')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: /next page/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe('the walk names its order, and nothing re-sorts the page', () => {
  it('orders on the document NAME, never on a field a writer may omit', () => {
    render(<List />)

    const walk = mockQueries.find(
      (item) => item.__path === ENTRIES_PATH && item.__limit === WINDOW,
    )
    const orderings = (walk?.__constraints ?? [])
      .filter((item: any) => item?.__constraint === 'orderBy')
      .map((item: any) => item.args[0])
    expect(orderings).toEqual(['__name__'])
    // The field this list reads by, and the one that would hide every
    // imported entry: `cleanDoc` stamps `updatedAt` alone.
    expect(orderings).not.toContain('createdAt')
  })

  it('renders the page in the order it was read', () => {
    render(<List />)

    // The stamps ascend with the ids, so a `createdAt desc` sort in the
    // browser would put `Entry 09` first. Id order puts `Entry 00` first,
    // and only one of the two can be true of a walk that pages.
    expect(renderedTitles()).toEqual([
      'Entry 00',
      'Entry 01',
      'Entry 02',
      'Entry 03',
      'Entry 04',
      'Entry 05',
      'Entry 06',
      'Entry 07',
      'Entry 08',
      'Entry 09',
    ])
  })
})

describe('opening an entry does not depend on the list window', () => {
  /** An entry deliberately BEYOND the page the list is holding. */
  const OFF_PAGE = 'entry-24'

  it('resolves an entry the current page does not hold', async () => {
    mockNav.params = { collectionSlug: 'blog', entryId: OFF_PAGE }
    render(<Detail />)

    // Seeded from the entry's OWN document. Resolved out of the list, this
    // is `undefined` and the page draws "Entry not found" over a live post.
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Title') as HTMLInputElement).value,
      ).toBe('Entry 24'),
    )
    expect(screen.queryByText(/not in this collection/i)).toBeNull()
  })

  it('pays for ONE document to do it', async () => {
    mockNav.params = { collectionSlug: 'blog', entryId: OFF_PAGE }
    render(<Detail />)
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy())

    expect(mockListens).toContain(`${ENTRIES_PATH}/${OFF_PAGE}`)
    // And the window it was NOT found in is not widened to go looking: the
    // "read further until the entry turns up" fix bills the whole cap on
    // every mount and is still wrong past it.
    expect(Math.max(...entriesCeilings())).toBeLessThanOrEqual(WINDOW)
  })

  it('costs the same for the tenth entry opened as for the first', async () => {
    mockNav.params = { collectionSlug: 'blog', entryId: 'entry-00' }
    const { unmount } = render(<Detail />)
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy())
    const first = [...new Set(mockListens)].sort()
    unmount()

    mockListens.length = 0
    mockNav.params = { collectionSlug: 'blog', entryId: OFF_PAGE }
    render(<Detail />)
    await waitFor(() => expect(screen.getByLabelText('Title')).toBeTruthy())

    // The same shape of read, one path apart — no page walked to find it.
    expect([...new Set(mockListens)].sort().length).toBe(first.length)
  })
})

describe('the address check asks the COLLECTION, not the page', () => {
  it('refuses a slug an off-page entry already publishes at', async () => {
    mockNav.params = { collectionSlug: 'blog', entryId: 'entry-00' }
    render(<Detail />)
    await waitFor(() => expect(screen.getByLabelText('Slug')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Slug'), {
      // Owned by `entry-24`, which the list's page does not hold. A check run
      // over the rows on screen clears this address as free.
      target: { value: 'entry-24' },
    })

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    )
    expect(screen.getByText(/Already used by "Entry 24"/)).toBeTruthy()
  })

  it('asks it with a KEYED query capped at two documents', async () => {
    mockNav.params = { collectionSlug: 'blog', entryId: 'entry-00' }
    render(<Detail />)
    await waitFor(() => expect(screen.getByLabelText('Slug')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'entry-24' },
    })

    await waitFor(() =>
      expect(
        mockQueries.some((item) =>
          (item.__constraints ?? []).some(
            (constraint: any) =>
              constraint?.__constraint === 'where' &&
              constraint.args[0] === 'slug' &&
              constraint.args[2] === 'entry-24',
          ),
        ),
      ).toBe(true),
    )
    const probe = mockQueries.filter((item) =>
      (item.__constraints ?? []).some(
        (constraint: any) => constraint?.__constraint === 'where',
      ),
    )
    // The entry being edited, which may already own the address, plus
    // whichever other entry holds it. Nothing else has to be read.
    expect(probe.map((item) => item.__limit)).toEqual(
      probe.map(() => 2),
    )
    // And it did not answer the question by widening the list instead.
    expect(Math.max(...entriesCeilings())).toBeLessThanOrEqual(WINDOW)
  })
})
