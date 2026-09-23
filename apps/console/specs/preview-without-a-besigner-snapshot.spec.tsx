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
 *
 * @jest-environment jsdom
 */

/**
 * AGL-3204: Preview renders the STORED document when no snapshot exists.
 *
 * The reported symptom was that Preview works from inside the besigner and
 * nowhere else — a version row's Preview, a list card's Preview, a pasted
 * preview URL, all of them showing "No preview state found".
 *
 * AGL-1203 gave Preview one source: a `localStorage` snapshot the besigner
 * writes before opening the tab. Nothing else writes that key, and five
 * surfaces link straight at a preview route without going through the
 * besigner — so `readPreviewState` returned null and the surface refused.
 * The empty state was not a fallback firing; it was the only thing the route
 * could produce for anyone who had not just pressed Preview in the editor.
 *
 * ## What is asserted
 *
 * That the snapshot is now an OPTIMIZATION rather than the only source: with
 * no snapshot the surface reads the version the URL names and renders it,
 * and with a snapshot it still prefers the snapshot — which is the whole
 * point of the snapshot, since it carries besigner state that was never
 * saved.
 *
 * The theme gets its own assertion because a fallback that rendered the
 * right nodes unstyled would be a second bug wearing the first one's fix.
 * The snapshot carries `theme` "so the preview styles like the live site";
 * the fallback resolves it from the site document this surface ALREADY reads
 * for `{{host.*}}` tokens, through `resolveSiteTheme` — the same function
 * the besigner calls before it writes the snapshot.
 *
 * Settle with `waitFor`, never `await act(async () => …)`: this component
 * mounts the site runtimes and arms an 8-second ceiling timer, and an async
 * `act` never returns against it (the finding recorded in
 * `preview-tab-names-the-document.spec.tsx`).
 */

import { render, screen, waitFor } from '@testing-library/react'
import * as Aglyn from '@aglyn/aglyn'

/** Every `useAglynSiteTheme` argument, so the theme has its own assertion. */
let mockThemeCalls: Array<{ theme?: unknown; scheme?: string }>

jest.mock('@aglyn/aglyn-node-renderer', () => {
  const actualReact = jest.requireActual('react')
  return {
    __esModule: true,
    useAglynSiteSchemeThemes: () => undefined,
    useAglynSiteTheme: (args: { theme?: unknown; scheme?: string }) => {
      mockThemeCalls.push(args)
      return {}
    },
    AglynNodeRenderer: () =>
      actualReact.createElement('div', { 'data-testid': 'tree' }, 'rendered'),
  }
})

jest.mock('@aglyn/shared-ui-theme', () => ({
  __esModule: true,
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  getGoogleFontsUrl: () => undefined,
  SiteSchemeThemesContext: {
    Provider: ({ children }: { children: unknown }) => children,
  },
  useThemeModeState: () => [['light', 'light']],
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
}))

/** The document each read resolves to, keyed by the path it was asked for. */
let mockDocs: Record<string, Record<string, unknown> | undefined>
let mockRequestedPaths: string[]

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn(),
  // The real `doc(firestore, ...segments)` returns a reference; the path is
  // all this suite needs from one, so it stands in as the reference itself.
  doc: jest.fn((_firestore: unknown, ...segments: string[]) => {
    const path = segments.join('/')
    mockRequestedPaths.push(path)
    return path
  }),
  getDoc: jest.fn((path: string) =>
    Promise.resolve({
      data: () => mockDocs[path],
      // The chain walk reads single fields off a snapshot rather than the
      // whole document, exactly as the besigner's own walk does.
      get: (field: string) => mockDocs[path]?.[field],
    }),
  ),
  getDocs: jest.fn(() => Promise.resolve({ docs: [] })),
  limit: jest.fn(),
  query: jest.fn(),
}))

jest.mock('../utils/firestore-one-shot-retry', () => ({
  __esModule: true,
  default: (fn: () => unknown) => Promise.resolve(fn()),
}))

/**
 * The snapshot, switchable per test. `null` is the reported bug's condition
 * and the default here: every surface but the besigner.
 */
let mockSnapshot: { nodes: unknown; theme?: unknown; updatedAt: number } | null

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'aglyn:preview:screen:h1:s1:v1',
  readPreviewState: () => mockSnapshot,
}))

