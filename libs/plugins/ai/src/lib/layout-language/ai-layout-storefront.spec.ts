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

import { aiLayoutFrameCheck } from '../jobs/ai-job-layout-language'
import { aiLayoutPageCheck, aiLayoutPagePrompt } from '../jobs/ai-job-page-language'
import { aiSiteStorefrontPlan } from '../jobs/ai-job-plan-step'
import { aiSiteListings } from '../jobs/ai-job-site-content'
import { AI_PALETTE, AI_SURFACES } from '../runtime/ai-palette.generated'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_LAYOUT_SHOP_ALL } from './ai-layout-compiler'
import { AI_LAYOUT_STORE_ANNOUNCEMENT } from './ai-layout-frame'
import type { AiLayoutDesign } from './ai-layout-design'
import { AI_LAYOUT_LISTING_ELEMENTS, type AiLayoutListing } from './ai-layout-listings'
import type { AiLayoutTargets } from './ai-layout-links'
import { aiStorefrontItemIcons, aiStorefrontSays } from './ai-layout-storefront'

/*
 * A store's storefront (AGL-3676, second round). Zach, 2026-10-09, on the
 * beta.237 Willow Wick Candles start (job MtlXWjvt9P, "a small-batch candle
 * shop selling hand-poured soy candles online"): "again this Willow Wick
 * Candles site does not look like a store front". Its home was a lifestyle
 * hero, one row of featured products and four text-only bands; its /shop
 * opened on a tall hero with the grid below the fold; its header repeated
 * the nav's Shop as a "Shop candles" button.
 *
 * The plan and the answers below are that start's, as the live site showed
 * them, compiled offline by today's code.
 */

/** Willow Wick's plan, as its live pages show it. */
const WILLOW_PLAN = {
  reuse: [],
  create: [],
  screens: [
    {
      title: 'Home',
      slug: '/',
      layout: null,
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Willow Wick Candles',
      seoDescription: 'Hand-poured soy candles.',
      record: null,
      sections: [
        { name: 'Hero with shop call to action', uses: [], items: 0 },
        { name: 'Featured candles', uses: [], items: 4 },
        { name: 'Why soy, why small batch', uses: [], items: 3 },
        { name: 'How our candles are made', uses: [], items: 3 },
        { name: 'Made to be loved', uses: [], items: 0 },
        { name: 'Gifting and shipping', uses: [], items: 3 },
      ],
    },
    {
      title: 'Shop',
      slug: '/shop',
      layout: null,
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Shop',
      seoDescription: 'Every candle.',
      record: null,
      sections: [
        { name: 'Shop hero', uses: [], items: 0 },
        { name: 'Shop intro', uses: [], items: 0 },
        { name: 'Product grid', uses: [], items: 6 },
        { name: 'Candle care', uses: [], items: 3 },
      ],
    },
    {
      title: 'About',
      slug: '/about',
      layout: null,
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'About',
      seoDescription: 'Our story.',
      record: null,
      sections: [{ name: 'Our story', uses: [], items: 0 }],
    },
  ],
}

describe('a store plan is a storefront’s (AGL-3676)', () => {
  const settled = aiSiteStorefrontPlan(WILLOW_PLAN, { paid: true })
  const names = (index: number) => settled.screens[index].sections.map((section) => section.name)

  it('gives a paid store’s home the parts it left out, in a storefront’s order, within eight sections', () => {
    expect(names(0)).toEqual([
      'Hero with shop call to action',
      'Featured candles',
      'Shop by collection',
      'Why soy, why small batch',
      'How our candles are made',
      'Made to be loved',
      'Gifting and shipping',
      'Newsletter sign-up',
    ])
    expect(settled.screens[0].sections.length).toBeLessThanOrEqual(8)
  })

  it('adds the bestsellers, the reviews and the sign-up to a thin home, and keeps every section it planned', () => {
    const thin = aiSiteStorefrontPlan(
      { screens: [{ ...WILLOW_PLAN.screens[0], sections: [{ name: 'Hero', uses: [], items: 0 }, { name: 'Our story', uses: [], items: 0 }, { name: 'Closing call to action', uses: [], items: 0 }] }] },
      { paid: true },
    )
    expect(thin.screens[0].sections.map((section) => section.name)).toEqual([
      'Hero',
      'Bestsellers',
      'Shop by collection',
      'Our story',
      'Customer reviews',
      'Closing call to action',
      'Newsletter sign-up',
    ])
  })

  it('opens the Shop page on its grid, straight under its title', () => {
    expect(names(1)).toEqual(['Shop hero', 'Product grid', 'Shop intro', 'Candle care'])
  })

  it('leaves a Free store’s home as planned (the wall prices each section), but still opens its shop on the grid', () => {
    const free = aiSiteStorefrontPlan(WILLOW_PLAN, { paid: false })
    expect(free.screens[0]).toBe(WILLOW_PLAN.screens[0])
    expect(free.screens[1].sections.map((section) => section.name)[1]).toBe('Product grid')
  })

  it('changes nothing in a plan that is already a storefront', () => {
    const plan = { screens: [{ ...WILLOW_PLAN.screens[0], sections: [
      { name: 'Hero', uses: [], items: 0 },
      { name: 'Bestsellers', uses: [], items: 4 },
      { name: 'Shop by scent', uses: [], items: 3 },
      { name: 'Customer reviews', uses: [], items: 0 },
      { name: 'Join our newsletter', uses: [], items: 0 },
    ] }] }
    expect(aiSiteStorefrontPlan(plan, { paid: true })).toBe(plan)
  })
})

