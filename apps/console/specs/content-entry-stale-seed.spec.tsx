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
  isHostCollectionKind: () => () => true,
  COLLECTION_CATEGORIES_MAX: 20,
  findCollectionSlugOwner: () => null,
  collectionDeleteDenial: () => null,
  collectionTemplateBindings: () => [],
  mediaNodeSrc: () => '',
  createResourceUid: () => 'entry-new',
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 2 }) },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  deleteDoc: jest.fn(),
  deleteField: () => '__delete__',
  updateDoc: jest.fn(),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
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
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: {}, status: 'success', fromCache: false }),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const HostContent =
  require('../app/(app)/[orgSlug]/hosts/[host]/content/page').default

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
  fireEvent.click(screen.getByText('Hello world'))
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
    render(<HostContent />)

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
    render(<HostContent />)
    // Open the editor from the seed that WAS there, then lose the listener —
    // the state a terminal listen leaves an already-open editor in.
    fireEvent.click(screen.getByText('Hello world'))
    mockEntries.status = 'error'
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
    render(<HostContent />)

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
    render(<HostContent />)

    editAndSave()

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, payload, options] = mockSetDoc.mock.calls[0]
    expect(payload.title).toBe('Hello world, again')
    expect(payload.slug).toBe('hello-world-again')
    // Everything the author did not touch rides along off the seed.
    expect(payload.body).toBe('The body nobody is editing')
    expect(payload.seoTitle).toBe('Hello world — Acme')
    expect(payload.tags).toEqual(['news', 'launch'])
    expect(options).toEqual({ merge: true })
  })
})
