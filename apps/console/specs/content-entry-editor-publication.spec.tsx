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
 * The entry editor carries the publication controls (AGL-2498).
 *
 * Zach: *"We are also missing the ability schedule publishing on the content
 * collections, only via the expanded menu on the list."*
 *
 * All three controls — publish/unpublish, the future scheduler, and the
 * publish date from AGL-2497 — existed, and all three lived on the LIST
 * row's overflow menu. Somebody writing an entry had to close the editor,
 * find the row and open a different menu to decide when the piece went live.
 * The editor now carries them too.
 *
 * ## What these assert, and what they deliberately do not
 *
 * The behaviour of each action is already proven in
 * `content-entry-publish-date.spec.tsx` against the Firestore write. What is
 * new here is REACHABILITY and WIRING: that the control appears where the
 * writing happens, that it acts on the entry being edited, and that the two
 * one-letter-apart dates stay apart when shown side by side for the first
 * time. So these assert the write payload again — not the dialog — because
 * the failure this shape invites is a control that opens the right dialog
 * seeded from the WRONG entry, which looks perfect on screen.
 *
 * ## The container is deliberately still a dialog
 *
 * AGL-2498 also proposes converting the editor to a routed detail page. That
 * is not what landed here and these specs do not assume it: they drive the
 * dialog. See the issue for why the conversion was separated out.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUpdateDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

/** A published entry dated a year ago, and a draft with no date at all. */
const PUBLISHED_AT_SECONDS = 1_600_000_000

