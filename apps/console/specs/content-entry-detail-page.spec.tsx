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
 * Zach: *"We should probably make the content collections open a detail page
 * rather than a dialog and then it would become a bit more friendly."*
 *
 * The friendliness is not cosmetic. A dialog has no address, so it could not
 * be linked, bookmarked or sent to a colleague; Back closed it and lost the
 * context; and it constrained the layout, which is why the publication
 * controls were exiled to the list row's overflow menu in the first place —
 * the complaint the issue opens with.
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
  params: {} as { collectionId?: string; entryId?: string },
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
  status: 'success' as 'success' | 'error',
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
  doc: () => ({}),
  deleteDoc: jest.fn(),
  deleteField: () => '__delete__',
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
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
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: {}, status: 'success', fromCache: false }),
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

const HostContent =
  require('../app/(app)/[orgSlug]/hosts/[host]/content/page').default

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
  mockNav.params = { collectionId: 'col-1' }
  mockNav.search = ''
  mockNav.pushed = []
  mockNav.replaced = []
  // Business + ready is the ordinary case; the gate cases below set their own.
  mockOrg.org = { plan: 'business' }
  mockOrg.ready = true
})

/** The title field only exists while the editor is on screen. */
const titleField = () => screen.queryByLabelText('Title')

/** Opens an entry by clicking its row, the way the list does. */
const openByRow = (title: string) =>
  fireEvent.click(screen.getByText(title))

/**
 * A URL string → the two route params and the query the component reads.
 *
 * The regex mirrors the two real routes:
 * `…/content/{collectionId}` and
 * `…/content/{collectionId}/entries/{entryId}`.
 */
const addressOf = (url: string) => {
  const [path, query = ''] = url.split('?')
  const match = /\/content(?:\/([^/]+))?(?:\/entries\/([^/]+))?\/?$/.exec(path)
  return {
    params: {
      ...(match?.[1] ? { collectionId: match[1] } : {}),
      ...(match?.[2] ? { entryId: match[2] } : {}),
    },
    search: query,
  }
}

/**
 * A browser Back / Forward / pasted link: the address changes underneath the
 * component, which then has to notice. `render` is called again on the SAME
 * container so the tree is re-rendered rather than remounted.
 */
const navigateTo = (url: string, rerender: (ui: JSX.Element) => void) => {
  const next = addressOf(url)
  mockNav.params = next.params
  mockNav.search = next.search
  rerender(<HostContent />)
}

/** The address the component last asked for. */
const lastPushed = () => mockNav.pushed[mockNav.pushed.length - 1]

/**
 * The pending `router.push` transition completing — the address the component
 * asked for becomes the address it reads back.
 */
const settleNavigation = (rerender: (ui: JSX.Element) => void) => {
  navigateTo(lastPushed() ?? '/acme/hosts/shop/content/col-1', rerender)
}

/** The `datetime-local` value shape, in LOCAL time like the input's own. */
const localValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

