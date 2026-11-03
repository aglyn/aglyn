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
 * A source's menus drawn as it builds them (AGL-4139), over the recorded
 * aglyn.com home page and hand-built menus, stored as the layout step stores
 * them. On 11/3 the imported mega menus opened only on a click, in a 720 px
 * panel of three narrow cells, entries out of the source's order, with no
 * tiles, no featured picture and no dark column. How each opens is the
 * owner's: on hover, as the source and this platform's own site do; a click
 * on a name that is a link follows it; a name with nowhere to go opens its
 * menu on a click; the phone menu opens a group on a tap.
 */

import { aiLayoutSourceFrameBuild } from '../jobs/ai-job-layout-language'
import { aiLayoutChecks } from '../jobs/ai-job-layout-step'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { siteImportReplayFrame } from '../site-import/fixtures/site-import-fidelity-replay'
import { AI_LAYOUT_MENU_HOVER_GRACE_MS, aiLayoutFrameSourceOf, type AiLayoutFrameSource, type AiLayoutFrameSourceGroup } from './ai-layout-frame-source'
import { aiLayoutStoredInteractions } from './ai-layout-store'

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[]; parentId?: string | null; interactions?: Array<Record<string, any>> }
type Nodes = Record<string, Node>

const under = (nodes: Nodes, id: string): string[] => [id, ...(nodes[id]?.nodes ?? []).flatMap((child) => under(nodes, child))]
const words = (nodes: Nodes, id: string) => under(nodes, id).map((at) => String(nodes[at]?.props?.['children'] ?? nodes[at]?.props?.['label'] ?? ''))
const leafOf = (selector: unknown) => /^\[data-aglyn="leaf:(.+)"\]$/.exec(String(selector ?? ''))?.[1]
const row = (nodes: Nodes) => Object.keys(nodes).find((id) => nodes[id]?.props?.['component'] === 'nav' && nodes[id]?.props?.['ariaLabel'] === 'Main') as string
const named = (nodes: Nodes, label: string) => (nodes[row(nodes)]?.nodes ?? []).find((id) => nodes[id]?.props?.['children'] === label || nodes[id]?.props?.['label'] === label || words(nodes, id).includes(label)) as string
const steps = (node: Node | undefined, event: string) => (node?.interactions ?? []).filter((interaction) => interaction['trigger']?.event === event).flatMap((interaction) => interaction['steps'] as Array<Record<string, unknown>>)
const drawer = (nodes: Nodes) => Object.keys(nodes).find((id) => nodes[id]?.componentId === 'muiDrawer') as string

/** A source's frame built and stored as the layout step builds it, with no model. */
function build(source: AiLayoutFrameSource) {
  const built = aiLayoutSourceFrameBuild({
    siteName: 'Fixture Shop',
    homeId: 'home',
    pages: [{ id: 'home', label: 'Home', slug: '/' }] as never,
    targets: { pageId: null, pages: [], homeIds: ['home'], forms: [], formPageId: null, components: [], facts: '' } as never,
    extend: aiLayoutChecks(emptyAiSiteInventory('host-fixture'), null, 'The header of a fixture shop.'),
    source,
  })
  return { nodes: (built.value?.nodes ?? {}) as unknown as Nodes, violations: built.violations }
}

const entries = (prefix: string) => ['One', 'Two', 'Three'].map((label) => ({ label: `${prefix} ${label}`, to: `/${prefix.toLowerCase()}-${label.toLowerCase()}` }))

/*------------------------------------------
 * aglyn.com, replayed
 *-----------------------------------------*/