// ── The pages, compiled ────────────────────────────────────────────────────

const SCREENS = aiSiteStorefrontPlan(WILLOW_PLAN, { paid: true }).screens.map((screen, index) => ({
  ...screen,
  id: ['home', 'shop', 'about'][index],
}))
// A home that also names its reviews: the settled home with one text band given up for them.
const HOME = {
  ...SCREENS[0],
  sections: [
    ...SCREENS[0].sections.filter((section) => section.name !== 'Why soy, why small batch').slice(0, 6),
    { name: 'Customer reviews', uses: [], items: 0 },
    SCREENS[0].sections[7],
  ],
}

const PRODUCT_OUTPUTS = ['Lavender Soy Candle', 'Cedar & Smoke Soy Candle', 'Travel Tin Soy Candle', 'Candle Gift Set', 'Candle Wick Trimmer'].map((label, index) => ({
  resource: 'product' as const,
  id: `p${index}`,
  hostId: 'host-1',
  label,
}))

const LISTINGS: AiLayoutListing[] = aiSiteListings({ outputs: PRODUCT_OUTPUTS, screens: [HOME, ...SCREENS.slice(1)], store: true })

const DESIGN: AiLayoutDesign = { kind: 'store', seed: 0x5eed, home: true }

function targets(pageId: string): AiLayoutTargets {
  return {
    pageId,
    pages: [
      { id: 'home', label: 'Home', slug: '/' },
      { id: 'shop', label: 'Shop', slug: '/shop' },
      { id: 'about', label: 'About', slug: '/about' },
    ].filter((page) => page.id !== pageId),
    homeIds: [],
    forms: [],
    formPageId: null,
    components: [],
    facts: 'Willow Wick Candles: a small-batch candle shop selling hand-poured soy candles online.',
    listings: LISTINGS,
  }
}

const block = (kind: string, text: string, extra: Record<string, unknown> = {}) => ({ kind, col: -1, text, to: '', icon: '', style: 'none', items: [], ...extra })
const items = (...entries: Array<[string, string]>) => entries.map(([title, text]) => ({ title, text, to: '', icon: '' }))

