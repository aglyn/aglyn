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
 * Preview, the canvas and the published page agree on every host variable
 * (AGL-2881).
 *
 * One site document and one draft go through all three:
 *
 * - the TENANT's own composition, `composeNodesWithChrome`, with its reads
 *   answered from the fixture — the tree a visitor is served;
 * - PREVIEW, the real `DocumentPreview`, reading the same site and the same
 *   component definitions through its Firestore reads;
 * - the CANVAS's resolution, `resolveNodeHostTokens`, which every canvas leaf
 *   draws through (`node-leaf-host-tokens.spec.tsx` pins that the leaves do).
 *
 * The expected values are never written out as the thing compared against:
 * each surface is held to the tenant's output for the same node. The literal
 * values appear once, in a control, to prove that output really substituted.
 */

import * as Aglyn from '@aglyn/aglyn'
import { resolveNodeHostTokens } from '@aglyn/besigner-ui/hooks/use-node-with-host-tokens'
import { render, waitFor } from '@testing-library/react'

const HOST_ID = 'DXnRbPH4CQ'
const ROOT = '_@_'

/**
 * The aglyn.com site document, reduced to what a token reads. It sets no
 * postal address, which is the missing field.
 */
const mockSite = {
  displayName: 'aglyn-marketing',
  subdomain: 'aglyn-marketing',
  cname: 'aglyn.com',
  seo: { entity: { name: 'Aglyn' } },
  business: { supportEmail: 'hello@aglyn.com' },
}

/** A shared card component whose own nodes name the host. */
const mockDefinition = {
  rootId: 'card',
  nodes: {
    card: { $id: 'card', componentId: 'div', nodes: ['cardLine'] },
    cardLine: {
      $id: 'cardLine',
      componentId: 'div',
      parentId: 'card',
      props: {
        children: 'Built with {{host.businessName}}',
        href: '{{prop.link}}',
      },
      nodes: [],
    },
  },
  props: [{ name: 'link', type: 'text', defaultValue: '{{host.url}}' }],
}

/** The draft the besigner handed Preview. */
function mockDraft() {
  return {
    [ROOT]: {
      $id: ROOT,
      componentId: 'div',
      nodes: ['statement', 'logo', 'contact', 'visit', 'cardPlacement'],
    },
    // The Statement section on the home screen, as stored.
    statement: {
      $id: 'statement',
      componentId: 'div',
      parentId: ROOT,
      props: {
        ariaLabel: 'What {{host.businessName}} is',
        children: '{{host.businessName}} builds sites',
      },
      nodes: [],
    },
    logo: {
      $id: 'logo',
      componentId: 'div',
      parentId: ROOT,
      props: { alt: '{{host.businessName}} logo' },
      nodes: [],
    },
    contact: {
      $id: 'contact',
      componentId: 'div',
      parentId: ROOT,
      props: {
        href: '{{host.url}}/contact',
        title: 'Write to {{host.supportEmail}}',
      },
      nodes: [],
    },
    // No postal address on this site.
    visit: {
      $id: 'visit',
      componentId: 'div',
      parentId: ROOT,
      props: { children: 'Visit us at {{host.address}}' },
      nodes: [],
    },
    cardPlacement: {
      $id: 'cardPlacement',
      componentId: 'reusableInstance',
      parentId: ROOT,
      props: { refId: 'card' },
      nodes: [],
    },
  }
}

