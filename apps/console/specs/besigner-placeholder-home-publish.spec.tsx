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
 * AGL-3478 — publishing the placeholder Home page makes it the owner's.
 *
 * A new site is born with a Home page the platform routed at `/`, named by the
 * host's `defaultHomeScreenId` so a starter may take the root back from it
 * (AGL-3408). The obvious thing to do with it is open it, edit it, and press
 * Save & publish — and that left the marker behind, so the next starter would
 * unpublish the page the owner made.
 *
 * What this spec pins, at the button people actually press:
 *  - on the placeholder, Save & publish goes through the route seam with the
 *    version, so the pointer and the cleared marker are one write;
 *  - a site whose placeholder is some OTHER screen publishes exactly as
 *    before — the pointer, and nothing near the host document;
 *  - a role that cannot publish is left on the pointer write alone.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/** The screen document as Firestore holds it, so a promote can be read back. */
let stored: Record<string, unknown>

/** Mutable so each case picks the screen's kind before rendering. */
const mockScreenDoc = {
  data: {} as Record<string, unknown>,
  status: 'success' as const,
  fromCache: false,
}

const mockUpdateScreenDoc = jest.fn((data: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(data)) stored[key] = value
  return Promise.resolve()
})

const mockCreateResource = jest.fn(async () => ({ id: 'created-id' }))

/** The host document's routing map and placeholder marker, per case. */
let mockHost: { screens: Record<string, string>; defaultHomeScreenId?: string }
let mockCanPublish = true
/** The editor's "the save landed" callback, so a case can make one land. */
let mockOnSaved: (() => void) | undefined
/** The route seam, spied: the placeholder must publish THROUGH it. */
const mockPublishScreenRoute = jest.fn().mockResolvedValue(undefined)
const mockHandleSave = jest.fn(async () => undefined)
const mockClearServerDraft = jest.fn().mockResolvedValue(undefined)
const mockWriteServerDraft = jest.fn().mockResolvedValue('saved')

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { getIdToken: async () => 'test-token' } }),
  useHostResourceApi: () => mockCreateResource,
  useHost: () => ({ doc: { data: mockHost, status: 'success', fromCache: false } }),
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

