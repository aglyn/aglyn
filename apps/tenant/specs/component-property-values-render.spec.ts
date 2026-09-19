/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * WHAT A PAGE SETS ON A PLACED COMPONENT REACHES THE VISITOR SAFELY.
 *
 * The real loader, through the real composer and graft, with Firestore and
 * the leaf reads stubbed: the page payload asserted here is exactly what the
 * published route hands the renderer, so anything absent from it never
 * reaches a visitor's DOM.
 */

const mockGetHost = jest.fn()
const mockGetScreenVersion = jest.fn()
const mockGetComponents = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin'),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        doc: (path: string) => ({ path }),
        getAll: async () => [],
      }),
    }),
  },
  getPlatformLockdown: async () => null,
  getDomainLockdown: async () => null,
  filterEnabledPluginsByReleaseFlags: async () => [],
  getRealmPluginInstalls: async () => [],
}))
jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  // The plugin hooks are registries no plugin has filled in here.
  resolveSiteRedirect: async () => undefined,
  resolveSitePage: async () => undefined,
  runSitePageEnrichers: async () => ({
    props: {},
    contributors: [],
    unattributed: false,
  }),
}))
jest.mock('../utils/get-host', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetHost(...args),
  CNAME_HOST_PREFIX: 'cname--',
}))
jest.mock('../utils/get-org-billing', () => ({
  __esModule: true,
  default: async () => ({ org: { $id: 'org-1' } }),
}))
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: async () => undefined },
}))
jest.mock('../utils/render-timings', () => ({
  __esModule: true,
  startRenderTimer: () => ({ mark: () => undefined, report: () => undefined }),
}))
// The leaf reads beneath the composition. Everything between them and the
// payload is real.
jest.mock('@aglyn/tenant-runtime/get-screen', () => ({
  __esModule: true,
  default: async () => ({
    screen: { $id: 'screen-1', displayName: 'About', versionId: 'v1' },
    error: null,
  }),
}))
jest.mock('@aglyn/tenant-runtime/get-screen-version', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetScreenVersion(...args),
}))
jest.mock('@aglyn/tenant-runtime/apply-publish-schedule', () => ({
  __esModule: true,
  default: async () => undefined,
}))
jest.mock('@aglyn/tenant-runtime/get-layout-version', () => ({
  __esModule: true,
  default: async () => ({ version: { nodes: {} }, layout: {} }),
}))
jest.mock('@aglyn/tenant-runtime/get-components', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockGetComponents(...args),
}))
jest.mock('@aglyn/tenant-runtime/get-variables', () => ({
  __esModule: true,
  default: async () => [],
  getFunctions: async () => [],
  getWorkflows: async () => [],
}))
jest.mock('@aglyn/tenant-runtime/get-plugin-installs', () => ({
  __esModule: true,
  default: async () => [],
}))
jest.mock('@aglyn/tenant-runtime/get-forms', () => ({
  __esModule: true,
  default: async () => ({ forms: {} }),
}))
jest.mock('@aglyn/tenant-runtime/get-datasets', () => ({
  __esModule: true,
  default: async () => ({}),
}))
jest.mock('@aglyn/tenant-runtime/get-collection-content', () => ({
  __esModule: true,
  default: async () => ({ collection: null, entries: [], entry: null, error: null }),
  getPublishedCollectionSource: async () => ({ entries: [], categories: [] }),
}))
jest.mock('@aglyn/tenant-runtime/get-author-content', () => ({
  __esModule: true,
  default: async () => ({
    known: false,
    slug: '',
    name: '',
    author: null,
    entries: [],
    categories: [],
    page: 1,
    perPage: 10,
    totalEntries: 0,
    totalPages: 1,
  }),
}))
jest.mock('@aglyn/tenant-runtime/template-screens', () => ({
  __esModule: true,
  default: async () => new Set<string>(),
  getTemplateScreenIds: async () => new Set<string>(),
  getTemplateScreenRouting: async () => ({
    templateScreenIds: new Set<string>(),
    listRoutes: {},
    collectionListings: {},
  }),
}))

import { loadPageData } from '../app/[host]/[scheme]/[[...slug]]/load-page-data'

const ROOT = '_@_'

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  displayName: 'Acme',
  screens: { 'screen-1': 'about' },
}

/** A published screen placing one instance of `card`, with its values. */
const screenPlacing = (propValues: Record<string, unknown>) => ({
  version: {
    nodes: {
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['placed'] },
      placed: {
        $id: 'placed',
        componentId: 'reusableInstance',
        parentId: ROOT,
        props: { refId: 'card', name: 'Card', propValues },
        nodes: [],
      },
    },
  },
})

/** The loader's answer for the one page, and the nodes it hands the renderer. */
async function loadWith(
  definition: Record<string, unknown>,
  propValues: Record<string, unknown>,
) {
  mockGetComponents.mockResolvedValue({ definitions: { card: definition } })
  mockGetScreenVersion.mockResolvedValue(screenPlacing(propValues))
  const result: any = await loadPageData('acme', ['about'])
  const nodes = Object.values(
    (result?.props?.nodes ?? {}) as Record<string, any>,
  ).filter((node) => node && typeof node === 'object')
  return { result, nodes }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetHost.mockResolvedValue({ host: { ...HOST }, error: null })
})

describe('a link or image a property feeds (AGL-2933)', () => {
  const CARD = {
    rootId: 'card',
    nodes: {
      card: { $id: 'card', componentId: 'muiStack', nodes: ['cta', 'photo'] },
      cta: {
        $id: 'cta',
        componentId: 'muiButton',
        parentId: 'card',
        props: { href: '{{prop.link}}', children: 'Go' },
      },
      photo: {
        $id: 'photo',
        componentId: 'image',
        parentId: 'card',
        props: { src: '{{prop.image}}', alt: 'Photo' },
      },
    },
    props: [
      { name: 'link', type: 'href', defaultValue: 'https://example.com/pricing' },
      { name: 'image', type: 'image', defaultValue: 'https://cdn.example.com/a.png' },
    ],
  }

  const byComponent = (nodes: any[], componentId: string) =>
    nodes.find((node) => node.componentId === componentId)

  it('renders the addresses the page set', async () => {
    const { result, nodes } = await loadWith(CARD, {
      link: 'https://example.com/contact',
      image: 'https://cdn.example.com/b.png',
    })
    expect(result.notFound).toBeUndefined()
    expect(byComponent(nodes, 'muiButton')?.props?.href).toBe(
      'https://example.com/contact',
    )
    expect(byComponent(nodes, 'image')?.props?.src).toBe(
      'https://cdn.example.com/b.png',
    )
  })

  it('never hands the page a javascript: or data: value set on a property', async () => {
    const { result, nodes } = await loadWith(CARD, {
      link: 'javascript:alert(document.cookie)',
      image: 'data:text/html,<script>alert(1)</script>',
    })
    // The page still renders, with the button and the picture in it.
    expect(result.notFound).toBeUndefined()
    expect(byComponent(nodes, 'muiButton')?.props).toEqual({ children: 'Go' })
    expect(byComponent(nodes, 'image')?.props).toEqual({ alt: 'Photo' })
    expect(JSON.stringify(result.props.nodes)).not.toMatch(/javascript:|data:text/i)
  })
})
