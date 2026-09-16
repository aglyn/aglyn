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
 * The besigner's Screen Properties saves reach the live page (AGL-2934).
 *
 * Save SEO, the password Save and the layout binding each write a document
 * the tenant renders the live page from, and none of them moves the page's
 * address — so the routing-map seam that announces every publish never saw
 * them. The save landed, the toast said so, and a signed-out fetch went on
 * serving the old `<title>`, or the unprotected page, until the tenant's
 * caches lapsed on their own.
 *
 * ## What each case pins, and why the write is held open
 *
 * - A published screen announces ITSELF, once, after the write has landed.
 *   The first case holds the write pending and asserts silence before
 *   letting it land: a drop fired ahead of the write regenerates the page
 *   from the document it was meant to replace.
 * - A refused write (the seed guard) and a rejected one announce nothing.
 *   There is no new document to serve, and a drop would buy a regeneration
 *   for no change.
 * - An unpublished screen announces nothing (AGL-2573). It has no page to
 *   drop, and a draft-only write is not a publish.
 *
 * The announce is observed at `revalidateLivePages`, beneath the real
 * `announceLiveScreenChange`, so these fail whether the page stops calling
 * the helper or the helper stops gating on the routing map.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/** One user object for the whole file, so the announce can be matched to it. */
const mockUser = { uid: 'uid-owner', getIdToken: async () => 'test-token' }

/** The routing map the host listener serves; each case decides the entry. */
const mockHostDoc = { data: {} as Record<string, unknown> }

/** Mutable so each case picks the screen listener's verdict before rendering. */
const mockScreenDoc = {
  data: {} as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

const mockUpdateScreenDoc = jest.fn(
  (_data: Record<string, unknown>): Promise<void> => Promise.resolve(),
)
const mockUpdateVersionDoc = jest.fn(
  (_data: Record<string, unknown>): Promise<void> => Promise.resolve(),
)
const mockRevalidateLivePages = jest.fn(
  async (_options: Record<string, unknown>): Promise<unknown> => ({
    revalidated: 2,
    pathsDropped: 0,
    scanTruncated: false,
    reason: 'ok',
  }),
)

const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: mockUser }),
  useHostResourceApi: () => mockCreateResource,
  useHost: () => ({
    doc: { data: mockHostDoc.data, status: 'success', fromCache: false },
  }),
  useHostActivityLogger: () => jest.fn(),
  useScreen: () => ({
    doc: {
      data: mockScreenDoc.data,
      status: mockScreenDoc.status,
      fromCache: mockScreenDoc.fromCache,
      hasEmitted: true,
      hasPendingWrites: false,
    },
    setDoc: mockUpdateScreenDoc,
  }),
  useLayout: () => ({ doc: { data: undefined, status: 'success' } }),
  useLayoutVersion: () => ({ doc: { data: undefined, status: 'success' } }),
  useScreenVersion: () => ({
    doc: {
      data: { nodes: {} },
      status: 'success',
      hasEmitted: true,
      hasPendingWrites: false,
      fromCache: false,
    },
    // The layout binding is written to the VERSION document.
    setDoc: mockUpdateVersionDoc,
  }),
  useScreenVersionRef: () => ({ path: 'hosts/host-1/screens/screen-1' }),
  saveNodesGuarded: jest.fn().mockResolvedValue(undefined),
  // The REAL guard: a stub would let the write through whatever the page
  // passed it, and the refusal case would assert nothing.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) =>
    segments[segments.length - 1],
  query: (name: string) => name,
  limit: () => undefined,
  doc: () => ({}),
  getDoc: () => Promise.resolve({ exists: () => false, data: () => undefined }),
  deleteField: () => '__delete__',
}))

// Mocked BENEATH the helper rather than in place of it. The shortfall wording
// stays real, because what the author reads is part of what is asserted.
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

