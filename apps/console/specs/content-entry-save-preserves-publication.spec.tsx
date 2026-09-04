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
 * Saving an entry must never disturb its publication dates (AGL-2498).
 *
 * ## The hazard this pins down
 *
 * This repo has a documented bug class — AGL-1250 — where a Firestore
 * converter's `toFirestore` DEFAULTS a field that a partial write did not
 * carry, so a `merge: true` write that says nothing about `nodes` emits
 * `nodes: {}` and destroys a 222-node component. `publishedAt` is now an
 * author-chosen value (AGL-2497 backdating) rather than a machine stamp, so
 * the same shape applied here would silently discard the date an editor
 * deliberately set, and `Article.datePublished` would go back to lying.
 *
 * Entries are safe from that TODAY for three independent reasons, and this
 * file asserts all three rather than trusting any one of them:
 *
 * 1. **No converter.** Entry documents carry no `withConverter` anywhere —
 *    the console listener builds a plain `collection()`, the tenant loader
 *    reads through the raw Admin SDK. So nothing gets a chance to inject a
 *    default. This is asserted indirectly: it is what makes the payload the
 *    editor passes the payload Firestore receives.
 * 2. **The payload does not name the fields.** `handleSaveEntry` writes
 *    sixteen editor fields and neither `publishedAt` nor `publishAt` is one
 *    of them — the editor's state object has no slot for either.
 * 3. **`merge: true`.** A `setDoc` WITHOUT merge replaces the document, which
 *    would delete both dates just as surely as defaulting them. The merge
 *    option is therefore load-bearing and is asserted as such.
 *
 * ## Why an assertion on the write and not on the screen
 *
 * A save that blanked the publication date would still close the dialog, still
 * show "Entry saved", and still leave the list rendering the STALE listener
 * value until the snapshot came back. Nothing on screen distinguishes it. The
 * only honest witness is the argument Firestore was handed.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

const PUBLISHED_AT_SECONDS = 1_600_000_000
const PUBLISH_AT_SECONDS = 2_000_000_000

/**
 * Three publication states, because they are three different rows of the
 * table and a save must leave each of them alone: published WITH a date,
 * scheduled with a FUTURE `publishAt` and no `publishedAt` at all, and a
 * draft that has never had either.
 */
/** Which entry the detail route is open on; set by `renderEntry`. */
const mockParams = { collectionSlug: 'blog', entryId: 'entry-1' }

const mockEntries = {
  data: [
    {
      $id: 'entry-1',
      title: 'Hello world',
      slug: 'hello-world',
      status: 'published',
      publishedAt: {
        seconds: PUBLISHED_AT_SECONDS,
        toDate: () => new Date(PUBLISHED_AT_SECONDS * 1000),
      },
      updatedAt: { seconds: 1_700_000_000, toDate: () => new Date() },
    },
    {
      $id: 'entry-2',
      title: 'Going out Monday',
      slug: 'going-out-monday',
      status: 'scheduled',
      publishAt: {
        seconds: PUBLISH_AT_SECONDS,
        toDate: () => new Date(PUBLISH_AT_SECONDS * 1000),
      },
    },
    {
      $id: 'entry-3',
      title: 'Never published',
      slug: 'never-published',
      status: 'draft',
    },
  ] as Array<Record<string, unknown>>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

jest.mock('@aglyn/aglyn', () => ({
  // A wholesale barrel mock is a CLOSED WORLD — see
  // content-entry-stale-seed.spec.tsx, which learned that the hard way.
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
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/content-authors',
  ),
  HostEntityType: jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/platform.types',
  ).HostEntityType,
  resolveMediaSrc: () => '',
}))

/**
 * `now()` is a recognisable sentinel rather than a clock: an assertion that a
 * save did NOT stamp a date cannot be made against a real timestamp, because
 * a stamped "now" and a stored date are both just numbers.
 */
jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: {
    now: () => ({ seconds: 999_999, __stampedNow: true }),
    fromDate: (date: Date) => ({ seconds: Math.floor(date.getTime() / 1000) }),
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

beforeEach(() => {
  jest.clearAllMocks()
  mockEntries.status = 'success'
  mockEntries.fromCache = false
})

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

/** The document payload of the one `setDoc` the save performed. */
const savedPayload = () => mockSetDoc.mock.calls[0][1] as Record<string, unknown>
const savedOptions = () => mockSetDoc.mock.calls[0][2] as Record<string, unknown>

describe('saving an entry leaves its publication dates alone (AGL-2498)', () => {
  it('never NAMES publishedAt or publishAt in the payload', async () => {
    renderEntry('entry-1')
    save()
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const payload = savedPayload()
    // `toHaveProperty` and not a truthiness check: the destructive write is
    // `publishedAt: undefined`, which is PRESENT as a key and is exactly what
    // a defaulting converter or a hand-added editor field would emit.
    expect(payload).not.toHaveProperty('publishedAt')
    expect(payload).not.toHaveProperty('publishAt')
    // Nor a status flip — a save is not a publication event.
    expect(payload).not.toHaveProperty('status')
  })

  it('merges rather than replaces — the option is what preserves the date', async () => {
    renderEntry('entry-1')
    save()
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    // Without `merge: true` the payload above REPLACES the document, and the
    // stored `publishedAt` is gone precisely because the payload omits it —
    // the omission that protects the field in one mode destroys it in the
    // other.
    expect(savedOptions()).toEqual({ merge: true })
  })

  it('leaves a SCHEDULED entry publishAt untouched when its text is edited', async () => {
    renderEntry('entry-2')
    // A real edit, so this is not passing merely because nothing happened.
    // Exact, not a regex: "SEO title" also matches /Title/i, and editing the
    // wrong field would still produce a payload that satisfied the assertions.
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Going out Tuesday' },
    })
    save()
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const payload = savedPayload()
    expect(payload['title']).toBe('Going out Tuesday')
    // The pending schedule survives a rename. If a save wrote `publishAt` the
    // post would go out at the wrong time, or never.
    expect(payload).not.toHaveProperty('publishAt')
    expect(payload).not.toHaveProperty('status')
  })

  it('does not INVENT a date for a draft that has never had one', async () => {
    renderEntry('entry-3')
    save()
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const payload = savedPayload()
    // "Never published" must stay distinguishable from "published at an
    // unknown time". A save that stamped `publishedAt` would publish-date
    // every draft in the collection to whenever it was last edited.
    expect(payload).not.toHaveProperty('publishedAt')
    expect(payload['updatedAt']).toEqual({ seconds: 999_999, __stampedNow: true })
  })

  it('writes the editor fields it IS responsible for, so the omission is specific', async () => {
    renderEntry('entry-1')
    save()
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const payload = savedPayload()
    // A payload that named nothing would satisfy every assertion above. These
    // pin that the save is really saving, so the absent keys are a deliberate
    // omission rather than a broken write.
    expect(payload['title']).toBe('Hello world')
    expect(payload['slug']).toBe('hello-world')
    expect(payload).toHaveProperty('excerpt')
    expect(payload).toHaveProperty('body')
    expect(payload).toHaveProperty('tags')
  })
})
