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
 * MEDIA SHARING AND WRITES FOLLOW "Edit the workspace media library" (AGL-4047).
 *
 * The rules' `canWriteOrgMedia` and the folders route's `resolveMediaScope` both
 * refuse a sharing write without `org.media`. The controls used to show on
 * `viewerOrgWide` alone, so a member of the whole workspace without the key
 * chose a site and the save failed. They are switched off with the permission
 * named, on the real library, in each of the three places sharing is changed.
 *
 * So is everything else the same doors refuse: Upload, New folder, New subfolder,
 * Replace file, Edit image, File info, "Find where this is used", Make private,
 * Rename, Move, tags and Delete, on the toolbar, the file, the folder, a selection
 * and the drawer. Copy temporary link stays on, for a site's collaborator too,
 * because `/api/media/sign` asks only that the member can see the file.
 *
 * A site's own library answers the same way to the site's "Edit site content",
 * read as its door reads it, and the workspace's key has no say there.
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
const mockConfirmation: { confirm: (options?: { description?: string }) => Promise<void> } = {
  confirm: () => Promise.resolve(),
}
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

/**
 * The Shared with control in a file's details drawer: its All sites radio,
 * which stands for the whole field (AGL-4047). The field is one fieldset, so
 * its radios are on or off together.
 */
async function drawerSelect(fileName: string) {
  const card = (await screen.findByText(fileName)).closest('.MuiCard-root')
  fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'File actions' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Details' }))
  await screen.findByRole('textbox', { name: 'File name' })
  const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
  return within(drawer).getByRole('radio', { name: 'All sites' }) as HTMLInputElement
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
      expect(select.disabled).toBe(true)
      expect(select.closest(`[aria-label='${REFUSAL.replace(/'/g, "\\'")}']`)).not.toBeNull()
    }, 240_000)

    it('finds a folder’s Shared with… switched off, naming the permission', async () => {
      await mountLibrary()
      const item = await folderItem('Covers')
      expect(standing(item)).toBe('refused')
    }, 240_000)

    it('finds a selection’s Shared with… switched off, naming the permission', async () => {
      await mountLibrary()
      const button = await bulkButton('logo.webp')
      expect(standing(button)).toBe('refused')
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
      expect(select.disabled).toBe(false)
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
      expect(select.disabled).toBe(true)
      expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    }, 240_000)
  })
})

/** A file's overflow menu, opened on its card. */
async function fileMenu(fileName: string) {
  const card = (await screen.findByText(fileName)).closest('.MuiCard-root') as HTMLElement
  fireEvent.click(within(card).getByRole('button', { name: 'File actions' }))
  await screen.findByRole('menuitem', { name: 'Details' })
}

/** A menu entry's standing: on, held with no reason, or off with the permission named. */
function standing(element: HTMLElement) {
  const off = element.getAttribute('aria-disabled') === 'true' || (element as HTMLButtonElement).disabled === true
  if (!off) return 'on'
  return screen.queryAllByLabelText(REFUSAL).some((wrapper) => wrapper.contains(element)) ? 'refused' : 'held'
}

