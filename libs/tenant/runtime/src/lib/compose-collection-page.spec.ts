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

import * as Aglyn from '@aglyn/aglyn/server'
import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
  resolveCollectionTemplateScreenId,
} from './compose-collection-page'
import composeScreenNodes, {
  composeNodesWithChrome,
} from './compose-screen-nodes'
import type { CollectionContent } from './get-collection-content'
import getScreen from './get-screen'

jest.mock('./compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(),
  composeNodesWithChrome: jest.fn(),
}))
jest.mock('./get-screen', () => ({
  __esModule: true,
  default: jest.fn(),
  getScreen: jest.fn(),
}))

const composeScreenNodesMock = composeScreenNodes as jest.Mock
const composeNodesWithChromeMock = composeNodesWithChrome as jest.Mock
const getScreenMock = getScreen as jest.Mock

const content = (
  overrides: Partial<CollectionContent> = {},
): CollectionContent => ({
  collection: {
    $id: 'col-1',
    displayName: 'Blog',
    slug: 'blog',
    listScreenId: undefined,
    entryScreenId: undefined,
    templateScreenId: undefined,
  },
  entries: [
    { $id: 'e1', title: 'Hello', slug: 'hello', excerpt: 'Hi' },
  ],
  entry: null,
  error: null,
  ...overrides,
})

const entry = {
  $id: 'e1',
  title: 'Hello world',
  slug: 'hello-world',
  excerpt: 'The first post',
  body: '# Heading',
  coverImage: 'https://cdn.example.com/cover.png',
  category: 'Guides',
  tags: ['nextjs', 'seo'],
  publishedAt: { seconds: 1_700_000_000 },
}

beforeEach(() => {
  jest.clearAllMocks()
  getScreenMock.mockResolvedValue({
    screen: { $id: 'scr-1', displayName: 'Template', layoutId: 'lay-1' },
  })
  composeScreenNodesMock.mockResolvedValue({ root: {} })
  composeNodesWithChromeMock.mockResolvedValue({ root: {} })
})

describe('resolveCollectionTemplateScreenId (AGL-551)', () => {
  it('routes lists through listScreenId only', () => {
    expect(
      resolveCollectionTemplateScreenId({ listScreenId: 'list-1' }, 'list'),
    ).toBe('list-1')
    expect(
      resolveCollectionTemplateScreenId(
        { entryScreenId: 'entry-1', templateScreenId: 'legacy-1' },
        'list',
      ),
    ).toBeUndefined()
  })

  it('routes entries through entryScreenId with legacy fallback', () => {
    expect(
      resolveCollectionTemplateScreenId(
        { entryScreenId: 'entry-1', templateScreenId: 'legacy-1' },
        'entry',
      ),
    ).toBe('entry-1')
    expect(
      resolveCollectionTemplateScreenId(
        { templateScreenId: 'legacy-1' },
        'entry',
      ),
    ).toBe('legacy-1')
    expect(resolveCollectionTemplateScreenId({}, 'entry')).toBeUndefined()
  })
})

describe('composeCollectionTemplatePage (AGL-551)', () => {
  it('returns null when no template screen is designated', async () => {
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: content(),
    })
    expect(result).toBeNull()
    expect(getScreenMock).not.toHaveBeenCalled()
  })

  it('composes entry routes with {{entry.*}} tokens and entry SEO', async () => {
    const data = content({ entry })
    data.collection!.entryScreenId = 'entry-screen'
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    expect(getScreenMock).toHaveBeenCalledWith({
      hostId: 'host-1',
      screenId: 'entry-screen',
    })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    expect(composeArgs.tokens['entry.title']).toBe('Hello world')
    expect(composeArgs.tokens['entry.url']).toBe('/blog/hello-world')
    expect(composeArgs.tokens['entry.body']).toBe('# Heading')
    expect(composeArgs.tokens['entry.category']).toBe('Guides')
    expect(composeArgs.tokens['entry.tags']).toBe('nextjs, seo')
    expect(composeArgs.tokens['collection.name']).toBe('Blog')
    // Related posts (AGL-582): entry renders carry the routed entry.
    expect(composeArgs.collection).toEqual({ slug: 'blog', entry })
    expect(result?.screen['seo']).toEqual({
      title: 'Hello world',
      description: 'The first post',
      image: 'https://cdn.example.com/cover.png',
    })
    expect(result?.nodes).toEqual({ root: {} })
  })

  it('prefers seoTitle/seoDescription over title/excerpt (AGL-582)', async () => {
    const data = content({
      entry: {
        ...entry,
        seoTitle: 'SEO title',
        seoDescription: 'SEO description',
      },
    })
    data.collection!.entryScreenId = 'entry-screen'
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    expect(result?.screen['seo']).toEqual({
      title: 'SEO title',
      description: 'SEO description',
      image: 'https://cdn.example.com/cover.png',
    })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    expect(composeArgs.tokens['entry.seoTitle']).toBe('SEO title')
    expect(composeArgs.tokens['entry.seoDescription']).toBe('SEO description')
  })

  it('composes list routes with the fetched entries in context', async () => {
    const data = content()
    data.collection!.listScreenId = 'list-screen'
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    const composeArgs = composeScreenNodesMock.mock.calls[0][0]
    expect(composeArgs.screenId).toBe('list-screen')
    expect(composeArgs.collection).toEqual({
      slug: 'blog',
      entries: data.entries,
    })
    expect(composeArgs.tokens).toEqual({
      'collection.name': 'Blog',
      'collection.slug': 'blog',
    })
    expect(result?.screen['seo'].title).toBe('Blog')
  })

  it('falls through when the template fails to compose', async () => {
    const data = content({ entry })
    data.collection!.templateScreenId = 'legacy-screen'
    composeScreenNodesMock.mockResolvedValue(null)
    const result = await composeCollectionTemplatePage({
      hostId: 'host-1',
      content: data,
    })
    expect(result).toBeNull()
  })
})

