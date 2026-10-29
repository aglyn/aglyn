/**
 * @jest-environment node
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
 * The imported header is the source's menu (AGL-4108), over aglyn.com's home
 * page as AglynBot read it on 10/28 and a Squarespace page's markup.
 *
 * On 10/29 the header was seven page titles cut to 28 characters with no
 * menus, wrapping onto two and three lines from 900 px up, the logo over
 * "Home" at 1280, "Start free" sent to the Forms page, and a footer of seven
 * links and the host's name. Here the source's own header — Product and
 * Solutions as menus, Pricing, Docs and Blog, "Sign in" and "Start free" to
 * the app — is drawn by code with no model, on one line from the width it
 * fits, with every menu inside the phone menu, and its footer's columns,
 * profiles and © line word for word.
 *
 * jsdom lays nothing out, so "no wrap and no overlap at 1280" is held on the
 * tree: every label of the row is on one line, the logo never narrower than
 * itself, and the row shown only from the width it measures to fit.
 */

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { increment: (n: number) => ({ __inc: n }), serverTimestamp: () => '__now__' },
}))

import type { AiJob, AiJobItemLedger } from '../model/ai-jobs.types'
import { aiSiteImportFrameIsRead, aiSiteImportLedger, aiSiteImportWaveOwed, type AiSiteImportPage, type AiSiteImportState } from '../model/ai-site-import'
import { AI_LAYOUT_HEADER_MEASURE, aiLayoutFrameSourceRow, aiLayoutHeaderRowWidth, type AiLayoutFrameSource } from '../layout-language/ai-layout-frame-source'
import { AI_LAYOUT_LOGO_HEIGHT } from '../layout-language/ai-layout-frame'
import type { SiteImportInventory } from '../site-import/site-import-crawl'
import { extractSiteImportPage } from '../site-import/site-import-html'
import { siteImportLookOf } from '../site-import/site-import-layout'
import { siteImportFooterColumns, siteImportNavTree, type SiteImportFrameSource } from '../site-import/site-import-nav'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { aiSiteImportFrameJob, aiSiteImportFrameLinkTo, aiSiteImportFrameSource, aiSiteImportHomeOf } from './ai-job-import-step'
import {
  AI_LAYOUT_SITE_FRAME_INPUT,
  aiLayoutFrameCheck,
  aiLayoutSiteBrandOf,
  aiLayoutSiteFrameOf,
  aiLayoutSourceFrameBuild,
} from './ai-job-layout-language'
import { aiLayoutChecks } from './ai-job-layout-step'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'

const NOW = new Date('2026-10-29T18:00:00.000Z')

/** A recorded home page as the crawl keeps it: its menu, footer and look read as the source builds them. */
function crawledHome(name: SiteLayoutPageName): SiteImportInventory['pages'][number] {
  const { url } = SITE_LAYOUT_PAGES[name]
  const extract = extractSiteImportPage(siteLayoutRecording(name), url, siteLayoutSameSite(name), { structure: true })
  const source = extract as SiteImportFrameSource
  const { structure: _structure, loginForm: _loginForm, ...rest } = extract
  return {
    ...rest,
    url,
    path: '/',
    foundBy: 'home',
    bytes: 0,
    nav: siteImportNavTree(source),
    footer: siteImportFooterColumns(source),
    look: siteImportLookOf(source),
  }
}

function planned(path: string, wave: number, index: number): AiSiteImportPage {
  const slug = path === '/' ? '/' : (path.split('/').filter(Boolean).pop() as string)
  return { slot: `p${index}`, url: `https://aglyn.com${path}`, path, title: slug, group: 'main', wave, draftId: `draft${index}`, slug, words: 300, images: 0 }
}

