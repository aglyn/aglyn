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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLLECTION_ENTRIES_COMPONENT_ID } from '@aglyn/aglyn/app-utils/collection-entries'
import { AI_PALETTE, AI_SURFACES } from '../runtime/ai-palette.generated'
import { aiLayoutPageCheck, aiLayoutPagePrompt } from '../jobs/ai-job-page-language'
import { aiLayoutFrameCheck } from '../jobs/ai-job-layout-language'
import { AI_LAYOUT_POST_CARD_TOKENS, aiCompileLayoutPage } from './ai-layout-compiler'
import {
  AI_LAYOUT_CART_ELEMENT,
  AI_LAYOUT_LISTING_ELEMENTS,
  AI_LAYOUT_LISTINGS_INPUT,
  aiLayoutListingAt,
  aiLayoutListingPlacements,
  aiLayoutListingsOf,
  type AiLayoutListing,
} from './ai-layout-listings'
import type { AiLayoutTargets } from './ai-layout-links'

/*
 * A store's products and a blog's posts listed by the sections that show
 * them (AGL-3676). The live Ember & Wick start (2026-10-08) wrote five
 * products and showed none: "Featured candles" and "The candle range" were
 * cards naming candles, with no photo, price or link, and the header had no
 * cart. The Clay Notes blog's "Featured writing" linked to no post.
 */

/** Ember & Wick's confirmed plan (job 85u_o2U_Ra), its pages and their sections. */
const EMBER_SCREENS = [
  {
    id: 'home',
    title: 'Home',
    slug: '/',
    sections: [
      { name: 'Hero with shop call to action', items: 0 },
      { name: 'Featured candles', items: 3 },
      { name: 'Why small batch soy', items: 3 },
      { name: 'Gifting teaser', items: 0 },
      { name: 'Closing call to action', items: 0 },
    ],
  },
  {
    id: 'shop',
    title: 'Shop',
    slug: '/shop',
    sections: [
      { name: 'Shop intro', items: 0 },
      { name: 'Candle range image cards', items: 6 },
      { name: 'Care and burn notes', items: 0 },
    ],
  },
  {
    id: 'gifting',
    title: 'Gifting',
    slug: '/gifting',
    sections: [
      { name: 'Gifting hero', items: 0 },
      { name: 'Gift ideas by occasion', items: 4 },
    ],
  },
  { id: 'about', title: 'About', slug: '/about', sections: [{ name: 'Our story', items: 0 }, { name: 'How we make our candles', items: 4 }] },
  { id: 'contact', title: 'Contact', slug: '/contact', sections: [{ name: 'Get in touch', items: 0 }] },
]

const PRODUCTS: AiLayoutListing = {
  id: 'listing:products',
  kind: 'products',
  name: 'the shop',
  records: ['Signature Soy Candle', 'Travel Soy Candle', 'Candle Gift Set', 'Soy Wax Melts', 'Candle Care Kit'],
  placements: aiLayoutListingPlacements('products', EMBER_SCREENS),
}

const POSTS: AiLayoutListing = {
  id: 'listing:posts',
  kind: 'posts',
  name: 'the blog',
  records: ['Why clay', 'Glazes I keep coming back to', 'The first kiln firing'],
  href: '/blog',
  collectionSlug: 'blog',
  placements: aiLayoutListingPlacements('posts', [
    {
      id: 'home',
      title: 'Home',
      slug: '/',
      sections: [
        { name: 'Hero', items: 0 },
        { name: 'About the studio', items: 0 },
        { name: 'Featured journeys cards', items: 3 },
        { name: 'Reader notes', items: 3 },
      ],
    },
  ]),
}

describe('where a site lists its records (AGL-3676)', () => {
  it('lists the catalog in the shop page’s section of items and features it on the home', () => {
    expect(PRODUCTS.placements).toEqual([
      { screenId: 'home', section: 1, role: 'featured' },
      { screenId: 'shop', section: 1, role: 'index' },
    ])
  })

  it('features the posts on a blog’s home in its first band of items, whatever the plan named it', () => {
    expect(POSTS.placements).toEqual([{ screenId: 'home', section: 2, role: 'featured' }])
  })

  it('reads the listings a unit carries, dropping one it cannot place', () => {
    const read = aiLayoutListingsOf({
      [AI_LAYOUT_LISTINGS_INPUT]: [PRODUCTS, { ...POSTS, collectionSlug: '../x' }, { kind: 'events' }],
    })
    expect(read.map((listing) => listing.kind)).toEqual(['products'])
    expect(aiLayoutListingAt(read, 'shop', 1)?.role).toBe('index')
    expect(aiLayoutListingAt(read, 'shop', 2)).toBeNull()
  })
})

/*
 * The elements are named by their persisted ids, as the form binding names
 * `form`: a plugin never imports another's internals, so their sources hold
 * the names here.
 */
