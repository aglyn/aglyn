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
 * The besigner's Screen Properties ▸ Slug field (AGL-2570, AGL-2571, AGL-2572).
 *
 * Reproduced on production while publishing marketing screens: the Parent
 * screen select committed on change and said so, the Slug field beside it was
 * typed into, `DONE` was clicked, a toast read "Already saved" — and Firestore
 * still held the old slug. The dialog's `DONE` saved the CANVAS document and
 * closed over the typed slug, which only the small Publish button beside the
 * field had ever read.
 *
 * Three things are asserted here, and each of them is a report a person acted
 * on:
 *
 *  - `DONE` commits the field, so "saved" means saved.
 *  - `DONE` does not change whether the screen is on the live site. It renames
 *    a live path and stores a slug on an unpublished screen; publishing stays
 *    the Publish button's job (AGL-2571).
 *  - The helper line under the field is present-tense only about what is
 *    actually being served, and the field seeds itself with the screen's OWN
 *    segment rather than the whole composed routing path (AGL-2572).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/** The document as Firestore holds it, so a commit can be read back raw. */
let stored: Record<string, unknown>

/** The host's `screens` routing map — what makes a path reachable. */
let mockRoutingMap: Record<string, string>

const mockScreenDoc = {
  data: {} as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

const mockUpdateScreenDoc = jest.fn((data: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(data)) stored[key] = value
  return Promise.resolve()
})

/**
 * The routing-map write. Spied rather than stubbed away: "did this publish
 * something" is the question AGL-2571 turns on, and it is answered by whether
 * this was called and with what.
 */
const mockSyncScreenRouteEntries = jest.fn().mockResolvedValue(undefined)

/** The CANVAS save behind `DONE` — the one whose "Already saved" misled. */
const mockHandleSave = jest.fn().mockResolvedValue(undefined)

const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

/**
 * The screen under test and the parent it nests under. `screen-1`'s own slug
 * is `old`; the composed path is therefore `alternatives/old`.
 */
const mockScreenDocs = [
  {
    $id: 'parent-1',
    slug: 'alternatives',
    displayName: 'Alternatives',
  },
  {
    $id: 'screen-1',
    slug: 'old',
    parentId: 'parent-1',
    displayName: 'Alternatives — Webflow',
  },
]

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { getIdToken: async () => 'test-token' } }),
  useHostResourceApi: () => mockCreateResource,
  useHost: () => ({
    doc: {
      data: { subdomain: 'aglyn-marketing', screens: mockRoutingMap },
      status: 'success',
      fromCache: false,
    },
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
  }),
  useScreenVersionRef: () => ({ path: 'hosts/host-1/screens/screen-1' }),
  saveNodesGuarded: jest.fn().mockResolvedValue(undefined),
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

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

/**
 * The routing helpers are REAL throughout (AGL-2076's reasoning, applied to
 * the whole family): they are pure functions over a slug and a map, they are
 * what decides the address this dialog promises, and a double answering a
 * constant would let the page compose anything and still look right. The glue
 * in AGL-2572 is exactly what a stubbed `normalizeScreenSlug` would hide.
 */
