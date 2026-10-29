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
 * The Tidewater Soap Works footer (AGL-3735). Zach, 10/12, a screenshot of
 * https://tidewater-soap-works.aglyn.app/ (guided-start store, job
 * S0vnUzhGar, built 10/11 on beta.242): four columns — the brand, "Shop"
 * over the site's pages, "Our shop" over NOTHING, and the store's account and
 * policies under no heading — centered against each other. Its layout's live
 * version is its first, straight out of the frame compile.
 */

import { aiLayoutFrameCheck } from '../jobs/ai-job-layout-language'
import { aiLayoutWithNavigation } from '../jobs/ai-site-publish'
import { aiLayoutWithMenuChanges } from '../model/ai-layout-menus'
import type { AiStoreFrameLinks } from '../model/ai-site-store-pages'
import { AI_LAYOUT_STORE_FOOTER_HEADING } from './ai-layout-frame'
import { aiLayoutFrameHollows, aiLayoutFrameIsHollow, aiLayoutWithoutFrameHollows } from './ai-layout-frame-hollows'
import type { AiLayoutListing } from './ai-layout-listings'
import type { AiLayoutTargets } from './ai-layout-links'

interface Node {
  componentId: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
}

const NONE = { hollow: false }
const hollowOf = (nodes: Record<string, unknown>) => ({ hollow: aiLayoutFrameIsHollow(aiLayoutFrameHollows(nodes)) })

/** The live layout's footer, node for node (prod `hosts/wPZ9tRTQU7/layouts/xMJ9UuCLDH`, version oLA1ZW0quH). */
function tidewaterLiveFooter(): Record<string, Node> {
  const link = (children: string, to: Record<string, string>): Node => ({ componentId: 'muiScreenLink', props: { children, renderAs: 'link', color: 'inherit', ...to } })
  const heading = (children: string): Node => ({ componentId: 'muiTypography', props: { children, variant: 'subtitle1', component: 'p' } })
  const column = (nodes: string[]): Node => ({ componentId: 'muiGrid', props: { size: 'xs:12 sm:6 md:3' }, nodes })
  return {
    footer: { componentId: 'section', props: { element: 'footer', ariaLabel: 'Site footer' }, nodes: ['inner'] },
    inner: { componentId: 'muiContainer', props: { maxWidth: 'lg' }, nodes: ['stack'] },
    stack: { componentId: 'muiStack', props: { spacing: '6' }, nodes: ['row', 'bottom'] },
    row: { componentId: 'muiGrid', props: { container: true, spacing: '4' }, sx: { alignItems: 'center' }, nodes: ['c1', 'c2', 'c3', 'c4'] },
    c1: column(['c1flow']),
    c1flow: { componentId: 'muiStack', props: { spacing: '2.5' }, nodes: ['brand', 'blurb'] },
    brand: heading('Tidewater Soap Works'),
    blurb: { componentId: 'muiTypography', props: { children: 'Handmade cold-process soap, body lotion and bath gift sets.', variant: 'body1' } },
    c2: column(['c2flow']),
    c2flow: { componentId: 'muiStack', props: { spacing: '2.5' }, nodes: ['shopHeading', 'pages'] },
    shopHeading: heading('Shop'),
    pages: { componentId: 'muiStack', props: { spacing: '1' }, nodes: ['home', 'shop', 'gifts', 'about', 'contact'] },
    home: link('Home', { screenId: 'c0WVAB83wU' }),
    shop: link('Shop', { screenId: 'X8inwUsEsY' }),
    gifts: link('Gift sets', { screenId: 'VtwzyzqS98' }),
    about: link('About', { screenId: 'PX07zfV2cu' }),
    contact: link('Contact', { screenId: 'urdyjPZAiR' }),
    c3: column(['ourShop']),
    ourShop: heading('Our shop'),
    c4: column(['storeList']),
    storeList: { componentId: 'muiStack', props: { spacing: '1' }, nodes: ['account', 'shipping', 'privacy', 'terms'] },
    account: link('Your account', { href: '/account' }),
    shipping: link('Shipping & returns', { href: '/shipping-returns' }),
    privacy: link('Privacy policy', { href: '/privacy' }),
    terms: link('Terms of sale', { href: '/terms' }),
    bottom: { componentId: 'muiBox', sx: { pt: 3, borderTop: 1, borderColor: 'divider' }, nodes: ['copyright'] },
    copyright: { componentId: 'muiTypography', props: { children: '© Tidewater Soap Works', variant: 'body2', component: 'p' } },
  }
}