describe('composeCollectionFallbackPage (AGL-551)', () => {
  const host = {
    $id: 'host-1',
    screens: { 'home-screen': Aglyn.SCREEN_ROOT_PATH, other: 'about' },
  } as never

  it('wraps the built-in list in the home screen layout chrome', async () => {
    const result = await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content(),
    })
    expect(getScreenMock).toHaveBeenCalledWith({
      hostId: 'host-1',
      screenId: 'home-screen',
    })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    expect(chromeArgs.layoutId).toBe('lay-1')
    expect(chromeArgs.collection).toEqual({
      slug: 'blog',
      entries: content().entries,
    })
    const componentIds = Object.values(chromeArgs.screenNodes).map(
      (node: any) => node.componentId,
    )
    expect(componentIds).toContain(Aglyn.COLLECTION_ENTRIES_COMPONENT_ID)
    expect(result?.nodes).toEqual({ root: {} })
  })

  it('renders entries through the markdown Entry body block', async () => {
    await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content({ entry }),
    })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    const bodyNode: any = Object.values(chromeArgs.screenNodes).find(
      (node: any) =>
        node.componentId === Aglyn.COLLECTION_ENTRY_BODY_COMPONENT_ID,
    )
    expect(bodyNode?.props?.markdown).toBe('# Heading')
    // Entry routes hand the routed entry over for Related posts (AGL-582);
    // the empty just-this-entry list must NOT mask on-demand fetching.
    expect(chromeArgs.collection).toEqual({ slug: 'blog', entry })
  })

  it('includes meta/related/share blocks, image-component-free (AGL-582)', async () => {
    await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content({ entry }),
    })
    const chromeArgs = composeNodesWithChromeMock.mock.calls[0][0]
    const nodes = Object.values(chromeArgs.screenNodes) as any[]
    const componentIds = nodes.map((node) => node.componentId)
    expect(componentIds).toContain(Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID)
    expect(componentIds).toContain(Aglyn.COLLECTION_RELATED_COMPONENT_ID)
    expect(componentIds).toContain(Aglyn.COLLECTION_SHARE_COMPONENT_ID)
    const metaNode = nodes.find(
      (node) =>
        node.componentId === Aglyn.COLLECTION_ENTRY_META_COMPONENT_ID,
    )
    expect(metaNode?.props?.category).toBe('Guides')
    expect(metaNode?.props?.tags).toBe('nextjs, seo')
    // The first-party image component crashes tenant SSR (AGL-579): the
    // cover renders as a background-image stack instead.
    expect(componentIds).not.toContain('image')
    const coverNode = nodes.find((node) =>
      String(node.props?.sx?.backgroundImage ?? '').includes(
        'https://cdn.example.com/cover.png',
      ),
    )
    expect(coverNode?.componentId).toBe('muiStack')
  })

  it('skips the layout lookup when the host has no home screen', async () => {
    await composeCollectionFallbackPage({
      hostId: 'host-1',
      host: { $id: 'host-1', screens: { a: 'about' } } as never,
      content: content(),
    })
    expect(getScreenMock).not.toHaveBeenCalled()
    expect(composeNodesWithChromeMock.mock.calls[0][0].layoutId).toBeUndefined()
  })

  it('fails open to null when composition throws', async () => {
    composeNodesWithChromeMock.mockRejectedValue(new Error('boom'))
    const result = await composeCollectionFallbackPage({
      hostId: 'host-1',
      host,
      content: content(),
    })
    expect(result).toBeNull()
  })
})
