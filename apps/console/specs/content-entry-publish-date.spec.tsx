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
 * A content entry's publish date is settable, and can be set to a PAST
 * instant (AGL-2497).
 *
 * `Article.datePublished` in the tenant's structured data is wired to
 * `entry.publishedAt` and always worked. Nothing upstream could put an
 * author-chosen value in that field: the publish toggle hardcoded
 * `Timestamp.now()`, and the only date control on the page was a
 * future-ONLY scheduler. So an imported archive told Google every post in it
 * was published on migration day, and no edit anywhere could correct it.
 *
 * ## The assertion surface is the WRITE, not a response
 *
 * Every assertion below reads the arguments of the Firestore call. A broken
 * implementation can leave the dialog, show a success snackbar and log the
 * activity while writing the wrong instant, the wrong field, or an extra
 * one — none of which a rendered result would expose. Three properties are
 * asserted about every payload: WHICH fields it names, what the date is, and
 * what it did NOT touch.
 *
 * ## Scheduling is the regression control
 *
 * The failure mode this feature invites is that somebody relaxes
 * `handleScheduleEntry`'s `publishAt <= new Date()` refusal to let a past
 * date through, and future scheduling silently stops working. So the
 * scheduler is driven here too — it must still accept a future instant, still
 * refuse a past one, and still write `status: 'scheduled'` with `publishAt`
 * rather than `publishedAt`.
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
  // The REAL gate, not a stub (AGL-471). Entry scheduling is a Business
  // entitlement and `hasEntitlement` delegates straight to this; stubbing it
  // true would leave these cases asserting scheduling works on a plan they
  // never actually check. The closed world above is why it has to be listed.
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