describe('a listing is drawn with the element its plugin declares', () => {
  const commerce = (file: string) => readFileSync(join(__dirname, '../../../../commerce/src/lib/components', file), 'utf8')

  it('names the Product grid and the Cart by the ids, and the props, the commerce plugin persists', () => {
    const grid = commerce('product-grid.tsx')
    expect(grid).toContain(`export const ID: Aglyn.ComponentId = '${AI_LAYOUT_LISTING_ELEMENTS.products}'`)
    for (const prop of ['source', 'sort', 'columns', 'maxItems', 'pageSize', 'cardStyle', 'emptyText']) {
      expect(grid).toMatch(new RegExp(`\\b${prop}\\?:`))
    }
    expect(commerce('cart.tsx')).toContain(`export const ID: Aglyn.ComponentId = '${AI_LAYOUT_CART_ELEMENT}'`)
  })

  it('names Collection Entries by the core id the tenant expands', () => {
    expect(AI_LAYOUT_LISTING_ELEMENTS.posts).toBe(COLLECTION_ENTRIES_COMPONENT_ID)
  })

  it('offers both commerce elements to code only, never to a model', () => {
    expect(AI_PALETTE['product-grid']?.pluginId).toBe('commerce')
    expect(AI_SURFACES.screen.codeOnly).toContain('product-grid')
    expect(AI_SURFACES.screen.allow).not.toContain('product-grid')
    expect(AI_SURFACES.layout.codeOnly).toContain('cart')
    expect(AI_SURFACES.layout.allow).not.toContain('cart')
  })
})

const block = (kind: string, text: string, items: Array<{ title: string; text: string }> = []) => ({
  kind,
  col: -1,
  text,
  to: '',
  icon: '',
  style: 'none',
  items: items.map((item) => ({ ...item, to: '', icon: '' })),
})

const CARDS = [
  { title: 'Signature Soy Candle', text: 'Our everyday candle.' },
  { title: 'Travel Soy Candle', text: 'A small tin for the road.' },
  { title: 'Candle Gift Set', text: 'Three scents, boxed.' },
]

function targets(pageId: string, listings: AiLayoutListing[]): AiLayoutTargets {
  return {
    pageId,
    pages: [
      { id: 'home', label: 'Home', slug: '/' },
      { id: 'shop', label: 'Shop', slug: '/shop' },
      { id: 'aiSiteBlog', label: 'Blog', slug: '/blog', href: '/blog' },
    ].filter((page) => page.id !== pageId),
    homeIds: [],
    forms: [],
    formPageId: null,
    components: [],
    facts: 'Ember & Wick: hand-poured soy candles in small batches.',
    listings,
  }
}

const HOME_SCREEN = {
  id: 'home',
  title: 'Home',
  slug: '/',
  layout: null,
  template: null,
  duplicateOf: null,
  nav: true,
  record: null,
  sections: [
    { name: 'Hero with shop call to action', uses: [], items: 0 },
    { name: 'Featured candles', uses: [], items: 3 },
  ],
}

const HOME_ANSWER = {
  sections: [
    { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Hand-poured soy candles'), block('lede', 'Small batches, poured by hand.')] },
    { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'Featured candles'), block('cards', '', CARDS)] },
  ],
}

function homeCheck(listings: AiLayoutListing[]) {
  const sectionIds = ['sec-0', 'sec-1']
  return aiLayoutPageCheck({
    screen: HOME_SCREEN as never,
    sectionIds,
    targets: targets('home', listings),
    context: { screenIds: ['shop'], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: sectionIds },
    reusableComponents: false,
  })
}

const nodesOf = (value: unknown) => Object.values((value ?? {}) as Record<string, { componentId: string; props?: Record<string, unknown> }>)

