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
 * MEDIA SHARING FOLLOWS "Edit the workspace media library" (AGL-4047).
 *
 * The rules' `canWriteOrgMedia` and the folders route's `resolveMediaScope` both
 * refuse a sharing write without `org.media`. The controls used to show on
 * `viewerOrgWide` alone, so a member of the whole workspace without the key
 * chose a site and the save failed. They are switched off with the permission
 * named, on the real library, in each of the three places sharing is changed.
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

// The plugin zone beside Upload media (AGL-3602) draws registered widgets,
// which this suite registers none of; `plugin-widget-slot-zones.spec.tsx`
// renders it.
jest.mock('../plugin-widget-slot.component', () => ({ __esModule: true, default: () => null }))

// The sharing controls read the key (AGL-4047); each case below says who is reading.
jest.mock('../../hooks/use-org-permissions', () => {
  const read = () => mockPermissions
  return { __esModule: true, default: read, useOrgPermissions: read }
})

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

let mockPermissions: { loaded: boolean; can: (key: string) => boolean; permissions: object; granted: object }

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

const REFUSAL = 'Your role does not include "Edit the workspace media library" — ask an organization admin'

const HOLDER = { loaded: true, can: () => true, permissions: {}, granted: {} }
const REFUSED = { loaded: true, can: (key: string) => key !== 'org.media', permissions: {}, granted: {} }
const LOADING = { loaded: false, can: () => true, permissions: {}, granted: {} }

async function mountLibrary() {
  render(<MediaLibraryComponent orgId="org-1" />)
  await screen.findAllByRole('button', { name: 'File actions' }, { timeout: 120_000 })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** The Shared with control in a file's details drawer. */
async function drawerSelect(fileName: string) {
  const card = (await screen.findByText(fileName)).closest('.MuiCard-root')
  fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'File actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Details' }))
  await screen.findByRole('textbox', { name: 'File name' })
  const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
  const label = within(drawer).getByText('Shared with')
  const box = label.parentElement as HTMLElement
  return box.querySelector('.MuiSelect-select') as HTMLElement
}

/** The Shared with… entry in a folder's menu. */
async function folderItem(folderName: string) {
  const card = (await screen.findAllByText(folderName))
    .map((node) => node.closest('.MuiCard-root'))
    .find(Boolean) as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: 'Folder actions' }))
  return screen.findByRole('menuitem', { name: 'Shared with…' })
}

/** The Shared with… button of a selection. */
async function bulkButton(fileName: string) {
  const card = (await screen.findByText(fileName)).closest('.MuiCard-root') as HTMLElement
  fireEvent.click(within(card).getByRole('checkbox'))
  return (await screen.findByRole('button', { name: 'Shared with…' })) as HTMLButtonElement
}

describe('the org library’s sharing controls', () => {
  beforeEach(() => {
    mockDb.collections.clear()
    mockDb.docs.clear()
    seedLibrary('orgs/org-1', true)
    mockDb.docs.set('orgs/org-1/members/user-1', { role: 'editor', allHosts: true })
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => (String(input).includes('/api/media/quarantine') ? { quarantined: {} } : {}),
    })) as unknown as typeof fetch
  })

  describe('a member of the whole workspace without the key', () => {
    beforeEach(() => {
      mockPermissions = REFUSED
    })

    it('finds the drawer’s control switched off, naming the permission', async () => {
      await mountLibrary()
      const select = await drawerSelect('logo.webp')
      expect(select.getAttribute('aria-disabled')).toBe('true')
      expect(select.closest(`[aria-label='${REFUSAL.replace(/'/g, "\\'")}']`)).not.toBeNull()
    }, 240_000)

    it('finds a folder’s Shared with… switched off, naming the permission', async () => {
      await mountLibrary()
      const item = await folderItem('Covers')
      expect(item.getAttribute('aria-disabled')).toBe('true')
      expect(screen.getByLabelText(REFUSAL).contains(item)).toBe(true)
    }, 240_000)

    it('finds a selection’s Shared with… switched off, naming the permission', async () => {
      await mountLibrary()
      const button = await bulkButton('logo.webp')
      expect(button.disabled).toBe(true)
      expect(screen.getByLabelText(REFUSAL).contains(button)).toBe(true)
    }, 240_000)
  })

  describe('a holder (negative control)', () => {
    beforeEach(() => {
      mockPermissions = HOLDER
    })

    it('has all three on, and no reason anywhere', async () => {
      await mountLibrary()
      const button = await bulkButton('logo.webp')
      expect(button.disabled).toBe(false)
      const item = await folderItem('Covers')
      expect(item.getAttribute('aria-disabled')).toBeNull()
      fireEvent.keyDown(item, { key: 'Escape' })
      expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    }, 240_000)

    it('has the drawer’s control on', async () => {
      await mountLibrary()
      const select = await drawerSelect('logo.webp')
      expect(select.getAttribute('aria-disabled')).toBeNull()
      expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    }, 240_000)
  })

  describe('while permissions load', () => {
    beforeEach(() => {
      mockPermissions = LOADING
    })

    it('holds the controls with no refusal said', async () => {
      await mountLibrary()
      const select = await drawerSelect('logo.webp')
      expect(select.getAttribute('aria-disabled')).toBe('true')
      expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    }, 240_000)
  })
})