describe('an entry publish date can be set, and BACKDATED (AGL-2497)', () => {
  it('writes the chosen PAST instant to publishedAt, and nothing else', async () => {
    render(<HostContent />)
    openRowAction('Hello world', /^Edit published date/)

    const backdated = new Date(2019, 4, 1, 9, 30)
    fireEvent.change(screen.getByLabelText('Published on'), {
      target: { value: localValue(backdated) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save published date' }))

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    // The instant that reaches Firestore is the one that was typed — read as
    // LOCAL time, not shifted into UTC by an `toISOString()` round trip.
    expect(payload.publishedAt.seconds).toBe(
      Math.floor(backdated.getTime() / 1000),
    )
    // ONE field. `status` is untouched (re-dating is not publishing) and so
    // is `updatedAt` — that is what `Article.dateModified` reads, and it must
    // go on meaning "last edited".
    expect(Object.keys(payload)).toEqual(['publishedAt'])
  })

  it('seeds the dialog from the entry OWN date, not from today', () => {
    render(<HostContent />)
    openRowAction('Hello world', /^Edit published date/)

    expect(
      (screen.getByLabelText('Published on') as HTMLInputElement).value,
    ).toBe(localValue(new Date(PUBLISHED_AT_SECONDS * 1000)))
  })

  it('seeds an UNDATED draft from now — never from the epoch', () => {
    render(<HostContent />)
    openRowAction('Never published', /^Edit published date/)

    const value = (screen.getByLabelText('Published on') as HTMLInputElement)
      .value
    // The `strictNullChecks`-off trap: `(publishedAt?.seconds ?? 0) * 1000`
    // compiles clean and opens this dialog on 1 Jan 1970.
    expect(value.startsWith('1970-')).toBe(false)
    // Within a minute of now rather than equal to it — the input holds
    // minutes, and an equality would flake once every 60 seconds.
    expect(Math.abs(new Date(value).getTime() - Date.now())).toBeLessThan(
      120_000,
    )
  })

  it('REFUSES a future instant and sends the user to Schedule', async () => {
    render(<HostContent />)
    openRowAction('Hello world', /^Edit published date/)

    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    fireEvent.change(screen.getByLabelText('Published on'), {
      target: { value: localValue(future) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save published date' }))

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/schedule/i),
    )
  })

  /**
   * An EMPTIED input reaches no write — the one unparseable state this
   * control can actually be in.
   *
   * Worth stating precisely, because it was measured rather than assumed. An
   * `input[type=datetime-local]` sanitizes: its `value` is either a valid
   * `YYYY-MM-DDTHH:mm` string or `''`, never anything else. Typing garbage
   * yields `''` and so does a half-entered date — probed directly in jsdom,
   * and it is the HTML rule, not a jsdom quirk. So `new Date(at)` is Invalid
   * Date for exactly one input value, `''`.
   *
   * That makes the handler's `Number.isNaN` check and the Save button's
   * `disabled={!publishDate?.at}` REDUNDANT guards over the same single
   * state, not two guards over two states. Deleting either one alone leaves
   * this suite green — deliberately recorded rather than papered over, since
   * a mutation that kills nothing usually means a decorative test. Here it
   * means a deliberately doubled guard, and what must never regress is the
   * OUTCOME: an empty date writes nothing. Removing BOTH is what this kills.
   *
   * The cost of getting it wrong is why the redundancy is kept. Invalid Date
   * compares `false` against everything, so it would fall through the future
   * refusal below as well and store `Timestamp.fromDate(Invalid Date)` — a
   * NaN instant, which is the `strictNullChecks`-off shape this whole
   * feature exists to avoid: a `datePublished` that is unparseable rather
   * than absent.
   */
  it('writes NOTHING when the date is cleared', async () => {
    render(<HostContent />)
    openRowAction('Hello world', /^Edit published date/)

    fireEvent.change(screen.getByLabelText('Published on'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save published date' }))

    expect(mockUpdateDoc).not.toHaveBeenCalled()
  })
})

describe('publishing keeps a date the author already chose (AGL-2497)', () => {
  it('UNPUBLISHING still deletes the date — the escape hatch is intact', async () => {
    // "Preserve an existing date" would be a trap without this: an entry
    // could never get a fresh publication instant again. Unpublish DELETES
    // the field, so publish -> unpublish -> publish stamps now, and the
    // preservation below can only ever pick up a date somebody chose.
    render(<HostContent />)
    openRowAction('Hello world', 'Unpublish')

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({
      status: 'draft',
      publishedAt: '__delete__',
    })
  })

  it('publishing an entry that HAS a date preserves it', async () => {
    // The draft that carries a date: exactly what a backdate-then-publish
    // flow produces, and the case the old unconditional `Timestamp.now()`
    // silently destroyed.
    mockEntries.data[1].publishedAt = {
      seconds: PUBLISHED_AT_SECONDS,
      toDate: () => new Date(PUBLISHED_AT_SECONDS * 1000),
    }
    try {
      render(<HostContent />)
      openRowAction('Never published', 'Publish')

      await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
      const [, payload] = mockUpdateDoc.mock.calls[0]
      expect(payload.status).toBe('published')
      expect(payload.publishedAt.seconds).toBe(PUBLISHED_AT_SECONDS)
      expect(payload.publishedAt.__stampedNow).toBeUndefined()
    } finally {
      delete mockEntries.data[1].publishedAt
    }
  })

  it('publishing an entry with NO date still stamps now', async () => {
    render(<HostContent />)
    openRowAction('Never published', 'Publish')

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    expect(payload.status).toBe('published')
    // The sentinel from the mocked clock — an absent date must reach the
    // stamp, and must NOT reach an arithmetic fallback that renders as 1970.
    expect(payload.publishedAt.__stampedNow).toBe(true)
  })
})

/**
 * The regression control. Backdating and scheduling share a concept and must
 * not share a guard: the way this feature breaks the scheduler is by somebody
 * relaxing `publishAt <= new Date()` to admit a past date.
 */
describe('future scheduling is UNCHANGED (AGL-123 regression control)', () => {
  it('still accepts a future instant, writing publishAt and status', async () => {
    render(<HostContent />)
    openRowAction('Hello world', /^Schedule/)

    // Seconds zeroed: `datetime-local` carries minute precision, so an
    // expectation built from `Date.now()` would be 41 seconds off the value
    // the input can actually hold.
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    future.setSeconds(0, 0)
    fireEvent.change(screen.getByLabelText('Publish at'), {
      target: { value: localValue(future) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    const [, payload] = mockUpdateDoc.mock.calls[0]
    expect(payload.status).toBe('scheduled')
    // `publishAt`, the deferred field — NOT `publishedAt`, which is the one
    // the publish date owns. Conflating the two is the other half of the
    // failure this suite guards.
    expect(Object.keys(payload).sort()).toEqual(['publishAt', 'status'])
    expect(payload.publishAt.seconds).toBe(Math.floor(future.getTime() / 1000))
  })

  it('still REFUSES a past instant', async () => {
    render(<HostContent />)
    openRowAction('Hello world', /^Schedule/)

    fireEvent.change(screen.getByLabelText('Publish at'), {
      target: { value: localValue(new Date(2019, 4, 1, 9, 30)) },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/future/i),
    )
  })
})