import DocumentPreview from '../components/document-preview.component'
import { resetDocumentSubject } from '../components/document-subject'

const HOST_ID = 'h1'
const SCREEN_ID = 's1'
const VERSION_ID = 'v1'
const SCREEN_PATH = `hosts/${HOST_ID}/screens/${SCREEN_ID}`
const VERSION_PATH = `${SCREEN_PATH}/versions/${VERSION_ID}`

const STORED_TEXT_NODE = 'n-stored'

/** A minimal canvas-rooted tree, the shape a screen version really stores. */
const storedNodes = () => ({
  [Aglyn.NODE_ROOT_ID]: {
    $id: Aglyn.NODE_ROOT_ID,
    componentId: 'div',
    parentId: null,
    nodes: [STORED_TEXT_NODE],
  },
  [STORED_TEXT_NODE]: {
    $id: STORED_TEXT_NODE,
    componentId: 'div',
    parentId: Aglyn.NODE_ROOT_ID,
    nodes: [],
  },
})

/** The site's own theme, the thing `resolveSiteTheme` reads off the host. */
const HOST_THEME = { palette: { primary: { main: '#00b0ff' } } }

const ids = {
  hostId: HOST_ID,
  kind: 'screen' as const,
  docId: SCREEN_ID,
  versionId: VERSION_ID,
}

// Retitled by this change; see the component. Matched on the heading so
// the body copy can be reworded without silently vacating the assertion.
const REFUSAL = /Nothing to preview yet/i

