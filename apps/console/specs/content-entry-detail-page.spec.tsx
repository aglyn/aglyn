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
 * A collection entry opens a DETAIL PAGE, not a dialog (AGL-2498).
 *
 * The difference is not cosmetic. A dialog has no address, so it cannot be
 * linked, bookmarked or sent to a colleague; Back closes it and loses the
 * context; and it constrains the layout, which is what exiles the publication
 * controls to the list row's overflow menu.
 *
 * ## What these assert, and why each one is here
 *
 * Three properties, and the third is the one that makes the other two safe:
 *
 * 1. **It is a page.** The editor is not inside a `role="dialog"`, and the
 *    list is not behind it — the two are alternatives.
 * 2. **It has an address.** Opening pushes
 *    `…/content/{collectionId}/entries/{entryId}`, a pasted link opens
 *    straight into the entry, and Back means back. Both halves are PATH
 *    SEGMENTS since the second pass — an entry is addressed
 *    `collection + entry`, and while one half lived in the query there was no
 *    single string that named an entry.
 * 3. **Leaving is guarded.** The dialog's `onClose` was a bare
 *    `setEditor(null)` — no dirty tracking, no confirmation. On a routed page
 *    that omission gets WORSE rather than staying neutral, because Back is
 *    far easier to press than a dialog is to dismiss. So the address and the
 *    guard are tested together: an address without a guard is a new way to
 *    lose a post, and a suite that only proved the address would call that
 *    shipped.
 *
 * Plus the AGL-471 plan gate, because this issue MOVED the surface it lives
 * on: `orgReady` is consulted BEFORE `hasEntitlement`, since `hasEntitlement`
 * on an undefined org answers NO and would tell a paying Business org, during
 * its own loading window, that it lacks the feature it pays for.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUpdateDoc = jest.fn().mockResolvedValue(undefined)
const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()
/** Resolved value of the confirmation dialog — per test. */
const mockConfirm = jest.fn().mockResolvedValue(true)

const PUBLISHED_AT_SECONDS = 1_600_000_000

/**
 * The address bar, as the component sees it.
 *
 * Since AGL-2498's second pass BOTH halves of an entry's address are path
 * segments — `…/content/{collectionId}/entries/{entryId}` — so `params` is
 * what `useParams` answers with and `search` is what is left in the query.
 * `push`/`replace` record without applying, which is what makes a click and a
 * browser Back distinguishable here: a click goes through the component
 * (which claims the segment it wrote), a Back is this object being changed
 * underneath it and the tree re-rendered.
 */
const mockNav = {
  params: {} as { collectionSlug?: string; entryId?: string },
  search: '',
  pushed: [] as string[],
  replaced: [] as string[],
}

const mockOrg = {
  org: undefined as Record<string, unknown> | undefined,
  ready: false,
}

/**
 * The site's content collections.
 *
 * A mutable module value rather than a literal inside the hook mock, because
 * AGL-2498 made the collection an ADDRESS: a test that navigates between two
 * of them needs there to be two.
 */
const mockCollections: Array<Record<string, unknown>> = []

const mockEntries = {
  data: [
    {
      $id: 'entry-1',
      title: 'Hello world',
      slug: 'hello-world',
      status: 'published',
      body: 'the stored body',
      excerpt: 'the stored excerpt',
      publishedAt: {
        seconds: PUBLISHED_AT_SECONDS,
        toDate: () => new Date(PUBLISHED_AT_SECONDS * 1000),
      },
      updatedAt: { seconds: 1_700_000_000, toDate: () => new Date() },
    },
    {
      $id: 'entry-2',
      title: 'Never published',
      slug: 'never-published',
      status: 'draft',
    },
  ] as Array<Record<string, unknown>>,
  status: 'success' as 'success' | 'error' | 'loading',
  fromCache: false,
}