const mockRealScreenRoute = jest.requireActual('@aglyn/aglyn/app-utils/screen-route')

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
  composeLayoutChainAndScreenNodes: () => ({}),
  decodeStoredNodes: () => ({}),
  collectReferencedComponentIds: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/compose-reusable-components',
  ).collectReferencedComponentIds,
  buildScreenRouteEntries: mockRealScreenRoute.buildScreenRouteEntries,
  composeScreenRoutePath: mockRealScreenRoute.composeScreenRoutePath,
  findScreenIdByRoutePath: mockRealScreenRoute.findScreenIdByRoutePath,
  linkableScreenRoutes: mockRealScreenRoute.linkableScreenRoutes,
  normalizeScreenSlug: mockRealScreenRoute.normalizeScreenSlug,
  ownScreenSlugFromRoutePath: mockRealScreenRoute.ownScreenSlugFromRoutePath,
  reservedScreenRouteMessage: mockRealScreenRoute.reservedScreenRouteMessage,
  reservedScreenRouteSegment: mockRealScreenRoute.reservedScreenRouteSegment,
  screenRoutePathToUrl: mockRealScreenRoute.screenRoutePathToUrl,
  screenSlugHasPathSeparator: mockRealScreenRoute.screenSlugHasPathSeparator,
  SCREEN_SLUG_PATH_SEPARATOR_MESSAGE:
    mockRealScreenRoute.SCREEN_SLUG_PATH_SEPARATOR_MESSAGE,
  SCREEN_KIND_TEMPLATE: mockRealScreenRoute.SCREEN_KIND_TEMPLATE,
  wouldCreateScreenCycle: mockRealScreenRoute.wouldCreateScreenCycle,
}))
jest.mock('@aglyn/aglyn/app-utils/analytics-events', () => ({
  isFirstPublishedRoute: () => false,
  trackEvent: () => undefined,
}))
jest.mock('@aglyn/aglyn/app-utils/marketplace-theme', () => ({
  resolveSiteTheme: () => undefined,
}))
jest.mock('@aglyn/besigner', () => ({
  focus: { getLastSelected: () => null },
}))
jest.mock('@aglyn/besigner-ui', () => ({
  BesignerConflictAlertComponent: () => null,
  BesignerDraftAlertComponent: () => null,
  recoverableRoomSessions: () => 0,
  LayoutChromeContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  /**
   * The dialog's own `Done`, wired to the handler the page passes it — this
   * is the control under test, so unlike the sibling suites it cannot be
   * flattened away. The real component renders it through
   * `CloseableDrawerComponent`'s `action`.
   */
  PropertiesDialogComponent: ({
    children,
    onActionClick,
  }: {
    children: ReactNode
    onActionClick: () => void
  }) => (
    <div>
      {children}
      <button type="button" onClick={onActionClick}>
        {'Done'}
      </button>
    </div>
  ),
  useAddElementDrawerCallback: () => () => undefined,
  useClearCanvasCallback: () => async () => undefined,
  useRepairDocumentCallback: () => async () => undefined,
  useBesignerDocument: () => ({
    saveAvailable: false,
    remoteChanged: false,
    // The page reads `draft.available` to decide whether the live site is
    // behind, so the shape matters — `null` crashes the render and every
    // assertion below would then be reading a page that never mounted.
    draft: { available: false },
    handleSave: mockHandleSave,
    saveWorkingDraft: jest.fn().mockResolvedValue(undefined),
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
      .requireActual(
        '../../../libs/besigner/feature/designer/src/lib/utils/docs-help',
      )
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
  useHostSubdomain: () => 'aglyn-marketing',
}))
jest.mock('../components/screen-social-image-field.component', () => ({
  __esModule: true,
  default: () => null,
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
/** The host's screens listener — what `screensById` is composed from. */
jest.mock('../hooks/use-firestore-collection', () => ({
  __esModule: true,
  default: () => ({ data: mockScreenDocs, status: 'success', fromCache: false }),
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
  syncScreenRouteEntries: (...args: unknown[]) =>
    mockSyncScreenRouteEntries(...args),
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

const ScreenBesigner =
  require('../app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/besigner/page').default

/** The published state: the screen owns a routing entry under its parent. */
const publishScreenOne = () => {
  mockRoutingMap = { 'parent-1': 'alternatives', 'screen-1': 'alternatives/old' }
}

beforeEach(() => {
  jest.clearAllMocks()
  stored = {
    displayName: 'Alternatives — Webflow',
    slug: 'old',
    parentId: 'parent-1',
    versionId: 'ver-1',
  }
  mockScreenDoc.data = stored
  mockScreenDoc.fromCache = false
  mockScreenDoc.status = 'success'
  // Unpublished by default: the parent is live, this screen is not — the
  // state both defects were found in.
  mockRoutingMap = { 'parent-1': 'alternatives' }
})

const typeSlug = (value: string) => {
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value } })
}

const clickDone = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
}

describe('Screen Properties ▸ Slug · Done commits the field (AGL-2570)', () => {
  it('writes the typed slug to the screen document', async () => {
    render(<ScreenBesigner />)

    typeSlug('webflow')
    clickDone()

    await waitFor(() =>
      expect(mockUpdateScreenDoc).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'webflow' }),
      ),
    )
    // Read back raw: the document, not the field, is what the tenant serves.
    expect(stored.slug).toBe('webflow')
  })

  it('does not publish an unpublished screen', async () => {
    render(<ScreenBesigner />)

    typeSlug('webflow')
    clickDone()

    await waitFor(() => expect(stored.slug).toBe('webflow'))
    // The routing map is the whole of what makes a path reachable (AGL-2571).
    // Done stores the slug; Publish is what puts the screen on the site.
    expect(mockSyncScreenRouteEntries).not.toHaveBeenCalled()
    expect(stored).not.toHaveProperty('publishedAt')
  })

  it('moves a LIVE screen to its new path', async () => {
    publishScreenOne()
    render(<ScreenBesigner />)

    typeSlug('webflow')
    clickDone()

    await waitFor(() => expect(mockSyncScreenRouteEntries).toHaveBeenCalled())
    expect(mockSyncScreenRouteEntries).toHaveBeenCalledWith(
      expect.anything(),
      'host-1',
      { 'screen-1': 'alternatives/webflow' },
      // The announcer (AGL-2573). A rename changes which address serves the
      // page, so the seam drops both the old one and the new one.
      expect.objectContaining({ user: expect.anything() }),
    )
    // A rename is not a new publication, so the published date is untouched.
    expect(stored).not.toHaveProperty('publishedAt')
  })

  it('refuses to close over an edit it cannot commit, and says why', async () => {
    // `search` is a reserved address on every site (AGL-2076).
    mockRoutingMap = {}
    stored.parentId = undefined
    mockScreenDoc.data = stored
    render(<ScreenBesigner />)

    typeSlug('search')
    clickDone()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('reserved address'),
      expect.objectContaining({ variant: 'warning' }),
    )
    // Nothing was written, and the canvas save that used to answer
    // "Already saved" for a slug edit never ran.
    expect(stored.slug).toBe('old')
    expect(mockHandleSave).not.toHaveBeenCalled()
  })

  it('will not take a screen off the site by emptying the field', async () => {
    publishScreenOne()
    render(<ScreenBesigner />)

    typeSlug('')
    clickDone()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('press Unpublish'),
      expect.objectContaining({ variant: 'warning' }),
    )
    expect(stored.slug).toBe('old')
    expect(mockSyncScreenRouteEntries).not.toHaveBeenCalled()
  })
})