jest.mock('@aglyn/aglyn', () => ({
  canvas: {
    rootNode: null,
    nestedNodes: {},
    didSetInitial: true,
    canUndo: false,
    canRedo: false,
  },
  CANVAS_ROOT_ELEMENT_ID: 'root',
  MAX_LAYOUT_CHAIN_DEPTH: 5,
  HostViewType: { SCREEN: 'screen' },
  ScreenLinkContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  buildScreenRouteEntries: () => ({}),
  composeLayoutChainWithProps: () => ({}),
  layoutPropValuesFor: () => undefined,
  composeScreenRoutePath: () => '/careers',
  decodeStoredNodes: () => ({}),
  findScreenIdByRoutePath: () => undefined,
  normalizeScreenSlug: (value: string) => value,
  // Real where they are pure functions over a string or a node map. This mock
  // is a closed world, so an export the page gains arrives as `undefined is
  // not a function` from inside render, nowhere near the cause.
  ownScreenSlugFromRoutePath: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).ownScreenSlugFromRoutePath,
  collectReferencedComponentIds: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/compose-reusable-components',
  ).collectReferencedComponentIds,
  screenSlugHasPathSeparator: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).screenSlugHasPathSeparator,
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  reservedScreenRouteMessage: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).reservedScreenRouteMessage,
  reservedScreenRouteSegment: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).reservedScreenRouteSegment,
  linkableScreenRoutes: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).linkableScreenRoutes,
  SCREEN_KIND_TEMPLATE: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).SCREEN_KIND_TEMPLATE,
  screenRoutePathToUrl: () => '',
  wouldCreateScreenCycle: () => false,
}))
jest.mock('@aglyn/aglyn/app-utils/marketplace-theme', () => ({
  resolveSiteTheme: () => undefined,
}))
jest.mock('@aglyn/besigner', () => ({
  focus: { getLastSelected: () => null },
}))
jest.mock('@aglyn/besigner-ui', () => ({
  BesignerConflictAlertComponent: () => null,
  // The inspector's plugin widget extras; nothing here opens the inspector.
  BesignerInspectorExtrasContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  BesignerDraftAlertComponent: () => null,
  recoverableRoomSessions: () => 0,
  LayoutChromeContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  // Rendered unconditionally: whether the dialog is open is chrome, and what
  // is under test is what its saves announce.
  PropertiesDialogComponent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useAddElementDrawerCallback: () => () => undefined,
  useClearCanvasCallback: () => async () => undefined,
  useRepairDocumentCallback: () => async () => undefined,
  useBesignerDocument: () => ({
    saveAvailable: false,
    remoteChanged: false,
    draft: { available: false, sharedDraftUnopened: false },
    handleSave: () => undefined,
    refuseOverUnopenedDraft: () => false,
    jsonOpen: false,
    openJsonEditor: () => undefined,
    closeJsonEditor: () => undefined,
    handleJsonSave: () => undefined,
    hasError: false,
    notFound: false,
    status: 'success',
  }),
  useLayoutChromeCanvas: () => ({ chromeCanvas: null }),
  useRenderedCanvasElements: () => ({ elements: { current: {} } }),
  withBesignerContext: (component: unknown) => component,
  nodeElementSelector: () => '',
  besignerDocsUrl: (...args: unknown[]): string =>
    jest
      .requireActual('../../../libs/besigner/feature/designer/src/lib/utils/docs-help')
      .besignerDocsUrl(...args),
  useComponentPropagationNotice: (...args: unknown[]) =>
    jest
      .requireActual(
        '../../../libs/besigner/feature/designer/src/lib/hooks/use-component-propagation-notice',
      )
      .useComponentPropagationNotice(...args),
  describeComponentPropagation: (...args: unknown[]): string =>
    jest
      .requireActual(
        '../../../libs/besigner/feature/designer/src/lib/hooks/use-component-propagation-notice',
      )
      .describeComponentPropagation(...args),
}))
jest.mock('@aglyn/shared-ui-theme', () => ({
  getGoogleFontsUrl: () => undefined,
  mergeSxProps: jest.requireActual(
    '../../../libs/shared/ui/theme/src/lib/util/merge-sx-props',
  ).mergeSxProps,
  generateComponentClassKeys: jest.requireActual(
    '../../../libs/shared/ui/theme/src/lib/util/generate-component-class-keys',
  ).generateComponentClassKeys,
  HostThemeDocumentContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useLoading: () => ({ queueLoading: () => () => undefined, loading: false }),
  HelpTip: jest.requireActual(
    '../../../libs/shared/ui/jsx/src/lib/components/help-tip.component',
  ).HelpTip,
}))
jest.mock('@aglyn/shared-ui-jsx/const/prebuilt-components', () => ({
  LOADING_OVERLAY_ELEMENT: null,
}))