/** aglyn.com planned: Home, Product and Pricing in the first wave; Besigner, Blog and Solutions in the second. */
function aglynState(): AiSiteImportState {
  const pages = [
    planned('/', 1, 0),
    planned('/product', 1, 1),
    planned('/pricing', 1, 2),
    planned('/product/besigner', 2, 3),
    planned('/blog', 2, 4),
    planned('/solutions', 2, 5),
  ]
  return {
    domain: 'aglyn.com',
    siteName: 'import-check-1029',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: NOW.toISOString(),
    pageLimit: null,
    existingPages: 0,
    found: pages.length,
    stoppedBy: null,
    groups: [],
    pages,
    waves: [
      { index: 1, label: 'Wave 1', group: 'main', slots: ['p0', 'p1', 'p2'], frame: true, status: 'running', startedAt: NOW.toISOString(), finishedAt: null },
      { index: 2, label: 'Wave 2', group: 'main', slots: ['p3', 'p4', 'p5'], frame: false, status: 'waiting', startedAt: null, finishedAt: null },
    ],
    leftOut: [],
    leftOutCount: {},
    frame: { draftId: 'frameDraft' },
    reviewId: null,
    home: aiSiteImportHomeOf({ pages: [crawledHome('home')] }),
    look: {
      at: NOW.toISOString(),
      theme: 'applied',
      colors: ['#00b0ff', '#0077ad'],
      logo: { mediaId: 'm1', src: 'media:host-import/m1', width: 632, height: 192 },
      seo: true,
      seed: 7,
    },
  }
}

const job = (): AiJob =>
  ({
    $id: 'importJob',
    orgId: 'org-test',
    hostId: 'host-import',
    kind: 'import',
    status: 'running',
    brief: 'Bring in aglyn.com',
    inputs: { domain: 'aglyn.com' },
    steps: [],
    outputs: [],
    createdBy: 'uid-owner',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  }) as unknown as AiJob

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[]; interactions?: unknown[] }

/** The frame the layout step draws for an import's first wave: no model, every check a layout is held to. */
function drawnFrame(state = aglynState()) {
  const items: AiJobItemLedger[] = aiSiteImportLedger(state)
  const frameJob = aiSiteImportFrameJob(job(), state, state.waves[0], items)
  const source = aiLayoutSiteFrameOf(frameJob.inputs) as AiLayoutFrameSource
  const home = state.pages[0]
  const built = aiLayoutSourceFrameBuild({
    siteName: String(frameJob.inputs?.['businessName']),
    homeId: home.draftId,
    pages: [{ id: home.draftId, label: 'Home', slug: '/' }],
    targets: { pageId: null, pages: [], homeIds: [home.draftId], forms: [], formPageId: null, components: [], facts: '' } as never,
    extend: aiLayoutChecks(emptyAiSiteInventory('host-import'), frameJob.plan ?? null, [frameJob.brief, ...(state.home?.facts.lines ?? [])].join('\n')),
    brand: aiLayoutSiteBrandOf(frameJob.inputs),
    source,
  })
  const nodes = (built.value?.nodes ?? {}) as unknown as Record<string, Node>
  const all = Object.values(nodes)
  const of = (componentId: string) => all.filter((node) => node.componentId === componentId)
  const children = (node: Node | undefined) => (node?.nodes ?? []).map((id) => nodes[id] as Node)
  const within = (node: Node | undefined): Node[] => children(node).flatMap((child) => [child, ...within(child)])
  const drawer = of('muiDrawer')[0]
  const header = of('muiAppBar')[0]
  const footer = all.find((node) => node.componentId === 'section' && node.props?.['element'] === 'footer')
  return { built, frameJob, source, nodes, all, of, children, within, drawer, header, footer }
}

const label = (node: Node) => String(node.props?.['children'] ?? node.props?.['label'] ?? '')

