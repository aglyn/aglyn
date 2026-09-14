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
 * A collection entry holds a featured video (AGL-2954).
 *
 * Three layers, each asserted where it can fail:
 *
 * 1. **The pick rule** (`featuredVideoPick`), as data. It decides what a pick
 *    writes, and the part worth a spec is the poster fill: an empty cover
 *    becomes the film's captured frame, an existing cover is kept, and a film
 *    with no captured frame fills nothing, because its poster URL would
 *    answer 404 in an `<img>`.
 * 2. **The field**, rendered. Its preview shows a frame only when the film's
 *    document records one, under the rule the published page applies.
 * 3. **The page**, rendered. The card opens the page's picker narrowed to
 *    video, a pick lands in the editor through the rule above, and the save
 *    stores the reference, or deletes the field once it is cleared.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

/** Which entry the detail route is open on; set by `renderEntry`. */
const mockParams = { collectionSlug: 'blog', entryId: 'entry-1' }

const mockEntries = {
  data: [
    {
      $id: 'entry-1',
      title: 'Harbor at dawn',
      slug: 'harbor-at-dawn',
      excerpt: 'A film about the morning shift',
      body: 'Body copy',
      status: 'draft',
    },
    {
      $id: 'entry-2',
      title: 'The night crew',
      slug: 'the-night-crew',
      status: 'draft',
      coverVideo: 'media:host-1/film-1',
    },
  ] as Array<Record<string, unknown>>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

/** Media documents by path, for the field's own read of a library film. */
const mockMediaDocs = new Map<string, Record<string, unknown>>()

/** The props the page last handed its picker dialog. */
const mockPicker: { props: Record<string, any> | null } = { props: null }

jest.mock('@aglyn/aglyn', () => ({
  // A wholesale barrel mock is a CLOSED WORLD — see
  // content-entry-stale-seed.spec.tsx. The pick rules are REAL here, because
  // the pick is what these suites are about.
  hostPublicOrigin: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/host-naming',
  ).hostPublicOrigin,
  isHostCollectionKind: () => () => true,
  COLLECTION_CATEGORIES_MAX: 20,
  findCollectionSlugOwner: () => null,
  findEntrySlugOwner: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/collection-slug',
  ).findEntrySlugOwner,
  collectionDeleteDenial: () => null,
  collectionTemplateBindings: () => [],
  mediaNodeSrc: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/media-ref',
  ).mediaNodeSrc,
  resolveMediaSrc: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/media-ref',
  ).resolveMediaSrc,
  inheritedMediaAlt: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/media-metadata',
  ).inheritedMediaAlt,
  createResourceUid: () => 'entry-new',
  ...jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/content-authors',
  ),
  HostEntityType: jest.requireActual(
    '../../../libs/aglyn/src/lib/foundation/definitions/platform.types',
  ).HostEntityType,
}))

jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 2 }) },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  where: () => undefined,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  deleteDoc: jest.fn(),
  deleteField: () => '__delete__',
  updateDoc: jest.fn(),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useSortedPagedCollection: (buildBase: () => string) => ({
    rows: buildBase() === 'entries' ? mockEntries.data : [],
    hasMore: false,
    page: 0,
    setPage: () => undefined,
    pageSize: 10,
    setPageSize: () => undefined,
    status: mockEntries.status,
    fromCache: mockEntries.fromCache,
  }),
  useHostResourceApi: () => jest.fn(async () => ({ id: 'created-id' })),
  useUser: () => ({ data: { uid: 'uid-author', getIdToken: jest.fn() } }),
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
// The page's ONE picker, recorded rather than rendered: the library behind it
// has its own spec, and what is asserted here is what the page asks it for.
jest.mock('../components/media/media-picker-dialog.component', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockPicker.props = props
    return null
  },
}))
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
          { $id: 'col-1', displayName: 'Videos', slug: 'blog', kind: 'content' },
        ],
        status: 'success',
        fromCache: false,
      }
    }
    return { data: [], status: 'success', fromCache: false }
  },
}))
/**
 * The open ENTRY, a library FILM, and anything else, told apart by path. A
 * null ref is a read the caller did not make, and answers nothing.
 */
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: (build: () => { __path?: string } | null) => {
    const path = build()?.__path ?? ''
    if (path.includes('/entries/')) {
      const id = path.split('/').pop()
      return {
        data: mockEntries.data.find((entry: any) => entry.$id === id),
        status: mockEntries.status,
        fromCache: mockEntries.fromCache,
      }
    }
    if (path.includes('/media/')) {
      return {
        data: mockMediaDocs.get(path),
        status: mockMediaDocs.has(path) ? 'success' : 'loading',
        fromCache: false,
      }
    }
    return { data: path ? {} : undefined, status: 'success', fromCache: false }
  },
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
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
const {
  EntryCoverVideoField,
  featuredVideoPick,
} = require('../components/content/entry-cover-video-field.component')