jest.mock('@aglyn/aglyn', () => ({
  // A wholesale barrel mock is a CLOSED WORLD — anything the page calls and
  // this object does not name throws inside a handler, and a spec that never
  // asserted the write would go green over the wreckage.
  hostPublicOrigin: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/host-naming',
  ).hostPublicOrigin,
  // The REAL entitlement check, not a stub (AGL-471). Stubbing it true would
  // leave the ordering case below asserting a gate it never runs.
  checkEntitlement: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/plan-entitlements',
  ).checkEntitlement,
  isHostCollectionKind: () => () => true,
  COLLECTION_CATEGORIES_MAX: 20,
  findCollectionSlugOwner: () => null,
  // The REAL rule, not a stub (AGL-2498). The slug is authored now, so a
  // collision is reachable on purpose — and a stub returning `null` would
  // leave every suite asserting a Save button that a real duplicate disables.
  findEntrySlugOwner: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-slug',
  ).findEntrySlugOwner,
  collectionDeleteDenial: () => null,
  collectionTemplateBindings: () => [],
  mediaNodeSrc: () => '',
  createResourceUid: () => 'entry-new',
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/content-authors',
  ),
  HostEntityType: jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/platform.types',
  ).HostEntityType,
  resolveMediaSrc: () => '',
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: {
    now: () => ({ seconds: 999_999, __stampedNow: true }),
    fromDate: (date: Date) => ({
      seconds: Math.floor(date.getTime() / 1000),
    }),
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  // The slug-uniqueness probe asks the collection by KEY rather than
  // searching the page it is holding. Constraints are erased here, so the
  // probe reads back every mock entry and the real rule filters them.
  where: () => undefined,
  // A PATH, because the entry editor now reads its entry BY KEY — the hook
  // mock below answers on it.
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  deleteDoc: jest.fn(),
  deleteField: () => '__delete__',
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  /*
    The entries WINDOW. `usePagedCollection` asks the builder for one page
    plus a probe row and hands back the page; this stands in for it so the
    suite can keep naming the collection it wants without a live listener.
  */
  usePagedCollection: (build: (pageLimit: number) => string) => ({
    rows: build(11) === 'entries' ? mockEntries.data : [],
    hasMore: false,
    page: 0,
    setPage: () => undefined,
    pageSize: 10,
    setPageSize: () => undefined,
    status: mockEntries.status,
    fromCache: mockEntries.fromCache,
  }),
  // The ordering the window is read in. This mock erases query constraints
  // anyway, so the builder is the identity here; the read-cost suite is where
  // the `orderBy` it carries is asserted.
  collectionPage: (ref: unknown) => ref,
  useHostResourceApi: () => jest.fn(async () => ({ id: 'created-id' })),
  useUser: () => ({ data: { uid: 'uid-editor', getIdToken: jest.fn() } }),
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
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
  // The entry detail header's "View on site" control (AGL-2498). An anchor,
  // so the suites can still find every BUTTON by role without it.
  AppLink: ({ children, href }: { children?: unknown; href?: string }) => (
    <a href={href}>{children as never}</a>
  ),
  HelpTip: () => null,
  MdiIcon: () => null,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }

/**
 * The layout renders `headerRight` beside its children, because the "Back to
 * entries" control and the unsaved-changes marker both live there. A mock
 * that dropped it would hide the exit this suite is about.
 */
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
      {/* The HEADING as well as the actions (AGL-2498). The detail page's
          loading and not-found states say what they are in the header, so a
          mock that dropped it would hide the very states the split exists to
          make possible. */}
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
  The two panels AGL-2498 added to the entry detail page. Both read live data
  of their own — the traffic card walks day-counter documents, the activity
  slot resolves the workspace's plugins — and neither is what any of these
  suites is about. Stubbed to nothing so a change to either cannot redden a
  spec about publication dates.
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
  default: () => ({ org: mockOrg.org, ready: mockOrg.ready }),
}))
jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  default: () => ({
    branding: { productName: 'Northwind' },
    whiteLabel: true,
    ready: true,
  }),
}))
jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: (build: () => string) => {
    const name = build()
    if (name === 'entries') {
      return {
        data: mockEntries.data,
        status: mockEntries.status,
        fromCache: mockEntries.fromCache,
      }
    }
    if (name === 'collections') {
      return { data: mockCollections, status: 'success', fromCache: false }
    }
    return { data: [], status: 'success', fromCache: false }
  },
}))
/**
 * The host document AND the open ENTRY, told apart by path.
 *
 * The editor reads its entry by key, so this hook is the entry's seed — and
 * therefore the read `writeGuardedBySeed` is consulted about. Answering every
 * ref with one blank object would leave the guard asserting nothing and the
 * editor seeded from a document that does not exist.
 */
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: (build: () => { __path?: string } | null) => {
    const path = build()?.__path ?? ""
    if (path.includes("/entries/")) {
      const id = path.split("/").pop()
      return {
        data: mockEntries.data.find((entry: any) => entry.$id === id),
        status: mockEntries.status,
        fromCache: mockEntries.fromCache,
      }
    }
    return { data: {}, status: 'success', fromCache: false }
  },
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
/**
 * A LIVE address, not a constant.
 *
 * `useParams` reads `mockNav.params` on every render and `push` rewrites it,
 * so the two ways into the editor stay distinguishable: a click goes through
 * the component, while a Back is `mockNav.params` being changed and the tree
 * re-rendered. A frozen `{}` — what the older content specs use — cannot tell
 * those apart, and would pass whether or not the URL was wired to anything.
 *
 * `usePathname` is still mocked because a stray call must not throw; the page
 * itself stopped reading it when the address moved into the path (AGL-2498).
 */
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockNav.search),
  /**
   * A NEW object per call, like the real hook — which is what makes the URL
   * sync's dependency list load-bearing rather than cosmetic. `useRouter` and
   * `useConfirmationContext` do the same.
   */
  useParams: () => ({ ...mockNav.params }),
  useRouter: () => ({
    /**
     * ⚠️ Neither `push` nor `replace` APPLIES the address, because the real
     * ones do not either: App Router starts a transition and `useParams`
     * reports the new value on a LATER render. The window in between — editor
     * open, address not yet caught up — is exactly where the URL sync can be
     * made to close the editor it just opened, so a mock that applied the
     * push synchronously would paper over that whole class of bug.
     * `settleNavigation` below is what ends the transition.
     */
    push: (url: string) => {
      mockNav.pushed.push(url)
    },
    replace: (url: string) => {
      mockNav.replaced.push(url)
    },
  }),
  usePathname: () => '/acme/hosts/shop/content',
}))

/**
 * `require` after the mocks, not a top-level `import`: the modules must be
 * evaluated only once every `jest.mock` above is registered.
 */
const { ContentScopeProvider } = require('../components/content/content-scope.context')
const CollectionEntriesPage =
  require('../components/content/collection-entries-page.component').default
const EntryDetailPage =
  require('../components/content/entry-detail-page.component').default

/**
 * The two pages, each inside the REAL scope provider.
 *
 * They are two components now, and that is the property this suite mostly
 * exists to hold. The provider is not stubbed because it owns the address
 * rewrite, the entries listener and the shared entry actions — a stubbed scope
 * would leave every address assertion below testing a fixture.
 */
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

beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockResolvedValue(true)
  mockEntries.status = 'success'
  mockEntries.fromCache = false
  mockEntries.data = [
    {
      $id: 'entry-1',
      title: 'Hello world',
      slug: 'hello-world',
      status: 'published',
      body: 'the stored body',
      excerpt: 'the stored excerpt',
      publishedAt: {
        seconds: PUBLISHED_AT_SECONDS,
        toDate: () => new Date(PUBLISHED_AT_SECONDS * 1000),
      },
      updatedAt: { seconds: 1_700_000_000, toDate: () => new Date() },
    },
    {
      $id: 'entry-2',
      title: 'Never published',
      slug: 'never-published',
      status: 'draft',
    },
  ]
  // Every test starts ON the collection, which is where the rewrite puts a
  // reader who arrives at bare `/content`. The rewrite itself has its own
  // tests below, and those start with an empty `params`.
  mockCollections.length = 0
  mockCollections.push({
    $id: 'col-1',
    displayName: 'Blog',
    slug: 'blog',
    kind: 'content',
  })
  mockNav.params = { collectionSlug: 'blog' }
  mockNav.search = ''
  mockNav.pushed = []
  mockNav.replaced = []
  // Business + ready is the ordinary case; the gate cases below set their own.
  mockOrg.org = { plan: 'business' }
  mockOrg.ready = true
})

/** The title field only exists on the entry detail page. */
const titleField = () => screen.queryByLabelText('Title')

/** Opens an entry by clicking its row, the way the list does. */
const openByRow = (title: string) => fireEvent.click(screen.getByText(title))

/**
 * A URL string → the two route params and the query the pages read.
 *
 * The regex mirrors the two real routes:
 * `…/content/{collectionSlug}` and
 * `…/content/{collectionSlug}/entries/{entryId}`.
 */