const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullComponent = { __esModule: true, default: () => null }

jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/besigner-app-bar.component', () => nullComponent)
jest.mock('../components/besigner-document-switcher.component', () => nullComponent)
jest.mock('../components/besigner-functions-button.component', () => nullComponent)
// The plugin widget zones read the slot registry at import time; no plugin
// renders here.
jest.mock('../components/plugin-widget-slot.component', () => nullComponent)
jest.mock('../components/besigner-versions.component', () => nullComponent)
jest.mock('../components/collaborator-overlays.component', () => nullComponent)
jest.mock('../components/presence-avatars.component', () => nullComponent)
jest.mock('../components/binding-picker-provider.component', () => passthrough)
jest.mock('../components/interactions-provider.component', () => passthrough)
jest.mock('../components/besigner-media-picker-provider.component', () => passthrough)
jest.mock('../components/entity-picker-provider.component', () => passthrough)
jest.mock('../components/reusable-components-provider.component', () => passthrough)
jest.mock('../components/console-plugins-gate.component', () => ({
  withSitePlugins: (component: unknown) => component,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../components/screen-social-image-field.component', () => nullComponent)
jest.mock('../components/screen-layout-properties.component', () => ({
  __esModule: true,
  default: () => null,
  useLayoutChainProperties: () => [],
}))
jest.mock('../hooks/use-plugin-drawer-registration', () => ({
  __esModule: true,
  default: () => undefined,
}))
jest.mock('../hooks/use-collection-templates', () => ({
  __esModule: true,
  default: () => ({
    templateScreenIds: new Set<string>(),
    routesByScreenId: new Map<string, unknown>(),
  }),
}))
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: [], status: 'success', fromCache: false }),
}))
jest.mock('../hooks/use-host-component-definitions', () => ({
  __esModule: true,
  default: () => ({ definitions: {}, ready: true }),
}))
jest.mock('../hooks/use-presence', () => ({
  __esModule: true,
  default: () => ({ entries: [], session: null }),
}))
jest.mock('../hooks/use-coediting', () => ({
  __esModule: true,
  default: () => ({ clearMirror: () => undefined }),
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
// The besigner's inspector and toolbar zones read the org the screen belongs
// to (AGL-2908), so mounting either editor now reaches `useCurrentOrg`. The
// zone's widget is the null component above, leaving `orgId` the only thing
// read here. The real hook resolves an org through `useOrgScope` and opens a
// `useConfirmedDoc` listen this suite does not drive, and that listen's effect
// keys on the `useFirestore` double above — a fresh object per call — so it
// re-subscribes on every render and the editor never settles (AGL-2928). One
// held object, because a double rebuilt per call is that same loop.
jest.mock('../hooks/use-current-org', () => {
  const currentOrg = {
    org: undefined,
    orgId: 'org-1',
    ready: true,
    entitlementsFromCache: false,
  }
  const useCurrentOrg = () => currentOrg
  return { __esModule: true, useCurrentOrg, default: useCurrentOrg }
})
// At the owner's answer: none of these saves is gated by the host role, and
// the owner's standing leaves the routing map the only thing deciding.
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({ hostRole: 'owner', canPublish: true, loaded: true }),
}))
jest.mock('../constants/app-setup', () => ({}))
jest.mock('../constants/preview-state', () => ({
  previewWindowName: () => 'preview',
  writePreviewState: () => undefined,
}))
jest.mock('../constants/screen-publishing', () => ({
  syncScreenRouteEntries: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../constants/tenant-links', () => ({
  resolveScreenLiveUrl: () => ({ url: undefined, unavailableReason: undefined }),
}))
jest.mock('../constants/collection-templates', () => ({
  collectionTemplatePublishMessage: () => '',
  collectionTemplateRoutesSummary: () => '',
}))
jest.mock('../constants/route-links', () => ({
  buildRoute: () => '/x',
  Route: {
    SCREEN_DETAILS: 'screen-details',
    LAYOUT_BESIGNER: 'layout-besigner',
    HOST_SCREENS: 'host-screens',
  },
}))
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }))
jest.mock('next/navigation', () => ({
  useParams: () => ({ screenId: 'screen-1', versionId: 'ver-1' }),
}))
jest.mock('mobx-react-lite', () => ({ observer: (component: unknown) => component }))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ScreenBesigner =
  require('../app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page').default