jest.mock('@aglyn/aglyn', () => ({
  canvas: {
    rootNode: null,
    nestedNodes: {},
    didSetInitial: true,
    canUndo: false,
    canRedo: false,
    toJSON: () => ({ nodes: {} }),
  },
  CANVAS_ROOT_ELEMENT_ID: 'root',
  MAX_LAYOUT_CHAIN_DEPTH: 5,
  HostViewType: { SCREEN: 'screen', EMAIL: 'email' },
  ScreenLinkContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  buildScreenRouteEntries: () => ({}),
  composeLayoutChainWithProps: () => ({}),
  layoutPropValuesFor: () => undefined,
  // Real (AGL-3286): the page parks a version's layout style overrides on
  // the canvas root and lifts them out on save — pure functions over a map.
  ...(({
    injectLayoutStyleOverrides,
    extractLayoutStyleOverrides,
    replaceUnderMerge,
  }) => ({
    injectLayoutStyleOverrides,
    extractLayoutStyleOverrides,
    replaceUnderMerge,
  }))(
    jest.requireActual(
      '../../../libs/aglyn/src/lib/app-utils/layout-style-overrides',
    ),
  ),
  composeScreenRoutePath: () => '/',
  decodeStoredNodes: () => ({}),
  findScreenIdByRoutePath: () => undefined,
  blockingRouteOwner: () => undefined,
  normalizeScreenSlug: (value: string) => value,
  // Real (AGL-2572): the slug field seeds itself through this, and it is a
  // pure read of one path segment. Listed because this mock is a closed
  // world — an export the page gained arrives here as `undefined is not a
  // function`, from inside render, nowhere near the cause.
  ownScreenSlugFromRoutePath: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).ownScreenSlugFromRoutePath,
  // The page-group helpers (AGL-3463), real for the same reason.
  isScreenGroup: jest.requireActual('@aglyn/aglyn/app-utils/screen-route')
    .isScreenGroup,
  liveScreenDescendants: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).liveScreenDescendants,
  screenClaimsToBeAPage: jest.requireActual(
    '@aglyn/aglyn/app-utils/screen-route',
  ).screenClaimsToBeAPage,
  toScreenRouteNode: jest.requireActual('@aglyn/aglyn/app-utils/screen-route')
    .toScreenRouteNode,
  versionStamp: () => 'stamp-1',
  collectReferencedComponentIds: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/compose-reusable-components',
  ).collectReferencedComponentIds,
  // Real too (AGL-2572): the slug field refuses a typed `/` through this
  // pair, and both are pure functions over a string. Listed because this mock
  // is a closed world — an export the page gained arrives as `undefined is
  // not a function`, from inside render, nowhere near the cause.
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
jest.mock('@aglyn/aglyn/app-utils/site-theme', () => ({
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
  PropertiesDialogComponent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useAddElementDrawerCallback: () => () => undefined,
  // Both take the editor's noun and hand back an async callback the toolbar
  // calls. This spec never clicks either one; they are here because the page
  // calls the hooks at render, and a wholesale mock that omits an export the
  // barrel gained renders nothing at all — the failure lands as a missing
  // label, nowhere near the cause (AGL-2554, AGL-2555).
  useClearCanvasCallback: () => async () => undefined,
  useRepairDocumentCallback: () => async () => undefined,
  useBesignerDocument: (options: { onSaved?: () => void }) => {
    mockOnSaved = options?.onSaved
    return {
      // Nothing to store: the case under test is the PROMOTE that must follow
      // an already-saved document, which is the step "Save draft" skipped.
      saveAvailable: false,
      remoteChanged: false,
      draft: { available: false, sharedDraftUnopened: false },
      handleSave: mockHandleSave,
      // No saved draft on offer, so nothing is refused (AGL-2874).
      refuseOverUnopenedDraft: () => false,
      jsonOpen: false,
      openJsonEditor: () => undefined,
      closeJsonEditor: () => undefined,
      handleJsonSave: () => undefined,
      hasError: false,
      notFound: false,
      status: 'success',
    }
  },
  useLayoutChromeCanvas: () => ({ chromeCanvas: null }),
  // The layout-restyling entry point and its state (AGL-3286).
  LayoutStylePickerButton: () => null,
  layoutStyleSelection: { current: null, select: () => {}, clear: () => {} },
  useCanvasLayoutStyleOverrides: () => undefined,
  useRenderedCanvasElements: () => ({ elements: { current: {} } }),
  withBesignerContext: (component: unknown) => component,
  nodeElementSelector: () => '',
  clearServerDraft: (...args: unknown[]) => mockClearServerDraft(...args),
  writeServerDraft: (...args: unknown[]) => mockWriteServerDraft(...args),
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
  // The wordmark modules build their MUI class keys at import time, so a stub
  // here is a module-load failure rather than a missing style.
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
/**
 * The app bar, reduced to the two facts under test: what the primary Save
 * does, and whether a draft/publish split is offered at all. The real
 * `SaveControl` collapses to a single plain button exactly when
 * `onSaveAndPublish` is absent, so the marker below is that condition made
 * assertable.
 */
jest.mock('../components/besigner-app-bar.component', () => ({
  __esModule: true,
  default: (props: { onSaveAndPublish?: () => void }) => (
    <button type="button" onClick={() => props.onSaveAndPublish?.()}>
      {'Save & publish'}
    </button>
  ),
}))
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
// The entry lookup the link pickers search (AGL-3119); nothing here opens one.
jest.mock('../components/link-target-search-provider.component', () => passthrough)
jest.mock('../components/reusable-components-provider.component', () => passthrough)
jest.mock('../components/screen-social-image-field.component', () => nullComponent)
// The layout property values in Screen Properties (AGL-2893) are their own
// component with their own spec; nothing here is about them.
jest.mock('../components/screen-layout-properties.component', () => ({
  __esModule: true,
  default: () => null,
  useLayoutChainProperties: () => [],
}))
jest.mock('../components/console-plugins-gate.component', () => ({
  withSitePlugins: (component: unknown) => component,
}))
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
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
jest.mock('../hooks/use-host-role', () => ({
  __esModule: true,
  default: () => ({
    hostRole: mockCanPublish ? 'owner' : 'author',
    canPublish: mockCanPublish,
    loaded: true,
  }),
}))
jest.mock('../constants/app-setup', () => ({}))
jest.mock('../constants/preview-state', () => ({
  previewWindowName: () => 'preview',
  writePreviewState: () => undefined,
}))
jest.mock('../constants/screen-publishing', () => ({
  publishScreenRoute: (...args: unknown[]) => mockPublishScreenRoute(...args),
  syncScreenRouteEntries: jest.fn().mockResolvedValue(undefined),
  unpublishScreenRoute: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../utils/revalidate-live-pages', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(null),
  revalidateLivePages: jest.fn().mockResolvedValue(null),
  describeRevalidateShortfall: () => null,
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

beforeEach(() => {
  jest.clearAllMocks()
  // The placeholder, routed at `/` by the platform, with the owner editing a
  // version of their own (`ver-1`, from the route params).
  stored = { displayName: 'Home', slug: '/', versionId: 'ver-seeded' }
  mockScreenDoc.data = stored
  mockHost = { screens: { 'screen-1': '/' }, defaultHomeScreenId: 'screen-1' }
  mockCanPublish = true
})

const saveAndPublish = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save & publish' }))

describe('Save & publish on the placeholder home page (AGL-3478)', () => {
  it('publishes through the route seam, version and all, in one write', async () => {
    render(<ScreenBesigner />)
    saveAndPublish()

    await waitFor(() => expect(mockPublishScreenRoute).toHaveBeenCalled())
    expect(mockPublishScreenRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        hostId: 'host-1',
        screenId: 'screen-1',
        versionId: 'ver-1',
      }),
      '/',
      '/',
    )
    // The seam moved the pointer — a second write of it would be a publish
    // that can land without the marker going.
    expect(mockUpdateScreenDoc).not.toHaveBeenCalled()
  })

  it('also adopts it when the owner edited the live version itself', async () => {
    stored.versionId = 'ver-1'
    // A save that LANDED — the owner's edits are on the live version now.
    mockHandleSave.mockImplementationOnce(async () => {
      mockOnSaved?.()
    })
    render(<ScreenBesigner />)
    saveAndPublish()

    await waitFor(() => expect(mockPublishScreenRoute).toHaveBeenCalled())
    expect(mockUpdateScreenDoc).not.toHaveBeenCalled()
  })

  it('does nothing to it on a click that publishes nothing', async () => {
    // Already the live version, and the save had nothing to store: the
    // button only refreshes the cache, so the placeholder stays one.
    stored.versionId = 'ver-1'
    render(<ScreenBesigner />)
    saveAndPublish()

    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
        expect.stringMatching(/^Already published/),
        expect.anything(),
      ),
    )
    expect(mockPublishScreenRoute).not.toHaveBeenCalled()
  })

  it('leaves a site whose placeholder is another screen exactly as it was', async () => {
    mockHost = {
      screens: { home: '/', 'screen-1': 'about' },
      defaultHomeScreenId: 'home',
    }
    render(<ScreenBesigner />)
    saveAndPublish()

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalled())
    expect(stored.versionId).toBe('ver-1')
    expect(mockPublishScreenRoute).not.toHaveBeenCalled()
  })

  it('leaves a role that cannot publish on the pointer write alone', async () => {
    mockCanPublish = false
    render(<ScreenBesigner />)
    saveAndPublish()

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalled())
    expect(mockPublishScreenRoute).not.toHaveBeenCalled()
  })
})
