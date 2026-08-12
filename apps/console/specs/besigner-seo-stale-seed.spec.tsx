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
 * The besigner's Screen Properties ▸ SEO panel (AGL-1437).
 *
 * Two defects in one handler, and the second is why this one survived the
 * AGL-1358 sweep that hardened ~126 of its siblings:
 *
 * 1. No `fromCache` check. The panel is seeded from the screen listener and
 *    writes the whole `seo` map, which `updateDoc` REPLACES wholesale — so a
 *    cache-served seed reinstates that snapshot's title, description and
 *    social image while the author believes they edited one field.
 * 2. It DEFAULTED the social-image triple — `image: existing.image ?? ''`,
 *    `imageWidth ?? 0`, `imageHeight ?? 0` — so saving a description on a
 *    screen with no social image ADDED three keys the document never had.
 *    `/careers` stores exactly `{ description, title }`; a save here made it
 *    five.
 *
 * ## Why these assertions are on the KEY SET
 *
 * A spec that reads values cannot see defect 2 at all. `snapshot.get('image')`
 * returns undefined for an absent key and `''` for an invented one, and every
 * truthiness check downstream treats them the same — which is exactly how a
 * screen came to look like it had an authored social image when it did not.
 * So the writes here are applied to a stored document with `updateDoc`'s own
 * top-level-replace semantics and the result is read back RAW, the way
 * `doc.data()` would be, and its key set compared.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()

/**
 * The `/careers` shape, verified in production during AGL-1434: exactly two
 * keys under `seo`, no social image. The whole point of the fix is that
 * saving a description leaves it that way.
 */
const STORED_SEO = { description: 'Join the Aglyn team', title: 'Careers' }

/** The document as Firestore holds it, so a save can be read back raw. */
let stored: Record<string, unknown>

/** Mutable so each spec picks the screen listener's verdict before rendering. */
const mockScreenDoc = {
  data: {} as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
}

/**
 * What `updateScreenDoc` does downstream: `useModifyDocCallback` sends a
 * payload with no merge options through `updateDoc`, and `updateDoc` REPLACES
 * a top-level key's value — it does not merge a nested map into the stored
 * one. That is the whole hazard, so the fake reproduces it exactly rather
 * than deep-merging and hiding it.
 */