/** A film as the picker hands it back: its document, CDN path included. */
const film = (overrides: Record<string, unknown> = {}) => ({
  $id: 'film-1',
  fileName: 'harbor.mp4',
  contentType: 'video/mp4',
  url: 'https://firebasestorage.example/harbor.mp4?alt=media&token=t',
  cdnPath: '/api/media/cdn/host-1/film-1',
  alt: 'Cranes over the harbor at dawn',
  video: { durationMs: 63_000, width: 1920, height: 1080 },
  poster: { width: 1920, height: 1080, variants: [320, 640, 1280] },
  ...overrides,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockMediaDocs.clear()
  mockPicker.props = null
  mockEntries.status = 'success'
  mockEntries.fromCache = false
})

describe('what picking a film writes (AGL-2954)', () => {
  const pick = (
    media: Record<string, unknown>,
    cover: { coverImage?: string; coverImageAlt?: string } = {},
  ) =>
    featuredVideoPick({
      media,
      src: String(media['src'] ?? 'media:host-1/film-1'),
      hostId: 'host-1',
      coverImage: cover.coverImage ?? '',
      coverImageAlt: cover.coverImageAlt ?? '',
    })

  it('fills an empty cover with the frame the film records, and its description', () => {
    expect(pick(film())).toEqual({
      coverVideo: 'media:host-1/film-1',
      coverImage: '/api/media/cdn/host-1/film-1?poster=1',
      coverImageAlt: 'Cranes over the harbor at dawn',
    })
  })

  it('names the site in an org film’s frame, as the cover would resolve there', () => {
    expect(
      pick(film({ src: 'media:org:org-1/film-1', visibleTo: ['host:host-1'] })),
    ).toEqual(
      expect.objectContaining({
        coverVideo: 'media:org:org-1/film-1',
        coverImage: '/api/media/cdn/org:org-1:host-1/film-1?poster=1',
      }),
    )
  })

  it('keeps a cover the author already chose', () => {
    const picked = pick(film(), {
      coverImage: 'media:host-1/hero',
      coverImageAlt: 'The crew on deck',
    })
    expect(picked).toEqual({ coverVideo: 'media:host-1/film-1' })
  })

  it('leaves the cover empty for a film with no captured frame', () => {
    const picked = pick(
      film({ poster: undefined, posterError: 'browser could not decode this video' }),
    )
    expect(picked).toEqual({ coverVideo: 'media:host-1/film-1' })
  })

  it('fills nothing from a film the CDN cannot serve a frame for', () => {
    // A free-tier film has no CDN path, so its stored form is the raw
    // storage URL, which has no poster to ask for.
    const raw = film({ cdnPath: undefined })
    const picked = pick({ ...raw, src: raw.url })
    expect(picked).toEqual({ coverVideo: raw.url })
  })

  it('keeps a description the author already wrote', () => {
    expect(pick(film(), { coverImageAlt: 'Written by hand' })).toEqual(
      expect.objectContaining({ coverImageAlt: 'Written by hand' }),
    )
  })

  it('leaves the description blank for a film with none', () => {
    expect(pick(film({ alt: undefined }))).toEqual(
      expect.objectContaining({ coverImageAlt: '' }),
    )
  })

  it('refuses a file that is not a video', () => {
    expect(pick(film({ contentType: 'image/png' }))).toBeNull()
  })
})