describe('the org library’s other writes', () => {
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

    it('finds a file’s Make private and Delete off, and its download and details on', async () => {
      await mountLibrary()
      await fileMenu('logo.webp')
      expect(standing(screen.getByRole('menuitem', { name: 'Make private' }))).toBe('refused')
      expect(standing(screen.getByRole('menuitem', { name: 'Delete' }))).toBe('refused')
      expect(standing(screen.getByRole('menuitem', { name: 'Download file' }))).toBe('on')
      expect(standing(screen.getByRole('menuitem', { name: 'Details' }))).toBe('on')
    }, 240_000)

    it('finds Upload and New folder off, on the toolbar and the rail', async () => {
      await mountLibrary()
      for (const button of screen.getAllByRole('button', { name: 'Upload media' })) {
        expect(standing(button)).toBe('refused')
      }
      const newFolders = screen.getAllByRole('button', { name: 'New folder' })
      expect(newFolders).toHaveLength(2)
      for (const button of newFolders) expect(standing(button)).toBe('refused')
    }, 240_000)

    it('refuses a dropped file, saying why, and uploads nothing', async () => {
      await mountLibrary()
      const posts = (global.fetch as jest.Mock).mock.calls.length
      const dropZone = screen.getByRole('button', { name: 'Upload media' }).closest('.MuiBox-root') as HTMLElement
      const dataTransfer = { types: ['Files'], files: [new File(['x'], 'a.png', { type: 'image/png' })] }
      fireEvent.drop(dropZone, { dataTransfer })
      expect(mockSnackbar.enqueueSnackbar).toHaveBeenCalledWith(REFUSAL, expect.anything())
      expect((global.fetch as jest.Mock).mock.calls.length).toBe(posts)
    }, 240_000)

    it('finds a file’s Replace file off', async () => {
      await mountLibrary()
      await fileMenu('logo.webp')
      expect(standing(screen.getByRole('menuitem', { name: 'Replace file' }))).toBe('refused')
    }, 240_000)

    it('finds a folder’s New subfolder off, on the card', async () => {
      await mountLibrary()
      await folderItem('Covers')
      expect(standing(screen.getByRole('menuitem', { name: 'New subfolder' }))).toBe('refused')
    }, 240_000)

    it('finds the drawer’s Replace, Edit image and usage scan off, and asks no door', async () => {
      await mountLibrary()
      await drawerSelect('logo.webp')
      const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
      for (const name of ['Replace file', 'Edit image', 'Find where this is used']) {
        expect([name, standing(within(drawer).getByRole('button', { name }))]).toEqual([name, 'refused'])
      }
      const asked = (global.fetch as jest.Mock).mock.calls.map(([input]) => String(input))
      expect(asked.filter((url) => url.includes('/api/media/metadata') || url.includes('/api/media/references'))).toEqual([])
    }, 240_000)

    it('keeps Copy temporary link on, which its route does not ask the key for', async () => {
      const library = mockDb.collections.get('orgs/org-1/media') as { id: string; data: Record<string, unknown> }[]
      const logo = library.find((row) => row.data.fileName === 'logo.webp') as { data: Record<string, unknown> }
      logo.data.private = true
      await mountLibrary()
      await fileMenu('logo.webp')
      expect(standing(screen.getByRole('menuitem', { name: 'Copy temporary link' }))).toBe('on')
      expect(standing(screen.getByRole('menuitem', { name: 'Publish file' }))).toBe('refused')
    }, 240_000)

    it('finds a folder’s Rename and Delete off', async () => {
      await mountLibrary()
      await folderItem('Covers')
      expect(standing(screen.getByRole('menuitem', { name: 'Rename' }))).toBe('refused')
      expect(standing(screen.getByRole('menuitem', { name: 'Delete' }))).toBe('refused')
    }, 240_000)

    it('finds a selection’s Move, tags and Delete off', async () => {
      await mountLibrary()
      await bulkButton('logo.webp')
      for (const name of ['Move to folder…', 'Add tag…', 'Remove tag…', 'Delete…']) {
        expect([name, standing(screen.getByRole('button', { name }))]).toEqual([name, 'refused'])
      }
    }, 240_000)

    it('finds the drawer’s fields, Save and Delete off, and the permission said once', async () => {
      await mountLibrary()
      await drawerSelect('logo.webp')
      const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
      for (const name of ['File name', 'Add a tag', 'Alt text', 'Description']) {
        expect([name, (within(drawer).getByRole('textbox', { name }) as HTMLInputElement).disabled]).toEqual([name, true])
      }
      expect(within(drawer).getByRole('alert').textContent).toBe(REFUSAL)
      expect(standing(within(drawer).getByRole('button', { name: 'Save' }))).toBe('refused')
      expect(standing(within(drawer).getByRole('button', { name: 'Delete file' }))).toBe('refused')
      expect(standing(within(drawer).getByRole('button', { name: 'Download file' }))).toBe('on')
    }, 240_000)
  })

  describe('a holder (negative control)', () => {
    beforeEach(() => {
      mockPermissions = HOLDER
    })

    it('has every write on, and no reason anywhere', async () => {
      await mountLibrary()
      await fileMenu('logo.webp')
      expect(standing(screen.getByRole('menuitem', { name: 'Make private' }))).toBe('on')
      expect(standing(screen.getByRole('menuitem', { name: 'Delete' }))).toBe('on')
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete' }), { key: 'Escape' })
      await bulkButton('logo.webp')
      for (const name of ['Move to folder…', 'Add tag…', 'Remove tag…', 'Delete…']) {
        expect([name, standing(screen.getByRole('button', { name }))]).toEqual([name, 'on'])
      }
      expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    }, 240_000)

    it('has Upload, New folder, Replace and the usage scan on', async () => {
      await mountLibrary()
      for (const button of screen.getAllByRole('button', { name: 'Upload media' })) {
        expect(standing(button)).toBe('on')
      }
      for (const button of screen.getAllByRole('button', { name: 'New folder' })) {
        expect(standing(button)).toBe('on')
      }
      await fileMenu('logo.webp')
      expect(standing(screen.getByRole('menuitem', { name: 'Replace file' }))).toBe('on')
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Replace file' }), { key: 'Escape' })
      await drawerSelect('logo.webp')
      const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
      for (const name of ['Replace file', 'Edit image', 'Find where this is used']) {
        expect([name, standing(within(drawer).getByRole('button', { name }))]).toEqual([name, 'on'])
      }
      expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    }, 240_000)
  })

  describe('while permissions load', () => {
    beforeEach(() => {
      mockPermissions = LOADING
    })

    it('holds the writes with no refusal said', async () => {
      await mountLibrary()
      await fileMenu('logo.webp')
      expect(standing(screen.getByRole('menuitem', { name: 'Delete' }))).toBe('held')
      expect(standing(screen.getByRole('menuitem', { name: 'Replace file' }))).toBe('held')
      expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    }, 240_000)
  })

  describe('a site’s collaborator, who reaches only the files shared with their site', () => {
    beforeEach(() => {
      mockPermissions = REFUSED
      mockDb.docs.set('orgs/org-1/members/user-1', {
        role: 'viewer',
        allHosts: false,
        hostAccess: { 'host-1': 'viewer' },
        scopeTokens: ['org', 'host:host-1'],
      })
      const library = mockDb.collections.get('orgs/org-1/media') as { id: string; data: Record<string, unknown> }[]
      const logo = library.find((row) => row.data.fileName === 'logo.webp') as { data: Record<string, unknown> }
      logo.data.private = true
    })

    it('has Copy temporary link, which its route admits for anyone who can see the file', async () => {
      await mountLibrary()
      await fileMenu('logo.webp')
      expect(standing(screen.getByRole('menuitem', { name: 'Copy temporary link' }))).toBe('on')
      // Still not theirs: its route refuses a member who does not reach every site.
      expect(screen.queryByRole('menuitem', { name: 'Publish file' })).toBeNull()
    }, 240_000)
  })
})