/** The home the live site showed: its hero, its featured row, and text bands of a title and a sentence each. */
const HOME_ANSWER = {
  sections: [
    {
      band: 'plain',
      align: 'start',
      cols: [],
      blocks: [
        block('heading', 'Hand-poured soy candles for slow evenings'),
        block('lede', 'Small batches, clean-burning soy, scents that feel like home.'),
        block('image', 'A lit candle on a bedside table beside an open book'),
        block('button', 'Shop candles', { to: 'page:shop', style: 'primary' }),
        block('button', 'Our story', { to: 'page:about', style: 'secondary' }),
      ],
    },
    { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'Featured candles'), block('cards', '', { items: items(['Lavender', 'Calm.'], ['Cedar', 'Warm.']) })] },
    {
      band: 'plain',
      align: 'center',
      cols: [],
      blocks: [block('heading', 'Shop by collection'), block('cards', '', { items: items(['Everyday candles', 'Our signature jars.'], ['Travel tins', 'Small and packable.'], ['Gifts', 'Boxed sets.']) })],
    },
    {
      band: 'dark',
      align: 'start',
      cols: [],
      blocks: [block('heading', 'How our candles are made'), block('steps', '', { items: items(['Melt', 'We melt the soy slowly.'], ['Pour', 'Each jar is poured by hand.'], ['Cure', 'Two weeks before they ship.']) })],
    },
    { band: 'dark', align: 'start', cols: [], blocks: [block('heading', 'Made to be loved'), block('text', 'Every candle is made to burn evenly to the last of its wax, in a jar you will want to keep.')] },
    {
      band: 'soft',
      align: 'center',
      cols: [],
      blocks: [block('heading', 'Gifting and shipping'), block('cards', '', { items: items(['Gift wrapping', 'Wrapped and ready to give.'], ['Shipping', 'Packed with care.'], ['Easy returns', 'Write to us if anything arrives broken.']) })],
    },
    { band: 'plain', align: 'center', cols: [], blocks: [block('heading', 'What our customers say'), block('quotes', '', { items: items(['Lovely candle', 'A reviewer']) })] },
    { band: 'brand', align: 'center', cols: [], blocks: [block('heading', 'Letters from the studio'), block('lede', 'New scents and small-batch drops, a few times a season.'), block('form', '')] },
  ],
}

type Node = { componentId: string; props?: Record<string, unknown>; nodes?: string[]; parentId?: string | null }
const nodesOf = (value: unknown) => (value ?? {}) as Record<string, Node>

function check(screen: typeof HOME, pageId: string, home: boolean, answer: Record<string, unknown>) {
  const sectionIds = screen.sections.map((_, index) => `${pageId}-sec-${index}`)
  return {
    sectionIds,
    result: aiLayoutPageCheck({
      screen: screen as never,
      sectionIds,
      targets: targets(pageId),
      // A paid store, as the live one was: its workspace keeps components, and
      // the page step's check spares the compiler's own cards (`repeatsCompiled`).
      context: { screenIds: ['home', 'shop', 'about'], formIds: [], componentIds: [], codeBuilt: true, repeatsCompiled: true, scrollTargetIds: sectionIds },
      reusableComponents: true,
      design: { ...DESIGN, home },
    })(answer),
  }
}

/** Every component in a section, by its stored root's id. */
function within(nodes: Record<string, Node>, rootId: string): Node[] {
  const out: Node[] = []
  const walk = (id: string) => {
    const node = nodes[id]
    if (!node) return
    out.push(node)
    for (const child of node.nodes ?? []) walk(child)
  }
  walk(rootId)
  return out
}

