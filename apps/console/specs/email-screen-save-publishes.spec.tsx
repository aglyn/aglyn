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
 * An email screen's Save IS its publish.
 *
 * A `kind: 'email'` screen routes no live page — campaign sends and the
 * composer's preview read `screens/{id}.versionId` and render that version,
 * and nothing else ever reads the document. So the draft/promote split the
 * routed screens need protects nothing here, and what it produced instead was
 * a trap: an author edits an email design, presses the default "Save draft",
 * and every campaign preview and send keeps rendering the OLD promoted
 * version, silently.
 *
 * What this spec pins:
 *  - the email editor offers ONE save control, no draft/publish split, and
 *    that control promotes the version pointer after saving;
 *  - the success toast names the readers a save actually reaches — campaigns
 *    and previews — not a live site the screen does not have;
 *  - a routed (non-email) screen keeps the split and its plain save exactly
 *    as they were.
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
const mockHandleSave = jest.fn(async () => undefined)
const mockClearServerDraft = jest.fn().mockResolvedValue(undefined)
const mockWriteServerDraft = jest.fn().mockResolvedValue('saved')

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { getIdToken: async () => 'test-token' } }),
  useHostResourceApi: () => mockCreateResource,
  useHost: () => ({ doc: { data: {}, status: 'success', fromCache: false } }),
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
  composeLayoutChainAndScreenNodes: () => ({}),
  composeScreenRoutePath: () => '/promo',
  decodeStoredNodes: () => ({}),
  findScreenIdByRoutePath: () => undefined,
  normalizeScreenSlug: (value: string) => value,
  versionStamp: () => 'stamp-1',
  collectReferencedComponentIds: jest.requireActual(
    '../../../libs/aglyn/src/lib/app-utils/compose-reusable-components',
  ).collectReferencedComponentIds,
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
  BesignerDraftAlertComponent: () => null,
  recoverableRoomSessions: () => 0,
  LayoutChromeContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  PropertiesDialogComponent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useAddElementDrawerCallback: () => () => undefined,
  useBesignerDocument: () => ({
    // Nothing to store: the case under test is the PROMOTE that must follow
    // an already-saved document, which is the step "Save draft" skipped.
    saveAvailable: false,
    remoteChanged: false,
    draft: { available: false },
    handleSave: mockHandleSave,
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
  default: (props: {
    onSave: () => void
    onSaveAndPublish?: () => void
  }) => (
    <div>
      <button type="button" onClick={() => props.onSave()}>
        {'Toolbar save'}
      </button>
      <span>
        {props.onSaveAndPublish ? 'publish-split-offered' : 'single-save-only'}
      </span>
    </div>
  ),
}))
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
jest.mock('../components/screen-social-image-field.component', () => nullComponent)
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

beforeEach(() => {
  jest.clearAllMocks()
  // The trap staged as production held it: the version being edited
  // (`ver-1`, from the route params) is NOT the version the pointer serves.
  stored = { displayName: 'August promo', versionId: 'ver-old' }
  mockScreenDoc.data = stored
})

describe('an email screen saves what the send path reads', () => {
  beforeEach(() => {
    stored.kind = 'email'
  })

  it('offers a single save — no draft/publish split to fall into', () => {
    render(<ScreenBesigner />)
    expect(screen.getByText('single-save-only')).toBeTruthy()
  })

  it('promotes the version pointer, which is what campaigns render', async () => {
    render(<ScreenBesigner />)

    fireEvent.click(screen.getByRole('button', { name: 'Toolbar save' }))

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalled())
    // Read back the way `loadEmailTemplate` reads it: the pointer now names
    // the version the author just saved.
    expect(stored.versionId).toBe('ver-1')
  })

  it('says who a save reaches — campaigns and previews, not a live site', async () => {
    render(<ScreenBesigner />)

    fireEvent.click(screen.getByRole('button', { name: 'Toolbar save' }))

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    const messages = mockEnqueueSnackbar.mock.calls.map(([message]) =>
      String(message),
    )
    expect(
      messages.some((message) => /campaigns and previews/i.test(message)),
    ).toBe(true)
    // The routed-screen copy is a lie here: there is no live site to change.
    expect(messages.some((message) => /live site|live page/i.test(message))).toBe(
      false,
    )
  })
})

describe('a routed screen keeps the split the email editor drops', () => {
  it('offers Save draft beside Save & publish, and Save does not promote', async () => {
    render(<ScreenBesigner />)

    expect(screen.getByText('publish-split-offered')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Toolbar save' }))

    // The plain save writes the version document and nothing else — the
    // pointer promote stays behind the explicit Save & publish.
    await waitFor(() => expect(mockHandleSave).toHaveBeenCalled())
    expect(mockUpdateScreenDoc).not.toHaveBeenCalled()
    expect(stored.versionId).toBe('ver-old')
  })
})
