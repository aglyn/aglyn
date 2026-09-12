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
 * The composers that build a page from a template or a built-in body hand the
 * head's social card to their composition, and hand back what it read
 * (AGL-2850).
 *
 * Each names the references its head resolves the card from, in the head's
 * order: a collection page's entry cover, its template's image and the site
 * default; an author page's share card and portrait. The composition is a
 * double here that answers the way `composeNodesWithChrome` does, so what is
 * pinned is which references each composer hands over and that the answer
 * reaches the page.
 */

jest.mock('./compose-screen-nodes', () => ({
  __esModule: true,
  default: jest.fn(),
  composeNodesWithChrome: jest.fn(),
}))
jest.mock('./get-screen', () => ({
  __esModule: true,
  default: jest.fn(),
}))
jest.mock('./built-in-page-layout', () => ({
  __esModule: true,
  default: jest.fn(async () => undefined),
  resolveBuiltInPageLayoutId: jest.fn(async () => undefined),
}))

import {
  composeAuthorFallbackPage,
  composeAuthorTemplatePage,
} from './compose-author-page'
import {
  composeCollectionFallbackPage,
  composeCollectionTemplatePage,
} from './compose-collection-page'
import composeScreenNodes, { composeNodesWithChrome } from './compose-screen-nodes'
import type { AuthorContent } from './get-author-content'
import type { CollectionContent } from './get-collection-content'
import getScreen from './get-screen'
import type { ComposeSocialImages } from './social-image-facts'

const composeScreenNodesMock = composeScreenNodes as jest.Mock
const composeNodesWithChromeMock = composeNodesWithChrome as jest.Mock
const getScreenMock = getScreen as jest.Mock

const COVER = 'media:host-1/cover'
const TEMPLATE_CARD = 'media:host-1/template-card'
const HOST_CARD = 'media:host-1/host-card'
const AUTHOR_CARD = 'media:host-1/author-card'
const PORTRAIT = 'media:host-1/portrait'

/** What each asset's document records after a replace. */
const DAM: Record<string, { width: number; height: number }> = {
  [COVER]: { width: 1400, height: 700 },
  [TEMPLATE_CARD]: { width: 1080, height: 1080 },
  [HOST_CARD]: { width: 1600, height: 900 },
  [AUTHOR_CARD]: { width: 1200, height: 628 },
  [PORTRAIT]: { width: 512, height: 512 },
}

/**
 * A composition answering the card as the real one does: each reference it
 * was handed whose asset records a pair, and no report when none does.
 */
const answering = async (options: { socialImages?: ComposeSocialImages }) => {
  const facts = Object.fromEntries(
    (options.socialImages?.images ?? [])
      .filter((image): image is string => Boolean(image && DAM[image]))
      .map((image) => [image, DAM[image]]),
  )
  if (Object.keys(facts).length) options.socialImages?.onFacts(facts)
  return { root: {} }
}

/** The references the composition was handed, by its first call. */
const imagesHandedTo = (mock: jest.Mock) =>
  (mock.mock.calls[0][0] as { socialImages?: ComposeSocialImages })
    .socialImages?.images

const HOST = {
  $id: 'host-1',
  subdomain: 'acme',
  seo: { image: HOST_CARD, imageWidth: 1200, imageHeight: 630 },
} as never

const collectionContent = (
  overrides: Partial<CollectionContent> = {},
): CollectionContent => ({
  collection: {
    $id: 'col-1',
    displayName: 'Blog',
    slug: 'blog',
    listScreenId: 'list-tmpl',
    entryScreenId: 'entry-tmpl',
  },
  entries: [],
  entry: null,
  error: null,
  ...overrides,
})

const ENTRY = { $id: 'e1', title: 'Hello', slug: 'hello', coverImage: COVER }