describe('aglyn.com’s menus, replayed (AGL-4139)', () => {
  const frame = siteImportReplayFrame('home')
  const nodes = frame.tree.nodes as unknown as Nodes

  it('builds with nothing the layout check refuses', () => {
    expect(frame.violations).toEqual([])
  })

  it('Product: its name a link to its page, which a click follows, and its panel shown on hover', () => {
    const name = named(nodes, 'Product')
    expect(nodes[name]).toMatchObject({ componentId: 'muiScreenLink', props: { children: 'Product', screenId: 'draft1' } })
    // No click of its own: a click follows the link, and opens nothing.
    expect(steps(nodes[name], 'elementClick')).toEqual([])
    const shown = steps(nodes[name], 'elementHoverEnter').find((step) => step['type'] === 'showElement')
    expect(shown?.['dismissOn']).toEqual(['escape', 'outsideClick'])
    const panel = leafOf(shown?.['selector']) as string
    // Hidden until shown, as the Besigner's "Start hidden" draws it, and hidden again a moment after the pointer leaves.
    expect(nodes[panel]).toMatchObject({ componentId: 'muiBox', props: { className: 'aglyn-hidden' } })
    expect(steps(nodes[name], 'elementHoverLeave')).toEqual([{ type: 'hideElement', selector: `[data-aglyn="leaf:${panel}"]`, delayMs: AI_LAYOUT_MENU_HOVER_GRACE_MS }])
    expect(steps(nodes[panel], 'elementHoverEnter').some((step) => leafOf(step['selector']) === panel && step['type'] === 'showElement')).toBe(true)
  })

  it('Product’s panel spans the whole bar at the source’s own measure, its three columns in the source’s order', () => {
    const panel = leafOf(steps(nodes[named(nodes, 'Product')], 'elementHoverEnter').find((step) => step['type'] === 'showElement')?.['selector']) as string
    const region = nodes[panel]?.parentId as string
    expect(nodes[region]?.sx).toEqual({ position: 'absolute', top: '100%', left: 0, right: 0, display: { xs: 'none', lg: 'block' } })
    expect(nodes[nodes[region]?.parentId as string]?.componentId).toBe('muiToolbar')
    const measure = nodes[panel]?.nodes?.[0] as string
    expect(nodes[measure]).toMatchObject({ componentId: 'muiContainer', props: { maxWidth: 'xl' } })
    const columns = under(nodes, panel).find((id) => nodes[id]?.props?.['direction'] === 'row' && nodes[id]?.props?.['flexWrap'] === 'wrap') as string
    const [first, second, third] = nodes[columns]?.nodes ?? []
    expect(nodes[columns]?.nodes).toHaveLength(3)
    expect(words(nodes, first as string).filter((text) => ['Besigner', 'CRM', 'Aglyn AI'].includes(text))).toEqual(['Besigner', 'CRM'])
    expect(words(nodes, second as string).find((text) => text === 'Aglyn AI' || text === 'Media')).toBe('Aglyn AI')
    // The featured card: a light box holding the picture from the library, its title, its line and its link.
    expect(nodes[third as string]?.sx).toEqual({ flex: '0 0 300px' })
    const box = under(nodes, third as string).find((id) => nodes[id]?.componentId === 'muiCard') as string
    expect(nodes[box]?.sx).toEqual({ bgcolor: 'action.hover' })
    const image = under(nodes, box).find((id) => nodes[id]?.componentId === 'image') as string
    expect(nodes[image]?.props).toMatchObject({ src: 'media:host-import/mp0', objectFit: 'cover', loading: 'lazy' })
    expect(words(nodes, box).filter(Boolean)).toEqual(['FEATURED', 'Besigner', 'Design on a live canvas with real components and instant publish.', 'See all products →'])
  })

  it('draws each tiled entry’s icon in a flat Card of a theme role, the icon in a role too', () => {
    const panel = leafOf(steps(nodes[named(nodes, 'Product')], 'elementHoverEnter').find((step) => step['type'] === 'showElement')?.['selector']) as string
    const icons = under(nodes, panel).filter((id) => nodes[id]?.componentId === 'icon')
    expect(icons).toHaveLength(13)
    for (const icon of icons) {
      const tile = nodes[nodes[icon]?.parentId as string]
      expect(tile).toMatchObject({ componentId: 'muiCard', props: { variant: 'elevation', elevation: '0' }, sx: { bgcolor: 'action.hover' } })
      expect(['primary.main', 'secondary.main', 'text.secondary']).toContain(nodes[icon]?.props?.['color'])
    }
    // The source's three ink colors stay three: the links' blue, the slate, the magenta.
    expect(new Set(icons.map((icon) => nodes[icon]?.props?.['color']))).toEqual(new Set(['primary.main', 'text.secondary', 'secondary.main']))
  })

  it('Solutions, whose page this wave does not bring in, is the Mega Menu opened on hover by its own id, and on a click', () => {
    const menu = named(nodes, 'Solutions')
    expect(nodes[menu]?.componentId).toBe('muiMegaMenu')
    expect(steps(nodes[menu], 'elementHoverEnter')).toEqual([{ type: 'openMenu', menuNodeId: menu }])
    // Its dark developer column: the site's own dark scheme around a Card holding its heading, words and links.
    const dark = under(nodes, menu).find((id) => nodes[id]?.props?.['colorScheme'] === 'dark') as string
    expect(nodes[dark]?.sx).toEqual({ flex: '0 0 280px' })
    expect(words(nodes, dark).filter(Boolean)).toEqual([
      'FOR DEVELOPERS',
      'Open source & self-hostable',
      'Aglyn is Apache-2.0. Fork it, self-host it with Docker, and extend it with plugins and APIs.',
      'Developers home',
      'Star on GitHub →',
      'See all solutions →',
    ])
  })

  it('in the phone menu each menu opens on a tap, holding every word of its panel', () => {
    const groups = under(nodes, drawer(nodes)).filter((id) => nodes[id]?.componentId === 'muiAccordion')
    expect(groups.map((id) => words(nodes, id)[1])).toEqual(['Product', 'Solutions'])
    const product = words(nodes, groups[0] as string)
    for (const text of ['Besigner', 'Aglyn AI', 'FEATURED', 'Design on a live canvas with real components and instant publish.', 'See all products →']) expect(product).toContain(text)
    const solutions = words(nodes, groups[1] as string)
    for (const text of ['BY TEAM', 'BY USE CASE', 'FOR DEVELOPERS', 'Open source & self-hostable', 'Star on GitHub →']) expect(solutions).toContain(text)
    // Every link in it closes the phone menu.
    const links = under(nodes, groups[0] as string).filter((id) => nodes[id]?.componentId === 'muiScreenLink')
    expect(links.every((id) => steps(nodes[id], 'elementClick').some((step) => step['type'] === 'closeDrawer'))).toBe(true)
  })

  it('the footer opens with the logo, and its developer card is a ruled, filled box', () => {
    const footer = Object.keys(nodes).find((id) => nodes[id]?.props?.['element'] === 'footer') as string
    const firstImage = under(nodes, footer).find((id) => nodes[id]?.componentId === 'image') as string
    const firstWords = under(nodes, footer).find((id) => typeof nodes[id]?.props?.['children'] === 'string') as string
    expect(nodes[firstImage]?.props).toMatchObject({ src: 'media:host-import/m1', alt: 'Aglyn' })
    expect(under(nodes, footer).indexOf(firstImage)).toBeLessThan(under(nodes, footer).indexOf(firstWords))
    const card = under(nodes, footer).find((id) => nodes[id]?.componentId === 'muiCard') as string
    expect(nodes[card]).toMatchObject({ props: { variant: 'outlined' }, sx: { bgcolor: 'action.hover' } })
    expect(words(nodes, card).filter(Boolean)).toEqual(['ARE YOU A DEVELOPER?', 'Open source. Self-hostable. Yours to run.', 'Aglyn for developers →'])
  })

  it('sets no color by value anywhere in the header or the footer', () => {
    const hex = /#[0-9a-f]{3,8}\b|rgba?\(/i
    for (const node of Object.values(nodes)) {
      for (const key of ['color', 'bgcolor', 'backgroundColor', 'borderColor']) expect(String(node.sx?.[key] ?? '')).not.toMatch(hex)
      expect(String(node.props?.['color'] ?? '')).not.toMatch(hex)
    }
  })
})