describe('a store’s home compiles as a storefront (Willow Wick, AGL-3676)', () => {
  const { result, sectionIds } = check(HOME, 'home', true, HOME_ANSWER)
  const nodes = nodesOf(result.value?.nodes)
  const section = (index: number) => within(nodes, sectionIds[index])
  const has = (index: number, componentId: string) => section(index).some((node) => node.componentId === componentId)

  it('passes the page step’s own check', () => {
    expect(result.violations).toEqual([])
  })

  it('reads, section by section, as a storefront', () => {
    const summary = HOME.sections.map((planned, index) => {
      const parts = section(index)
      const kinds = [
        parts.some((node) => node.componentId === 'product-grid') && 'product grid',
        parts.some((node) => node.componentId === AI_LAYOUT_LISTING_ELEMENTS.reviews) && 'reviews',
        parts.some((node) => node.componentId === AI_LAYOUT_LISTING_ELEMENTS.signup) && 'newsletter',
        parts.filter((node) => node.componentId === 'image').length && `${parts.filter((node) => node.componentId === 'image').length} pictures`,
        parts.filter((node) => node.componentId === 'icon').length && `${parts.filter((node) => node.componentId === 'icon').length} icons`,
      ].filter(Boolean)
      return `${planned.name}: ${kinds.join(', ') || 'words'}`
    })
    expect(summary).toEqual([
      'Hero with shop call to action: 1 pictures',
      'Featured candles: product grid',
      'Shop by collection: 3 pictures',
      'How our candles are made: 3 pictures',
      'Made to be loved: 1 pictures',
      'Gifting and shipping: 3 icons',
      'Customer reviews: reviews',
      'Newsletter sign-up: newsletter',
    ])
  })

  it('opens with a hero that sells, its first button the shop', () => {
    const buttons = section(0).filter((node) => node.componentId === 'muiButton')
    expect(buttons[0]?.props).toMatchObject({ screenId: 'shop' })
    expect(buttons.map((node) => node.props?.['children'])).not.toContain(AI_LAYOUT_SHOP_ALL)
  })

  it('lists the bestsellers with add to cart', () => {
    expect(section(1).find((node) => node.componentId === 'product-grid')?.props).toMatchObject({ cardStyle: 'photo', quickAdd: true, maxItems: '4' })
  })

  it('draws the collections as picture tiles that open the shop', () => {
    const tiles = section(2).filter((node) => node.componentId === 'image')
    expect(tiles).toHaveLength(3)
    for (const tile of tiles) expect(tile.props).toMatchObject({ screenId: 'shop' })
  })

  it('leads every reason to buy with an icon, none twice in a row', () => {
    const icons = section(5).filter((node) => node.componentId === 'icon').map((node) => node.props?.['iconId'])
    expect(new Set(icons).size).toBe(3)
  })

  it('keeps one dark band at most', () => {
    const dark = HOME.sections.filter((_, index) => nodes[sectionIds[index]]?.props?.['colorScheme'] === 'dark')
    expect(dark.length).toBeLessThanOrEqual(1)
  })

  it('places the store’s real reviews, written by nobody here, and its newsletter field', () => {
    expect(section(6).find((node) => node.componentId === 'product-reviews')?.props).toEqual({ scope: 'store', heading: 'What our customers say', maxItems: '3' })
    expect(JSON.stringify(section(6))).not.toContain('Lovely candle')
    expect(has(7, 'newsletter-signup')).toBe(true)
    expect(has(7, 'form')).toBe(false)
  })

  it('tells the model the platform fills the reviews and the sign-up', () => {
    const prompt = aiLayoutPagePrompt({
      job: { $id: 'job-willow', brief: 'Candles', inputs: {} },
      plan: { reuse: [], create: [], screens: [HOME] } as never,
      screen: HOME as never,
      targets: targets('home'),
      reusableComponents: false,
    })
    expect(prompt).toContain('7. "Customer reviews"; the platform shows the store\'s real customer reviews here')
    expect(prompt).toContain('8. "Newsletter sign-up"; the platform places the newsletter sign-up field here')
  })
})

describe('a store’s Shop page opens on its grid (AGL-3676)', () => {
  const shop = SCREENS[1]
  const answer = {
    sections: [
      {
        band: 'dark',
        align: 'center',
        cols: [],
        blocks: [block('heading', 'Shop every candle'), block('lede', 'Hand-poured in small batches.'), block('image', 'A candle silhouetted at dusk'), block('button', 'Our story', { to: 'page:about' })],
      },
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'All candles'), block('cards', '', { items: items(['Lavender', 'Calm.']) })] },
      { band: 'soft', align: 'start', cols: [], blocks: [block('heading', 'Made slowly'), block('text', 'We pour every jar by hand.')] },
      { band: 'plain', align: 'start', cols: [], blocks: [block('heading', 'Candle care'), block('cards', '', { items: items(['Trim the wick', 'To a quarter inch.'], ['First burn', 'Let it pool to the edge.'], ['Keep it clear', 'Away from drafts.']) })] },
    ],
  }
  const { result, sectionIds } = check(shop as never, 'shop', false, answer)
  const nodes = nodesOf(result.value?.nodes)

  it('passes the page step’s own check', () => {
    expect(result.violations).toEqual([])
  })

  it('draws its opening as a title bar: no picture, no button, not dark', () => {
    const opening = within(nodes, sectionIds[0])
    expect(opening.some((node) => node.componentId === 'image' || node.componentId === 'muiButton')).toBe(false)
    expect(nodes[sectionIds[0]]?.props?.['colorScheme']).toBeUndefined()
    expect(opening.find((node) => node.componentId === 'muiTypography' && node.props?.['component'] === 'h1')?.props?.['children']).toBe('Shop every candle')
  })

  it('puts the browsing grid second, with sort, categories and add to cart, and no heading of its own', () => {
    const grid = within(nodes, sectionIds[1])
    expect(grid.find((node) => node.componentId === 'product-grid')?.props).toMatchObject({ pageSize: '12', showSort: true, showCategories: true, quickAdd: true })
    expect(grid.some((node) => node.componentId === 'muiTypography')).toBe(false)
  })
})

