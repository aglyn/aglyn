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
 * Saving a content entry must go through `writeGuardedBySeed`, and be refused
 * under all THREE of its signals (AGL-1449).
 *
 * This handler hand-rolled the guard, and picked the weakest signal to
 * hand-roll: `getSessionHealth().staleSession` alone. That is precisely the
 * mistake AGL-1356 was filed for. The editor is seeded from the ENTRIES
 * listener, and the save writes every editor field — title, slug, excerpt,
 * body, cover image, both SEO fields, author, category and tags — so
 * `merge: true` protects none of them: they are all in the payload. A cached
 * seed therefore does not lose one edit; it reverts the whole post to whatever
 * IndexedDB last held, over an author who fixed a typo.
 *
 * `fromCache` is the signal that catches that, and the handler never read it.
 * Neither did it read `unreadable`. The one it did read needs two DISTINCT
 * collections denied inside 60 seconds before it says anything at all, and
 * this page issues no labelled one-shot read of its own.
 *
 * All three are asserted, and the stale-session case goes through the real
 * console wiring (`setStaleSessionCheck` + `reportDeniedRead`), because an
 * injected signal is the one a call site can silently lose.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  __resetSessionHealth,
  getSessionHealth,
  reportDeniedRead,
} from '../utils/session-health'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

/**
 * The stored entry, and the listener verdict on it. Every field here rides
 * along in the payload when the author retypes the title — the reason the
 * guard has to stand in front of this write.
 */
/** Which entry the detail route is open on; set by `renderEntry`. */
const mockParams = { collectionSlug: 'blog', entryId: 'entry-1' }

const mockEntries = {
  data: [
    {
      $id: 'entry-1',
      title: 'Hello world',
      slug: 'hello-world',
      excerpt: 'A first post',
      body: 'The body nobody is editing',
      coverImage: 'https://cdn.test/cover.png',
      seoTitle: 'Hello world — Acme',
      seoDescription: 'What Acme said first',
      authorName: 'Ada',
      tags: ['news', 'launch'],
      status: 'published',
      createdAt: { seconds: 1 },
    },
  ] as Array<Record<string, unknown>>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

jest.mock('@aglyn/aglyn', () => ({
  // A wholesale mock of the barrel is a CLOSED WORLD: every export the page
  // reaches has to be present here, and an export it GAINS later is a
  // `TypeError` at render rather than a missing stub anyone can see coming.
  // `hostPublicOrigin` arrived that way (AGL-2195), so it is the REAL
  // function taken from its leaf module — this suite asserts nothing about
  // the live-entry link, and a stub would only have to be corrected again the
  // next time the origin rules move.
  hostPublicOrigin: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/host-naming',
  ).hostPublicOrigin,
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
  // The custom-author model (AGL-2486), REAL for the same reason
  // `hostPublicOrigin` is: the page reads `HostEntityType` and three helpers
  // off this barrel, and a closed-world mock turns each one into a
  // `TypeError` at render. A stub of the Person/Organization branch would
  // also be a stub of the exact question that branch answers.
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/content-authors',
  ),
  HostEntityType: jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/platform.types',
  ).HostEntityType,
  resolveMediaSrc: () => '',
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 2 }) },
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
  updateDoc: jest.fn(),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

/**
 * Creating an action/entry is a SERVER call since AGL-2266, so this closed-world
 * factory has to name the hook or the component throws and every assertion
 * below reads the crash as the behaviour under test. A `jest.fn` rather than an
 * inert arrow: these suites are about writes that must NOT happen, and this is
 * the one write that would now happen somewhere else.
 */
const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

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
  useHostResourceApi: () => mockCreateResource,
  useUser: () => ({ data: { uid: 'uid-author', getIdToken: jest.fn() } }),
  // The REAL guard, not a stub — a stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  // The two-column shell `HubTabs` lays its nav and panels out with — the
  // Content page became a tabbed hub in AGL-2486. Mocked here rather than
  // mocking `HubTabs` itself, so the real strip (and its `keepMounted`
  // panels, which is what keeps the entry editor in the tree) still runs.
  GridItems: ({ items }: { items: Array<{ children: ReactNode }> }) => (
    <div>
      {items.map((item, index) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
  // Both arrived with the AGL-2486 polish pass: `HelpTip` carries the
  // template-screen guidance that used to be helper text under the selects,
  // and `MdiIcon` draws the zero-state icon, the disclosure's cog and every
  // row-menu glyph. Named here because this factory is a closed world — an
  // unlisted export renders as `undefined` and React throws "Element type is
  // invalid" for the WHOLE page, which is what it did.
  // The entry detail header's "View on site" control (AGL-2498). An anchor,
  // so the suites can still find every BUTTON by role without it.
  AppLink: ({ children, href }: { children?: unknown; href?: string }) => (
    <a href={href}>{children as never}</a>
  ),
  HelpTip: () => null,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
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
    headerRight,
  }: {
    children?: ReactNode
    headerRight?: ReactNode
  }) => (
    <div>
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
  default: () => ({ org: { plan: 'business' }, ready: true }),
}))
/**
 * The page names the product in its Template-screens help copy and reads that
 * name from the org's resolved brand (AGL-2486), so a white-label org sees its
 * own. Mocked here rather than left real because the hook reaches
 * `use-secondary-nav` -> `console-plugins-gate` -> `createPluginLoader`, and
 * `@aglyn/aglyn` is already a stub in this file; a non-Aglyn name also keeps
 * the substitution visible if the copy is ever asserted.
 */
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
/**
 * `collection`/`query` above collapse a ref to its last path segment, so the
 * page's own builder says which listener is asking.
 */
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
      return {
        data: [
          { $id: 'col-1', displayName: 'Blog', slug: 'blog', kind: 'content' },
        ],
        status: 'success',
        fromCache: false,
      }
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
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  // The Content page is a HubTabs hub since AGL-2486, and the strip mirrors
  // the active tab into `?tab=` with a shallow replace — so the router and
  // pathname it asks for have to exist here, or every render throws before a
  // single seed assertion runs.
  // `push` as well as `replace` since AGL-2498: the entry editor is a
  // routed detail page, so every door into it navigates. A router without
  // `push` throws inside the click handler; without `replace` the address
  // rewrite that puts a bare `/content` onto `/content/{collectionId}`
  // throws on mount.
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  /**
   * The route the DETAIL page is mounted at (AGL-2498).
   *
   * The entry editor is its own route component now, not a branch of the list
   * — so a suite about the editor mounts the editor, at an address that names
   * the entry, instead of rendering the list and clicking a row into it. That
   * is also what the browser does on a pasted link, which makes this the more
   * honest setup as well as the simpler one.
   */
  useParams: () => ({ ...mockParams }),
  usePathname: () => '/org/hosts/site/content',
}))