describe('Screen Properties ▸ Slug · the helper line (AGL-2570)', () => {
  it('does not claim an unsaved value is being served', () => {
    render(<ScreenBesigner />)

    typeSlug('webflow')

    // The lie: "Served at /alternatives/webflow" for a value no document has
    // received, on a screen that is not on the site at all.
    expect(
      screen.queryByText(/^Served at \/alternatives\/webflow$/),
    ).toBeNull()
    expect(
      screen.getByText(
        /Not published — Publish puts this screen at \/alternatives\/webflow/,
      ),
    ).toBeTruthy()
  })

  it('names both addresses while a LIVE screen is being renamed', () => {
    publishScreenOne()
    render(<ScreenBesigner />)

    typeSlug('webflow')

    expect(
      screen.getByText(
        /Served at \/alternatives\/old — Done moves it to \/alternatives\/webflow/,
      ),
    ).toBeTruthy()
  })

  it('speaks in the present tense for what IS live', () => {
    publishScreenOne()
    render(<ScreenBesigner />)

    expect(screen.getByText('Served at /alternatives/old')).toBeTruthy()
  })
})

/**
 * The field holds one segment; the routing map holds the composed path. A
 * screen with an entry and no stored slug seeded the field with the whole
 * path, and `normalizeScreenSlug` DELETES an interior `/` — so pressing
 * Publish stored `alternativeswebflow`. Two screens on `aglyn-marketing`
 * carry a slug of exactly that shape.
 */
