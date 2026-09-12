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

import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { MediaLibraryComponent } from './media-library.component'

// ---------------------------------------------------------------------------
// The boundary. Firestore, fetch and the console's context providers are
// faked; every hook and handler inside the library runs for real, including
// the listener hooks the grid and the rail read through.
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
  const querySnapshot = (ref: { path: string }) => {
    const docs = (mockDb.collections.get(ref.path) ?? []).map((row) => ({
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
    query: (ref: { path: string }, ...constraints: unknown[]) => ({
      type: 'query',
      path: ref.path,
      constraints,
    }),
    where: (...args: unknown[]) => ({ kind: 'where', args }),
    orderBy: (...args: unknown[]) => ({ kind: 'orderBy', args }),
    limit: (count: number) => ({ kind: 'limit', count }),
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
      mockCalls.onSnapshot += 1
      const next = rest.find(
        (arg) => typeof arg === 'function',
      ) as MockSnapshotListener
      const timer = setTimeout(
        () =>
          next(ref.type === 'document' ? docSnapshot(ref) : querySnapshot(ref)),
        0,
      )
      return () => clearTimeout(timer)
    },
    getDoc: async (ref: { id: string; path: string }) => docSnapshot(ref),
    getDocs: async (ref: { path: string }) => {
      mockCalls.getDocs += 1
      return querySnapshot(ref)
    },
    getDocsFromServer: async (ref: { path: string }) => querySnapshot(ref),
    getCountFromServer: async (ref: { path: string }) => ({
      data: () => ({ count: (mockDb.collections.get(ref.path) ?? []).length }),
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

type MockSnapshotListener = (value: unknown) => void

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
const mockOrgHosts = {
  hosts: [
    { $id: 'host-1', name: 'Aglyn Marketing', subdomain: 'aglyn-marketing' },
    { $id: 'host-2', name: 'Docs', subdomain: 'docs' },
  ],
  ready: true,
  error: false,
  retry: () => undefined,
}
const mockCalls = { onSnapshot: 0, getDocs: 0 }
const mockDb = {
  collections: new Map<
    string,
    Array<{ id: string; data: Record<string, unknown> }>
  >(),
  docs: new Map<string, Record<string, unknown>>(),
}

const CREATED = Math.floor(Date.now() / 1000) - 3600

function seedLibrary(base: string, orgLibrary: boolean) {
  const scope = orgLibrary ? { visibleTo: ['org'] } : {}
  const asset = (id: string, fields: Record<string, unknown>) => ({
    id,
    data: {
      fileName: `${id}.png`,
      contentType: 'image/png',
      sizeBytes: 240_000,
      url: `https://storage.example/${id}`,
      cdnPath: `/api/media/cdn/${base}/${id}`,
      createdAt: { seconds: CREATED },
      tags: [],
      ...scope,
      ...fields,
    },
  })
  mockDb.collections.set(`${base}/media`, [
    asset('hero', {
      fileName: 'hero.png',
      tags: ['brand', 'hero'],
      folderId: 'covers',
      alt: 'Hero',
      width: 1600,
      height: 900,
    }),
    asset('logo', { fileName: 'logo.webp', contentType: 'image/webp' }),
    asset('launch', {
      fileName: 'launch.mp4',
      contentType: 'video/mp4',
      sizeBytes: 48_000_000,
    }),
    asset('guide', { fileName: 'guide.pdf', contentType: 'application/pdf' }),
    asset('banner', {
      fileName: 'banner.jpg',
      contentType: 'image/jpeg',
      folderId: 'blog',
      customMetadata: { campaign: 'fall' },
    }),
  ])
  mockDb.collections.set(`${base}/mediaFolders`, [
    { id: 'covers', data: { name: 'Covers', parentId: null, ...scope } },
    { id: 'blog', data: { name: 'Blog', parentId: null, ...scope } },
    { id: 'archive', data: { name: 'Archive', parentId: 'blog', ...scope } },
  ])
  mockDb.docs.set(`${base}/counters/media`, { count: 5, bytes: 49_000_000 })
}

// ---------------------------------------------------------------------------
// The burst.
// ---------------------------------------------------------------------------

/**
 * Past React's NESTED_UPDATE_LIMIT of 50, with margin. The production report
 * threw on the 51st update.
 */
const BURST = 60

const DEPTH = /Maximum update depth exceeded/

let depthErrors: string[] = []

/**
 * React reports error #185 by dispatching a `window` error, not by throwing
 * out of `dispatchEvent`, so it has to be caught here rather than with
 * `expect(…).toThrow`.
 */
const onWindowError = (event: ErrorEvent) => {
  const message = String(event.error?.message ?? event.message ?? '')
  if (!DEPTH.test(message)) return
  depthErrors.push(message)
  event.preventDefault()
}

/**
 * Type outside `act`.
 *
 * `act` drains the scheduler between events, which is the one thing a burst
 * of keystrokes does not do — and draining it resets the nested-update count
 * React is being asked about. Inside `act` this suite cannot fail.
 */
function outsideAct(run: () => void) {
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const previous = env.IS_REACT_ACT_ENVIRONMENT
  env.IS_REACT_ACT_ENVIRONMENT = false
  try {
    run()
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = previous
  }
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * `BURST` keystrokes into a controlled field, the way a browser sends them.
 * Returns what the field should read afterwards.
 */
function type(field: HTMLInputElement) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  const start = field.value
  outsideAct(() => {
    for (let index = 1; index <= BURST && field.isConnected; index += 1) {
      setValue?.call(field, `${start}${'a'.repeat(index)}`)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  return `${start}${'a'.repeat(BURST)}`
}

/**
 * Render with MUI on its PRODUCTION path, which is the one that shipped.
 *
 * MUI reads `process.env.NODE_ENV` when it renders, and its development path
 * hands `FormControl` a fresh `registerEffect` every render. That alone makes
 * the context object new every render, which re-runs the same `InputBase`
 * effect this issue is about — so under jest's default `NODE_ENV=test` every
 * field on the page looks guilty and nothing can be told apart. React itself
 * is unaffected: its build was chosen when the module was first required.
 */
async function renderInProductionMui(run: () => Promise<void>) {
  const previous = process.env.NODE_ENV
  ;(process.env as Record<string, string>).NODE_ENV = 'production'
  try {
    await run()
  } finally {
    ;(process.env as Record<string, string>).NODE_ENV = previous as string
  }
}

async function openDetails(fileName: string) {
  const card = (await screen.findByText(fileName)).closest('.MuiCard-root')
  if (!card) throw new Error(`no card for ${fileName}`)
  fireEvent.click(
    within(card as HTMLElement).getByRole('button', { name: 'File actions' }),
  )
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Details' }))
  await screen.findByRole('textbox', { name: 'File name' })
  const drawer = document.querySelector('.MuiDrawer-paper')
  if (!drawer) throw new Error('no drawer')
  return drawer as HTMLElement
}

/**
 * A burst of keystrokes on the media page must not exceed React's update
 * depth (AGL-2854).
 *
 * The production report was one `client-errors` entry from
 * `/aglyn-org/hosts/aglyn-marketing/media`: React error #185, thrown out of
 * the details drawer's Alt text `onChange` while someone captioned a file
 * they had just uploaded. React unmounts the tree when it throws that, so
 * the media page went blank mid-edit.
 *
 * The field was never the cause. Every keystroke anywhere on the page
 * re-renders the library, and the SEARCH BOX built its magnifier adornment
 * inline — a new element each time. `InputBase` reports the adornment up to
 * its `FormControl` from a passive effect keyed on that element, so the
 * effect re-ran on every render and called `setAdornedStart` with the value
 * the state already held. React cannot take the eager-bailout path there —
 * the fiber's alternate still carries the lanes of the render being
 * committed — so each call enqueued a real update during the commit's
 * passive flush. React counts those and never resets the count while they
 * keep arriving, which is why the 51st keystroke threw and the first fifty
 * looked fine.
 *
 * The loop belonged to neither control alone: it needed one to be typed in
 * and another to be re-rendered. `media-search-field.spec.tsx` drives the
 * same pair in isolation; this one drives the real page.
 */
describe('MediaLibraryComponent under a burst of input events (AGL-2854)', () => {
  beforeEach(() => {
    mockDb.collections.clear()
    mockDb.docs.clear()
    seedLibrary('hosts/host-1', false)
    seedLibrary('orgs/org-1', true)
    mockDb.docs.set('hosts/host-1', {
      name: 'Aglyn Marketing',
      subdomain: 'aglyn-marketing',
    })
    mockDb.docs.set('orgs/org-1/members/user-1', { role: 'owner' })
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(input).includes('/api/media/quarantine')
          ? { quarantined: {} }
          : {},
    })) as unknown as typeof fetch
    depthErrors = []
    window.addEventListener('error', onWindowError)
  })

  afterEach(() => {
    window.removeEventListener('error', onWindowError)
  })

  it('captions a file: the drawer survives a burst on Alt text', async () => {
    await renderInProductionMui(async () => {
      render(<MediaLibraryComponent hostId="host-1" />)
      await screen.findAllByRole(
        'button',
        { name: 'File actions' },
        { timeout: 120_000 },
      )
      await settle()
      const drawer = await openDetails('logo.webp')
      await settle()
      const alt = within(drawer).getByRole('textbox', {
        name: 'Alt text',
      }) as HTMLInputElement
      await act(async () => {
        alt.focus()
      })
      await settle()

      const typed = type(alt)
      await settle()

      expect(depthErrors).toEqual([])
      // React unmounts the tree when it throws #185, so a drawer that is
      // still on screen holding what was typed is the other half of the
      // claim — and it fails on its own if the burst never reached the field.
      expect(alt.isConnected).toBe(true)
      expect(alt.value).toBe(typed)
    })
  }, 240_000)
})