const SITE_REFUSAL = 'Your role does not include "Edit site content" — ask an organization admin'

/** A control's standing in a site's own library. */
function siteStanding(element: HTMLElement) {
  const off = element.getAttribute('aria-disabled') === 'true' || (element as HTMLButtonElement).disabled === true
  if (!off) return 'on'
  return screen.queryAllByLabelText(SITE_REFUSAL).some((wrapper) => wrapper.contains(element)) ? 'refused' : 'held'
}

describe('a site’s own library, which answers to the site’s key', () => {
  const mountSite = async () => {
    render(<MediaLibraryComponent hostId="host-1" />)
    await screen.findAllByRole('button', { name: 'File actions' }, { timeout: 120_000 })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const allOff = async (expected: 'on' | 'refused') => {
    for (const button of screen.getAllByRole('button', { name: 'Upload media' })) {
      expect(['Upload media', siteStanding(button)]).toEqual(['Upload media', expected])
    }
    for (const button of screen.getAllByRole('button', { name: 'New folder' })) {
      expect(['New folder', siteStanding(button)]).toEqual(['New folder', expected])
    }
    await fileMenu('logo.webp')
    for (const name of ['Replace file', 'Delete']) {
      expect([name, siteStanding(screen.getByRole('menuitem', { name }))]).toEqual([name, expected])
    }
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Delete' }), { key: 'Escape' })
    await drawerSelectSite('logo.webp')
    const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
    for (const name of ['Replace file', 'Edit image', 'Find where this is used', 'Save', 'Delete file']) {
      expect([name, siteStanding(within(drawer).getByRole('button', { name }))]).toEqual([name, expected])
    }
  }
  const drawerSelectSite = async (fileName: string) => {
    const card = (await screen.findByText(fileName)).closest('.MuiCard-root')
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'File actions' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Details' }))
    await screen.findByRole('textbox', { name: 'File name' })
  }

  beforeEach(() => {
    // The workspace's key has no say here, either way.
    mockPermissions = REFUSED
    mockDb.collections.clear()
    mockDb.docs.clear()
    seedLibrary('hosts/host-1', false)
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => (String(input).includes('/api/media/quarantine') ? { quarantined: {} } : {}),
    })) as unknown as typeof fetch
  })

  it.each(['admin', 'editor', 'author'])('leaves its controls on for a site %s, without the workspace’s key', async (role) => {
    mockDb.docs.set('hosts/host-1', { memberRoles: { 'user-1': role } })
    await mountSite()
    await allOff('on')
    expect(screen.queryByLabelText(SITE_REFUSAL)).toBeNull()
  }, 240_000)

  it('switches its controls off for a site viewer, naming the site’s key', async () => {
    mockDb.docs.set('hosts/host-1', { memberRoles: { 'user-1': 'viewer' } })
    await mountSite()
    await allOff('refused')
    expect(screen.queryByLabelText(REFUSAL)).toBeNull()
    const asked = (global.fetch as jest.Mock).mock.calls.map(([input]) => String(input))
    expect(asked.filter((url) => url.includes('/api/media/metadata') || url.includes('/api/media/references'))).toEqual([])
  }, 240_000)

  it('reads the site’s stamp before the role: an Author it refuses is off', async () => {
    mockDb.docs.set('hosts/host-1', {
      memberRoles: { 'user-1': 'author' },
      memberPermissions: { 'user-1': { 'site.edit': false } },
    })
    await mountSite()
    await allOff('refused')
  }, 240_000)

  it('reads the site’s stamp before the role: a Viewer it grants is on', async () => {
    mockDb.docs.set('hosts/host-1', {
      memberRoles: { 'user-1': 'viewer' },
      memberPermissions: { 'user-1': { 'site.edit': true } },
    })
    await mountSite()
    await allOff('on')
  }, 240_000)

  it('leaves staff, who are not on the roster, for the server to answer', async () => {
    mockDb.docs.set('hosts/host-1', { memberRoles: {} })
    await mountSite()
    await allOff('on')
  }, 240_000)
})