describe('Screen Properties ▸ Slug · the seed (AGL-2572)', () => {
  it('seeds the screen OWN segment, not the composed path', () => {
    mockRoutingMap = {
      'parent-1': 'alternatives',
      'screen-1': 'alternatives/webflow',
    }
    stored = {
      displayName: 'Alternatives — Webflow',
      parentId: 'parent-1',
      versionId: 'ver-1',
    }
    mockScreenDoc.data = stored
    render(<ScreenBesigner />)

    expect((screen.getByLabelText('Slug') as HTMLInputElement).value).toBe(
      'webflow',
    )
  })

  /**
   * The production harm path exactly: the field seeds itself, nobody types,
   * Publish is pressed — and what gets stored as the screen's own slug is
   * whatever the seed normalizes to. `s66k8CsopK` on `aglyn-marketing` holds
   * `alternativeswebflow` because of this, and is routed at
   * `alternatives/alternativeswebflow`.
   */
  it('publishes the seed unglued', async () => {
    mockRoutingMap = {
      'parent-1': 'alternatives',
      'screen-1': 'alternatives/webflow',
    }
    stored = {
      displayName: 'Alternatives — Webflow',
      parentId: 'parent-1',
      versionId: 'ver-1',
    }
    mockScreenDoc.data = stored
    render(<ScreenBesigner />)

    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(stored.slug).toBe('webflow'))
    expect(stored.slug).not.toBe('alternativeswebflow')
    // The path it lands on is the one the dialog promised, not a doubled one.
    expect(mockSyncScreenRouteEntries).toHaveBeenCalledWith(
      expect.anything(),
      'host-1',
      { 'screen-1': 'alternatives/webflow' },
      // The announcer (AGL-2573). A rename changes which address serves the
      // page, so the seam drops both the old one and the new one.
      expect.objectContaining({ user: expect.anything() }),
    )
  })
})

/**
 * A `/` a person TYPES (AGL-2572).
 *
 * The seed above is one way the field met a path; the other is somebody
 * writing `alternatives/webflow` into it, which reads as a perfectly ordinary
 * address. `normalizeScreenSlug` deletes the separator to reach the single
 * segment it promises, so the value was accepted, glued and stored — nothing
 * on screen said otherwise. The field refuses it now, and says what the
 * hierarchy is for.
 */
describe('Screen Properties ▸ Slug · a typed path (AGL-2572)', () => {
  it('refuses the edit instead of gluing it', async () => {
    render(<ScreenBesigner />)

    typeSlug('alternatives/webflow')
    clickDone()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      expect.stringContaining('one path segment'),
      expect.objectContaining({ variant: 'warning' }),
    )
    // The glue itself: neither the pasted-together word nor anything else
    // reached the document, and the canvas save that used to answer
    // "Already saved" for a refused slug never ran.
    expect(stored.slug).toBe('old')
    expect(mockSyncScreenRouteEntries).not.toHaveBeenCalled()
    expect(mockHandleSave).not.toHaveBeenCalled()
  })

  it('says so on the field, before anything is pressed', () => {
    render(<ScreenBesigner />)

    typeSlug('alternatives/webflow')

    expect(screen.getByText(/one path segment/)).toBeTruthy()
    // The refusal has to be visible BEFORE the click, for the reason the
    // reserved-address one is: this dialog publishes from a canvas the author
    // is already looking at.
    expect(
      (screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('does not publish a typed path either', async () => {
    render(<ScreenBesigner />)

    typeSlug('alternatives/webflow')
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => expect(screen.getByText(/one path segment/)).toBeTruthy())
    expect(stored.slug).toBe('old')
    expect(mockSyncScreenRouteEntries).not.toHaveBeenCalled()
  })

  /** `/` alone is the home page, and it still means that. */
  it('still takes the home page', async () => {
    mockRoutingMap = {}
    stored.parentId = undefined
    mockScreenDoc.data = stored
    render(<ScreenBesigner />)

    typeSlug('/')
    clickDone()

    await waitFor(() => expect(stored.slug).toBe('/'))
    expect(mockEnqueueSnackbar).not.toHaveBeenCalledWith(
      expect.stringContaining('one path segment'),
      expect.anything(),
    )
  })

  /** An ordinary slug is untouched, including the slashes around one. */
  it('leaves an ordinary slug alone', async () => {
    render(<ScreenBesigner />)

    typeSlug('/webflow/')
    clickDone()

    await waitFor(() => expect(stored.slug).toBe('webflow'))
  })
})