describe('a section the store’s catalog fills (AGL-3676)', () => {
  it('lists the real products through the Product grid, in place of the cards the design wrote', () => {
    const result = homeCheck([PRODUCTS])(HOME_ANSWER)
    expect(result.violations).toEqual([])
    const nodes = nodesOf(result.value?.nodes)
    const grid = nodes.find((node) => node.componentId === 'product-grid')
    expect(grid?.props).toMatchObject({ source: 'all', maxItems: '4', cardStyle: 'photo' })
    // The cards that named candles in words are gone: the grid shows the products themselves.
    expect(JSON.stringify(result.value?.nodes)).not.toContain('A small tin for the road.')
    // And a way to the whole shop beside the band's heading.
    expect(nodes.some((node) => node.componentId === 'muiButton' && node.props?.['children'] === 'Shop all' && node.props?.['screenId'] === 'shop')).toBe(true)
    // The section planned with items shows the store's items.
    expect(result.value?.items[1]).toBeGreaterThanOrEqual(2)
  })

  it('draws the cards as before where the site keeps no catalog', () => {
    const compiled = aiCompileLayoutPage(
      [{ blocks: [{ kind: 'heading', text: 'Hand-poured soy candles' }] }, { blocks: [{ kind: 'heading', text: 'Featured candles' }, { kind: 'cards', items: CARDS }] }],
      { title: 'Home', sections: HOME_SCREEN.sections },
      targets('home', []),
      { reusableComponents: false },
    )
    expect(nodesOf(compiled.tree.nodes).some((node) => node.componentId === 'product-grid')).toBe(false)
    expect(JSON.stringify(compiled.tree.nodes)).toContain('A small tin for the road.')
  })

  it('tells the model the platform lists the products, so it writes no cards for them', () => {
    const prompt = aiLayoutPagePrompt({
      job: { $id: 'job-1', brief: 'Candles', inputs: {} },
      plan: { reuse: [], create: [], screens: [HOME_SCREEN] } as never,
      screen: HOME_SCREEN as never,
      targets: targets('home', [PRODUCTS]),
      reusableComponents: false,
    })
    expect(prompt).toContain('2. "Featured candles"; the platform lists the shop\'s products here itself')
    expect(prompt).not.toContain('"Featured candles"; shows 3 items')
  })

  it('shows the whole catalog on the shop’s own page, paged', () => {
    const compiled = aiCompileLayoutPage(
      [
        { blocks: [{ kind: 'heading', text: 'The candle range' }] },
        { blocks: [{ kind: 'heading', text: 'Every candle' }, { kind: 'cards', items: CARDS }] },
      ],
      { title: 'Shop', sections: [{ name: 'Shop intro', uses: [], items: 0 }, { name: 'Candle range image cards', uses: [], items: 6 }] },
      targets('shop', [PRODUCTS]),
      { reusableComponents: false },
    )
    const grid = Object.values(compiled.tree.nodes).find((node) => node.componentId === 'product-grid')
    expect(grid?.props).toMatchObject({ pageSize: '12', columns: '3' })
    expect(grid?.props?.['maxItems']).toBeUndefined()
  })
})

describe('a section the blog’s posts fill (AGL-3676)', () => {
  const BLOG_SCREEN = {
    ...HOME_SCREEN,
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'About the studio', uses: [], items: 0 },
      { name: 'Featured journeys cards', uses: [], items: 3 },
    ],
  }
  const answer = {
    sections: [
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Clay Notes')] },
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'About the studio'), block('text', 'One potter, one wheel.')] },
      { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'Featured writing'), block('cards', '', [{ title: 'Why clay', text: 'How it began.' }, { title: 'Glazes', text: 'What I use.' }])] },
    ],
  }

  it('lists each post as a linked card — cover, date, byline, title and excerpt — from the blog itself', () => {
    const sectionIds = ['sec-0', 'sec-1', 'sec-2']
    const result = aiLayoutPageCheck({
      screen: BLOG_SCREEN as never,
      sectionIds,
      targets: targets('home', [POSTS]),
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: sectionIds },
      reusableComponents: false,
    })(answer)
    expect(result.violations).toEqual([])
    const nodes = nodesOf(result.value?.nodes)
    expect(nodes.find((node) => node.componentId === 'collectionEntries')?.props).toMatchObject({ collectionSlug: 'blog', entriesLimit: '3' })
    const stored = JSON.stringify(result.value?.nodes)
    for (const token of AI_LAYOUT_POST_CARD_TOKENS) expect(stored).toContain(token)
    // The picture and the link name the post, by the tokens the page fills per post.
    expect(nodes.some((node) => node.componentId === 'image' && node.props?.['src'] === '{{entry.coverImage}}' && node.props?.['href'] === '{{entry.url}}')).toBe(true)
    expect(stored).not.toContain('How it began.')
    // A way to the whole blog, by its path.
    expect(nodes.some((node) => node.props?.['children'] === 'All posts' && node.props?.['href'] === '/blog')).toBe(true)
  })
})

describe('a selling site’s header carries the cart (AGL-3676)', () => {
  const frame = (listings: AiLayoutListing[]) =>
    aiLayoutFrameCheck({
      siteName: 'Ember & Wick',
      homeId: 'home',
      pages: [
        { id: 'home', label: 'Home', slug: '/' },
        { id: 'shop', label: 'Shop', slug: '/shop' },
      ],
      targets: { ...targets('', listings), pageId: null, pages: [] },
      extend: () => [],
    })({
      header: { band: 'plain', align: 'start', cols: [], blocks: [] },
      footer: { band: 'soft', align: 'start', cols: [], blocks: [block('text', 'Hand-poured soy candles.')] },
    })

  it('puts the store’s Cart button in the header of a site that sells', () => {
    const result = frame([{ ...PRODUCTS, placements: [] }])
    expect(result.violations).toEqual([])
    expect(nodesOf(result.value?.nodes).find((node) => node.componentId === 'cart')?.props).toEqual({ variant: 'button' })
  })

  it('carries no cart where the site does not sell', () => {
    expect(nodesOf(frame([]).value?.nodes).some((node) => node.componentId === 'cart')).toBe(false)
  })
})
