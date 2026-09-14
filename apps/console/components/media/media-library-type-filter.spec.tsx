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

import { act, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { MediaLibraryComponent } from './media-library.component'

// ---------------------------------------------------------------------------
// The boundary. Firestore, fetch and the console's context providers are
// faked; every hook and handler inside the library runs for real, including
// the listener hooks the grid and the rail read through.
//
// The fake ANSWERS the grid's queries rather than echoing the collection back:
// each `where` the component builds is applied to the seeded documents, so a
// constraint that matches nothing renders the empty grid a person would see.
// ---------------------------------------------------------------------------

jest.mock('firebase/firestore', () => {
  let autoId = 0
  const pathOf = (parent: { path?: string } | undefined, segments: string[]) =>
    [parent?.path, ...segments].filter(Boolean).join('/')
  const docSnapshot = (ref: { id: string; path: string }) => {
    const data = mockDb.docs.get(ref.path)
    return {
      id: ref.id,
      ref,
      exists: () => data !== undefined,
      data: () => (data ? { ...data } : undefined),
      get: (field: string) => data?.[field],
      metadata: { fromCache: false, hasPendingWrites: false },
    }
  }
  const querySnapshot = (ref: {
    path: string
    constraints?: MockConstraint[]
  }) => {
    const docs = mockAnswer(ref).map((row) => ({
      id: row.id,
      ref: { type: 'document', id: row.id, path: `${ref.path}/${row.id}` },
      exists: () => true,
      data: () => ({ ...row.data }),
      get: (field: string) => row.data[field],
    }))
    return {
      docs,
      size: docs.length,
      empty: docs.length === 0,
      metadata: { fromCache: false, hasPendingWrites: false },
      docChanges: () => [],
    }
  }
  return {
    __esModule: true,
    collection: (parent: { path?: string }, ...segments: string[]) => ({
      type: 'collection',
      id: segments[segments.length - 1],
      path: pathOf(parent, segments),
    }),
    doc: (parent: { path?: string }, ...segments: string[]) => {
      const path = pathOf(
        parent,
        segments.length ? segments : [`auto-${(autoId += 1)}`],
      )
      const cut = path.lastIndexOf('/')
      return {
        type: 'document',
        id: path.slice(cut + 1),
        path,
        parent: { path: path.slice(0, cut) },
      }
    },
    query: (ref: { path: string }, ...constraints: MockConstraint[]) => ({
      type: 'query',
      path: ref.path,
      constraints,
    }),
    where: (...args: unknown[]) => ({ kind: 'where', args }),
    orderBy: (...args: unknown[]) => ({ kind: 'orderBy', args }),
    limit: (count: number) => ({ kind: 'limit', args: [count] }),
    startAfter: (...args: unknown[]) => ({ kind: 'startAfter', args }),
    serverTimestamp: () => ({ kind: 'serverTimestamp' }),
    Timestamp: {
      fromMillis: (ms: number) => ({
        seconds: Math.floor(ms / 1000),
        nanoseconds: 0,
        toMillis: () => ms,
      }),
    },
    onSnapshot: (
      ref: { type: string; id: string; path: string },
      ...rest: unknown[]
    ) => {
      const next = rest.find(
        (arg) => typeof arg === 'function',
      ) as MockSnapshotListener
      const timer = setTimeout(
        () =>
          next(
            ref.type === 'document'
              ? docSnapshot(ref)
              : querySnapshot(ref as never),
          ),
        0,
      )
      return () => clearTimeout(timer)
    },
    getDoc: async (ref: { id: string; path: string }) => docSnapshot(ref),
    getDocs: async (ref: { path: string; constraints?: MockConstraint[] }) => {
      if (ref.path.endsWith('/media')) mockGridQueries.push(ref)
      return querySnapshot(ref)
    },
    getCountFromServer: async (ref: {
      path: string
      constraints?: MockConstraint[]
    }) => ({
      data: () => ({ count: mockAnswer(ref).length }),
    }),
    updateDoc: async () => undefined,
    writeBatch: () => ({
      set: () => undefined,
      update: () => undefined,
      delete: () => undefined,
      commit: async () => undefined,
    }),
  }
})

jest.mock(
  '@aglyn/tenant-feature-instance/hooks/firebase/firebase-services',
  () => ({
    __esModule: true,
    useFirestore: () => mockFirestore,
    useUser: () => mockUserState,
  }),
)

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  useUser: () => mockUserState,
  useHostActivityLogger: () => mockLogActivity,
  useScopeTokens: jest.requireActual(
    '@aglyn/tenant-feature-instance/hooks/use-scope-tokens',
  ).useScopeTokens,
  useFirestoreCollection: jest.requireActual(
    '@aglyn/tenant-feature-instance/hooks/use-firestore-collection',
  ).useFirestoreCollection,
  useFirestoreDoc: jest.requireActual(
    '@aglyn/tenant-feature-instance/hooks/use-firestore-doc',
  ).useFirestoreDoc,
}))

