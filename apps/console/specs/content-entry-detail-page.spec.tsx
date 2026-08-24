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
 * 2. **It has an address.** Opening pushes `?entry=<id>`, a pasted link
 *    opens straight into the entry, and Back means back.
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
 * `search` is what `useSearchParams` answers with, and `push` rewrites it —
 * which is what makes a click and a browser Back distinguishable here: a
 * click goes through the component (which claims the parameter it wrote), a
 * Back is this object being changed underneath it and the tree re-rendered.
 */
const mockNav = {
  search: '',
  pushed: [] as string[],
}

const mockOrg = {
  org: undefined as Record<string, unknown> | undefined,
  ready: false,
}

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
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: {}, status: 'success', fromCache: false }),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
/**
 * A LIVE address, not a constant.
 *
 * `useSearchParams` reads `mockNav.search` on every render and `push`
 * rewrites it, so the two ways into the editor stay distinguishable: a click
 * goes through the component, while a Back is `mockNav.search` being changed
 * and the tree re-rendered. A frozen `new URLSearchParams()` — what the older
 * content specs use — cannot tell those apart, and would pass whether or not
 * the URL was wired to anything.
 */
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockNav.search),
  useRouter: () => ({
    replace: jest.fn(),
    /**
     * ⚠️ `push` records the address but does NOT apply it, because the real
     * one does not either: App Router starts a transition and
     * `useSearchParams` reports the new value on a LATER render. The window
     * in between — editor open, address not yet caught up — is exactly where
     * the URL sync can be made to close the editor it just opened, so a mock
     * that applied the push synchronously would paper over that whole class
     * of bug. `settleNavigation` below is what ends the transition.
     */
    push: (url: string) => {
      mockNav.pushed.push(url)
    },
  }),
  /**
   * A NEW object per call, like the real hook. `useRouter` and
   * `useConfirmationContext` do the same, and it is what makes the URL sync's
   * dependency list load-bearing rather than cosmetic.
   */
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
  mockNav.search = ''
  mockNav.pushed = []
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
 * A browser Back / Forward / pasted link: the address changes underneath the
 * component, which then has to notice. `render` is called again on the SAME
 * container so the tree is re-rendered rather than remounted.
 */
const navigateTo = (search: string, rerender: (ui: JSX.Element) => void) => {
  mockNav.search = search
  rerender(<HostContent />)
}

/** The address the component last asked for, query string only. */
const lastPushed = () => mockNav.pushed[mockNav.pushed.length - 1]

/**
 * The pending `router.push` transition completing — the address the component
 * asked for becomes the address it reads back.
 */
const settleNavigation = (rerender: (ui: JSX.Element) => void) => {
  const url = lastPushed() ?? ''
  const index = url.indexOf('?')
  navigateTo(index === -1 ? '' : url.slice(index), rerender)
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

  it('gives the entry an ADDRESS that can be linked, bookmarked or sent', () => {
    render(<HostContent />)

    openByRow('Hello world')

    expect(mockNav.pushed).toEqual(['/acme/hosts/shop/content?entry=entry-1'])
  })

  it('keeps the ?collection= deep link alive across a trip into an entry', () => {
    // AGL-845: the DAM's "Used on" list links straight to a collection. That
    // parameter has to survive the entry, or coming back out lands on the
    // wrong collection.
    mockNav.search = '?collection=col-1'
    render(<HostContent />)

    openByRow('Hello world')

    expect(mockNav.pushed[0]).toContain('collection=col-1')
    expect(mockNav.pushed[0]).toContain('entry=entry-1')
  })

  it('opens straight into the entry when the address already names one', () => {
    // The pasted-link case, and the reason the conversion is worth doing at
    // all: no click, just the URL.
    mockNav.search = '?entry=entry-1'
    render(<HostContent />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
    expect((screen.getByLabelText('Excerpt') as HTMLInputElement).value).toBe(
      'the stored excerpt',
    )
  })

  it('waits for the entry rather than opening a BLANK editor over it', () => {
    // The listener has not answered yet. Seeding an empty buffer here and
    // calling the parameter handled is how a pasted link opens an editor
    // that never fills — and an empty buffer over a real entry is one Save
    // away from blanking the post.
    mockEntries.data = []
    mockNav.search = '?entry=entry-1'
    const { rerender } = render(<HostContent />)

    expect(titleField()).toBeNull()

    mockEntries.data = [
      { $id: 'entry-1', title: 'Hello world', slug: 'hello-world' },
    ]
    rerender(<HostContent />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
  })

  it('stays open while the pushed address is still in flight', () => {
    // The transition window. `router.push` does not update `useSearchParams`
    // synchronously, so for at least one render the editor is open while the
    // address still says "list". The URL sync must recognise the parameter it
    // asked for as its own — otherwise every re-render in that window closes
    // the editor the click just opened, and the row appears not to work at
    // all. Broken once, in this shape, by listing `router`/`entryHref` in the
    // sync's dependencies: both are fresh objects per render, so the effect
    // ran every render instead of only when the address changed.
    const { rerender } = render(<HostContent />)
    openByRow('Hello world')
    expect(mockNav.search).toBe('')

    rerender(<HostContent />)

    expect((titleField() as HTMLInputElement).value).toBe('Hello world')
  })

  it('closes on Back — the address is what says whether the editor is open', () => {
    const { rerender } = render(<HostContent />)
    openByRow('Hello world')
    settleNavigation(rerender)
    expect(titleField()).toBeTruthy()

    navigateTo('', rerender)

    expect(titleField()).toBeNull()
    expect(screen.getByText('Never published')).toBeTruthy()
  })

  it('leaves a CLEAN editor without asking anything', async () => {
    render(<HostContent />)
    openByRow('Hello world')

    fireEvent.click(screen.getByRole('button', { name: /Back to entries/ }))

    await waitFor(() => expect(titleField()).toBeNull())
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(lastPushed()).toBe('/acme/hosts/shop/content')
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

    navigateTo('', rerender)

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
    expect((titleField() as HTMLInputElement).value).toBe(
      'Hello world, rewritten',
    )
    // The address is put back, so the page the question is about is the page
    // on screen — not a list the editor is invisibly floating over.
    expect(lastPushed()).toBe('/acme/hosts/shop/content?entry=entry-1')
  })

  it('lets the browser Back through once the discard is confirmed', async () => {
    mockConfirm.mockResolvedValue(true)
    const { rerender } = render(<HostContent />)
    openByRow('Hello world')
    settleNavigation(rerender)
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Hello world, rewritten' },
    })

    navigateTo('', rerender)

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
    // And it returns to the LIST address rather than leaving `?entry=` on a
    // page that no longer shows an entry — a link somebody then sends that
    // reopens the editor they had just finished with.
    expect(lastPushed()).toBe('/acme/hosts/shop/content')
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