const addressOf = (url: string) => {
  const [path, query = ''] = url.split('?')
  const match = /\/content(?:\/([^/]+))?(?:\/entries\/([^/]+))?\/?$/.exec(path)
  return {
    params: {
      ...(match?.[1] ? { collectionSlug: match[1] } : {}),
      ...(match?.[2] ? { entryId: match[2] } : {}),
    },
    search: query,
  }
}

/** Puts an address in the bar without rendering anything. */
const at = (url: string) => {
  const next = addressOf(url)
  mockNav.params = next.params
  mockNav.search = next.search
}

/** The address the app last asked for. */
const lastPushed = () => mockNav.pushed[mockNav.pushed.length - 1]
/** The address the app last rewrote to. */
const lastReplaced = () => mockNav.replaced[mockNav.replaced.length - 1]

/** The `datetime-local` value shape, in LOCAL time like the input's own. */
const localValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

describe('the entry detail is its OWN route (AGL-2498)', () => {
  /**
   * The defect this split exists to remove, asserted directly: the collection
   * page flashing before the entry page appears.
   *
   * With the two screens in one component, the detail cannot render until its
   * buffer is seeded from the entries listener — so on a cold load the
   * component renders the only thing it can render meanwhile, which is the
   * list. `mockEntries.data = []` is exactly that moment.
   */
  it('shows its OWN loading state, never the list, before the entry arrives', () => {
    // The listener has not ANSWERED — which is a different state from having
    // answered with nothing, and the page has to tell them apart or a slow
    // read reads as a deleted post. See the "not there" case below.
    mockEntries.data = []
    mockEntries.status = 'loading'
    at('/acme/hosts/shop/content/blog/entries/entry-1')

    render(<Detail />)

    // Not the list. This is the flash.
    expect(screen.queryByText('Never published')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    // Its own chrome instead, saying what it is doing.
    expect(screen.getByText(/Loading entry/)).toBeTruthy()
  })

  it('fills in once the entry arrives, without a blank editor in between', () => {
    // Seeding an empty buffer while the listener is still out is how a pasted
    // link opens an editor that never fills — and an empty buffer over a real
    // entry is one Save away from blanking the post.
    mockEntries.data = []
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    const { rerender } = render(<Detail />)
    expect(titleField()).toBeNull()

    mockEntries.data = [
      { $id: 'entry-1', title: 'Hello world', slug: 'hello-world' },
    ]
    rerender(<Detail />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
  })

  it('says so plainly when the address names an entry that is not there', () => {
    // A deleted entry, or a link naming an entry from another collection.
    // "Loading" forever would be the wrong answer once the listener HAS
    // answered — the two states are distinct and both are honest.
    mockEntries.data = []
    mockEntries.status = 'success'
    at('/acme/hosts/shop/content/blog/entries/gone')

    render(<Detail />)

    expect(screen.getByText('Entry not found')).toBeTruthy()
  })

  it('opens straight into the entry when the address already names one', () => {
    // The pasted-link case, and the reason the addressing is worth having.
    at('/acme/hosts/shop/content/blog/entries/entry-1')

    render(<Detail />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
    expect((screen.getByLabelText('Excerpt') as HTMLInputElement).value).toBe(
      'the stored excerpt',
    )
    // It is a PAGE, not a dialog: `role="dialog"` is what MUI's Dialog
    // announces itself as, so a revert to the old container reddens here.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('leaves a CLEAN editor without asking anything', async () => {
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)

    fireEvent.click(screen.getByRole('button', { name: /Back to entries/ }))

    await waitFor(() => expect(lastPushed()).toBe('/acme/hosts/shop/content/blog'))
    expect(mockConfirm).not.toHaveBeenCalled()
  })

  it('asks before dropping unsaved edits, and NO keeps them', async () => {
    mockConfirm.mockResolvedValue(false)
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Back to entries/ }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    // Still here, still carrying what was typed. A guard that asked and then
    // left anyway is worse than no guard: it looks like it protected you.
    expect((titleField() as HTMLInputElement).value).toBe(
      'Hello world, rewritten',
    )
    expect(mockNav.pushed).toEqual([])
  })

  it('treats a SAVED entry as clean, and returns to its COLLECTION', async () => {
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    // Nothing was asked: the changes are stored, so "discard unsaved changes?"
    // would be a question about nothing — and worse, `beforeunload` would go
    // on blocking the tab over them.
    expect(mockConfirm).not.toHaveBeenCalled()
    // The COLLECTION, not bare `/content`: leaving an entry must not also
    // change which collection you are looking at.
    expect(lastPushed()).toBe('/acme/hosts/shop/content/blog')
  })

  it('schedules from the detail page, still writing publishAt', async () => {
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)

    fireEvent.click(screen.getByRole('button', { name: /^Schedule/ }))
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    future.setSeconds(0, 0)
    fireEvent.change(screen.getByLabelText('Publish at'), {
      target: { value: localValue(future) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    // `publishAt`, the DEFERRED field — one letter from `publishedAt`, which
    // is when the entry SAYS it went out.
    expect(Object.keys(payload).sort()).toEqual(['publishAt', 'status'])
    expect(payload.status).toBe('scheduled')
  })

  describe('the plan gate keeps its order across the move (AGL-471)', () => {
    it('says "checking" — not "upgrade" — while the org is still loading', async () => {
      // `hasEntitlement` on an undefined org answers NO. Testing `orgReady`
      // second would therefore tell a paying Business org, during its own
      // loading window, that it does not have the feature it pays for.
      mockOrg.org = undefined
      mockOrg.ready = false
      at('/acme/hosts/shop/content/blog/entries/entry-1')
      render(<Detail />)

      fireEvent.click(screen.getByRole('button', { name: /^Schedule/ }))
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      future.setSeconds(0, 0)
      fireEvent.change(screen.getByLabelText('Publish at'), {
        target: { value: localValue(future) },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

      await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
      const [message] = mockEnqueueSnackbar.mock.calls[0]
      expect(message).toMatch(/Checking your plan/)
      expect(message).not.toMatch(/Business/)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('refuses a Free org once the plan is actually known', async () => {
      mockOrg.org = { plan: 'free' }
      mockOrg.ready = true
      at('/acme/hosts/shop/content/blog/entries/entry-1')
      render(<Detail />)

      fireEvent.click(screen.getByRole('button', { name: /^Schedule/ }))
      const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      future.setSeconds(0, 0)
      fireEvent.change(screen.getByLabelText('Publish at'), {
        target: { value: localValue(future) },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

      await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
      const [message] = mockEnqueueSnackbar.mock.calls[0]
      expect(message).toMatch(/Business plan/)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })
})

/**
 * The entry's address segment is AUTHORED (AGL-2498).
 *
 * A derived slug is two wrongs in one: there is no way to choose an address,
 * and `slug: slugify(title)` on every save silently MOVES a published post
 * whenever its headline is edited — 404-ing every inbound link with nothing
 * in the console to say so.
 */
describe('an entry slug can be overridden (AGL-2498)', () => {
  it('writes the AUTHORED slug rather than one derived from the title', async () => {
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)

    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'a-shorter-address' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockSetDoc.mock.calls[0]
    expect(payload.slug).toBe('a-shorter-address')
  })

  it('slugifies what was typed rather than storing it raw', async () => {
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)

    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'Hello There!! ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    expect(mockSetDoc.mock.calls[0][1].slug).toBe('hello-there')
  })

  it('does NOT move a published entry address when its title is edited', async () => {
    // The regression this field exists to stop. `entry-1` is published.
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe(
      'hello-world',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    expect(mockSetDoc.mock.calls[0][1].slug).toBe('hello-world')
  })

  it('DOES follow the title while the entry is still a draft', async () => {
    // An unpublished address is not in the wild, so following the title is
    // the helpful default — and the only way a new post gets a slug at all
    // without anybody typing one.
    at('/acme/hosts/shop/content/blog/entries/entry-2')
    render(<Detail />)

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'A brand new headline' },
    })

    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe(
      'a-brand-new-headline',
    )
  })

  it('stops following the title once the slug has been touched', async () => {
    at('/acme/hosts/shop/content/blog/entries/entry-2')
    render(<Detail />)

    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'chosen-by-hand' },
    })
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'A completely different headline' },
    })

    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe(
      'chosen-by-hand',
    )
  })

  it('REFUSES a slug another entry in the collection already serves', async () => {
    // The tenant resolves an entry with `where('slug','==',…)` and takes the
    // first match, so a duplicate makes one of the two simply unreachable.
    at('/acme/hosts/shop/content/blog/entries/entry-1')
    render(<Detail />)

    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'never-published' },
    })

    // Disabled rather than refused on click: the collision is visible while
    // it is being typed, not after the author has committed to it.
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(mockSetDoc).not.toHaveBeenCalled()
  })
})