/**
 * "All sites except…" in the workspace library (AGL-4047): the drawer and a
 * folder's dialog choose it with the shared field, and the route writes it,
 * because its marker is the server's alone. The confirmation names the sites
 * left out that use the file, and does not promise that a link pasted into
 * custom HTML there stops loading: it doesn't.
 */
describe('sharing a file with all sites except some', () => {
  const posts = () =>
    (global.fetch as jest.Mock).mock.calls
      .filter(([input]) => String(input).includes('/api/media/folders'))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
  let confirmed: Array<{ description?: string }>

  beforeEach(() => {
    mockDb.collections.clear()
    mockDb.docs.clear()
    seedLibrary('orgs/org-1', true)
    mockDb.docs.set('orgs/org-1/members/user-1', { role: 'editor', allHosts: true })
    mockPermissions = HOLDER
    confirmed = []
    mockConfirmation.confirm = (options) => {
      confirmed.push(options ?? {})
      return Promise.resolve()
    }
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () => {
        const url = String(input)
        if (url.includes('/api/media/quarantine')) return { quarantined: {} }
        if (url.includes('/api/media/references')) {
          return {
            references: [
              { kind: 'screen', id: 'home', name: 'Home', hostId: 'host-2', hostSubdomain: 'docs', live: true },
              { kind: 'screen', id: 'about', name: 'About', hostId: 'host-1', hostSubdomain: 'aglyn-marketing', live: true },
            ],
            coverage: 'full',
          }
        }
        return { ok: true, assets: 2, total: 3, next: 3, done: true }
      },
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    mockConfirmation.confirm = () => Promise.resolve()
  })

  it('from the drawer: names the site left out that uses it, and writes through the route', async () => {
    await mountLibrary()
    await drawerSelect('logo.webp')
    const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
    fireEvent.click(within(drawer).getByRole('radio', { name: /All sites except/ }))
    fireEvent.click(within(drawer).getByRole('checkbox', { name: /Docs/ }))
    expect(within(drawer).getByText(/custom HTML keeps loading/)).toBeTruthy()

    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(confirmed).toHaveLength(1)
    expect(confirmed[0].description).toContain('docs uses this file')
    expect(confirmed[0].description).not.toContain('aglyn-marketing')
    expect(confirmed[0].description).toContain('pasted into custom HTML, which keeps loading')
    expect(posts()).toContainEqual(
      expect.objectContaining({
        action: 'set-sharing',
        orgId: 'org-1',
        mediaIds: ['logo'],
        choice: { mode: 'allExcept', exceptHostIds: ['host-2'] },
      }),
    )
  }, 240_000)

  it('from the drawer: saving details alone writes no sharing (negative control)', async () => {
    await mountLibrary()
    await drawerSelect('logo.webp')
    const drawer = document.querySelector('.MuiDrawer-paper') as HTMLElement
    await act(async () => {
      fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(confirmed).toHaveLength(0)
    expect(posts().filter((body) => body.action === 'set-sharing')).toEqual([])
  }, 240_000)

  it('from a folder: counts with no choice, then writes the choice over the folder', async () => {
    await mountLibrary()
    fireEvent.click(await folderItem('Covers'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /All sites except/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Docs/ }))
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const sent = posts()
    expect(sent).toContainEqual(expect.objectContaining({ action: 'set-sharing', folderId: 'covers', preview: true }))
    expect(sent.find((body) => body.preview)).not.toHaveProperty('choice')
    expect(sent).toContainEqual(
      expect.objectContaining({
        action: 'set-sharing',
        folderId: 'covers',
        cascade: true,
        choice: { mode: 'allExcept', exceptHostIds: ['host-2'] },
      }),
    )
  }, 240_000)

  it('refuses leaving every site out before anything is sent', async () => {
    await mountLibrary()
    fireEvent.click(await folderItem('Covers'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('radio', { name: /All sites except/ }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Docs/ }))
    // The last site in can't be left out too: the field holds it, with the reason.
    const last = within(dialog).getByRole('checkbox', { name: /Aglyn Marketing/ }) as HTMLInputElement
    expect(last.disabled).toBe(true)
    expect(within(dialog).getByText('At least one site has to stay in.')).toBeTruthy()
  }, 240_000)
})

/**
 * A folder's Shared with… in the folder TREE as well as on its grid card
 * (AGL-4047). Production showed it on the card's menu only, so the same folder
 * offered different actions in the two places. The tree now offers the same
 * entry, opening the same dialog, under the same gate and refusal wording.
 */
describe('a folder’s Shared with… in the folder tree', () => {
  /** The menu of a folder's row in the tree, opened. */
  const treeMenu = async (folderName: string) => {
    fireEvent.click(await screen.findByRole('button', { name: `Actions for ${folderName}` }))
    return screen.findByRole('menu')
  }
  /** Each entry of the open menu with its standing, in order. */
  const entries = (menu: HTMLElement) =>
    within(menu)
      .getAllByRole('menuitem')
      .map((item) => [item.textContent, standing(item)])
  const closeMenu = async (menu: HTMLElement) => {
    fireEvent.keyDown(within(menu).getAllByRole('menuitem')[0], { key: 'Escape' })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  const posts = () =>
    (global.fetch as jest.Mock).mock.calls
      .filter(([input]) => String(input).includes('/api/media/folders'))
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)))

  beforeEach(() => {
    mockDb.collections.clear()
    mockDb.docs.clear()
    seedLibrary('orgs/org-1', true)
    mockDb.docs.set('orgs/org-1/members/user-1', { role: 'editor', allHosts: true })
    global.fetch = jest.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(input).includes('/api/media/quarantine')
          ? { quarantined: {} }
          : { ok: true, assets: 2, total: 3, next: 3, done: true },
    })) as unknown as typeof fetch
  })

  it.each([
    ['a holder', HOLDER, 'on'],
    ['a member of the whole workspace without the key', REFUSED, 'refused'],
    ['anyone while permissions load', LOADING, 'held'],
  ] as const)('offers it to %s exactly as the grid card does', async (_who, permissions, expected) => {
    mockPermissions = permissions
    await mountLibrary()

    const tree = await treeMenu('Covers')
    const fromTree = entries(tree)
    await closeMenu(tree)
    const card = (await folderItem('Covers')).closest('[role="menu"]') as HTMLElement
    const fromCard = entries(card)

    expect(fromTree).toContainEqual(['Shared with…', expected])
    expect(fromTree).toEqual(fromCard)
    if (expected !== 'refused') expect(screen.queryByLabelText(REFUSAL)).toBeNull()
  }, 240_000)

  it('opens the same dialog as the card, for the folder chosen, and counts it first', async () => {
    mockPermissions = HOLDER
    await mountLibrary()
    const tree = await treeMenu('Archive')
    fireEvent.click(within(tree).getByRole('menuitem', { name: 'Shared with…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Shared with — "Archive"')).toBeTruthy()
    expect(within(dialog).getByRole('radio', { name: /All sites except/ })).toBeTruthy()
    expect(within(dialog).getByText(/Also apply/)).toBeTruthy()
    expect(posts()).toContainEqual(
      expect.objectContaining({ action: 'set-sharing', folderId: 'archive', preview: true }),
    )
  }, 240_000)

  it('is not offered in a site’s own library, where the card has none either (negative control)', async () => {
    mockPermissions = HOLDER
    mockDb.collections.clear()
    mockDb.docs.clear()
    seedLibrary('hosts/host-1', false)
    mockDb.docs.set('hosts/host-1', { memberRoles: { 'user-1': 'admin' } })
    render(<MediaLibraryComponent hostId="host-1" />)
    await screen.findAllByRole('button', { name: 'File actions' }, { timeout: 120_000 })
    const tree = await treeMenu('Covers')
    expect(within(tree).getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(within(tree).queryByRole('menuitem', { name: 'Shared with…' })).toBeNull()
  }, 240_000)
})