// ── The tenant's reads, answered from the fixture ──────────────────────────
jest.mock('@aglyn/tenant-runtime/get-layout-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/get-components', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ definitions: { card: mockDefinition } })),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
  getFunctions: jest.fn(async () => ({})),
  getWorkflows: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-datasets', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-plugin-installs', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('@aglyn/tenant-runtime/get-forms', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ forms: {} })),
}))
jest.mock('@aglyn/tenant-runtime/get-media-asset-facts', () => ({
  __esModule: true,
  default: jest.fn(async () => new Map()),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('@aglyn/tenant-runtime/stamp-form-dataset-bindings', () => ({
  __esModule: true,
  stampFormDatasetBindings: (nodes: unknown) => nodes,
}))

// ── Preview's surroundings ─────────────────────────────────────────────────
jest.mock('@aglyn/aglyn-node-renderer', () => ({
  __esModule: true,
  useAglynSiteSchemeThemes: () => undefined,
  useAglynSiteTheme: () => ({}),
  AglynNodeRenderer: () => null,
}))

jest.mock('@aglyn/shared-ui-theme', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/shared-ui-theme'),
  ThemeProvider: ({ children }: { children: unknown }) => children,
  getGoogleFontsUrl: () => undefined,
  useThemeModeState: () => [['light', 'light']],
}))

/** One instance, as the app's is, so Preview's reads run once per mount. */
const mockFirestore = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
  useFirestoreDoc: () => ({ data: undefined, status: 'loading' }),
}))

/**
 * What the site read answers, swapped per test, and what it waits on first:
 * a test holds it open to see what Preview does before the site answers.
 */
const mockSiteRead: {
  outcome: 'found' | 'missing' | 'denied'
  held?: Promise<void>
} = { outcome: 'found' }

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: jest.fn((_firestore: unknown, ...segments: string[]) =>
    segments.join('/'),
  ),
  doc: jest.fn((_firestore: unknown, ...segments: string[]) =>
    segments.join('/'),
  ),
  getDoc: jest.fn(async (path: string) => {
    if (path !== 'hosts/DXnRbPH4CQ') return { data: () => undefined }
    await mockSiteRead.held
    if (mockSiteRead.outcome === 'denied') {
      throw Object.assign(new Error('denied'), { code: 'unavailable' })
    }
    return {
      data: () => (mockSiteRead.outcome === 'found' ? mockSite : undefined),
    }
  }),
  getDocs: jest.fn(async (path: string) => ({
    docs:
      path === 'hosts/DXnRbPH4CQ/components'
        ? [{ id: 'card', data: () => mockDefinition }]
        : [],
  })),
  limit: jest.fn(),
  query: jest.fn((path: string) => path),
}))

jest.mock('../utils/firestore-one-shot-retry', () => ({
  __esModule: true,
  default: (run: () => unknown) => Promise.resolve().then(run),
}))

jest.mock('../constants/preview-state', () => ({
  __esModule: true,
  previewStateKey: () => 'k',
  readPreviewState: () => ({ nodes: mockDraft(), theme: undefined }),
}))

import { composeNodesWithChrome } from '@aglyn/tenant-runtime/compose-screen-nodes'
import DocumentPreview from '../components/document-preview.component'

type NodeMap = Record<string, { props?: Record<string, unknown> }>

/** The tree the published page serves for the draft, on this site. */
const published = async (): Promise<NodeMap> =>
  (await composeNodesWithChrome({
    hostId: HOST_ID,
    screenNodes: mockDraft(),
    host: mockSite,
  })) as NodeMap

/** Every node the published tree renders a host variable in. */
const tokenBearingIds = () => [
  'statement',
  'logo',
  'contact',
  'visit',
  // The card's line, grafted in the placement's place.
  'cmp__cardPlacement__cardLine',
]

/** A node's props as Preview put them in the store it renders. */
const previewProps = (id: string) =>
  (Aglyn.canvas.getNode(id) as { props?: Record<string, unknown> } | undefined)
    ?.props

const openPreview = () =>
  render(
    <DocumentPreview ids={{ hostId: HOST_ID, kind: 'screen', docId: 's1' }} />,
  )