describe('a frame with nothing hollow in it (AGL-3735)', () => {
  it('finds the live Tidewater footer hollow: "Our shop" alone in its column, the columns centered', () => {
    const hollows = aiLayoutFrameHollows(tidewaterLiveFooter())
    expect(hollows.footerColumns).toEqual(['c3'])
    expect(hollows.footerCenteredRows).toEqual(['row'])
    expect(hollows.footerHeadings).toEqual([])
  })

  it('puts "Our shop" over the heading-less store links after it, as one column, and top-aligns the row', () => {
    const fixed = aiLayoutWithoutFrameHollows(tidewaterLiveFooter()) as Record<string, Node>
    expect(fixed).not.toBeNull()
    expect(fixed['c4']).toBeUndefined()
    expect(fixed['row'].nodes).toEqual(['c1', 'c2', 'c3'])
    const flow = fixed['c3'].nodes ?? []
    expect(flow).toHaveLength(1)
    expect(fixed[flow[0]].componentId).toBe('muiStack')
    expect(fixed[flow[0]].nodes).toEqual(['ourShop', 'storeList'])
    expect(fixed['storeList'].nodes).toEqual(['account', 'shipping', 'privacy', 'terms'])
    expect(['c1', 'c2', 'c3'].map((id) => fixed[id].props?.['size'])).toEqual(['xs:12 md:4', 'xs:12 md:4', 'xs:12 md:4'])
    expect(fixed['row'].sx?.['alignItems']).toBe('flex-start')
    expect(fixed['row'].sx?.['alignItems']).not.toBe('center')
    expect(hollowOf(fixed)).toEqual(NONE)
    // The original is a copy's source, never changed.
    expect(tidewaterLiveFooter()['row'].nodes).toHaveLength(4)
  })

  it('appends the links into the heading column’s own flow when it already has one', () => {
    const nodes = tidewaterLiveFooter()
    nodes['c3'].nodes = ['c3flow']
    nodes['c3flow'] = { componentId: 'muiStack', props: { spacing: '2.5' }, nodes: ['ourShop'] }
    const fixed = aiLayoutWithoutFrameHollows(nodes) as Record<string, Node>
    expect(fixed['c3'].nodes).toEqual(['c3flow'])
    expect(fixed['c3flow'].nodes).toEqual(['ourShop', 'storeList'])
    expect(fixed['c4']).toBeUndefined()
    expect(hollowOf(fixed)).toEqual(NONE)
  })

  it('takes a heading-only column out when what follows it is not a column of links alone', () => {
    const nodes = tidewaterLiveFooter()
    nodes['c4'].nodes = ['c4text']
    nodes['c4text'] = { componentId: 'muiTypography', props: { children: 'Open Saturdays.', variant: 'body1' } }
    const fixed = aiLayoutWithoutFrameHollows(nodes) as Record<string, Node>
    expect(fixed['c3']).toBeUndefined()
    expect(fixed['ourShop']).toBeUndefined()
    expect(fixed['row'].nodes).toEqual(['c1', 'c2', 'c4'])
    expect(hollowOf(fixed)).toEqual(NONE)
  })

  it('takes an empty footer column out and reflows the rest', () => {
    const nodes = tidewaterLiveFooter()
    nodes['c3'].nodes = []
    delete nodes['ourShop']
    expect(aiLayoutFrameHollows(nodes).footerColumns).toEqual(['c3'])
    const fixed = aiLayoutWithoutFrameHollows(nodes) as Record<string, Node>
    expect(fixed['c3']).toBeUndefined()
    expect(fixed['row'].nodes).toEqual(['c1', 'c2', 'c4'])
    expect(hollowOf(fixed)).toEqual(NONE)
  })

  it('takes out a heading left last in a column with nothing under it, and keeps the column its words hold', () => {
    const nodes = tidewaterLiveFooter()
    nodes['c1flow'].nodes = ['brand', 'blurb', 'stray']
    nodes['stray'] = { componentId: 'muiTypography', props: { children: 'Follow us', variant: 'subtitle1' } }
    const fixed = aiLayoutWithoutFrameHollows(nodes) as Record<string, Node>
    expect(fixed['stray']).toBeUndefined()
    expect(fixed['c1flow'].nodes).toEqual(['brand', 'blurb'])
    expect(hollowOf(fixed)).toEqual(NONE)
  })

  it('leaves a footer with nothing hollow as it is', () => {
    const nodes = aiLayoutWithoutFrameHollows(tidewaterLiveFooter()) as Record<string, Node>
    expect(aiLayoutWithoutFrameHollows(nodes)).toBeNull()
  })

  it('takes a header dropdown that holds no link out', () => {
    const nodes: Record<string, Node> = {
      bar: { componentId: 'muiAppBar', props: { component: 'header' }, nodes: ['nav'] },
      nav: { componentId: 'muiStack', props: { component: 'nav' }, nodes: ['a', 'menu'] },
      a: { componentId: 'muiScreenLink', props: { children: 'Home', screenId: 'home' } },
      menu: { componentId: 'muiNavMenu', props: { label: 'Services' }, nodes: [] },
    }
    expect(aiLayoutFrameHollows(nodes).headerMenus).toEqual(['menu'])
    const fixed = aiLayoutWithoutFrameHollows(nodes) as Record<string, Node>
    expect(fixed['menu']).toBeUndefined()
    expect(fixed['nav'].nodes).toEqual(['a'])
  })

  it('keeps a mega menu whose entries are each a Link Container, its icon and words inside (AGL-4108)', () => {
    const nodes: Record<string, Node> = {
      bar: { componentId: 'muiAppBar', props: { component: 'header' }, nodes: ['nav'] },
      nav: { componentId: 'muiStack', props: { component: 'nav' }, nodes: ['menu'] },
      menu: { componentId: 'muiMegaMenu', props: { label: 'Product' }, nodes: ['entry'] },
      entry: { componentId: 'muiLinkBox', props: { href: '/besigner', ariaLabel: 'Besigner' }, nodes: ['name'] },
      name: { componentId: 'muiTypography', props: { children: 'Besigner', variant: 'subtitle2' } },
    }
    expect(aiLayoutFrameHollows(nodes).headerMenus).toEqual([])
  })

  it('keeps a header dropdown that holds a link, and takes only the empty one out', () => {
    const nodes: Record<string, Node> = {
      bar: { componentId: 'section', props: { element: 'header' }, nodes: ['nav'] },
      nav: { componentId: 'muiStack', props: { component: 'nav' }, nodes: ['full', 'empty'] },
      full: { componentId: 'muiNavMenu', props: { label: 'Shop' }, nodes: ['soap'] },
      soap: { componentId: 'muiScreenLink', props: { children: 'Soap', screenId: 'soap' } },
      empty: { componentId: 'muiMegaMenu', props: { label: 'Gifts' }, nodes: ['col'] },
      col: { componentId: 'muiStack', nodes: [] },
    }
    expect(aiLayoutFrameHollows(nodes).headerMenus).toEqual(['empty'])
    const fixed = aiLayoutWithoutFrameHollows(nodes) as Record<string, Node>
    expect(fixed['nav'].nodes).toEqual(['full'])
    expect(fixed['full'].nodes).toEqual(['soap'])
    expect(hollowOf(fixed)).toEqual(NONE)
  })
})