describe('the collection list addresses its entries (AGL-2498)', () => {
  it('gives the entry an ADDRESS that names BOTH halves of it', () => {
    // The collection AND the entry, both as path segments. It was
    // `/content?entry=entry-1`, which says which entry but not which
    // collection — the collection rode along in a SECOND query parameter that
    // any link rebuild could drop.
    render(<List />)

    openByRow('Hello world')

    expect(mockNav.pushed).toEqual([
      '/acme/hosts/shop/content/blog/entries/entry-1',
    ])
  })

  it('addresses the collection by SLUG, not by document id', () => {
    // Collection document ids are not uniform — seeded ones were given
    // readable ids and everything created since gets a uid — so routing by id
    // put `/content/changelog` beside `/content/QgXv7lU_rG` on one site.
    at('/acme/hosts/shop/content/col-1')

    render(<List />)

    expect(lastReplaced()).toBe('/acme/hosts/shop/content/blog')
  })

  it('rewrites a legacy ?collection= deep link onto the routed address', () => {
    // AGL-845's DAM "Used on" links carry a document id in a query parameter,
    // and they are in the wild. They keep working — by being REWRITTEN, so the
    // address the reader ends up with is one they can send on.
    mockNav.params = {}
    mockNav.search = '?collection=col-1'

    render(<List />)

    expect(mockNav.replaced).toEqual(['/acme/hosts/shop/content/blog'])
  })

  it('rewrites a legacy ?entry= link straight into the entry', () => {
    // Both legacy parameters at once — the shape a bookmark of the old editor
    // has. The rewrite must carry the entry too, or a saved link to a post
    // silently degrades into a link to its list.
    mockNav.params = {}
    mockNav.search = '?collection=col-1&entry=entry-1'

    render(<List />)

    expect(mockNav.replaced).toEqual([
      '/acme/hosts/shop/content/blog/entries/entry-1',
    ])
  })

  it('carries ?tab= through the rewrite but never the legacy pair', () => {
    // `?tab=` is HubTabs' own mirroring and has to survive. `?collection=` and
    // `?entry=` must NOT: they are the address that moved into the path, and
    // carrying them forward would leave two answers to "which collection is
    // open" in one URL with nothing to say which wins.
    mockNav.params = {}
    mockNav.search = '?tab=authors&collection=col-1'

    render(<List />)

    expect(mockNav.replaced).toEqual([
      '/acme/hosts/shop/content/blog?tab=authors',
    ])
  })

  it('rewrites an address naming a collection that no longer exists', () => {
    // Left alone, `selected` falls back to the first collection and the
    // address then NAMES one collection while the page SHOWS another — and the
    // next save writes to the one on screen.
    at('/acme/hosts/shop/content/gone')

    render(<List />)

    expect(lastReplaced()).toBe('/acme/hosts/shop/content/blog')
  })

  it('leaves a settled address alone', () => {
    // The guard against the opposite failure: a rewrite that fires on an
    // address already in the routed form is a `replace` per render, at the
    // exact moment the router is mid-navigation.
    render(<List />)

    expect(mockNav.replaced).toEqual([])
  })

  it('navigates when the collection Select is changed', () => {
    // Which collection is open is the page's ADDRESS, not a piece of component
    // state — so choosing one goes through the router and can be linked,
    // bookmarked, reloaded and gone Back out of.
    mockCollections.push({
      $id: 'col-2',
      displayName: 'Changelog',
      slug: 'changelog',
      kind: 'content',
    })
    render(<List />)

    // MUI's `TextField select` is a listbox behind a combobox, not a native
    // `<select>`, so it is DRIVEN rather than assigned to — `fireEvent.change`
    // on it throws "does not have a value setter".
    fireEvent.mouseDown(screen.getByLabelText('Collection'))
    fireEvent.click(screen.getByRole('option', { name: /Changelog/ }))

    expect(lastPushed()).toBe('/acme/hosts/shop/content/changelog')
  })
})
