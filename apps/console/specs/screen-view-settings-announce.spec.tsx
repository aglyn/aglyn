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
 * The screen detail page's settings saves reach the live page (AGL-2934).
 *
 * The SEO card, the page password, the visibility select and the rename each
 * write the screen document the tenant renders the live page from — its head,
 * whether it withholds the content, whether it carries `noindex`, the title
 * fallback. None of them moves the page's address, so the routing-map seam
 * that announces publishes never saw them.
 *
 * Each path: a published screen announces itself after the write lands; a
 * rejected write, a refused seed, and an unpublished screen announce nothing
 * (AGL-2573). Observed at `revalidateLivePages`, beneath the real helper.
 */

import { HostScreenVisibility } from '@aglyn/aglyn'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUpdateDoc = jest.fn(
  (_ref: unknown, _data: Record<string, unknown>): Promise<void> =>
    Promise.resolve(),
)
const mockEnqueueSnackbar = jest.fn()
const mockUser = { uid: 'uid-owner', getIdToken: async () => 'token' }
const mockRevalidateLivePages = jest.fn(
  async (_options: Record<string, unknown>): Promise<unknown> => ({
    revalidated: 2,
    pathsDropped: 0,
    scanTruncated: false,
    reason: 'ok',
  }),
)

/** Mutable per case: the screen listener and the host's routing map. */
const mockScreenDoc = {
  data: {} as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}
const mockHostDoc = { data: {} as Record<string, unknown> }

jest.mock('@aglyn/tenant-feature-instance', () => {
  const authPersistence = { __stub: 'authPersistence' }
  return {
    useFirestore: () => ({}),
    useUser: () => ({ data: mockUser }),
    useAuthPersistence: () => authPersistence,
    useHostCampaigns: () => ({ options: [], truncated: false, ready: true }),
    // The REAL guard, so the refusal case refuses for real.
    writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
      .writeGuardedBySeed,
  }
})

jest.mock('firebase/firestore', () => ({
  ...jest.requireActual('firebase/firestore'),
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  // Addressed, so the document listener can tell the host from the screen.
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  deleteField: () => '__delete__',
  updateDoc: (ref: unknown, data: Record<string, unknown>) =>
    mockUpdateDoc(ref, data),
}))

jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: (options: Record<string, unknown>) => mockRevalidateLivePages(options),
  revalidateLivePages: (options: Record<string, unknown>) =>
    mockRevalidateLivePages(options),
  describeRevalidateShortfall: jest.requireActual(
    '../utils/revalidate-live-pages',
  ).describeRevalidateShortfall,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  GridItems: ({ items }: { items: Array<{ children: ReactNode }> }) => (
    <div>
      {items.map((item, index) => (
        <div key={index}>{item.children}</div>
      ))}
    </div>
  ),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MdiIcon: () => null,
  useConfirmationContext: () => ({
    confirm: jest.fn().mockResolvedValue(undefined),
  }),
  useLoading: () => ({ queueLoading: () => () => undefined, loading: false }),
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
// The Edit button lives in `headerRight`.
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
jest.mock('../components/secondary-nav-bar.component', () => nullCard)
jest.mock('../components/analytics/screen-analytics-card.component', () => nullCard)
jest.mock('../components/plugin-widget-slot.component', () => nullCard)
jest.mock('../components/host-display-name.component', () => nullCard)
jest.mock('../components/screen-social-image-field.component', () => nullCard)
jest.mock('../components/document-presence-live.component', () => nullCard)
jest.mock('../components/used-by-card.component', () => nullCard)
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'owner', canPublish: true, loaded: true }),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ org: { plan: 'business' } }),
}))
jest.mock('../hooks/use-collection-templates', () => ({
  __esModule: true,
  default: () => ({
    templateScreenIds: new Set<string>(),
    routesByScreenId: new Map<string, unknown>(),
  }),
}))
jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => jest.fn(),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [], status: 'success', fromCache: false }),
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: (ref: () => { path: string }) =>
    ref().path === 'hosts/host-1'
      ? { data: mockHostDoc.data, status: 'success', fromCache: false }
      : {
          data: mockScreenDoc.data,
          status: mockScreenDoc.status,
          fromCache: mockScreenDoc.fromCache,
        },
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
jest.mock('next/navigation', () => ({
  useParams: () => ({ screenId: 'screen-1', versionId: 'ver-1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ScreenDetails =
  require('../app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page').default

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: jest.requireActual('node:crypto').webcrypto,
    })
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  mockHostDoc.data = { $id: 'host-1', screens: { 'screen-1': 'pricing' } }
  mockScreenDoc.data = {
    $id: 'screen-1',
    displayName: 'Pricing',
    description: 'The plans page',
    versionId: 'ver-1',
    seo: { title: 'Pricing — Acme', description: 'What Acme costs' },
    // Password mode, so the password field renders.
    visibility: HostScreenVisibility.PASSWORD,
  }
  mockScreenDoc.fromCache = false
  mockScreenDoc.status = 'success'
})

const unpublish = () => {
  mockHostDoc.data = { $id: 'host-1', screens: { 'screen-2': 'about' } }
}

const THIS_SCREEN = { user: mockUser, hostId: 'host-1', screenId: 'screen-1' }

const snackbarsOf = (variant: string) =>
  mockEnqueueSnackbar.mock.calls.filter(
    ([, options]) => (options as { variant?: string })?.variant === variant,
  )

const editTitleAndSave = () => {
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Pricing and plans' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save SEO' }))
}
const typePasswordAndSave = () => {
  fireEvent.change(screen.getByLabelText('Page password'), {
    target: { value: 'hunter2' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}
const chooseVisibility = (option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Visibility' }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}
const renameAndSave = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByLabelText('Display name'), {
    target: { value: 'Plans' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('the SEO card announces a published screen (AGL-2934)', () => {
  it('announces once the write has landed, and not before', async () => {
    let land: () => void = () => undefined
    mockUpdateDoc.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          land = resolve
        }),
    )
    render(<ScreenDetails />)

    editTitleAndSave()

    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()

    await act(async () => land())

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
  })

  it('does NOT announce when the seed guard refuses the save', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenDetails />)

    editTitleAndSave()

    await waitFor(() => expect(snackbarsOf('warning')).toHaveLength(1))
    expect(mockUpdateDoc).not.toHaveBeenCalled()
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does NOT announce when the write is rejected', async () => {
    mockUpdateDoc.mockImplementationOnce(() =>
      Promise.reject(new Error('permission-denied')),
    )
    render(<ScreenDetails />)

    editTitleAndSave()

    await waitFor(() => expect(snackbarsOf('error')).toHaveLength(1))
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does NOT announce for a screen that is not published', async () => {
    unpublish()
    render(<ScreenDetails />)

    editTitleAndSave()

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('SEO saved', expect.anything()),
    )
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })
})

describe('the page password announces a published screen (AGL-2934)', () => {
  it('announces after the hash is written', async () => {
    render(<ScreenDetails />)

    typePasswordAndSave()

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({
      protection: { passwordHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    })
  })

  it('does NOT announce when the write is rejected', async () => {
    mockUpdateDoc.mockImplementationOnce(() =>
      Promise.reject(new Error('permission-denied')),
    )
    render(<ScreenDetails />)

    typePasswordAndSave()

    await waitFor(() => expect(snackbarsOf('error')).toHaveLength(1))
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does NOT announce for a screen that is not published', async () => {
    unpublish()
    render(<ScreenDetails />)

    typePasswordAndSave()

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Password protection enabled',
        expect.anything(),
      ),
    )
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })
})

describe('the visibility select announces a published screen (AGL-2934)', () => {
  it('announces after access changes', async () => {
    render(<ScreenDetails />)

    chooseVisibility('Members only')

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
  })

  it('does NOT announce for a screen that is not published', async () => {
    unpublish()
    render(<ScreenDetails />)

    chooseVisibility('Members only')

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Page access updated',
        expect.anything(),
      ),
    )
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })
})

describe('the rename announces a published screen (AGL-2934)', () => {
  it('announces after the name and description are written', async () => {
    render(<ScreenDetails />)

    renameAndSave()

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
  })

  it('does NOT announce when the seed guard refuses the rename', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenDetails />)

    renameAndSave()

    await waitFor(() => expect(snackbarsOf('warning')).toHaveLength(1))
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })
})