/**
 * The password Save hashes in the browser. jsdom has no SubtleCrypto, so the
 * page gets Node's — the real digest, since nothing here is served by faking
 * one.
 */
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
  // Published at `/careers`, serving `ver-1` — the version this editor is on.
  mockHostDoc.data = { screens: { 'screen-1': 'careers' } }
  mockScreenDoc.data = {
    displayName: 'Careers',
    versionId: 'ver-1',
    seo: { description: 'Join the Aglyn team', title: 'Careers' },
  }
  mockScreenDoc.fromCache = false
  mockScreenDoc.status = 'success'
})

/** Take the screen off the site: no entry in the routing map. */
const unpublish = () => {
  mockHostDoc.data = { screens: { 'screen-2': 'about' } }
}

/** The announce this page is expected to make for `screen-1`. */
const THIS_SCREEN = { user: mockUser, hostId: 'host-1', screenId: 'screen-1' }

/** Every snackbar the page raised with the given variant. */
const snackbarsOf = (variant: string) =>
  mockEnqueueSnackbar.mock.calls.filter(
    ([, options]) => (options as { variant?: string })?.variant === variant,
  )

const editDescriptionAndSave = () => {
  fireEvent.change(screen.getByLabelText('Search description'), {
    target: { value: 'Open roles at Aglyn' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save SEO' }))
}

const typePasswordAndSave = (value: string) => {
  const field = screen.getByLabelText('Password')
  // Typed and then set, so an empty value is a CHANGE React reports rather
  // than the value the field already holds.
  fireEvent.change(field, { target: { value: 'draft' } })
  fireEvent.change(field, { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

const chooseLayout = (option: string) => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Layout' }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

describe('Save SEO announces a published screen to its live page (AGL-2934)', () => {
  it('announces the screen once the write has landed, and not before', async () => {
    let land: () => void = () => undefined
    mockUpdateScreenDoc.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          land = resolve
        }),
    )
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalledTimes(1))
    // Still in flight: a drop now would regenerate the page from the old
    // document.
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()

    await act(async () => land())

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'SEO saved',
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('does NOT announce when the seed guard refuses the save', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    // Settled on the refusal, so this cannot pass by asserting too early.
    await waitFor(() => expect(snackbarsOf('warning')).toHaveLength(1))
    expect(mockUpdateScreenDoc).not.toHaveBeenCalled()
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does NOT announce when the write is rejected', async () => {
    mockUpdateScreenDoc.mockImplementationOnce(() =>
      Promise.reject({ code: 'permission-denied' }),
    )
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    await waitFor(() => expect(snackbarsOf('error')).toHaveLength(1))
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does NOT announce for a screen that is not published', async () => {
    unpublish()
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    // The announce would sit in the same callback as this toast.
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'SEO saved',
        expect.anything(),
      ),
    )
    expect(mockUpdateScreenDoc).toHaveBeenCalledTimes(1)
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('warns when the live page could not be refreshed, and says SAVED', async () => {
    // The tenant refusing the drop — the state every publish on the platform
    // once fell back to the cache windows in.
    mockRevalidateLivePages.mockResolvedValueOnce({
      revalidated: 0,
      pathsDropped: 0,
      scanTruncated: false,
      reason: 'tenant-401',
    })
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    await waitFor(() => expect(snackbarsOf('warning')).toHaveLength(1))
    const [[message, options]] = snackbarsOf('warning')
    // "Saved.", not the publish paths' "Published." — the author saved SEO.
    expect(message).toMatch(/^Saved\. The live pages could not be refreshed/)
    expect(options).toEqual({ variant: 'warning', persist: false })
    // The save itself is still reported as the success it was.
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'SEO saved',
      expect.objectContaining({ variant: 'success' }),
    )
    expect(snackbarsOf('error')).toHaveLength(0)
  })
})

describe('the password Save announces a published screen (AGL-2934)', () => {
  it('announces once protection is switched ON', async () => {
    render(<ScreenBesigner />)

    typePasswordAndSave('hunter2')

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
    // It really was the hash write that preceded it.
    const [[payload]] = mockUpdateScreenDoc.mock.calls
    expect(payload).toEqual({
      protection: { passwordHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    })
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'Password protection enabled',
      expect.anything(),
    )
  })

  it('announces once protection is switched OFF — the mirror-image delay', async () => {
    mockScreenDoc.data = {
      ...mockScreenDoc.data,
      protection: { passwordHash: 'a'.repeat(64) },
    }
    render(<ScreenBesigner />)

    typePasswordAndSave('')

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
    expect(mockUpdateScreenDoc).toHaveBeenCalledWith({ protection: '__delete__' })
  })

  it('does NOT announce when the write is rejected', async () => {
    mockUpdateScreenDoc.mockImplementationOnce(() =>
      Promise.reject({ code: 'permission-denied' }),
    )
    render(<ScreenBesigner />)

    typePasswordAndSave('hunter2')

    await waitFor(() => expect(snackbarsOf('error')).toHaveLength(1))
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does NOT announce for a screen that is not published', async () => {
    unpublish()
    render(<ScreenBesigner />)

    typePasswordAndSave('hunter2')

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Password protection enabled',
        expect.anything(),
      ),
    )
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })
})