describe('Preview renders without a besigner snapshot (AGL-3204)', () => {
  let setNodes: jest.SpyInstance

  beforeEach(() => {
    resetDocumentSubject()
    mockRequestedPaths = []
    mockThemeCalls = []
    mockSnapshot = null
    mockDocs = {
      [`hosts/${HOST_ID}`]: { theme: HOST_THEME },
      [SCREEN_PATH]: { displayName: 'Pricing', versionId: VERSION_ID },
      [VERSION_PATH]: { nodes: storedNodes() },
    }
    setNodes = jest
      .spyOn(Aglyn.canvas, 'setNodes')
      .mockImplementation(() => undefined as never)
    jest.spyOn(Aglyn.canvas, 'getNode').mockReturnValue(undefined as never)
  })

  afterEach(() => {
    resetDocumentSubject()
    jest.restoreAllMocks()
  })

  it('states its premise: this is the no-snapshot case', () => {
    // The instrument before it is trusted. Every assertion below is about
    // what happens when the besigner has written nothing, so a snapshot
    // leaking in would make the suite pass without the fix.
    expect(mockSnapshot).toBeNull()
  })

  it('renders the stored version instead of refusing', async () => {
    // THE BUG: `readPreviewState` returned null, `missing` went true, and
    // the tab painted "Open this screen in the besigner and click Preview
    // again" — for a link whose whole purpose is to preview a version the
    // reader has no intention of editing.
    render(<DocumentPreview ids={ids} />)
    await waitFor(() => expect(setNodes).toHaveBeenCalled())
    expect(screen.queryByText(REFUSAL)).toBeNull()
  })

  it('renders the nodes the version document actually holds', async () => {
    // Not merely "something painted": the tree that reached the canvas has
    // to be THIS version's, or the fix is a blank page with no message.
    render(<DocumentPreview ids={ids} />)
    await waitFor(() => expect(setNodes).toHaveBeenCalled())
    const applied = setNodes.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(Object.keys(applied)).toContain(STORED_TEXT_NODE)
  })

  it('reads the version the URL names', async () => {
    render(<DocumentPreview ids={ids} />)
    await waitFor(() => expect(setNodes).toHaveBeenCalled())
    expect(mockRequestedPaths).toContain(VERSION_PATH)
  })

  it('styles the fallback like the live site', async () => {
    // A preview that renders the right nodes with MUI's default blue is a
    // new way of looking broken. The snapshot carries `theme`; with no
    // snapshot it comes off the site document this surface already reads.
    render(<DocumentPreview ids={ids} />)
    await waitFor(() => expect(setNodes).toHaveBeenCalled())
    const themed = mockThemeCalls.filter((call) => call.theme)
    expect(themed.length).toBeGreaterThan(0)
    expect(themed.at(-1)?.theme).toMatchObject(HOST_THEME)
  })

  it('still says so when the document genuinely has nothing to show', async () => {
    // The refusal is not deleted, only demoted. A version that does not
    // exist has no preview, and saying nothing would be a blank tab —
    // the defect AGL-1261 was filed about.
    mockDocs = {
      [`hosts/${HOST_ID}`]: { theme: HOST_THEME },
      [SCREEN_PATH]: { displayName: 'Pricing' },
    }
    render(<DocumentPreview ids={ids} />)
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy())
    expect(setNodes).not.toHaveBeenCalled()
  })

  describe('the snapshot is an optimization, not a casualty', () => {
    const SNAPSHOT_NODE = 'n-unsaved'

    beforeEach(() => {
      mockSnapshot = {
        nodes: {
          [Aglyn.NODE_ROOT_ID]: {
            $id: Aglyn.NODE_ROOT_ID,
            componentId: 'div',
            parentId: null,
            nodes: [SNAPSHOT_NODE],
          },
          [SNAPSHOT_NODE]: {
            $id: SNAPSHOT_NODE,
            componentId: 'div',
            parentId: Aglyn.NODE_ROOT_ID,
            nodes: [],
          },
        },
        theme: undefined,
        updatedAt: 1,
      }
    })

    it('prefers the snapshot, which holds work that was never saved', async () => {
      // The besigner's Preview shows the canvas as it stands, including
      // edits not yet written to the version. Reading the stored document
      // over the top of that would silently discard them.
      render(<DocumentPreview ids={ids} />)
      await waitFor(() => expect(setNodes).toHaveBeenCalled())
      const applied = setNodes.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(Object.keys(applied)).toContain(SNAPSHOT_NODE)
      expect(Object.keys(applied)).not.toContain(STORED_TEXT_NODE)
    })

    it('buys the fallback read only when there is no snapshot', async () => {
      // The besigner path must cost exactly what it cost before. This is
      // also what keeps `preview-tab-names-the-document.spec.tsx` honest:
      // it asserts no read names the version, and it mocks a snapshot in.
      render(<DocumentPreview ids={ids} />)
      await waitFor(() => expect(setNodes).toHaveBeenCalled())
      expect(mockRequestedPaths).not.toContain(VERSION_PATH)
    })
  })

  /**
   * Every kind Zach named, because the defect never was screen-specific:
   * all five preview routes render through this one component, and all five
   * refused. Each kind stores its tree somewhere slightly different, so a
   * fix proved on screens alone proves very little.
   */
  describe('every kind the routes cover', () => {
    const DEFINITION_ROOT = 'n-promoted'

    /**
     * A definition, which is what a component and a form really store: it is
     * rooted at the node that was promoted, NOT at the canvas root, so
     * loading one straight into the canvas renders nothing at all (AGL-680).
     */
    const definitionNodes = () => ({
      [DEFINITION_ROOT]: {
        $id: DEFINITION_ROOT,
        componentId: 'div',
        parentId: null,
        nodes: [],
      },
    })

    it.each([
      ['component', 'components'],
      ['form', 'forms'],
    ] as const)('wraps a %s definition under the canvas root', async (
      kind,
      collectionName,
    ) => {
      mockDocs = {
        [`hosts/${HOST_ID}`]: { theme: HOST_THEME },
        [`hosts/${HOST_ID}/${collectionName}/d1`]: { displayName: `A ${kind}` },
        [`hosts/${HOST_ID}/${collectionName}/d1/versions/v1`]: {
          nodes: definitionNodes(),
          // The definition root is written on the VERSION for both kinds.
          rootId: DEFINITION_ROOT,
        },
      }
      render(
        <DocumentPreview
          ids={{ hostId: HOST_ID, kind, docId: 'd1', versionId: 'v1' }}
        />,
      )
      await waitFor(() => expect(setNodes).toHaveBeenCalled())
      const applied = setNodes.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(Object.keys(applied)).toContain(Aglyn.NODE_ROOT_ID)
      expect(Object.keys(applied)).toContain(DEFINITION_ROOT)
    })

    it('reads a template off the document, which carries no version', async () => {
      // Templates version but never publish, so the route has no version
      // segment and the tree lives on the document itself. Reading a
      // `versions/undefined` path here would find nothing on every template.
      mockDocs = {
        [`hosts/${HOST_ID}`]: { theme: HOST_THEME },
        [`hosts/${HOST_ID}/templates/t1`]: {
          displayName: 'Blog entry',
          nodes: storedNodes(),
        },
      }
      render(
        <DocumentPreview ids={{ hostId: HOST_ID, kind: 'template', docId: 't1' }} />,
      )
      await waitFor(() => expect(setNodes).toHaveBeenCalled())
      const applied = setNodes.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(Object.keys(applied)).toContain(STORED_TEXT_NODE)
      expect(mockRequestedPaths.some((path) => path.includes('versions'))).toBe(
        false,
      )
    })

    it('renders a layout from its own version', async () => {
      mockDocs = {
        [`hosts/${HOST_ID}`]: { theme: HOST_THEME },
        [`hosts/${HOST_ID}/layouts/l1`]: { displayName: 'Site chrome' },
        [`hosts/${HOST_ID}/layouts/l1/versions/v1`]: { nodes: storedNodes() },
      }
      render(
        <DocumentPreview
          ids={{ hostId: HOST_ID, kind: 'layout', docId: 'l1', versionId: 'v1' }}
        />,
      )
      await waitFor(() => expect(setNodes).toHaveBeenCalled())
      const applied = setNodes.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(Object.keys(applied)).toContain(STORED_TEXT_NODE)
    })
  })

  describe('a screen keeps the chrome it renders inside', () => {
    const LAYOUT_ID = 'L1'
    const LAYOUT_SLOT = 'n-slot'

    beforeEach(() => {
      mockDocs = {
        [`hosts/${HOST_ID}`]: { theme: HOST_THEME },
        [SCREEN_PATH]: { displayName: 'Pricing' },
        [VERSION_PATH]: { nodes: storedNodes(), layoutId: LAYOUT_ID },
        [`hosts/${HOST_ID}/layouts/${LAYOUT_ID}`]: { versionId: 'lv1' },
        [`hosts/${HOST_ID}/layouts/${LAYOUT_ID}/versions/lv1`]: {
          nodes: {
            [Aglyn.NODE_ROOT_ID]: {
              $id: Aglyn.NODE_ROOT_ID,
              componentId: 'div',
              parentId: null,
              nodes: [LAYOUT_SLOT],
            },
            [LAYOUT_SLOT]: {
              $id: LAYOUT_SLOT,
              componentId: Aglyn.LAYOUT_SLOT_COMPONENT_ID,
              parentId: Aglyn.NODE_ROOT_ID,
              nodes: [],
            },
          },
        },
      }
    })

    it('composes the layout chain, as the besigner does before it snapshots', async () => {
      // A screen preview that dropped the header and footer would be a
      // second way of looking broken — the besigner walks the chain before
      // writing its snapshot (AGL-703) and this path has to agree with it.
      // Composition namespaces every layout node `layout__`, which is the
      // only marker that survives into the applied tree.
      render(<DocumentPreview ids={ids} />)
      await waitFor(() => expect(setNodes).toHaveBeenCalled())
      const applied = setNodes.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(
        Object.keys(applied).some((id) => Aglyn.isLayoutComposedNodeId(id)),
      ).toBe(true)
      // …and the screen is still in there. Layout chrome around nothing is
      // the failure `hasScreenAuthoredNodes` exists to name.
      expect(Aglyn.hasScreenAuthoredNodes(applied)).toBe(true)
    })

    it('takes the binding from the VERSION, not the document', async () => {
      // Key-present on the version wins, so a scheduled version can bring
      // its own chrome without reframing the one being served. An explicit
      // `null` there means no layout at all.
      mockDocs[SCREEN_PATH] = { displayName: 'Pricing', layoutId: LAYOUT_ID }
      mockDocs[VERSION_PATH] = { nodes: storedNodes(), layoutId: null }
      render(<DocumentPreview ids={ids} />)
      await waitFor(() => expect(setNodes).toHaveBeenCalled())
      const applied = setNodes.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(
        Object.keys(applied).some((id) => Aglyn.isLayoutComposedNodeId(id)),
      ).toBe(false)
    })
  })
})