/*------------------------------------------
 * How each menu opens
 *-----------------------------------------*/

describe('how a source’s menu opens, built (AGL-4139)', () => {
  const frame = (nav: AiLayoutFrameSourceGroup[]): AiLayoutFrameSource => ({ nav, ctas: [], header: 'paper', footer: null })

  it('a dropdown opened on hover under a name that is a link: the name, and its panel under it, hidden until shown', () => {
    const { nodes, violations } = build(frame([{ label: 'Shop', to: '/shop', items: entries('Shop'), hover: true }]))
    expect(violations).toEqual([])
    const item = named(nodes, 'Shop')
    expect(nodes[item]).toMatchObject({ componentId: 'muiBox', sx: { position: 'relative' } })
    const [name, panel] = nodes[item]?.nodes ?? []
    expect(nodes[name as string]).toMatchObject({ componentId: 'muiScreenLink', props: { children: 'Shop', href: '/shop' } })
    expect(nodes[panel as string]).toMatchObject({ props: { className: 'aglyn-hidden' }, sx: { position: 'absolute' } })
    expect(steps(nodes[item], 'elementHoverEnter')).toEqual([{ type: 'showElement', selector: `[data-aglyn="leaf:${panel}"]`, dismissOn: ['escape', 'outsideClick'] }])
    expect(steps(nodes[item], 'elementClick')).toEqual([])
  })

  it('a menu opened on hover whose name goes nowhere: the Dropdown Menu, opened on hover by its own id, and on a click', () => {
    const { nodes, violations } = build(frame([{ label: 'Shop', to: null, items: entries('Shop'), hover: true }]))
    expect(violations).toEqual([])
    const menu = named(nodes, 'Shop')
    expect(nodes[menu]?.componentId).toBe('muiNavMenu')
    expect(steps(nodes[menu], 'elementHoverEnter')).toEqual([{ type: 'openMenu', menuNodeId: menu }])
  })

  it('a menu the source opens on a click stays a menu that opens on a click, its phone menu as before', () => {
    const { nodes } = build(frame([{ label: 'Shop', to: '/shop', items: entries('Shop') }]))
    const menu = named(nodes, 'Shop')
    expect(nodes[menu]?.componentId).toBe('muiNavMenu')
    expect(nodes[menu]?.interactions).toBeUndefined()
    expect(under(nodes, drawer(nodes)).some((id) => nodes[id]?.componentId === 'muiAccordion')).toBe(false)
  })

  it('five dropdowns and five mega menus on hover repeat no inline style the layout check refuses, each hiding the others', () => {
    const featured = { heading: 'FEATURED', lines: ['A title', 'A line of words.'], band: 'soft' as const, width: 300 }
    const nav: AiLayoutFrameSourceGroup[] = [
      ...['Shop', 'Brands', 'Sale', 'Help', 'About'].map((label) => ({ label, to: `/${label.toLowerCase()}`, items: entries(label), hover: true })),
      ...['Men', 'Women', 'Kids', 'Home', 'Gifts'].map((label) => ({
        label,
        to: `/${label.toLowerCase()}`,
        items: entries(label).map((entry, index) => ({ ...entry, text: `${label} line ${index}`, at: index === 2 ? 1 : 0 })),
        columns: [{ heading: null, lines: [], band: 'plain' as const }, featured],
        hover: true,
        measure: 'xl' as const,
      })),
    ]
    const { nodes, violations } = build(frame(nav))
    expect(violations).toEqual([])
    const shop = named(nodes, 'Shop')
    // Pointing at one hides the nine others at once, then shows its own.
    expect(steps(nodes[shop], 'elementHoverEnter').map((step) => step['type'])).toEqual([...Array(9).fill('hideElement'), 'showElement'])
  })
})