describe('the featured video field (AGL-2954)', () => {
  const renderField = (value: string) => {
    const onValueChange = jest.fn()
    const onChoose = jest.fn()
    render(
      <EntryCoverVideoField
        hostId="host-1"
        value={value}
        onValueChange={onValueChange}
        onChoose={onChoose}
      />,
    )
    return { onValueChange, onChoose }
  }

  it('previews the frame a library film records', () => {
    mockMediaDocs.set('hosts/host-1/media/film-1', film())
    renderField('media:host-1/film-1')
    expect(
      screen.getByRole('img', { name: 'Featured video poster' }).getAttribute('src'),
    ).toBe('/api/media/cdn/host-1/film-1?poster=1&w=640')
  })

  it('shows a placeholder, never a guessed frame, for a film without one', () => {
    mockMediaDocs.set(
      'hosts/host-1/media/film-1',
      film({ poster: undefined, posterError: 'could not seek to a poster frame' }),
    )
    renderField('media:host-1/film-1')
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Video from your media library')).toBeTruthy()
    expect(screen.getByText('media:host-1/film-1')).toBeTruthy()
  })

  it('shows no frame for an org film this site may not use', () => {
    mockMediaDocs.set(
      'orgs/org-1/media/film-1',
      film({ visibleTo: ['host:host-2'] }),
    )
    renderField('media:org:org-1/film-1')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('names a Wistia link, and reads nothing for it', () => {
    renderField('https://acme.wistia.com/medias/e4a27b971d')
    expect(screen.getByText('Wistia video')).toBeTruthy()
    expect(
      screen.getByText('https://acme.wistia.com/medias/e4a27b971d'),
    ).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('offers Choose when empty, and Replace and Clear once set', () => {
    const empty = renderField('')
    expect(screen.getByText('No featured video')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Choose video' }))
    expect(empty.onChoose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })

  it('clears to an empty value', () => {
    const { onValueChange } = renderField('https://videos.example/harbor.mp4')
    expect(screen.getByText('Linked video')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Replace video' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onValueChange).toHaveBeenCalledWith('')
  })
})

/** The entry detail page, at the address that names one entry. */
const renderEntry = (entryId: string) => {
  mockParams.entryId = entryId
  return render(
    <ContentScopeProvider>
      <EntryDetailPage />
    </ContentScopeProvider>,
  )
}

/** The featured video field's own controls, found from its link input. */
const videoField = () =>
  screen
    .getByRole('textbox', { name: 'Featured video link' })
    .closest('.MuiStack-root') as HTMLElement

const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
  return mockSetDoc.mock.calls[0][1] as Record<string, unknown>
}

describe('the entry page stores a featured video (AGL-2954)', () => {
  it('opens the one picker narrowed to video, and saves the film with its frame as the cover', async () => {
    renderEntry('entry-1')
    expect(mockPicker.props?.['open']).toBe(false)

    fireEvent.click(
      within(videoField()).getByRole('button', { name: 'Choose video' }),
    )
    expect(mockPicker.props).toEqual(
      expect.objectContaining({ open: true, kind: 'video' }),
    )
    act(() => {
      mockPicker.props?.['onPick'](film())
    })

    const payload = await save()
    expect(payload['coverVideo']).toBe('media:host-1/film-1')
    expect(payload['coverImage']).toBe('/api/media/cdn/host-1/film-1?poster=1')
    expect(payload['coverImageAlt']).toBe('Cranes over the harbor at dawn')
  })

  it('leaves the cover and body pickers unnarrowed', () => {
    renderEntry('entry-1')
    fireEvent.click(screen.getByRole('button', { name: 'Choose image' }))
    expect(mockPicker.props).toEqual(expect.objectContaining({ open: true }))
    expect(mockPicker.props?.['kind']).toBeUndefined()
  })

  it('refuses a pick that is not a video, and stores nothing from it', async () => {
    renderEntry('entry-1')
    fireEvent.click(
      within(videoField()).getByRole('button', { name: 'Choose video' }),
    )
    act(() => {
      mockPicker.props?.['onPick'](
        film({ contentType: 'image/png', cdnPath: '/api/media/cdn/host-1/hero' }),
      )
    })
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'That file is not a video. Choose a video for the featured video.',
      expect.objectContaining({ variant: 'warning' }),
    )

    const payload = await save()
    expect(payload['coverVideo']).toBe('__delete__')
    expect(payload['coverImage']).toBe('')
  })

  it('keeps a stored film through an unrelated save', async () => {
    renderEntry('entry-2')
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'The night crew, again' },
    })
    const payload = await save()
    expect(payload['coverVideo']).toBe('media:host-1/film-1')
  })

  it('deletes the field once the video is cleared', async () => {
    renderEntry('entry-2')
    fireEvent.click(within(videoField()).getByRole('button', { name: 'Clear' }))
    const payload = await save()
    // Deleted, not stored blank: a field left behind would still read as a
    // film to anything that tests for it.
    expect(payload['coverVideo']).toBe('__delete__')
  })

  it('stores a pasted link as typed, trimmed', async () => {
    renderEntry('entry-1')
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Featured video link' }),
      { target: { value: '  https://acme.wistia.com/medias/e4a27b971d ' } },
    )
    const payload = await save()
    expect(payload['coverVideo']).toBe('https://acme.wistia.com/medias/e4a27b971d')
  })
})