describe('a collection entry opens a detail page (AGL-2498)', () => {
  it('renders the editor as a PAGE — no dialog, and the list is not behind it', () => {
    render(<HostContent />)
    // Before: the list, both rows, no editor.
    expect(screen.getByText('Never published')).toBeTruthy()
    expect(titleField()).toBeNull()

    openByRow('Hello world')

    // The editor is here...
    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
    // ...and it is NOT a dialog. This is the assertion the conversion is
    // about: `role="dialog"` is what MUI's Dialog announces itself as, so a
    // revert to the old container reddens here rather than somewhere subtle.
    expect(screen.queryByRole('dialog')).toBeNull()
    // The list is GONE rather than layered underneath. A second entry's row
    // still being reachable would mean two page headers and two breadcrumb
    // trails stacked, and the trail is what says which entry you are in.
    expect(screen.queryByText('Never published')).toBeNull()
  })

  it('gives the entry an ADDRESS that names BOTH halves of it', () => {
    // The collection AND the entry, both as path segments. Before AGL-2498's
    // second pass this was `/content?entry=entry-1`, which says which entry
    // but not which collection — the collection rode along in a SECOND query
    // parameter that any link rebuild could drop, and dropping it landed the
    // reader on whichever collection sorted first.
    render(<HostContent />)

    openByRow('Hello world')

    expect(mockNav.pushed).toEqual([
      '/acme/hosts/shop/content/col-1/entries/entry-1',
    ])
  })

  it('rewrites a legacy ?collection= deep link onto the routed address', () => {
    // AGL-845: the DAM's "Used on" list linked straight to a collection with
    // `?collection=`, and those links are in the wild. They keep working —
    // by being REWRITTEN onto the path, so the address the reader ends up
    // with is one they can send on.
    mockNav.params = {}
    mockNav.search = '?collection=col-1'

    render(<HostContent />)

    expect(mockNav.replaced).toEqual(['/acme/hosts/shop/content/col-1'])
  })

  it('rewrites a legacy ?entry= link straight into the entry', () => {
    // Both legacy parameters at once — the shape a bookmark of the old editor
    // has. The rewrite must carry the entry as well, or a saved link to a
    // post silently degrades into a link to its list.
    mockNav.params = {}
    mockNav.search = '?collection=col-1&entry=entry-1'

    render(<HostContent />)

    expect(mockNav.replaced).toEqual([
      '/acme/hosts/shop/content/col-1/entries/entry-1',
    ])
  })

  it('carries ?tab= through the rewrite but never the legacy pair', () => {
    // `?tab=` is HubTabs' own mirroring and has to survive. `?collection=`
    // and `?entry=` must NOT: they are the address that just moved into the
    // path, and carrying them forward would leave two answers to "which
    // collection is open" in one URL with nothing to say which wins.
    mockNav.params = {}
    mockNav.search = '?tab=authors&collection=col-1'

    render(<HostContent />)

    expect(mockNav.replaced).toEqual(['/acme/hosts/shop/content/col-1?tab=authors'])
  })

  it('rewrites an address naming a collection that no longer exists', () => {
    // A deleted collection, a stale bookmark, a typo. Left alone, `selected`
    // falls back to the first collection and the address then NAMES one
    // collection while the page SHOWS another — and the next save writes to
    // the one on screen.
    mockNav.params = { collectionId: 'col-gone' }

    render(<HostContent />)

    expect(mockNav.replaced).toEqual(['/acme/hosts/shop/content/col-1'])
  })

  it('leaves a settled address alone', () => {
    // The guard against the opposite failure: a rewrite that fires on an
    // address already in the routed form is a `replace` per render, at the
    // exact moment the router is mid-navigation.
    render(<HostContent />)

    expect(mockNav.replaced).toEqual([])
  })

  it('navigates when the collection Select is changed', () => {
    // Which collection is open is the page's ADDRESS since AGL-2498, not a
    // piece of component state — so choosing one goes through the router and
    // can be linked, bookmarked, reloaded and gone Back out of.
    mockCollections.push({
      $id: 'col-2',
      displayName: 'Changelog',
      slug: 'changelog',
      kind: 'content',
    })
    render(<HostContent />)

    // MUI's `TextField select` is a listbox behind a combobox, not a native
    // `<select>`, so it is DRIVEN rather than assigned to — `fireEvent.change`
    // on it throws "does not have a value setter".
    fireEvent.mouseDown(screen.getByLabelText('Collection'))
    fireEvent.click(screen.getByRole('option', { name: /Changelog/ }))

    expect(lastPushed()).toBe('/acme/hosts/shop/content/col-2')
  })

  it('opens straight into the entry when the address already names one', () => {
    // The pasted-link case, and the reason the conversion is worth doing at
    // all: no click, just the URL.
    mockNav.params = { collectionId: 'col-1', entryId: 'entry-1' }
    render(<HostContent />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
    expect((screen.getByLabelText('Excerpt') as HTMLInputElement).value).toBe(
      'the stored excerpt',
    )
  })

  it('waits for the entry rather than opening a BLANK editor over it', () => {
    // The listener has not answered yet. Seeding an empty buffer here and
    // calling the segment handled is how a pasted link opens an editor
    // that never fills — and an empty buffer over a real entry is one Save
    // away from blanking the post.
    mockEntries.data = []
    mockNav.params = { collectionId: 'col-1', entryId: 'entry-1' }
    const { rerender } = render(<HostContent />)

    expect(titleField()).toBeNull()

    mockEntries.data = [
      { $id: 'entry-1', title: 'Hello world', slug: 'hello-world' },
    ]
    rerender(<HostContent />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
  })

  it('stays open while the pushed address is still in flight', () => {
    // The transition window. `router.push` does not update `useParams`
    // synchronously, so for at least one render the editor is open while the
    // address still says "list". The URL sync must recognise the segment it
    // asked for as its own — otherwise every re-render in that window closes
    // the editor the click just opened, and the row appears not to work at
    // all. Broken once, in this shape, by listing `router`/`entryHref` in the
    // sync's dependencies: both are fresh objects per render, so the effect
    // ran every render instead of only when the address changed.
    //
    // The hazard SURVIVED the move from `?entry=` to a path segment — a
    // transition is a transition — which is why this test did not go with it.
    const { rerender } = render(<HostContent />)
    openByRow('Hello world')
    expect(mockNav.params.entryId).toBeUndefined()

    rerender(<HostContent />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
  })

  it('closes on Back — the address is what says whether the editor is open', () => {
    const { rerender } = render(<HostContent />)
    openByRow('Hello world')
    settleNavigation(rerender)
    expect(titleField()).toBeTruthy()

    navigateTo('/acme/hosts/shop/content/col-1', rerender)

    expect(titleField()).toBeNull()
    expect(screen.getByText('Never published')).toBeTruthy()
  })

  it('leaves a CLEAN editor without asking anything', async () => {
    render(<HostContent />)
    openByRow('Hello world')

    fireEvent.click(screen.getByRole('button', { name: /Back to entries/ }))

    await waitFor(() => expect(titleField()).toBeNull())
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(lastPushed()).toBe('/acme/hosts/shop/content/col-1')
  })

  it('asks before dropping unsaved edits, and NO keeps them', async () => {
    mockConfirm.mockResolvedValue(false)
    render(<HostContent />)
    openByRow('Hello world')
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Back to entries/ }))

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    // Still here, still carrying what was typed. A guard that asked and then
    // closed anyway is worse than no guard: it looks like it protected you.
    expect((titleField() as HTMLInputElement).value).toBe(
      'Hello world, rewritten',
    )
  })

  it('does not silently drop unsaved edits when the BROWSER goes back', async () => {
    // The hazard the conversion introduces, and the reason the guard had to
    // be BUILT rather than preserved: Back is far easier to press than a
    // dialog was to dismiss, and the dialog had no dirty tracking at all.
    mockConfirm.mockResolvedValue(false)
    const { rerender } = render(<HostContent />)
    openByRow('Hello world')
    settleNavigation(rerender)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    navigateTo('/acme/hosts/shop/content/col-1', rerender)

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    expect((titleField() as HTMLInputElement).value).toBe(
      'Hello world, rewritten',
    )
    // The address is put back, so the page the question is about is the page
    // on screen — not a list the editor is invisibly floating over.
    expect(lastPushed()).toBe(
      '/acme/hosts/shop/content/col-1/entries/entry-1',
    )
  })

  it('lets the browser Back through once the discard is confirmed', async () => {
    mockConfirm.mockResolvedValue(true)
    const { rerender } = render(<HostContent />)
    openByRow('Hello world')
    settleNavigation(rerender)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    navigateTo('/acme/hosts/shop/content/col-1', rerender)

    await waitFor(() => expect(titleField()).toBeNull())
  })

  it('treats a SAVED entry as clean — no prompt on the way out', async () => {
    render(<HostContent />)
    openByRow('Hello world')
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    // Back on the list, and nothing was asked: the changes are stored, so
    // "discard unsaved changes?" would be a question about nothing — and
    // worse, `beforeunload` would go on blocking the tab over them.
    await waitFor(() => expect(titleField()).toBeNull())
    expect(mockConfirm).not.toHaveBeenCalled()
    // And it returns to the COLLECTION address rather than leaving the entry
    // segment on a page that no longer shows an entry — a link somebody then
    // sends that reopens the editor they had just finished with. To the
    // collection and not to bare `/content`: leaving an entry must not also
    // change which collection you are looking at.
    expect(lastPushed()).toBe('/acme/hosts/shop/content/col-1')
  })

  it('schedules from the detail page, still writing publishAt', async () => {
    render(<HostContent />)
    openByRow('Hello world')

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
    // is when the entry SAYS it went out. Moving the container must not swap
    // them.
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
      render(<HostContent />)
      openByRow('Hello world')

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
      render(<HostContent />)
      openByRow('Hello world')

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