beforeEach(() => {
  mockSiteRead.outcome = 'found'
  mockSiteRead.held = undefined
  Aglyn.canvas.reset()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('host variables — the published page, Preview and the canvas agree (AGL-2881)', () => {
  it('CONTROL — the published page substitutes every token, the missing field included', async () => {
    const page = await published()
    expect(page['statement']?.props).toMatchObject({
      ariaLabel: 'What Aglyn is',
      children: 'Aglyn builds sites',
    })
    expect(page['logo']?.props).toMatchObject({ alt: 'Aglyn logo' })
    expect(page['contact']?.props).toMatchObject({
      href: 'https://aglyn.com/contact',
      title: 'Write to hello@aglyn.com',
    })
    // Not set on this site: nothing, never the token.
    expect(page['visit']?.props).toMatchObject({ children: 'Visit us at ' })
    expect(page['cmp__cardPlacement__cardLine']?.props).toMatchObject({
      children: 'Built with Aglyn',
      href: 'https://aglyn.com',
    })
    expect(JSON.stringify(page)).not.toContain('{{host.')
    // And the draft really held them.
    expect(JSON.stringify(mockDraft())).toContain('{{host.businessName}}')
  })

  it('Preview renders every node exactly as the published page does', async () => {
    const page = await published()
    openPreview()
    await waitFor(() =>
      expect(previewProps('statement')?.['ariaLabel']).not.toBeUndefined(),
    )
    for (const id of tokenBearingIds()) {
      expect({ id, props: previewProps(id) }).toEqual({
        id,
        props: page[id]?.props,
      })
    }
  })

  it('Preview never paints a token before the site has answered', async () => {
    let answer = () => undefined as void
    mockSiteRead.held = new Promise<void>((resolve) => {
      answer = resolve
    })
    const painted: string[] = []
    const setNodes = Aglyn.canvas.setNodes.bind(Aglyn.canvas)
    jest.spyOn(Aglyn.canvas, 'setNodes').mockImplementation((nodes, ...rest) => {
      painted.push(JSON.stringify(nodes))
      return setNodes(nodes, ...rest)
    })
    const { getDocs } = jest.requireMock('firebase/firestore') as {
      getDocs: jest.Mock
    }
    getDocs.mockClear()
    openPreview()
    // The definitions and the forms have answered; only the site has not.
    // Settled by waiting rather than by an async `act`, which never returns
    // against the ceiling timer this component arms.
    await waitFor(() => expect(getDocs).toHaveBeenCalledTimes(2))
    await Promise.all(getDocs.mock.results.map((result) => result.value))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(painted).toEqual([])

    answer()
    await waitFor(() =>
      expect(previewProps('statement')?.['ariaLabel']).toBe('What Aglyn is'),
    )
    expect(painted.length).toBeGreaterThan(0)
    for (const paint of painted) expect(paint).not.toContain('{{host.')
  })

  it('the canvas resolves every node exactly as the published page does', async () => {
    const page = await published()
    // The canvas grafts an instance with the same function, then draws each
    // leaf through its own resolution — never the page's tree.
    const grafted = Aglyn.composeReusableComponentNodes(
      mockDraft() as never,
      { card: mockDefinition } as never,
    ) as NodeMap
    for (const id of tokenBearingIds()) {
      expect({
        id,
        props: resolveNodeHostTokens(grafted[id], mockSite)?.props,
      }).toEqual({ id, props: page[id]?.props })
    }
  })

  it('Preview renders the tokens as written when the site cannot be read', async () => {
    mockSiteRead.outcome = 'denied'
    // The failed read is logged by design; keep it out of the run's output.
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    openPreview()
    await waitFor(() =>
      expect(previewProps('statement')?.['ariaLabel']).not.toBeUndefined(),
    )
    // No site values to show, so the variable stays visible rather than
    // collapsing to a blank that reads as missing copy.
    expect(previewProps('statement')?.['ariaLabel']).toBe(
      'What {{host.businessName}} is',
    )
  })

  it('Preview renders the tokens as written when the site document is missing', async () => {
    mockSiteRead.outcome = 'missing'
    openPreview()
    await waitFor(() =>
      expect(previewProps('contact')?.['href']).not.toBeUndefined(),
    )
    expect(previewProps('contact')?.['href']).toBe('{{host.url}}/contact')
  })
})