/**
 * `require` after the mocks, not a top-level `import`: the modules must be
 * evaluated only once every `jest.mock` above is registered.
 */
const { ContentScopeProvider } = require('../components/content/content-scope.context')
const EntryDetailPage =
  require('../components/content/entry-detail-page.component').default

/**
 * The entry detail page, at the address that names one entry.
 *
 * The provider is REAL rather than stubbed: it owns the scheduler and
 * published-date dialogs and the publish/delete writes these suites assert, so
 * a stubbed scope would leave them testing a fixture instead of the feature.
 */
const renderEntry = (entryId: string) => {
  mockParams.entryId = entryId
  return render(
    <ContentScopeProvider>
      <EntryDetailPage />
    </ContentScopeProvider>,
  )
}

const instance = jest.requireActual('@aglyn/tenant-feature-instance')

beforeAll(() => {
  instance.setStaleSessionCheck(() => getSessionHealth().staleSession)
})
afterAll(() => {
  instance.setStaleSessionCheck(null)
})

beforeEach(() => {
  jest.clearAllMocks()
  __resetSessionHealth()
  mockEntries.status = 'success'
  mockEntries.fromCache = false
})

/** Open the stored entry, retype its title, save. */
const editAndSave = () => {
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Hello world, again' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

/** Two DISTINCT collections denied inside the window — the real threshold. */
const killTheSession = () => {
  reportDeniedRead('hosts/host-1/collections')
  reportDeniedRead('orgs/org-1/members')
}

describe('Content entry seed guard (AGL-1449)', () => {
  it('REFUSES an entry save seeded from an unconfirmed read', async () => {
    mockEntries.fromCache = true
    renderEntry('entry-1')

    editAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('entry'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // AGL-1446's remedy reaches this call site now, which it could not while
    // the page carried its own copy.
    expect(message).toEqual(expect.stringMatching(/new browser tab/i))
    // The editor stays open with what was typed, so the author can retry
    // rather than discover later that nothing was stored.
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toEqual(
      'Hello world, again',
    )
  })

  it('REFUSES when the entries read FAILED, and says so differently', async () => {
    const { rerender } = renderEntry('entry-1')
    // The editor is seeded from the read that WAS there; then the listener is
    // lost — the state a terminal listen leaves an already-open editor in.
    //
    // `rerender` and not just a `fireEvent`: the listener lives in the SCOPE
    // PROVIDER above this page now, and a state change inside the page does
    // not re-render its parent. Without this the editor goes on reading the
    // healthy status it mounted with and the guard is never consulted.
    mockEntries.status = 'error'
    rerender(
      <ContentScopeProvider>
        <EntryDetailPage />
      </ContentScopeProvider>,
    )
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, again' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  it('REFUSES when the SESSION is stale, through the injected check', async () => {
    killTheSession()
    expect(getSessionHealth().staleSession).toBe(true)
    renderEntry('entry-1')

    editAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringMatching(/session went stale/i))
    // The guard's words, not the page's old ones.
    expect(message).not.toEqual(
      expect.stringContaining('overwrite newer changes'),
    )
  })

  it('SAVES the entry once the server has confirmed the seed', async () => {
    renderEntry('entry-1')

    editAndSave()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, payload, options] = mockSetDoc.mock.calls[0]
    expect(payload.title).toBe('Hello world, again')
    /*
      The slug does NOT follow the retitle (AGL-2498). This entry is
      `published`, so its address is in the wild — and `slug: slugify(title)`
      on every save is exactly what used to move `/blog/hello-world` to
      `/blog/hello-world-again` because somebody tightened a headline, 404-ing
      every inbound link with nothing in the console to say so. The slug is an
      authored field now, and this asserts the write carries the STORED one.
    */
    expect(payload.slug).toBe('hello-world')
    // Everything the author did not touch rides along off the seed.
    expect(payload.body).toBe('The body nobody is editing')
    expect(payload.seoTitle).toBe('Hello world — Acme')
    expect(payload.tags).toEqual(['news', 'launch'])
    expect(options).toEqual({ merge: true })
  })
})
