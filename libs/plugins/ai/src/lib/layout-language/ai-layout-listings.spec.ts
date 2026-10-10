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
import { aiLayoutListingContext, aiLayoutListingsWithDatasets, aiLayoutPageCheck, aiLayoutPagePrompt } from '../jobs/ai-job-page-language'
import { aiLayoutFrameCheck } from '../jobs/ai-job-layout-language'
import { aiSiteListings } from '../jobs/ai-job-site-content'
import { AI_LAYOUT_POST_CARD_TOKENS, AI_LAYOUT_STORE_EMPTY, aiCompileLayoutPage, aiLayoutRecordCardFields } from './ai-layout-compiler'
import {
  AI_LAYOUT_CART_ELEMENT,
  AI_LAYOUT_LISTING_ELEMENTS,
  AI_LAYOUT_LISTINGS_INPUT,
  aiLayoutListingAt,
  aiLayoutListingPlacements,
  aiLayoutListingsOf,
  aiLayoutRecordsPlacements,
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

  it('prefers the band that names the writing over an earlier band of items (live Clay Notes plan)', () => {
    const placements = aiLayoutListingPlacements('posts', [
      {
        id: 'home',
        title: 'Home',
        slug: '/',
        sections: [
          { name: 'hero with blog link', items: 0 },
          { name: 'what you will find: glazes, firings, studio notes', items: 3 },
          { name: 'featured posts cards linking to /blog', items: 3 },
        ],
      },
    ])
    expect(placements).toEqual([{ screenId: 'home', section: 2, role: 'featured' }])
  })

  it('gives the page step’s last pass what a post card binds', () => {
    const base = { screenIds: [], formIds: [], componentIds: [], codeBuilt: true }
    const posts = aiLayoutListingContext(base, targets('home', [POSTS]))
    expect([...(posts.bindingTokens ?? [])]).toEqual(['{{entry.url}}', '{{entry.coverImage}}'])
    expect(aiLayoutListingContext(base, targets('shop', [POSTS]))).toBe(base)
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
    for (const prop of ['source', 'sort', 'columns', 'maxItems', 'pageSize', 'cardStyle', 'emptyText', 'emptyTitle', 'emptyActionLabel', 'emptyActionHref', 'showSort', 'showCategories']) {
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

/*
 * The live Hearth & Wick store start (job FYNasg1h0S, 2026-10-09): its
 * products step failed, nothing was listed, and its Shop page compiled
 * "Product range image cards" as six cards naming kinds of candle — Soy
 * candles, Wax melts, Gift sets… — with a stock photo and a line each: no
 * product, no price, no cart. A store's Shop page is its storefront.
 */
describe('a store’s Shop page is its storefront (AGL-3676)', () => {
  const SHOP_SECTIONS = [
    { name: 'Shop intro heading', uses: [], items: 0 },
    { name: 'Product range image cards', uses: [], items: 6 },
    { name: 'Care and burn tips', uses: [], items: 3 },
    { name: 'Gift help call to action', uses: [], items: 0 },
  ]
  const RANGE = [
    { title: 'Soy candles', text: 'Hand-poured in small batches.' },
    { title: 'Wax melts', text: 'For a warmer.' },
    { title: 'Gift sets', text: 'Boxed and ready.' },
  ]
  const EMPTY_STORE: AiLayoutListing = {
    id: 'listing:products',
    kind: 'products',
    name: 'the shop',
    records: [],
    emptyAction: { label: 'Get in touch', href: '/contact' },
    placements: aiLayoutListingPlacements('products', [
      { id: 'home', title: 'Home', slug: '/', sections: [{ name: 'Hero with shop call to action', items: 0 }, { name: 'Featured range of candles, wax melts and gift sets', items: 3 }] },
      { id: 'shop', title: 'Shop', slug: '/shop', sections: SHOP_SECTIONS },
    ]),
  }
  const compileShop = (listings: AiLayoutListing[]) =>
    aiCompileLayoutPage(
      [
        { blocks: [{ kind: 'heading', text: 'Shop hand-poured soy candles' }] },
        { blocks: [{ kind: 'heading', text: 'The range' }, { kind: 'cards', items: RANGE }] },
        { blocks: [{ kind: 'heading', text: 'Care and burn tips' }, { kind: 'list', items: [{ title: 'Trim the wick', text: 'To a quarter inch before each burn.' }] }] },
        { blocks: [{ kind: 'heading', text: 'Need help with a gift?' }, { kind: 'button', text: 'Contact us', to: 'page:contact' }] },
      ],
      { title: 'Shop', sections: SHOP_SECTIONS },
      targets('shop', listings),
      { reusableComponents: false },
    )

  it('compiles the Shop page’s range section to the Product grid over the catalog, in place of invented cards', () => {
    expect(EMPTY_STORE.placements).toEqual([
      { screenId: 'home', section: 1, role: 'featured' },
      { screenId: 'shop', section: 1, role: 'index' },
    ])
    const compiled = compileShop([EMPTY_STORE])
    const grids = Object.values(compiled.tree.nodes).filter((node) => node.componentId === 'product-grid')
    expect(grids).toHaveLength(1)
    expect(grids[0].props).toMatchObject({ source: 'all', cardStyle: 'photo', pageSize: '12', showSort: true, showCategories: true })
    // The range drawn as cards is gone: the grid shows the store's products.
    expect(JSON.stringify(compiled.tree.nodes)).not.toContain('Boxed and ready.')
  })

  it('says, with no products yet, that new pieces are on the way, with a way to get in touch', () => {
    const grid = Object.values(compileShop([EMPTY_STORE]).tree.nodes).find((node) => node.componentId === 'product-grid')
    expect(grid?.props).toMatchObject({
      emptyTitle: 'New pieces are on the way',
      emptyText: AI_LAYOUT_STORE_EMPTY.text,
      emptyActionLabel: 'Get in touch',
      emptyActionHref: '/contact',
    })
    const alone = Object.values(compileShop([{ ...EMPTY_STORE, emptyAction: undefined }]).tree.nodes).find((node) => node.componentId === 'product-grid')
    expect(alone?.props).toMatchObject({ emptyTitle: 'New pieces are on the way', emptyText: AI_LAYOUT_STORE_EMPTY.textAlone })
    expect(alone?.props?.['emptyActionHref']).toBeUndefined()
  })

  it('keeps the empty state’s action through a listing’s round trip, and only as a site path', () => {
    const read = aiLayoutListingsOf({ [AI_LAYOUT_LISTINGS_INPUT]: [EMPTY_STORE] })
    expect(read[0].emptyAction).toEqual({ label: 'Get in touch', href: '/contact' })
    const unsafe = aiLayoutListingsOf({ [AI_LAYOUT_LISTINGS_INPUT]: [{ ...EMPTY_STORE, emptyAction: { label: 'Go', href: 'https://evil.example' } }] })
    expect(unsafe[0].emptyAction).toBeUndefined()
  })

  it('lists the catalog in the shop section that names the products over a framing one', () => {
    expect(
      aiLayoutListingPlacements('products', [
        { id: 'shop', title: 'Shop', slug: '/shop', sections: [{ name: 'Shop intro', items: 0 }, { name: 'Why soy', items: 4 }, { name: 'Product grid', items: 0 }] },
      ]),
    ).toEqual([{ screenId: 'shop', section: 2, role: 'index' }])
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

  it('carries no cart for a store that lists its catalog but cannot sell yet', () => {
    expect(nodesOf(frame([{ ...PRODUCTS, records: [], cart: false }]).value?.nodes).some((node) => node.componentId === 'cart')).toBe(false)
  })
})

/*
 * A music site's player (AGL-3716). A user asked Assist for "playable musics
 * like daniel Caesar" on a music site and could only be offered a Video. A
 * music site now places the Music player itself, EMPTY — its "add your
 * tracks" state — for the artist to fill with their own uploads. No job
 * sources a recording.
 */
const MUSIC_SCREENS = [
  {
    id: 'home',
    title: 'Home',
    slug: '/',
    sections: [
      { name: 'Hero', items: 0 },
      { name: 'Latest release', items: 0 },
      { name: 'Upcoming shows', items: 3 },
    ],
  },
  {
    id: 'music',
    title: 'Music',
    slug: '/music',
    sections: [
      { name: 'Music intro', items: 0 },
      { name: 'Listen to the tracks', items: 0 },
    ],
  },
  { id: 'booking', title: 'Booking', slug: '/booking', sections: [{ name: 'Book the band', items: 0 }] },
]

describe('a music site places an empty player for the artist’s own tracks (AGL-3716)', () => {
  const [tracks] = aiSiteListings({ outputs: [], screens: MUSIC_SCREENS, music: true })

  it('places it on the Music page, in the section about the recordings, and on a home section named for them', () => {
    expect(tracks).toMatchObject({ id: 'listing:tracks', kind: 'tracks', records: [] })
    expect(tracks.placements).toEqual([
      { screenId: 'home', section: 1, role: 'featured' },
      { screenId: 'music', section: 1, role: 'index' },
    ])
  })

  it('falls back to the home, after the opening, on a site with no music page or section', () => {
    const [only] = aiSiteListings({
      outputs: [],
      screens: [{ id: 'home', title: 'Home', slug: '/', sections: [{ name: 'Hero', items: 0 }, { name: 'About the band', items: 0 }] }],
      music: true,
    })
    expect(only.placements).toEqual([{ screenId: 'home', section: 1, role: 'featured' }])
  })

  it('is placed only on a music site', () => {
    expect(aiSiteListings({ outputs: [], screens: MUSIC_SCREENS }).some((listing) => listing.kind === 'tracks')).toBe(false)
  })

  it('round-trips with no records, whatever a unit input claims', () => {
    const [read] = aiLayoutListingsOf({ [AI_LAYOUT_LISTINGS_INPUT]: [{ ...tracks, records: ['Get You — Daniel Caesar'] }] })
    expect(read.kind).toBe('tracks')
    expect(read.records).toEqual([])
  })

  it('names the Music player by the id the music plugin persists, and offers it to a model', () => {
    const source = readFileSync(join(__dirname, '../../../../music/src/lib/components/music-player.tsx'), 'utf8')
    expect(source).toContain(`export const MUSIC_PLAYER_ID: Aglyn.ComponentId = '${AI_LAYOUT_LISTING_ELEMENTS.tracks}'`)
    expect(AI_PALETTE['musicPlayer']?.pluginId).toBe('music')
    expect(AI_SURFACES.screen.allow).toEqual(expect.arrayContaining(['musicPlayer', 'musicTrack']))
    // The rights confirmation is the owner's answer: never offered to a model.
    expect(AI_PALETTE['musicPlayer']?.propsSchema.properties['rightsConfirmed']).toBeUndefined()
    expect(AI_PALETTE['musicTrack']?.propsSchema.properties['rightsConfirmed']).toBeUndefined()
  })

  it('compiles the section to an empty player — no source — under the words the design gave it', () => {
    const compiled = aiCompileLayoutPage(
      [
        { blocks: [{ kind: 'heading', text: 'Our music' }] },
        {
          blocks: [
            { kind: 'heading', text: 'Listen' },
            { kind: 'cards', items: [{ title: 'Get You', text: 'Daniel Caesar' }] },
          ],
        },
      ],
      { title: 'Music', sections: MUSIC_SCREENS[1].sections.map((section) => ({ ...section, uses: [] })) },
      targets('music', [tracks]),
      { reusableComponents: false },
    )
    const nodes = nodesOf(compiled.tree.nodes)
    const player = nodes.find((node) => node.componentId === 'musicPlayer')
    expect(player).toBeTruthy()
    expect(player?.props?.['src']).toBeUndefined()
    // The cards naming another artist's song are gone.
    expect(JSON.stringify(compiled.tree.nodes)).not.toContain('Daniel Caesar')
    expect(JSON.stringify(compiled.tree.nodes)).toContain('Listen')
  })

  it('stores the player through the same validator every generated page passes', () => {
    const result = homeCheck([tracks])(HOME_ANSWER)
    expect(result.violations).toEqual([])
    const player = nodesOf(result.value?.nodes).find((node) => node.componentId === 'musicPlayer')
    expect(player).toBeTruthy()
    expect(player?.props?.['src']).toBeUndefined()
  })

  it('tells the model the platform places the player, so it names no songs', () => {
    const screen = {
      ...HOME_SCREEN,
      id: 'music',
      title: 'Music',
      slug: '/music',
      sections: MUSIC_SCREENS[1].sections.map((section) => ({ ...section, uses: [] })),
    }
    const prompt = aiLayoutPagePrompt({
      job: { $id: 'job-1', brief: 'A band site', inputs: {} },
      plan: { reuse: [], create: [], screens: [screen] } as never,
      screen: screen as never,
      targets: targets('music', [tracks]),
      reusableComponents: false,
    })
    expect(prompt).toContain('2. "Listen to the tracks"; the platform places a music player here for the artist\'s own tracks')
  })
})

/*
 * A site's datasets (AGL-3616): a menu, a team, a list of services kept as
 * records by the data plugin and repeated by the platform in the sections
 * that name them, never typed out by the model.
 */
describe('a section one of the site’s datasets fills (AGL-3616)', () => {
  const MENU: AiLayoutListing = {
    id: 'listing:records:ds-menu',
    kind: 'records',
    name: 'Menu',
    records: ['Margherita', 'Tiramisù'],
    datasetId: 'ds-menu',
    fields: [
      { id: 'dish', name: 'Dish', type: 'text' },
      { id: 'description', name: 'Description', type: 'text' },
      { id: 'course', name: 'Course', type: 'text' },
      { id: 'vegetarian', name: 'Vegetarian', type: 'bool' },
    ],
    placements: aiLayoutRecordsPlacements({ id: 'ds-menu', name: 'Menu' }, [
      { id: 'home', title: 'Home', slug: '/', sections: [{ name: 'Hero', items: 0 }, { name: 'From the menu', uses: ['new:Menu'], items: 3 }] },
      { id: 'menu', title: 'Menu', slug: '/menu', sections: [{ name: 'Intro', items: 0 }, { name: 'The menu', uses: ['ds-menu'], items: 12 }] },
    ]),
  }
  const MENU_SCREEN = {
    ...HOME_SCREEN,
    sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'From the menu', uses: ['ds-menu'], items: 3 },
    ],
  }
  const answer = {
    sections: [
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Trattoria Nonna')] },
      { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'From the menu'), block('cards', '', [{ title: 'Margherita', text: 'Classic.' }, { title: 'Lasagne', text: 'Baked.' }])] },
    ],
  }
  const check = (datasetIds: string[]) => {
    const sectionIds = ['sec-0', 'sec-1']
    return aiLayoutPageCheck({
      screen: MENU_SCREEN as never,
      sectionIds,
      targets: { ...targets('home', [MENU]), pages: [...targets('home', [MENU]).pages, { id: 'menu', label: 'Menu', slug: '/menu' }] },
      context: { screenIds: ['menu'], formIds: [], componentIds: [], datasetIds, codeBuilt: true, scrollTargetIds: sectionIds },
      reusableComponents: false,
    })(answer)
  }

  it('places the dataset where the plan names it, featured on the home and all of it on its own page', () => {
    expect(MENU.placements).toEqual([
      { screenId: 'home', section: 1, role: 'featured' },
      { screenId: 'menu', section: 1, role: 'index' },
    ])
    expect(aiLayoutListingAt([MENU], 'home', 1)?.listing.kind).toBe('records')
  })

  it('repeats one card over the dataset — its kicker, name and words bound to the record — in place of the cards the design wrote', () => {
    const result = check(['ds-menu'])
    expect(result.violations).toEqual([])
    const nodes = nodesOf(result.value?.nodes)
    const repeat = nodes.find((node) => node.props?.['repeatDataset'] === 'ds-menu')
    expect(repeat).toMatchObject({ componentId: AI_LAYOUT_LISTING_ELEMENTS.records, props: { repeatDataset: 'ds-menu', repeatLimit: '3' } })
    const stored = JSON.stringify(result.value?.nodes)
    for (const token of ['{{item.dish}}', '{{item.description}}', '{{item.course}}']) expect(stored).toContain(token)
    // The design's own cards named dishes; the records are the dataset's.
    expect(stored).not.toContain('Lasagne')
    // A way to the whole menu, on its own page.
    expect(nodes.some((node) => node.props?.['children'] === 'See all')).toBe(true)
  })

  it('admits a repeat only over a dataset the site has, as a Form’s dataset binding is', () => {
    const nodes = nodesOf(check([]).value?.nodes)
    expect(nodes.some((node) => 'repeatDataset' in (node.props ?? {}))).toBe(false)
  })

  it('tells the design the platform lists the records, by name', () => {
    const prompt = aiLayoutPagePrompt({
      job: { brief: 'A trattoria', inputs: {}, $id: 'job-123456' },
      plan: { reuse: [], create: [], screens: [MENU_SCREEN as never] } as never,
      screen: MENU_SCREEN as never,
      targets: targets('home', [MENU]),
      reusableComponents: false,
    })
    expect(prompt).toContain('the platform lists the records of the dataset “Menu” (“Margherita”, “Tiramisù”) here itself, one card each')
  })

  it('keeps a dataset’s listing only where the site has the dataset, and reads its fields off the inventory where it names none', () => {
    const inventory = { datasets: [{ id: 'ds-menu', name: 'Menu', fields: ['Dish', 'Notes'], fieldIds: ['dish', 'notes'] }] }
    expect(aiLayoutListingsWithDatasets([MENU, PRODUCTS], { datasets: [] })).toEqual([PRODUCTS])
    expect(aiLayoutListingsWithDatasets([{ ...MENU, fields: [] }], inventory)[0].fields).toEqual([
      { id: 'dish', name: 'Dish', type: 'text' },
      { id: 'notes', name: 'Notes', type: 'text' },
    ])
    // Read back from a unit's inputs: one listing a dataset, several datasets a site.
    const read = aiLayoutListingsOf({ [AI_LAYOUT_LISTINGS_INPUT]: [MENU, { ...MENU, id: 'listing:records:ds-team', datasetId: 'ds-team' }, { ...MENU, datasetId: '../x' }] })
    expect(read.map((listing) => listing.id)).toEqual(['listing:records:ds-menu', 'listing:records:ds-team'])
  })

  it('draws questions and answers as a ruled list, and a card from the fields its names say', () => {
    expect(
      aiLayoutRecordCardFields([
        { id: 'name', name: 'Name', type: 'text' },
        { id: 'role', name: 'Role', type: 'text' },
        { id: 'bio', name: 'Bio', type: 'text' },
        { id: 'years', name: 'Years', type: 'int32' },
      ]),
    ).toEqual({ title: 'name', kicker: 'role', body: 'bio' })
    expect(aiLayoutRecordCardFields([{ id: 'question', name: 'Question', type: 'text' }, { id: 'answer', name: 'Answer', type: 'text' }])).toEqual({
      title: 'question',
      kicker: null,
      body: 'answer',
    })
  })
})