/*------------------------------------------
 * The frame as a job carries it, and as it is stored
 *-----------------------------------------*/

describe('a source frame read defensively (AGL-4139)', () => {
  it('keeps roles, bands and library pictures, and nothing else', () => {
    const read = aiLayoutFrameSourceOf({
      nav: [
        {
          label: 'Shop',
          to: '/shop',
          hover: true,
          measure: 'xl',
          items: [
            { label: 'One', to: '/one', at: 1, tile: { fill: 'action.hover', color: 'primary.main' } },
            { label: 'Two', to: '/two', at: 9, tile: { fill: '#e6f5ff', color: 'primary.main' } },
          ],
          columns: [
            { heading: 'A', lines: ['x'], band: 'dark', image: { src: 'media:host-import/mp0', alt: 'A picture', ratio: 1.6 }, width: 300 },
            { heading: null, lines: [], band: 'neon', image: { src: 'https://elsewhere.example/a.png', alt: '' }, width: 9_000 },
          ],
        },
      ],
      ctas: [],
      header: 'paper',
      footer: null,
    })
    const shop = read?.nav[0]
    expect(shop?.items.map((entry) => [entry.at, entry.tile])).toEqual([
      [1, { fill: 'action.hover', color: 'primary.main' }],
      [undefined, undefined],
    ])
    expect(shop?.columns).toEqual([
      { heading: 'A', lines: ['x'], band: 'dark', image: { src: 'media:host-import/mp0', alt: 'A picture', ratio: 1.6 }, width: 300 },
      { heading: null, lines: [], band: 'plain' },
    ])
    expect([shop?.hover, shop?.measure]).toEqual([true, 'xl'])
  })
})

describe('interactions as stored (AGL-4139)', () => {
  it('name the stored ids of the elements they act on, and leave every other value as it is', () => {
    const stored = aiLayoutStoredInteractions(
      [
        { id: 'a', trigger: { event: 'elementHoverEnter' }, steps: [{ type: 'openMenu', menuNodeId: 'll3-megaMenu' }] },
        { id: 'b', trigger: { event: 'elementHoverEnter' }, steps: [{ type: 'showElement', selector: '[data-aglyn="leaf:ll9-menuPanel"]' }, { type: 'closeDrawer' }] },
        { id: 'c', trigger: { event: 'elementClick' }, steps: [{ type: 'scrollTo', selector: '[data-aglyn="leaf:elsewhere"]' }] },
      ],
      { 'll3-megaMenu': 'Stored3', 'll9-menuPanel': 'Stored9' },
    )
    expect(stored).toEqual([
      { id: 'a', trigger: { event: 'elementHoverEnter' }, steps: [{ type: 'openMenu', menuNodeId: 'Stored3' }] },
      { id: 'b', trigger: { event: 'elementHoverEnter' }, steps: [{ type: 'showElement', selector: '[data-aglyn="leaf:Stored9"]' }, { type: 'closeDrawer' }] },
      { id: 'c', trigger: { event: 'elementClick' }, steps: [{ type: 'scrollTo', selector: '[data-aglyn="leaf:elsewhere"]' }] },
    ])
  })
})