jest.mock('../../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => mockCurrentOrg,
  useCurrentOrg: () => mockCurrentOrg,
}))

jest.mock('../../hooks/use-org-hosts', () => ({
  __esModule: true,
  default: () => mockOrgHosts,
  useOrgHosts: () => mockOrgHosts,
}))

jest.mock('../../hooks/use-release-flags', () => ({
  __esModule: true,
  useReleaseFlag: () => mockReleaseFlag,
}))

jest.mock('../../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgSlug: () => 'aglyn-org',
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => mockSnackbar,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: (props: { href: string; children?: unknown }) =>
    jest
      .requireActual('react')
      .createElement('a', { href: props.href }, props.children),
  useConfirmationContext: () => mockConfirmation,
}))

jest.mock('@aglyn/shared-ui-jsx/components/empty-state.component', () => ({
  __esModule: true,
  default: (props: { label?: unknown; action?: unknown }) =>
    jest
      .requireActual('react')
      .createElement('div', null, props.label, props.action),
}))

type MockSnapshotListener = (snapshot: unknown) => void

interface MockConstraint {
  kind: string
  args: unknown[]
}

interface MockRow {
  id: string
  data: Record<string, unknown>
}

// Stable references, as the real providers hand out: a fake that built a new
// object per render would itself be a dependency that changes every render.
const mockFirestore = { kind: 'fake-firestore' }
const mockUserState = {
  data: { uid: 'user-1', getIdToken: async () => 'id-token' },
}
const mockLogActivity = jest.fn()
const mockSnackbar = { enqueueSnackbar: jest.fn(), closeSnackbar: jest.fn() }
const mockConfirmation = { confirm: () => Promise.resolve() }
const mockReleaseFlag = {
  released: true,
  visible: true,
  staffPreview: false,
  isStaff: false,
  ready: true,
}
const mockCurrentOrg = {
  org: { $id: 'org-1' },
  orgId: 'org-1',
  ready: true,
  entitlementsFromCache: false,
}
const mockOrgHosts = { hosts: [], ready: true, error: false, retry: () => undefined }
const mockDb = {
  collections: new Map<string, MockRow[]>(),
  docs: new Map<string, Record<string, unknown>>(),
}
/** Every read of the media collection the grid made, in order. */
const mockGridQueries: Array<{ path: string; constraints?: MockConstraint[] }> =
  []

/**
 * One `where`, with Firestore's range semantics over strings. Anything the
 * grid does not send in these tests throws, so the model cannot quietly
 * answer a query it does not understand.
 */
function mockMatches(data: Record<string, unknown>, where: unknown[]) {
  const [field, op, bound] = where as [string, string, unknown]
  const value = data[field]
  switch (op) {
    case '==':
      return value === bound
    case '>=':
    case '<':
      if (typeof bound !== 'string') {
        throw new Error(`unmodelled ${op} bound on ${field}`)
      }
      if (typeof value !== 'string') return false
      return op === '>=' ? value >= bound : value < bound
    case 'array-contains':
      return Array.isArray(value) && value.includes(bound)
    case 'array-contains-any':
      return (
        Array.isArray(value) &&
        (bound as unknown[]).some((token) => value.includes(token))
      )
    default:
      throw new Error(`unmodelled operator '${op}'`)
  }
}

/** The rows a query over the fake collection returns. */
function mockAnswer(ref: { path: string; constraints?: MockConstraint[] }) {
  const wheres = (ref.constraints ?? []).filter((c) => c?.kind === 'where')
  return (mockDb.collections.get(ref.path) ?? []).filter((row) =>
    wheres.every((c) => mockMatches(row.data, c.args)),
  )
}

const CREATED = Math.floor(Date.now() / 1000) - 3600

const ASSETS: Array<[fileName: string, contentType: string]> = [
  ['hero.png', 'image/png'],
  ['logo.webp', 'image/webp'],
  ['banner.jpg', 'image/jpeg'],
  ['launch.mp4', 'video/mp4'],
  ['teaser.webm', 'video/webm'],
  ['interview.mov', 'video/quicktime'],
  ['guide.pdf', 'application/pdf'],
  ['brand-kit.zip', 'application/zip'],
]

const filesOf = (family: string) =>
  ASSETS.filter(([, type]) => type.startsWith(family)).map(([name]) => name)

function seedHostLibrary() {
  mockDb.collections.set(
    'hosts/host-1/media',
    ASSETS.map(([fileName, contentType], index) => ({
      id: fileName.replace(/\W/g, '-'),
      data: {
        fileName,
        contentType,
        sizeBytes: 240_000,
        url: `https://storage.example/${fileName}`,
        cdnPath: `/api/media/cdn/host-1/${fileName.replace(/\W/g, '-')}`,
        // Distinct, so Newest has one order to draw.
        createdAt: { seconds: CREATED - index },
        tags: [],
      },
    })),
  )
  mockDb.collections.set('hosts/host-1/mediaFolders', [])
  mockDb.docs.set('hosts/host-1/counters/media', {
    count: ASSETS.length,
    bytes: 1_000_000,
  })
  mockDb.docs.set('hosts/host-1', {
    name: 'Aglyn Marketing',
    subdomain: 'aglyn-marketing',
  })
}