const mockUpdateScreenDoc = jest.fn((data: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(data)) stored[key] = value
  return Promise.resolve()
})

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
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
  // The REAL guard, not a stub. A stub would let the write through whatever
  // the page passed it, which is the one thing this spec disproves.
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
  },
  CANVAS_ROOT_ELEMENT_ID: 'root',
  MAX_LAYOUT_CHAIN_DEPTH: 5,
  HostViewType: { SCREEN: 'screen' },
  ScreenLinkContext: { Provider: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  buildScreenRouteEntries: () => ({}),
  composeLayoutChainAndScreenNodes: () => ({}),
  composeScreenRoutePath: () => '/careers',
  decodeStoredNodes: () => ({}),
  findScreenIdByRoutePath: () => undefined,
  normalizeScreenSlug: (value: string) => value,
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
  LayoutChromeContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  // Rendered unconditionally: whether the properties dialog is open is
  // chrome, and what this spec is about is what Save SEO writes.
  PropertiesDialogComponent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  useAddElementDrawerCallback: () => () => undefined,
  useBesignerDocument: () => ({
    saveAvailable: false,
    remoteChanged: false,
    draft: null,
    handleSave: () => undefined,
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
}))
jest.mock('@aglyn/shared-ui-theme', () => ({
  getGoogleFontsUrl: () => undefined,
  HostThemeDocumentContext: {
    Provider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useLoading: () => ({ queueLoading: () => () => undefined, loading: false }),
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
  useHostSubdomain: () => 'shop',
}))
/**
 * The social-image field is a real control on this panel, but its media
 * picker is not what is under test — this stub stages a draft on demand so
 * the image branch can be driven without opening the DAM dialog.
 */
jest.mock('../components/screen-social-image-field.component', () => ({
  __esModule: true,
  default: ({
    onChange,
  }: {
    onChange: (draft: {
      image: string
      imageWidth: number
      imageHeight: number
    }) => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onChange({
            image: 'media/og-careers.png',
            imageWidth: 1200,
            imageHeight: 630,
          })
        }
      >
        {'Pick image'}
      </button>
      <button
        type="button"
        onClick={() => onChange({ image: '', imageWidth: 0, imageHeight: 0 })}
      >
        {'Clear image'}
      </button>
    </div>
  ),
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
  stored = { displayName: 'Careers', seo: { ...STORED_SEO } }
  mockScreenDoc.data = stored
  mockScreenDoc.fromCache = false
  mockScreenDoc.status = 'success'
})

/** Type a description, which is what makes Save SEO reachable. */
const editDescriptionAndSave = () => {
  fireEvent.change(screen.getByLabelText('Search description'), {
    target: { value: 'Open roles at Aglyn' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save SEO' }))
}

/** The stored `seo` map read back raw, the way `doc.data()` returns it. */
const storedSeoKeys = () =>
  Object.keys(stored.seo as Record<string, unknown>).sort()

describe('besigner SEO · the invented social-image keys (AGL-1437)', () => {
  it('does NOT introduce image keys when only a description is saved', async () => {
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalledTimes(1))
    // Read back raw. `snapshot.get('image')` could not tell an absent key
    // from an invented `''` one, which is how this survived.
    expect(storedSeoKeys()).toEqual(['description', 'title'])
    expect(stored.seo).not.toHaveProperty('image')
    expect(stored.seo).not.toHaveProperty('imageWidth')
    expect(stored.seo).not.toHaveProperty('imageHeight')
    expect((stored.seo as Record<string, unknown>).description).toBe(
      'Open roles at Aglyn',
    )
    // The field nobody typed in survives untouched.
    expect((stored.seo as Record<string, unknown>).title).toBe('Careers')
  })

  it('writes the triple as ONE group when an image IS picked', async () => {
    render(<ScreenBesigner />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save SEO' }))

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalledTimes(1))
    expect(storedSeoKeys()).toEqual([
      'description',
      'image',
      'imageHeight',
      'imageWidth',
      'title',
    ])
    expect(stored.seo).toMatchObject({
      image: 'media/og-careers.png',
      imageWidth: 1200,
      imageHeight: 630,
    })
  })

  it('DROPS all three when an author clears the image', async () => {
    stored.seo = {
      ...STORED_SEO,
      image: 'media/old.png',
      imageWidth: 1200,
      imageHeight: 630,
    }
    mockScreenDoc.data = stored
    render(<ScreenBesigner />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear image' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save SEO' }))

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalledTimes(1))
    // Cleared means ABSENT, not `''` with 0×0 — the head reads absent as
    // "inherit the site default", and an empty string as an authored image.
    expect(storedSeoKeys()).toEqual(['description', 'title'])
  })

  it('carries an unrelated key forward — it edits two fields, not the map', async () => {
    stored.seo = { ...STORED_SEO, breadcrumb: 'Home / Careers' }
    mockScreenDoc.data = stored
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalledTimes(1))
    expect(storedSeoKeys()).toEqual(['breadcrumb', 'description', 'title'])
  })
})

describe('besigner SEO · the missing seed guard (AGL-1437, AGL-1358)', () => {
  it('REFUSES a save seeded from an unconfirmed read', async () => {
    mockScreenDoc.fromCache = true
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    // Settled, so this cannot pass merely by asserting too early.
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockUpdateScreenDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('SEO settings'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
    // The typed value stays on screen. A refusal that also cleared the field
    // would send the author back to retype a form refused just as quietly.
    expect(
      (screen.getByLabelText('Search description') as HTMLInputElement).value,
    ).toEqual('Open roles at Aglyn')
  })

  it('REFUSES when the screen read failed, and says so differently', async () => {
    mockScreenDoc.status = 'error'
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockUpdateScreenDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  it('SAVES normally once the server has confirmed the seed', async () => {
    render(<ScreenBesigner />)

    editDescriptionAndSave()

    await waitFor(() => expect(mockUpdateScreenDoc).toHaveBeenCalledTimes(1))
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      'SEO saved',
      expect.anything(),
    )
  })
})