describe('the Tidewater footer, compiled again (AGL-3735)', () => {
  const PAGES = [
    { id: 'home', label: 'Home', slug: '/' },
    { id: 'shop', label: 'Shop', slug: '/shop' },
    { id: 'gifts', label: 'Gift sets', slug: '/gift-sets' },
    { id: 'about', label: 'About', slug: '/about' },
    { id: 'contact', label: 'Contact', slug: '/contact' },
  ]
  const PRODUCTS: AiLayoutListing = { id: 'listing:products', kind: 'products', name: 'the shop', records: ['Sea salt soap'], placements: [] }
  const targets: AiLayoutTargets = {
    pageId: null,
    pages: PAGES,
    homeIds: ['home'],
    forms: [],
    formPageId: null,
    components: [],
    facts: 'Tidewater Soap Works: handmade cold-process soap, body lotion and bath gift sets.',
    listings: [PRODUCTS],
  }
  const STORE: AiStoreFrameLinks = {
    account: '/account',
    footer: [
      { label: 'Your account', href: '/account' },
      { label: 'Shipping & returns', href: '/shipping-returns' },
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of sale', href: '/terms' },
    ],
  }
  const block = (kind: string, col: number, text: string, items: Array<{ title: string; to: string }> = []) => ({
    kind,
    col,
    text,
    to: '',
    icon: '',
    style: 'none',
    items: items.map((item) => ({ ...item, text: '', icon: '' })),
  })
  const pageList = (col: number) => block('list', col, '', PAGES.map((page) => ({ title: page.label, to: `page:${page.id}` })))
  /** The footer the design gave, as the model answers it: the brand, the site's pages, and "Our shop" over a list of its own. */
  const compile = (ourShop: ReturnType<typeof block>[], storeLinks: AiStoreFrameLinks | null = STORE) => {
    const result = aiLayoutFrameCheck({ siteName: 'Tidewater Soap Works', homeId: 'home', pages: PAGES, targets, extend: () => [], storeLinks })({
      header: { band: 'plain', align: 'start', cols: [], blocks: [] },
      footer: {
        band: 'soft',
        align: 'start',
        cols: [2, 1, 1],
        blocks: [
          block('heading', 0, 'Tidewater Soap Works'),
          block('text', 0, 'Handmade cold-process soap, body lotion and bath gift sets.'),
          block('heading', 1, 'Shop'),
          pageList(1),
          ...ourShop,
        ],
      },
    })
    expect(result.violations).toEqual([])
    const nodes = (result.value?.nodes ?? {}) as unknown as Record<string, Node & { $id?: string }>
    const row = Object.entries(nodes).find(([, node]) => node.componentId === 'muiGrid' && node.props?.['container'])
    if (!row) throw new Error('the footer has a row')
    const textsIn = (id: string): string[] => {
      const node = nodes[id]
      if (!node) return []
      const own = typeof node.props?.['children'] === 'string' ? [node.props['children'] as string] : []
      return [...own, ...(node.nodes ?? []).flatMap(textsIn)]
    }
    const columns = (row[1].nodes ?? []).map((id) => ({ size: nodes[id].props?.['size'], texts: textsIn(id) }))
    return { nodes, row: row[1], columns }
  }

  it('puts the store links under "Our shop" when the list the design gave it was a second list of the site’s pages', () => {
    const { nodes, row, columns } = compile([block('heading', 2, 'Our shop'), pageList(2)])
    expect(columns.map((column) => column.texts)).toEqual([
      ['Tidewater Soap Works', 'Handmade cold-process soap, body lotion and bath gift sets.'],
      ['Shop', 'Home', 'Shop', 'Gift sets', 'About', 'Contact'],
      ['Our shop', 'Your account', 'Shipping & returns', 'Privacy policy', 'Terms of sale'],
    ])
    expect(columns.map((column) => column.size)).toEqual(['xs:12 md:6', 'xs:12 md:3', 'xs:12 md:3'])
    expect(row.sx?.['alignItems']).toBe('flex-start')
    expect(hollowOf(nodes)).toEqual(NONE)
  })

  it('puts them under "Our shop" when none of its own links go anywhere, after what it lost', () => {
    const { nodes, columns } = compile([block('heading', 2, 'Our shop'), block('list', 2, '', [{ title: 'Gift cards', to: 'page:gift-cards' }])])
    expect(columns[2].texts).toEqual(['Our shop', 'Your account', 'Shipping & returns', 'Privacy policy', 'Terms of sale'])
    expect(hollowOf(nodes)).toEqual(NONE)
  })

  it('takes "Our shop" and its column out when the store adds no links, and the two left reflow', () => {
    const { nodes, columns } = compile([block('heading', 2, 'Our shop'), pageList(2)], null)
    expect(columns.map((column) => column.texts[0])).toEqual(['Tidewater Soap Works', 'Shop'])
    expect(columns.map((column) => column.size)).toEqual(['xs:12 md:8', 'xs:12 md:4'])
    expect(Object.values(nodes).some((node) => node.props?.['children'] === 'Our shop')).toBe(false)
    expect(hollowOf(nodes)).toEqual(NONE)
  })

  it('heads the store links "Customer care" in a column of their own where the design wrote no store heading', () => {
    const { nodes, columns } = compile([block('heading', 2, 'Visit'), block('text', 2, 'Open Saturdays at the harbor market.')])
    expect(columns).toHaveLength(4)
    expect(columns[3].texts).toEqual([AI_LAYOUT_STORE_FOOTER_HEADING, 'Your account', 'Shipping & returns', 'Privacy policy', 'Terms of sale'])
    expect(columns.every((column) => column.size === `xs:12 sm:6 md:${column.size?.toString().split('md:')[1]}`)).toBe(true)
    expect(hollowOf(nodes)).toEqual(NONE)
  })

  it('takes the store heading and its column out at publish when every store page it links went unwritten', () => {
    const { nodes } = compile([block('heading', 2, 'Our shop'), pageList(2)])
    const next = aiLayoutWithNavigation(nodes as never, { entries: [], droppedHrefs: STORE.footer.map((link) => link.href) }) as unknown as Record<string, Node>
    expect(next).not.toBeNull()
    expect(Object.values(next).some((node) => node.props?.['children'] === 'Our shop')).toBe(false)
    const row = Object.values(next).find((node) => node.componentId === 'muiGrid' && node.props?.['container'])
    expect(row?.nodes?.map((id) => next[id].props?.['size'])).toEqual(['xs:12 md:8', 'xs:12 md:4'])
    expect(hollowOf(next)).toEqual(NONE)
  })

  it('takes a footer heading out with the last link a menu change takes from under it', () => {
    const nodes = aiLayoutWithoutFrameHollows(tidewaterLiveFooter()) as Record<string, Node>
    // The footer's menu is its longest list: the site's pages. Every one taken out.
    const result = aiLayoutWithMenuChanges(nodes, ['footer'], {
      add: [],
      remove: ['Home', 'Shop', 'Gift sets', 'About', 'Contact'].map((label) => ({ parent: null, label })),
      rename: [],
      relink: [],
      order: [],
    })
    const next = result.nodes as Record<string, Node>
    expect(Object.values(next).some((node) => node.props?.['children'] === 'Shop')).toBe(false)
    expect(hollowOf(next)).toEqual(NONE)
  })
})