const mockEntries = {
  data: [
    {
      $id: 'entry-1',
      title: 'Hello world',
      slug: 'hello-world',
      status: 'published',
      // A real `Timestamp` shape: the row formatter and the dialog seed both
      // go through `toDate()`, which is the only reader that tells an absent
      // date apart from a zero one.
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
  // A wholesale barrel mock is a CLOSED WORLD — see
  // content-entry-stale-seed.spec.tsx, which learned that the hard way.
  hostPublicOrigin: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/host-naming',
  ).hostPublicOrigin,
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

/**
 * `fromDate` is REAL — it is what carries the author's chosen instant into
 * the write, so stubbing it would stub the thing under test. `now()` is a
 * recognisable sentinel instead of a clock: the point of several assertions
 * below is that a stamped "now" did NOT replace a stored date, and two real
 * timestamps a millisecond apart cannot show that.
 */
jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: {
    now: () => ({ seconds: 999_999, __stampedNow: true }),
    /**
     * Tolerant of an Invalid Date ON PURPOSE. The real `Timestamp.fromDate`
     * stores a garbage instant silently rather than throwing, and a mock
     * that throws does not reproduce the bug — it hides it. A `toISOString()`
     * here raises `RangeError` synchronously inside the click handler, React
     * re-throws it on a later task, and jest attributes the failure to
     * whichever unrelated test is running by then. The guard regression was
     * caught, but blamed on the wrong test and for the wrong reason.
     *
     * Passing the bad value THROUGH is what lets the write be observed as a
     * recorded payload, so the assertion that owns it is the one that fails.
     */
    fromDate: (date: Date) => ({
      seconds: Math.floor(date.getTime() / 1000),
      __fromDate: Number.isNaN(date.getTime())
        ? 'Invalid Date'
        : date.toISOString(),
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
  setDoc: jest.fn().mockResolvedValue(undefined),
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
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: {}, status: 'success', fromCache: false }),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/org/hosts/site/content',
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const HostContent =
  require('../app/(app)/[orgSlug]/hosts/[host]/content/page').default

beforeEach(() => {
  jest.clearAllMocks()
  mockEntries.status = 'success'
  mockEntries.fromCache = false
})

/**
 * The row actions live behind an overflow menu, one per row. `title` is the
 * entry to act on and `action` the menu item's label.
 */
const openRowAction = (title: string, action: string | RegExp) => {
  const row = screen.getByText(title).closest('tr') as HTMLElement
  fireEvent.click(row.querySelector('button') as HTMLElement)
  fireEvent.click(screen.getByRole('menuitem', { name: action }))
}

/** The `datetime-local` value shape, in LOCAL time like the input's own. */
const localValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Opens the entry editor dialog for a row, via its overflow menu. */
const openEditor = (title: string) => openRowAction(title, 'Edit')

/**
 * A button INSIDE the editor's Publication section. Deliberately queried by
 * the `button` role rather than by text: the list row's overflow menu offers
 * the same three labels as `menuitem`s, and a text query would happily find
 * those instead and prove nothing about the editor at all.
 */
const publicationButton = (name: string | RegExp) =>
  screen.getByRole('button', { name })

describe('the entry editor carries the publication controls (AGL-2498)', () => {
  it('SCHEDULES from inside the editor, writing publishAt for that entry', async () => {
    render(<HostContent />)
    openEditor('Hello world')

    fireEvent.click(publicationButton(/^Schedule/))

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    future.setSeconds(0, 0)
    fireEvent.change(screen.getByLabelText('Publish at'), {
      target: { value: localValue(future) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    expect(payload.status).toBe('scheduled')
    // `publishAt` — the DEFERRED field. Reaching this control from a second
    // place must not change which field it writes.
    expect(Object.keys(payload).sort()).toEqual(['publishAt', 'status'])
    expect(payload.publishAt.seconds).toBe(Math.floor(future.getTime() / 1000))
  })

  /**
   * The scheduler opens on a FUTURE instant — the other half of the
   * one-letter guard, and a gap the mutation testing found rather than
   * assumed. Every other test here types its own value before submitting, so
   * seeding the scheduler from the entry's `publishedAt` (a PAST date, the
   * publish-date rule applied to the wrong control) changed no assertion at
   * all while breaking the feature: the writer opens Schedule, finds a date
   * from 2020 pre-filled, and the Schedule button refuses it.
   */
  it('opens the scheduler seeded to a FUTURE instant, never the entry own date', () => {
    render(<HostContent />)
    openEditor('Hello world')

    fireEvent.click(publicationButton(/^Schedule/))

    const seeded = new Date(
      (screen.getByLabelText('Publish at') as HTMLInputElement).value,
    )
    expect(seeded.getTime()).toBeGreaterThan(Date.now())
    // Specifically NOT the entry's publication date, which is what the
    // backdating control seeds from one button over.
    expect(seeded.getTime()).not.toBe(PUBLISHED_AT_SECONDS * 1000)
  })

  it('BACKDATES from inside the editor, writing publishedAt for that entry', async () => {
    render(<HostContent />)
    openEditor('Hello world')

    fireEvent.click(publicationButton(/^Edit published date/))

    const backdated = new Date(2019, 4, 1, 9, 30)
    fireEvent.change(screen.getByLabelText('Published on'), {
      target: { value: localValue(backdated) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save published date' }))

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    expect(Object.keys(payload)).toEqual(['publishedAt'])
    expect(payload.publishedAt.seconds).toBe(
      Math.floor(backdated.getTime() / 1000),
    )
  })

  it('seeds each date dialog from the EDITED entry, not the first row', async () => {
    // The wiring failure this shape invites, and the reason these assert the
    // write rather than the dialog: a control that reads `entries[0]` instead
    // of the entry being edited looks correct on screen for row one and
    // silently re-dates the wrong post for every other row.
    render(<HostContent />)
    openEditor('Never published')

    fireEvent.click(publicationButton(/^Edit published date/))

    // Entry two has no date at all, so its dialog opens on NOW. Entry one is
    // dated 2020 — seeing that value here would mean the control read the
    // wrong entry.
    const value = (screen.getByLabelText('Published on') as HTMLInputElement)
      .value
    expect(value.startsWith('1970-')).toBe(false)
    expect(value).not.toBe(localValue(new Date(PUBLISHED_AT_SECONDS * 1000)))
    expect(Math.abs(new Date(value).getTime() - Date.now())).toBeLessThan(
      120_000,
    )
  })

  it('PUBLISHES from inside the editor', async () => {
    render(<HostContent />)
    openEditor('Never published')

    fireEvent.click(publicationButton('Publish'))

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    expect(payload.status).toBe('published')
  })

  it('offers UNPUBLISH, not Publish, for an already published entry', () => {
    render(<HostContent />)
    openEditor('Hello world')

    expect(publicationButton('Unpublish')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  /**
   * The one-letter guard, at the only surface that shows both dates at once.
   *
   * `publishedAt` (when it WENT live) and `publishAt` (when it is DUE to)
   * differ by a single letter. If the editor ever collapsed them into one
   * "publish date" control, the visible symptom would be here — so the two
   * buttons are asserted to be distinct controls with distinct wording, and
   * the status line is asserted to state the tense it is talking about.
   */
  it('keeps the published date and the schedule worded APART', () => {
    render(<HostContent />)
    openEditor('Hello world')

    const backdate = publicationButton(/^Edit published date/)
    const schedule = publicationButton(/^Schedule/)
    // Two controls, not one — a merged date field is the failure mode.
    expect(backdate).not.toBe(schedule)
    // PAST tense for the field the article claims about itself.
    expect(backdate.textContent).toMatch(/published/i)
    expect(backdate.textContent).not.toMatch(/schedule/i)
    // The status line names the tense rather than a bare date.
    expect(screen.getByText(/^Published /)).toBeTruthy()
  })

  it('offers NO publication controls until the draft exists', () => {
    // A new entry has no document yet, so publishing, scheduling or dating it
    // would write against an id nothing answers to.
    render(<HostContent />)
    fireEvent.click(screen.getByRole('button', { name: /new entry/i }))

    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Schedule/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /^Edit published date/ }),
    ).toBeNull()
  })
})