describe('aglyn.com’s header, as its home page builds it, with no model (AGL-4108)', () => {
  it('passes every check a layout is held to, as the layout step stores it', () => {
    const { built } = drawnFrame()
    expect(built.violations).toEqual([])
    expect(built.value).not.toBeNull()
  })

  it('is the source’s five items in order, Product and Solutions as menus, not the wave’s page titles', () => {
    const { header, within, children } = drawnFrame()
    const nav = within(header).find((node) => node.props?.['component'] === 'nav' && node.props?.['ariaLabel'] === 'Main') as Node
    expect(children(nav).map((node) => [node.componentId, label(node)])).toEqual([
      ['muiMegaMenu', 'Product'],
      ['muiMegaMenu', 'Solutions'],
      ['muiScreenLink', 'Pricing'],
      ['muiScreenLink', 'Docs'],
      ['muiScreenLink', 'Blog'],
    ])
  })

  it('opens Product’s mega menu on its 14 entries, each one link with its icon and the line under it', () => {
    const { of, within } = drawnFrame()
    const product = of('muiMegaMenu').find((node) => node.props?.['label'] === 'Product')
    const entries = within(product).filter((node) => node.componentId === 'muiLinkBox')
    expect(entries).toHaveLength(13)
    const icons = within(product).filter((node) => node.componentId === 'icon')
    expect(icons).toHaveLength(13)
    expect(icons[0].props?.['iconPath']).toMatch(/^M3 11H11V3H3/)
    expect(within(product).filter((node) => node.componentId === 'muiTypography').map(label)).toEqual(expect.arrayContaining(['Besigner', 'Visual builder on a live canvas', 'FEATURED']))
    // The 14th, "See all products →", is the menu's link to /product.
    const seeAll = within(product).find((node) => label(node) === 'See all products →')
    expect(seeAll?.props?.['screenId']).toBe('draft1')
  })

  it('sets Solutions’ 16 entries in the source’s three headed columns, side by side from a tablet up', () => {
    const { of, within } = drawnFrame()
    const solutions = of('muiMegaMenu').find((node) => node.props?.['label'] === 'Solutions')
    const headings = within(solutions).filter((node) => node.componentId === 'muiTypography' && node.props?.['variant'] === 'overline').map(label)
    expect(headings).toEqual(['BY TEAM', 'BY USE CASE', 'FOR DEVELOPERS'])
    // By team, each with its icon and the line under it; by use case and for developers, each a link.
    const described = within(solutions).filter((node) => node.componentId === 'muiLinkBox').map((node) => node.props?.['ariaLabel'])
    expect(described).toEqual(['Agencies', 'Startups', 'Creators', 'Developers', 'Enterprise', 'Small business'])
    const links = within(solutions).filter((node) => node.componentId === 'muiScreenLink').map(label)
    expect(links).toHaveLength(10)
    expect(links.slice(-1)).toEqual(['See all solutions →'])
    expect(within(solutions).filter((node) => node.componentId === 'muiGrid' && node.props?.['size'] === 'xs:12 sm:4')).toHaveLength(3)
  })

  it('opens a menu on the page its own name goes to, where none of its entries does', () => {
    const state = aglynState()
    const home = state.home as NonNullable<AiSiteImportState['home']>
    const nav = home.nav as NonNullable<typeof home.nav>
    const trimmed = { ...nav, items: nav.items.map((item) => (item.label === 'Solutions' ? { ...item, items: item.items.filter((entry) => !/\/solutions$/.test(entry.href)) } : item)) }
    const { of, within } = drawnFrame({ ...state, home: { ...home, nav: trimmed } })
    const solutions = of('muiMegaMenu').find((node) => node.props?.['label'] === 'Solutions')
    expect(within(solutions).filter((node) => node.componentId === 'muiScreenLink').map((node) => [label(node), node.props?.['href']])[0]).toEqual(['Solutions', '/solutions'])
  })

  it('links the pages of the header’s wave by id, a page still to come by its new address, and leaves for anywhere else as the source does', () => {
    const { of } = drawnFrame()
    const link = (text: string) => of('muiScreenLink').find((node) => label(node) === text)?.props
    expect(link('Pricing')).toMatchObject({ screenId: 'draft2' })
    expect(link('Blog')).toMatchObject({ href: '/blog' })
    expect(link('Docs')).toMatchObject({ href: 'https://docs.aglyn.com/' })
    const besigner = of('muiLinkBox').find((node) => node.props?.['ariaLabel'] === 'Besigner')
    expect(besigner?.props).toMatchObject({ href: '/besigner' })
  })

  it('carries "Sign in" and "Start free" to the app, drawn as the source draws them, never to a page of the site', () => {
    const { header, within, drawer } = drawnFrame()
    const buttons = within(header).filter((node) => node.componentId === 'muiButton' && !within(drawer).includes(node))
    expect(buttons.map((node) => [label(node), node.props?.['variant'], node.props?.['href'], node.props?.['screenId']])).toEqual([
      ['Sign in', 'text', 'https://app.aglyn.com/signin', undefined],
      ['Start free', 'contained', 'https://app.aglyn.com/signup', undefined],
    ])
  })

  it('holds every label of the row to one line, the logo to its own width, and shows the row only from the width it fits (no wrap, no overlap at 1280)', () => {
    const { header, within, of, source, children, all, nodes } = drawnFrame()
    const nav = within(header).find((node) => node.props?.['ariaLabel'] === 'Main') as Node
    expect(nav.sx).toMatchObject({ display: { xs: 'none', lg: 'flex' }, whiteSpace: 'nowrap', flexShrink: 0 })
    // Every item of the row inherits its one line, and none gives way to the next.
    for (const menu of [...of('muiMegaMenu'), ...of('muiNavMenu')]) expect(menu.sx).toMatchObject({ flexShrink: 0 })
    for (const item of within(nav)) expect(item.sx?.['whiteSpace'] === undefined || item.sx['whiteSpace'] === 'normal' || item.sx['whiteSpace'] === 'nowrap').toBe(true)
    const panels = within(nav).filter((node) => node.sx?.['whiteSpace'] === 'normal')
    expect(panels).toHaveLength(2)
    const ctas = within(header).find((node) => node.componentId === 'muiStack' && children(node).some((child) => child.componentId === 'muiButton'))
    expect(ctas?.sx).toMatchObject({ whiteSpace: 'nowrap', flexShrink: 0, ml: 'auto' })
    const logo = of('image')[0]
    expect(logo.props).toMatchObject({ alt: 'Aglyn', screenId: 'draft0', height: AI_LAYOUT_LOGO_HEIGHT })
    const brand = all.find((node) => node.nodes?.some((id) => nodes[id]?.componentId === 'image'))
    expect(brand?.sx).toMatchObject({ flexShrink: 0 })
    expect(brand?.sx?.['minWidth']).toBeUndefined()
    // At 1280 the row's room is the Container's: the brand, five items and two buttons fit it.
    const width = aiLayoutHeaderRowWidth(aiLayoutFrameSourceRow(source, Math.round((632 / 192) * 40)))
    expect(width).toBeLessThanOrEqual(AI_LAYOUT_HEADER_MEASURE.room.lg)
    // At 900 they would fill it to the edge, so below 1200 the row is the phone menu's button.
    expect(width).toBeGreaterThan(AI_LAYOUT_HEADER_MEASURE.room.md * AI_LAYOUT_HEADER_MEASURE.fill)
  })

  it('shows the menu button below that width, its drawer holding every menu as a heading over its entries, then the links and both buttons (390)', () => {
    const { of, within, drawer, children } = drawnFrame()
    expect(of('muiDrawerToggle')[0].sx).toMatchObject({ display: { xs: 'inline-flex', lg: 'none' } })
    const menu = children(drawer)[0]
    const parts = children(menu)
    const groups = parts.filter((node) => (node.nodes ?? []).length && children(node)[0]?.props?.['variant'] !== undefined)
    expect(parts.map((node) => children(node).map(label)[0])).toEqual(['Product', 'Solutions', 'Pricing', 'Sign in'])
    const product = children(parts[0])
    // Its heading the menu's name; "See all products →" its link to /product.
    expect(product.filter((node) => node.componentId === 'muiScreenLink').map(label)).toHaveLength(14)
    expect(product[0].componentId).toBe('muiTypography')
    const solutions = children(parts[1])
    expect(solutions.filter((node) => node.componentId === 'muiTypography').map(label)).toEqual(['Solutions', 'BY TEAM', 'BY USE CASE', 'FOR DEVELOPERS'])
    expect(solutions.filter((node) => node.componentId === 'muiScreenLink')).toHaveLength(16)
    expect(children(parts[2]).map(label)).toEqual(['Pricing', 'Docs', 'Blog'])
    expect(children(parts[3]).map((node) => [label(node), node.props?.['fullWidth'], node.props?.['href']])).toEqual([
      ['Sign in', true, 'https://app.aglyn.com/signin'],
      ['Start free', true, 'https://app.aglyn.com/signup'],
    ])
    // Every link followed from it closes it.
    expect(within(drawer).filter((node) => node.componentId === 'muiScreenLink').every((node) => (node.interactions ?? []).length === 1)).toBe(true)
    expect(groups.length).toBeGreaterThan(0)
  })

  it('sits on the page’s own ground, as the source’s grey bar does', () => {
    const { header } = drawnFrame()
    expect(header?.sx).toMatchObject({ bgcolor: 'background.default' })
  })
})