describe('a store’s header is a storefront’s (AGL-3676)', () => {
  const frame = (header: Record<string, unknown>) =>
    aiLayoutFrameCheck({
      siteName: 'Willow Wick Candles',
      homeId: 'home',
      pages: [
        { id: 'home', label: 'Home', slug: '/' },
        { id: 'shop', label: 'Shop', slug: '/shop' },
        { id: 'about', label: 'About', slug: '/about' },
      ],
      targets: { ...targets(''), pageId: null, pages: [] },
      extend: () => [],
    })({ header: { band: 'dark', align: 'start', cols: [], ...header }, footer: { band: 'soft', align: 'start', cols: [], blocks: [block('text', 'Hand-poured soy candles.')] } })

  it('drops the button repeating the nav’s Shop, keeps the cart, and opens with an announcement bar to the shop', () => {
    const result = frame({ blocks: [block('button', 'Shop candles', { to: 'page:shop', style: 'primary' })] })
    expect(result.violations).toEqual([])
    const nodes = Object.values(nodesOf(result.value?.nodes))
    expect(nodes.some((node) => node.componentId === 'muiButton')).toBe(false)
    expect(nodes.some((node) => node.componentId === 'cart')).toBe(true)
    expect(nodes.find((node) => node.componentId === 'muiScreenLink' && node.props?.['children'] === AI_LAYOUT_STORE_ANNOUNCEMENT)?.props).toMatchObject({ screenId: 'shop' })
  })

  it('says the design’s own announcement where it gave one', () => {
    const result = frame({ blocks: [block('note', 'Hand-poured in small batches, in plastic-free boxes')] })
    expect(result.violations).toEqual([])
    const nodes = Object.values(nodesOf(result.value?.nodes))
    expect(nodes.find((node) => node.componentId === 'muiTypography' && node.props?.['children'] === 'Hand-poured in small batches, in plastic-free boxes')).toBeDefined()
    expect(nodes.find((node) => node.componentId === 'muiScreenLink' && node.props?.['children'] === 'Shop now')?.props).toMatchObject({ screenId: 'shop' })
  })
})

describe('what a storefront’s parts are called and drawn with', () => {
  it('names the parts by the words a plan gives them', () => {
    expect(aiStorefrontSays('featured', 'Bestsellers')).toBe(true)
    expect(aiStorefrontSays('collections', 'Shop by scent')).toBe(true)
    expect(aiStorefrontSays('reviews', 'What our customers say')).toBe(true)
    expect(aiStorefrontSays('signup', 'Letters from the studio')).toBe(true)
    expect(aiStorefrontSays('signup', 'Why soy, why small batch')).toBe(false)
  })

  it('picks an icon a reason’s words suggest, and never the same twice', () => {
    const known = () => true
    expect(aiStorefrontItemIcons(items(['Free shipping', ''], ['Easy returns', ''], ['Gift wrapping', '']), known)).toEqual(['truck', 'recycle', 'gift'])
    expect(new Set(aiStorefrontItemIcons(items(['A', ''], ['B', ''], ['C', '']), known)).size).toBe(3)
  })

  it('offers the reviews and the sign-up to code only, by the ids and props the commerce plugin persists', () => {
    const commerce = (file: string) => readFileSync(join(__dirname, '../../../../commerce/src/lib/components', file), 'utf8')
    expect(commerce('product-reviews.tsx')).toContain(`export const ID: Aglyn.ComponentId = '${AI_LAYOUT_LISTING_ELEMENTS.reviews}'`)
    expect(commerce('newsletter-signup.tsx')).toContain(`export const ID: Aglyn.ComponentId = '${AI_LAYOUT_LISTING_ELEMENTS.signup}'`)
    for (const prop of ['scope', 'heading', 'maxItems']) expect(commerce('product-reviews.tsx')).toMatch(new RegExp(`\\b${prop}\\?:`))
    expect(commerce('newsletter-signup.tsx')).toMatch(/\bbuttonLabel\?:/)
    expect(commerce('product-grid.tsx')).toMatch(/\bquickAdd\?:/)
    for (const id of ['product-reviews', 'newsletter-signup']) {
      expect(AI_PALETTE[id]?.pluginId).toBe('commerce')
      expect(AI_SURFACES.screen.codeOnly).toContain(id)
      expect(AI_SURFACES.screen.allow).not.toContain(id)
    }
  })
})