describe('the layout binding announces only on the version the site serves (AGL-2934)', () => {
  it('announces when the live version of a published screen is reframed', async () => {
    render(<ScreenBesigner />)

    chooseLayout('None')

    await waitFor(() => expect(mockRevalidateLivePages).toHaveBeenCalledTimes(1))
    expect(mockRevalidateLivePages).toHaveBeenCalledWith(THIS_SCREEN)
    expect(mockUpdateVersionDoc).toHaveBeenCalledWith({ layoutId: null })
  })

  it('does NOT announce for a version the screen is not serving', async () => {
    // Live on `ver-0`; this editor is on `ver-1`, so no visitor sees the edit.
    mockScreenDoc.data = { ...mockScreenDoc.data, versionId: 'ver-0' }
    render(<ScreenBesigner />)

    chooseLayout('None')

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        'Layout removed for this version',
        expect.anything(),
      ),
    )
    expect(mockUpdateVersionDoc).toHaveBeenCalledTimes(1)
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })

  it('does NOT announce when the write is rejected', async () => {
    mockUpdateVersionDoc.mockImplementationOnce(() =>
      Promise.reject({ code: 'permission-denied' }),
    )
    render(<ScreenBesigner />)

    chooseLayout('None')

    await waitFor(() => expect(snackbarsOf('error')).toHaveLength(1))
    expect(mockRevalidateLivePages).not.toHaveBeenCalled()
  })
})