describe('aglyn.com’s footer, as its home page builds it (AGL-4108)', () => {
  it('keeps its six columns under their headings, with every link', () => {
    const { footer, within } = drawnFrame()
    const headings = within(footer).filter((node) => node.componentId === 'muiTypography' && node.props?.['variant'] === 'subtitle2').map(label)
    expect(headings).toEqual(['Product', 'Solutions', 'Use cases', 'Resources', 'Company', 'Documentation'])
    const columns = within(footer).filter((node) => node.componentId === 'muiGrid' && node.props?.['size'] === 'xs:12 sm:4 md:2')
    expect(columns).toHaveLength(6)
    expect(within(footer).filter((node) => node.componentId === 'muiScreenLink' && node.props?.['children'] === 'About')).toHaveLength(1)
    expect(within(columns[0]).filter((node) => node.componentId === 'muiScreenLink')).toHaveLength(13)
  })

  it('keeps its profiles, its words, its address, phone and email, and its © line word for word', () => {
    const { footer, within } = drawnFrame()
    const social = within(footer).find((node) => node.componentId === 'socialLinks')
    expect(Object.keys(social?.props ?? {}).sort()).toEqual(['facebook', 'github', 'instagram', 'linkedin', 'twitter', 'youtube'])
    // TikTok, which the Social Links element has no icon for, is linked by its name beside them.
    const named = within(footer).filter((node) => node.componentId === 'muiScreenLink' && /tiktok\.com/.test(String(node.props?.['href'])))
    expect(named).toHaveLength(1)
    const words = within(footer).map(label)
    expect(words).toContain('© 2026 Aglyn LLC. All rights reserved. Aglyn™ and Besigner™ are trademarks of Aglyn LLC.')
    expect(words).toContain('The visual builder with a real platform underneath. Design, ship, and run every site from one place.')
    expect(words).toContain('5900 Balcones Drive STE 100, Austin, TX 78731, US')
    const phone = within(footer).find((node) => label(node) === '+1-512-555-0142')
    expect(phone?.props?.['href']).toBe('tel:+15125550142')
    expect(words).not.toContain('© import-check-1029')
    expect(words.join(' ')).not.toContain('import-check-1029')
  })
})

