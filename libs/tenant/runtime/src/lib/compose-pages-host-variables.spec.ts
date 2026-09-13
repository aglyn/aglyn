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
 * A page composed from a template or a built-in body fills its host variables
 * in from the site it renders for (AGL-2883).
 *
 * The shared layout is where a site usually names itself — a footer's
 * `© {{host.businessName}}` — and every composer here grafts that layout. The
 * composition fills host variables in from the site its caller hands it, and
 * renders each one as nothing without a site, so a composer that holds the
 * site document and does not pass it serves a footer with no name on every
 * page it builds.
 *
 * Driven through the REAL `composeScreenNodes` and `composeNodesWithChrome`,
 * with only the reads answered from fixtures, so what is pinned is the text a
 * visitor reads rather than an argument handed to a double.
 */

const mockGetPublishedLayoutVersion = jest.fn()
const mockGetScreen = jest.fn()
const mockGetScreenVersion = jest.fn()

jest.mock('./get-layout-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetPublishedLayoutVersion(...a),
}))
jest.mock('./get-screen', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetScreen(...a),
}))
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: (...a: unknown[]) => mockGetScreenVersion(...a),
}))
jest.mock('./get-components', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ definitions: {} })),
}))
jest.mock('./get-forms', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ forms: {} })),
}))
jest.mock('./get-datasets', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('./get-plugin-installs', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
}))
jest.mock('./get-variables', () => ({
  __esModule: true,
  default: jest.fn(async () => ({})),
  getFunctions: jest.fn(async () => ({})),
  getWorkflows: jest.fn(async () => ({})),
}))
jest.mock('./get-collection-content', () => ({
  __esModule: true,
  getPublishedCollectionSource: jest.fn(),
}))
jest.mock('./apply-publish-schedule', () => ({
  __esModule: true,
  default: jest.fn(async () => undefined),
}))
jest.mock('./built-in-page-layout', () => ({
  __esModule: true,
  default: jest.fn(async () => 'site-layout'),
  resolveBuiltInPageLayoutId: jest.fn(async () => 'site-layout'),
}))

import { composeAuthorTemplatePage } from './compose-author-page'
import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
} from './compose-collection-page'
import type { AuthorContent } from './get-author-content'
import type { CollectionContent } from './get-collection-content'

const ROOT = '_@_'

/** The site the pages render for. It sets no postal address. */
const SITE = {
  $id: 'h1',
  subdomain: 'northwind-coffee',
  displayName: 'Northwind Coffee',
} as const

/** The shared layout: a footer that names the site, around the slot. */
const LAYOUT = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['slot', 'footer'] },
  slot: { $id: 'slot', componentId: 'layoutSlot', parentId: ROOT, nodes: [] },
  footer: {
    $id: 'footer',
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: '© {{host.businessName}}' },
    nodes: [],
  },
}

/** A template screen that names the site in its own copy, too. */
const TEMPLATE = {
  [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['heading'] },
  heading: {
    $id: 'heading',
    componentId: 'muiTypography',
    parentId: ROOT,
    props: { children: 'Stories from {{host.businessName}}' },
    nodes: [],
  },
}

const collectionContent = (
  overrides: Partial<CollectionContent> = {},
): CollectionContent => ({
  collection: {
    $id: 'blog',
    displayName: 'Blog',
    slug: 'blog',
    listScreenId: 'list-template',
    entryScreenId: 'entry-template',
  },
  entries: [],
  entry: null,
  error: null,
  ...overrides,
})

const authorContent = {
  slug: 'ada',
  name: 'Ada',
  known: true,
  author: { $id: 'a1', name: 'Ada', slug: 'ada' },
  entries: [],
  categories: [],
  page: 1,
  perPage: 10,
  totalEntries: 0,
  totalPages: 1,
} as unknown as AuthorContent

/** Every piece of copy a composed tree renders, in no particular order. */
const copyOf = (nodes: Record<string, any> | null | undefined) =>
  Object.values(nodes ?? {})
    .map((node) => node?.props?.children)
    .filter((text): text is string => typeof text === 'string')

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPublishedLayoutVersion.mockResolvedValue({
    version: { nodes: LAYOUT },
    layout: {},
  })
  mockGetScreen.mockResolvedValue({
    screen: {
      $id: 'template',
      kind: 'template',
      layoutId: 'site-layout',
      versionId: 'v1',
    },
  })
  mockGetScreenVersion.mockResolvedValue({ version: { nodes: TEMPLATE } })
})

describe('pages built from a template or a built-in body name their site (AGL-2883)', () => {
  it('CONTROL — the layout and the template both carry the token', () => {
    expect(JSON.stringify(LAYOUT)).toContain('{{host.businessName}}')
    expect(JSON.stringify(TEMPLATE)).toContain('{{host.businessName}}')
  })

  it('a collection page composed through its template', async () => {
    const page = await composeCollectionTemplatePage({
      hostId: 'h1',
      host: SITE as never,
      content: collectionContent(),
    })
    expect(copyOf(page?.nodes)).toEqual(
      expect.arrayContaining([
        '© Northwind Coffee',
        'Stories from Northwind Coffee',
      ]),
    )
    expect(JSON.stringify(page?.nodes)).not.toContain('{{host.')
  })

  it('a collection entry composed through its template', async () => {
    const page = await composeCollectionTemplatePage({
      hostId: 'h1',
      host: SITE as never,
      content: collectionContent({
        entry: { $id: 'e1', title: 'Hello', slug: 'hello' } as never,
      }),
    })
    expect(copyOf(page?.nodes)).toEqual(
      expect.arrayContaining(['© Northwind Coffee']),
    )
  })

  it('a collection page with no template', async () => {
    const page = await composeCollectionFallbackPage({
      hostId: 'h1',
      host: SITE as never,
      content: collectionContent({
        collection: { $id: 'blog', displayName: 'Blog', slug: 'blog' },
      }),
    })
    expect(copyOf(page?.nodes)).toEqual(
      expect.arrayContaining(['© Northwind Coffee']),
    )
    expect(JSON.stringify(page?.nodes)).not.toContain('{{host.')
  })

  it('an author page composed through its designated screen', async () => {
    const page = await composeAuthorTemplatePage({
      hostId: 'h1',
      host: { ...SITE, authorScreenId: 'author-template' },
      content: authorContent,
    })
    expect(copyOf(page?.nodes)).toEqual(
      expect.arrayContaining([
        '© Northwind Coffee',
        'Stories from Northwind Coffee',
      ]),
    )
  })

  it('renders a field the site has not set as nothing, as every page does', async () => {
    mockGetScreenVersion.mockResolvedValue({
      version: {
        nodes: {
          ...TEMPLATE,
          heading: {
            ...TEMPLATE.heading,
            props: { children: 'Visit us at {{host.address}}' },
          },
        },
      },
    })
    const page = await composeCollectionTemplatePage({
      hostId: 'h1',
      host: SITE as never,
      content: collectionContent(),
    })
    expect(copyOf(page?.nodes)).toEqual(
      expect.arrayContaining(['Visit us at ']),
    )
  })
})