const authorContent = (record: Record<string, unknown>): AuthorContent =>
  ({
    slug: 'zg',
    name: 'Zach Gover',
    known: true,
    author: { $id: 'a1', name: 'Zach Gover', slug: 'zg', ...record },
    entries: [],
    categories: [],
    page: 1,
    perPage: 10,
    totalEntries: 0,
    totalPages: 1,
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  getScreenMock.mockResolvedValue({
    screen: {
      $id: 'tmpl',
      displayName: 'Template',
      seo: { image: TEMPLATE_CARD, imageWidth: 1200, imageHeight: 630 },
    },
  })
  composeScreenNodesMock.mockImplementation(answering)
  composeNodesWithChromeMock.mockImplementation(answering)
})

describe('a collection page composed through its template (AGL-2850)', () => {
  it("hands over the entry's cover, the template's image and the site default", async () => {
    const page = await composeCollectionTemplatePage({
      hostId: 'host-1',
      host: HOST,
      content: collectionContent({ entry: ENTRY as never }),
    })
    expect(imagesHandedTo(composeScreenNodesMock)).toEqual([
      COVER,
      TEMPLATE_CARD,
      HOST_CARD,
    ])
    expect(page?.socialImageFacts).toEqual({
      [COVER]: DAM[COVER],
      [TEMPLATE_CARD]: DAM[TEMPLATE_CARD],
      [HOST_CARD]: DAM[HOST_CARD],
    })
  })

  it("hands over the template's image and the site default on a listing", async () => {
    const page = await composeCollectionTemplatePage({
      hostId: 'host-1',
      host: HOST,
      content: collectionContent(),
    })
    expect(imagesHandedTo(composeScreenNodesMock)).toEqual([
      undefined,
      TEMPLATE_CARD,
      HOST_CARD,
    ])
    expect(page?.socialImageFacts).toEqual({
      [TEMPLATE_CARD]: DAM[TEMPLATE_CARD],
      [HOST_CARD]: DAM[HOST_CARD],
    })
  })

  it('returns no facts when the composition answered for none', async () => {
    composeScreenNodesMock.mockResolvedValue({ root: {} })
    const page = await composeCollectionTemplatePage({
      hostId: 'host-1',
      host: HOST,
      content: collectionContent(),
    })
    // Anti-vacuity: the composition was handed the card all the same.
    expect(imagesHandedTo(composeScreenNodesMock)).toContain(TEMPLATE_CARD)
    expect(page).not.toHaveProperty('socialImageFacts')
  })
})

describe('a collection page with no template (AGL-2850)', () => {
  it("hands over the entry's cover and the site default", async () => {
    const page = await composeCollectionFallbackPage({
      hostId: 'host-1',
      host: HOST,
      content: collectionContent({
        collection: { $id: 'col-1', displayName: 'Blog', slug: 'blog' },
        entry: ENTRY as never,
      }),
    })
    expect(imagesHandedTo(composeNodesWithChromeMock)).toEqual([COVER, HOST_CARD])
    expect(page?.socialImageFacts).toEqual({
      [COVER]: DAM[COVER],
      [HOST_CARD]: DAM[HOST_CARD],
    })
  })
})

describe('an author page (AGL-2850)', () => {
  it('hands over the share card, then the portrait, through a designated screen', async () => {
    const page = await composeAuthorTemplatePage({
      hostId: 'host-1',
      host: { $id: 'host-1', authorScreenId: 'author-tmpl' },
      content: authorContent({ seoImage: AUTHOR_CARD, image: PORTRAIT }),
    })
    expect(imagesHandedTo(composeScreenNodesMock)).toEqual([AUTHOR_CARD, PORTRAIT])
    expect(page?.socialImageFacts).toEqual({
      [AUTHOR_CARD]: DAM[AUTHOR_CARD],
      [PORTRAIT]: DAM[PORTRAIT],
    })
  })

  it('hands over the same pictures for the built-in body', async () => {
    const page = await composeAuthorFallbackPage({
      hostId: 'host-1',
      host: { $id: 'host-1' },
      content: authorContent({ image: PORTRAIT }),
    })
    expect(imagesHandedTo(composeNodesWithChromeMock)).toEqual([
      undefined,
      PORTRAIT,
    ])
    expect(page?.socialImageFacts).toEqual({ [PORTRAIT]: DAM[PORTRAIT] })
  })
})