describe('the frame job for an import whose menu was read (AGL-4108)', () => {
  it('hands the layout step the source’s frame and a logo named as the source names it', () => {
    const state = aglynState()
    const frameJob = aiSiteImportFrameJob(job(), state, state.waves[0], aiSiteImportLedger(state))
    expect(frameJob.inputs?.[AI_LAYOUT_SITE_FRAME_INPUT]).toBeTruthy()
    expect(aiLayoutSiteBrandOf(frameJob.inputs)).toEqual({ logo: { src: 'media:host-import/m1' }, name: false, alt: 'Aglyn', aspect: 3.292 })
  })

  it('quotes the header and footer at nothing, since no model is asked', () => {
    const state = aglynState()
    expect(aiSiteImportFrameIsRead(state)).toBe(true)
    expect(aiSiteImportWaveOwed(state, state.waves[0]).frame).toBe(false)
    expect(aiSiteImportWaveOwed({ ...state, home: { ...(state.home as NonNullable<AiSiteImportState['home']>), nav: null } }, state.waves[0]).frame).toBe(true)
  })

  it('hands no frame for a source whose menu could not be read, which the frame model then designs', () => {
    const state = aglynState()
    const unread = { ...state, home: { ...(state.home as NonNullable<AiSiteImportState['home']>), nav: null } }
    expect(aiSiteImportFrameSource(unread, unread.waves[0])).toBeNull()
  })

  it('resolves a link: the home page and this wave’s by id, a later wave’s by its address, off-site and mail as they are', () => {
    const to = aiSiteImportFrameLinkTo(aglynState(), 1)
    expect(to('https://aglyn.com/')).toBe('page:draft0')
    expect(to('https://www.aglyn.com/pricing/')).toBe('page:draft2')
    expect(to('https://aglyn.com/product/besigner')).toBe('/besigner')
    expect(to('https://aglyn.com/careers')).toBe('https://aglyn.com/careers')
    expect(to('http://app.aglyn.com/signup')).toBe('https://app.aglyn.com/signup')
    expect(to('mailto:support@example.com')).toBe('mailto:support@example.com')
    expect(to('tel:+1 (512) 555-0142')).toBe('tel:+15125550142')
    expect(to('javascript:alert(1)')).toBeNull()
  })
})