/**
 * A bound as a person can read it in a failure message: every character
 * outside printable ASCII is spelled as its `\u` escape, so a missing U+F8FF
 * shows up as a difference instead of as two identical-looking strings.
 */
const spelled = (value: unknown) =>
  typeof value === 'string'
    ? value.replace(
        /[^\x20-\x7e]/g,
        (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
      )
    : value

/** The `contentType` bounds of one grid query, or null when it has none. */
function contentTypeRange(query: { constraints?: MockConstraint[] }) {
  const bounds = (query.constraints ?? [])
    .filter((c) => c.kind === 'where' && c.args[0] === 'contentType')
    .map((c) => [c.args[1], c.args[2]] as [string, string])
  if (!bounds.length) return null
  return {
    lower: spelled(bounds.find(([op]) => op === '>=')?.[1]),
    upper: spelled(bounds.find(([op]) => op === '<')?.[1]),
  }
}

/** The last grid query that narrowed by content type. */
function lastTypedQuery() {
  const typed = mockGridQueries.filter((query) => contentTypeRange(query))
  return typed[typed.length - 1]
}

/** Lets every pending read resolve and every state update it causes land. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderLibrary(
  props: Partial<Parameters<typeof MediaLibraryComponent>[0]> = {},
) {
  render(<MediaLibraryComponent hostId="host-1" {...props} />)
  await screen.findAllByRole(
    'button',
    { name: 'File actions' },
    { timeout: 60_000 },
  )
  await settle()
}

/** The Type select, found by its label rather than by position. */
const typeSelect = () => screen.getByRole('combobox', { name: /^Type\b/ })

async function chooseType(label: string) {
  fireEvent.mouseDown(typeSelect())
  fireEvent.click(await screen.findByRole('option', { name: label }))
  await settle()
}

beforeEach(() => {
  mockDb.collections.clear()
  mockDb.docs.clear()
  mockGridQueries.length = 0
  seedHostLibrary()
  global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(input).includes('/api/media/quarantine')
        ? { quarantined: {} }
        : {},
  })) as unknown as typeof fetch
})

/**
 * The Images and Video filters under a date sort (AGL-2952).
 *
 * Newest and Oldest move the Type facet into the query as a RANGE on
 * `contentType`: at least `video/`, and below `video/` followed by U+F8FF, a
 * character that sorts above everything a content type is spelled with. The
 * upper bound is what makes the range a prefix match. Without the U+F8FF the
 * two bounds are the same string, no content type is both at least it and
 * below it, and the filter answers "No media matches these filters" in a
 * library full of video.
 *
 * Newest is the default sort, so this is the filter as most people meet it.
 * The model above applies the query to the seeded documents, which is what
 * turns a wrong bound into the empty grid rather than into a string nobody
 * looks at.
 */
describe('the Type filter under a date sort (AGL-2952)', () => {
  const FAMILIES = [
    ['Video', 'video/'],
    ['Images', 'image/'],
  ] as const

  it.each(FAMILIES)(
    '%s bounds the range above every %s type',
    async (label, family) => {
      await renderLibrary()
      await chooseType(label)

      const query = lastTypedQuery()
      expect(query).toBeDefined()
      expect(contentTypeRange(query)).toEqual({
        lower: family,
        upper: `${family}\\uf8ff`,
      })
      // Every file of the family is inside the range, and nothing else is.
      expect(
        mockAnswer(query)
          .map((row) => row.data['fileName'])
          .sort(),
      ).toEqual([...filesOf(family)].sort())
    },
    120_000,
  )

  it.each(FAMILIES)(
    '%s lists every %s file rather than an empty grid',
    async (label, family) => {
      await renderLibrary()
      await chooseType(label)

      expect(lastTypedQuery()).toBeDefined()
      expect(screen.queryByText('No media matches these filters')).toBeNull()
      for (const fileName of filesOf(family)) {
        expect(screen.getByText(fileName)).toBeTruthy()
      }
      expect(screen.queryByText('guide.pdf')).toBeNull()
    },
    120_000,
  )

  /**
   * The bound is one invisible character, and a literal copy of it is what an
   * editor or a formatter can drop without anyone seeing the diff. The source
   * spells it as an escape, and holds no literal U+F8FF anywhere.
   */
  it('spells the bound as an escape in the source', () => {
    const source = readFileSync(
      join(__dirname, 'media-library.component.tsx'),
      'utf8',
    )
    expect(source).toContain("where('contentType', '<', `${prefix}\\uf8ff`)")
    expect(source).not.toMatch(/\uf8ff/)
  })
})