describe('a Squarespace header and footer (AGL-4108)', () => {
  function potteryState(): AiSiteImportState {
    const base = aglynState()
    const pages = [planned('/', 1, 0), planned('/classes', 1, 1), planned('/gallery', 1, 2)].map((page) => ({ ...page, url: page.url.replace('https://aglyn.com', 'https://www.tidewater-pottery.example') }))
    return {
      ...base,
      domain: 'tidewater-pottery.example',
      siteName: 'Tidewater Pottery Studio',
      pages,
      waves: [{ ...base.waves[0], slots: pages.map((page) => page.slot) }],
      home: aiSiteImportHomeOf({ pages: [crawledHome('pottery')] }),
      look: { ...(base.look as NonNullable<AiSiteImportState['look']>), logo: null },
    }
  }

  it('draws its folder as a dropdown, its call to action outlined, its name as the brand, and fits a 900-pixel screen', () => {
    const { built, of, header, within } = drawnFrame(potteryState())
    expect(built.violations).toEqual([])
    const classes = of('muiNavMenu')[0]
    expect(classes.props?.['label']).toBe('Classes')
    expect(within(classes).filter((node) => node.componentId === 'muiScreenLink').map(label)).toEqual(['Wheel throwing', 'Hand building', 'Kids clay club'])
    const book = within(header).find((node) => node.componentId === 'muiButton')
    expect(book?.props).toMatchObject({ children: 'Book a class', variant: 'outlined', href: 'https://www.tidewater-pottery.example/book' })
    const nav = within(header).find((node) => node.props?.['ariaLabel'] === 'Main')
    expect(nav?.sx).toMatchObject({ display: { xs: 'none', md: 'flex' } })
  })

  it('keeps its column, its address, phone and email, its profiles and its © line', () => {
    const { footer, within } = drawnFrame(potteryState())
    const words = within(footer).map(label)
    expect(words).toEqual(expect.arrayContaining(['Studio', 'Classes', 'Membership', 'Gift cards', '14 Wharf Street, Port Fixture, ME 04000', '(207) 555-0187', 'studio@example.com', '© 2026 Tidewater Pottery Studio']))
    expect(within(footer).find((node) => node.componentId === 'socialLinks')?.props).toEqual({
      instagram: expect.stringMatching(/^https:\/\/(?:www\.)?instagram\.com\//),
      facebook: expect.stringMatching(/^https:\/\/(?:www\.)?facebook\.com\//),
    })
  })
})

describe('a header of the site’s pages, where no source menu was read (AGL-4108)', () => {
  /** The 10/29 header's seven page titles, cut to 28 characters as the frame cuts a label. */
  const TITLES = ['Home', 'All-in-One Website Platform', 'Drag and Drop Website', 'Manage Multiple Websites', 'Ecommerce Website Builder', 'POS System Built Into Your', 'Website Form Builder']

  it('holds every title to one line, the logo to its own width, and shows the row only from 1200 px, where the 10/29 header wrapped from 900 and lay its logo over Home', () => {
    const pages = TITLES.map((label, at) => ({ id: `page${at}`, label, slug: at ? `p${at}` : '/' }))
    const check = aiLayoutFrameCheck({
      siteName: 'import-check-1029',
      homeId: 'page0',
      pages,
      targets: { pageId: null, pages: [], homeIds: ['page0'], forms: [], formPageId: null, components: [], facts: '' } as never,
      extend: () => [],
      brand: { logo: { src: 'media:host-import/m1' }, name: false, alt: 'Aglyn', aspect: 632 / 192 },
    })
    const built = check({ header: { band: 'plain', align: 'start', cols: [], blocks: [] }, footer: null } as never)
    expect(built.violations).toEqual([])
    const nodes = Object.values(built.value?.nodes ?? {}) as unknown as Node[]
    const nav = nodes.find((node) => node.props?.['ariaLabel'] === 'Main')
    expect(nav?.sx).toMatchObject({ display: { xs: 'none', lg: 'flex' }, whiteSpace: 'nowrap' })
    expect(nodes.find((node) => node.componentId === 'muiDrawerToggle')?.sx).toMatchObject({ display: { xs: 'inline-flex', lg: 'none' } })
    const brand = nodes.find((node) => node.nodes?.some((id) => (built.value?.nodes as unknown as Record<string, Node>)[id]?.componentId === 'image'))
    expect(brand?.sx).toMatchObject({ flexShrink: 0 })
    expect(nodes.find((node) => node.componentId === 'image')?.props).toMatchObject({ alt: 'Aglyn' })
  })

  it('keeps a short menu on a 900-pixel screen, as before', () => {
    const pages = ['Home', 'About', 'Contact'].map((label, at) => ({ id: `page${at}`, label, slug: at ? label.toLowerCase() : '/' }))
    const check = aiLayoutFrameCheck({
      siteName: 'Rosie’s Bakery',
      homeId: 'page0',
      pages,
      targets: { pageId: null, pages: [], homeIds: ['page0'], forms: [], formPageId: null, components: [], facts: '' } as never,
      extend: () => [],
    })
    const built = check({ header: { band: 'plain', align: 'start', cols: [], blocks: [] }, footer: null } as never)
    const nav = (Object.values(built.value?.nodes ?? {}) as unknown as Node[]).find((node) => node.props?.['ariaLabel'] === 'Main')
    expect(nav?.sx).toMatchObject({ display: { xs: 'none', md: 'flex' }, whiteSpace: 'nowrap' })
  })
})
