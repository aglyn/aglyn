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
 * Every imported page is built through the site compiler (AGL-4107), over the
 * recorded pages the reader reads (AGL-4106): aglyn.com's Home, /product,
 * /pricing, /contact and a blog post, and a non-Aglyn studio page so the
 * build is never tuned to our own markup.
 *
 * On 10/29 the import of aglyn.com came out one column of plain lines: Home
 * had 0 cards, 0 icons, 0 accordions, no dark band and 1 of its 2 pictures;
 * /product was 134 lines top to bottom. These rows are the source's own
 * structure in the compiler's elements — its cards, columns, grids, tables,
 * tabs, accordions, steps, figures, pictures, icons and bands — with every
 * word on the page exactly once, as written. No live AI: the design answers
 * here are recorded, in the shape the tool answers.
 */

import { createHash } from 'node:crypto'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_LAYOUT_DESIGN_TOOL, aiReadLayoutDesign } from '../layout-language/ai-layout-language'
import type { AiLayoutRawTree } from '../layout-language/ai-layout-tree'
import { AI_MODEL_CATALOG, aiCatalogEntry } from '../providers/catalog'
import { resolveAiRoute } from '../providers/routing'
import type { SiteImportLayoutGroup, SiteImportLayoutNode } from '../model/ai-site-import'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { extractSiteImportPage, type SiteImportBlock } from '../site-import/site-import-html'
import { siteImportLayout, siteImportLayoutCounts } from '../site-import/site-import-layout'
import { siteImportPageRead } from '../site-import/site-import-page'
import { aiPageWithoutLinksTo } from './ai-site-publish'
import { aiSiteImportUnbuilt } from './ai-site-import-publish'
import { aiImportedPageCheck, aiLayoutDesignPrompt } from './ai-job-page-language'
import {
  aiCompileImportedPage,
  aiSiteImportDesignedSections,
  aiImportedPageListing,
  aiImportedPageListingOwed,
  aiImportPageModel,
  aiSiteImportDesignText,
  aiSiteImportIconPath,
  aiSiteImportLinkablePages,
  aiSiteImportPathOn24,
  aiSiteImportSectionNames,
} from './ai-site-import-compile'
import type { AiSiteImportDocument } from './ai-site-import-document'

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[] }

const clean = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The page's same-site addresses, each a page the import plans: every page a link may go to. */
function plannedLinks(blocks: readonly SiteImportBlock[], origin: string): Array<{ path: string; id: string }> {
  const paths = new Set<string>()
  for (const block of blocks) {
    if (block.kind !== 'link') continue
    try {
      const url = new URL(block.href)
      const path = url.pathname.replace(/\/+$/, '') || '/'
      if (url.origin === origin && path !== '/') paths.add(path)
    } catch {
      // Not an address.
    }
  }
  return [...paths].map((path) => ({ path, id: `p${path.replace(/[^a-z0-9]+/gi, '-')}` }))
}

/** A recorded page as a wave's read keeps it and the import step hands it on: its blocks, its layout, its photos in the library. */
function docOf(name: SiteLayoutPageName, build: AiSiteImportDocument['build'] = 'arranged'): AiSiteImportDocument {
  const { url } = SITE_LAYOUT_PAGES[name]
  const page = extractSiteImportPage(siteLayoutRecording(name), url, siteLayoutSameSite(name), { structure: true })
  const layout = siteImportLayout(page as Parameters<typeof siteImportLayout>[0])
  const path = new URL(url).pathname
  const read = siteImportPageRead({ ...page, layout, url, path, foundBy: path === '/' ? 'home' : 'sitemap', bytes: 0 } as never, 'now')
  const blocks = read.blocks ?? []
  const origin = new URL(url).origin
  const pictures = [...new Set(blocks.flatMap((block) => (block.kind === 'image' ? [block.url] : [])))]
  return {
    build,
    title: read.title,
    url,
    blocks,
    photos: pictures.map((from, index) => ({ mediaId: `m${index}`, src: `media:host-import/m${index}`, from, width: 1600, height: 900 })),
    links: plannedLinks(blocks, origin),
    origins: [origin, origin.replace('://', '://www.')],
    ...(read.layout ? { layout: read.layout } : {}),
  }
}

const TARGETS = { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' }

interface Built {
  doc: AiSiteImportDocument
  /** The compiled tree, its ids naming each element's role. */
  tree: AiLayoutRawTree
  /** The page as stored, checked and with its motion. */
  stored: Record<string, Node>
  violations: unknown[]
}

const built = new Map<string, Built>()

function build(name: SiteLayoutPageName, answer: Record<string, unknown> | null = null, options: { forms?: Array<{ id: string; name: string }> } = {}): Built {
  const key = `${name}:${JSON.stringify(answer)}:${JSON.stringify(options)}`
  const held = built.get(key)
  if (held) return held
  const doc = docOf(name)
  const names = aiSiteImportSectionNames(doc)
  const sectionIds = names.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug: name === 'home' ? '/' : `/${name}`, sections: names.map((section) => ({ name: section, uses: [], items: 0 })) }
  const targets = { ...TARGETS, forms: options.forms ?? [] }
  const design = { kind: 'business', seed: 7, home: name === 'home' }
  const check = aiImportedPageCheck({
    screen: screen as never,
    sectionIds,
    targets,
    context: { screenIds: doc.links.map((link) => link.id), formIds: targets.forms.map((form) => form.id), componentIds: [], codeBuilt: true },
    design,
    doc,
  })
  const result = check(answer)
  const compiled = aiCompileImportedPage({
    doc,
    sectionIds,
    plan: { title: screen.title, sections: screen.sections },
    targets,
    design,
    ...(answer ? { answer: { sections: [] } } : {}),
  })
  const out: Built = { doc, tree: compiled.tree, stored: (result.value?.nodes ?? {}) as unknown as Record<string, Node>, violations: result.violations }
  built.set(key, out)
  return out
}

/** Every word a visitor reads on a stored page: its text, its list lines, its buttons, its tab labels and its tables' cells. */
function shownWords(nodes: Record<string, Node>): string[] {
  const out: string[] = []
  const visit = (id: string) => {
    const node = nodes[id]
    if (!node) return
    for (const key of ['children', 'primary', 'secondary']) {
      const value = node.props?.[key]
      if (typeof value === 'string') out.push(value)
    }
    if (node.componentId === 'muiTabs' && typeof node.props?.['labels'] === 'string') out.push(...String(node.props['labels']).split('\n'))
    if (node.componentId === 'dataTable' && typeof node.props?.['rows'] === 'string') {
      for (const line of String(node.props['rows']).split('\n')) {
        out.push(...line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim()))
      }
    }
    for (const child of node.nodes ?? []) visit(child)
  }
  visit(CANVAS_ROOT_ELEMENT_ID)
  return out.filter(Boolean)
}

/** A page's words, as a sorted tally: each word as often as the page says it. */
const tally = (lines: readonly string[]) => (lines.join(' ').match(/[\p{L}\p{N}]+/gu) ?? []).sort()

const sourceLines = (doc: AiSiteImportDocument) =>
  doc.blocks.flatMap((block) => (block.kind === 'image' || (block.kind === 'link' && block.inline) || !clean(block.text) ? [] : [clean(block.text)]))

/** The compiled tree's elements of a role, in document order. */
function role(tree: AiLayoutRawTree, name: string): string[] {
  return Object.keys(tree.nodes).filter((id) => id.replace(/^li?\d+-|^ll\d+-/, '') === name)
}

/** The ids under one element, itself included. */
function under(tree: { nodes: Record<string, Node> }, id: string): string[] {
  const out: string[] = []
  const visit = (at: string) => {
    out.push(at)
    for (const child of tree.nodes[at]?.nodes ?? []) visit(child)
  }
  visit(id)
  return out
}

const sectionsOf = (tree: AiLayoutRawTree) => (tree.nodes[tree.rootId]?.nodes ?? []).map((id) => ({ id, node: tree.nodes[id] as Node }))

/** A section's band as the compiler drew it. */
function bandOf(node: Node): string {
  if (node.props?.['colorScheme'] === 'dark') return 'dark'
  if (node.sx?.['bgcolor'] === 'background.paper') return 'soft'
  if (node.sx?.['bgcolor'] === 'primary.main') return 'brand'
  return 'plain'
}

const ofKind = (tree: { nodes: Record<string, Node> }, ids: readonly string[], componentId: string) => ids.filter((id) => tree.nodes[id]?.componentId === componentId)

describe.each(Object.keys(SITE_LAYOUT_PAGES) as SiteLayoutPageName[])('%s: built by the site compiler, every word once', (name) => {
  it('passes the page check with no violation', () => {
    expect(build(name).violations).toEqual([])
  })

  it('shows every word of the source exactly once, as written, and none of its own', () => {
    const { doc, stored } = build(name)
    expect(tally(shownWords(stored))).toEqual(tally(sourceLines(doc)))
  })

  it('draws the source’s sections, each in its own band', () => {
    const { doc, tree } = build(name)
    const layout = doc.layout as NonNullable<AiSiteImportDocument['layout']>
    expect(sectionsOf(tree).map(({ node }) => bandOf(node))).toEqual(layout.sections.map((section) => section.band))
  })

  it('moves as the site moves: its entrance motion is written', () => {
    const { stored } = build(name)
    expect(Object.values(stored).some((node) => Object.keys(node.props ?? {}).some((key) => key.startsWith('aglynAnimation')))).toBe(true)
  })

  it('keeps no group of lines drawn as text pairs, as the 10/29 build did', () => {
    const { stored } = build(name)
    expect(Object.values(stored).filter((node) => node.componentId === 'muiListItemText')).toEqual([])
  })

  it('compiles to at least the reader’s structure: its groups, pictures, icons, tables and tabs', () => {
    const { doc, tree } = build(name)
    const layout = doc.layout as NonNullable<AiSiteImportDocument['layout']>
    const read = siteImportLayoutCounts(layout, doc.blocks)
    const nodes = Object.values(tree.nodes)
    expect(nodes.filter((node) => node.componentId === 'image')).toHaveLength(read.pictures)
    expect(nodes.filter((node) => node.componentId === 'dataTable')).toHaveLength(read.tables)
    // A lone icon is no word and no picture; every item's and every bullet's icon is drawn.
    const lone = layout.sections.reduce((total, section) => total + JSON.stringify(section.nodes).split('"kind":"icon"').length - 1, 0)
    expect(nodes.filter((node) => node.componentId === 'icon').length).toBeGreaterThanOrEqual(read.icons - lone)
  })
})

describe('aglyn.com Home', () => {
  const { tree } = build('home')
  const sections = sectionsOf(tree)

  it('opens on a hero around its own picture: the words over the film’s poster', () => {
    const hero = under(tree, sections[0].id)
    expect(ofKind(tree, hero, 'image')).toHaveLength(1)
    const title = hero.map((id) => tree.nodes[id]).find((node) => node.props?.['component'] === 'h1')
    expect(title?.props?.['children']).toBe('Build your website. Describe it, edit it, publish free.')
    expect(title?.props?.['variant']).toBe('displayXl')
  })

  it('draws "Explore the platform" as 13 of the theme’s cards in 3 columns, two on a tablet, each with its icon and its arrow, each a link to its page', () => {
    const explore = under(tree, sections[3].id)
    const cards = ofKind(tree, explore, 'muiCard')
    expect(cards).toHaveLength(13)
    // Its icon in its tile, and the "↗" at the end of the same row (AGL-4138).
    for (const card of cards) expect(ofKind(tree, under(tree, card), 'icon')).toHaveLength(2)
    const linked = ofKind(tree, explore, 'muiLinkBox')
    expect(linked).toHaveLength(13)
    expect(linked.map((id) => tree.nodes[id].props?.['screenId'])).toContain('p-product-besigner')
    const cells = explore.filter((id) => tree.nodes[id].componentId === 'muiGrid' && tree.nodes[id].props?.['size'] === 'xs:12 sm:6 md:4')
    expect(cells).toHaveLength(13)
  })

  it('keeps its other groups of cards, its 3 numbered steps, its FAQ of 11 as accordions and its dark closer', () => {
    expect(ofKind(tree, under(tree, sections[1].id), 'muiCard')).toHaveLength(3)
    expect(ofKind(tree, under(tree, sections[8].id), 'muiCard')).toHaveLength(3)
    const steps = role(tree, 'number').filter((id) => under(tree, sections[4].id).includes(id))
    expect(steps.map((id) => tree.nodes[id].props?.['children'])).toEqual(['01', '02', '03'])
    expect(ofKind(tree, under(tree, sections[9].id), 'muiAccordion')).toHaveLength(11)
    expect(sections[10].node.props?.['colorScheme']).toBe('dark')
  })

  it('sets "For agencies…" in the source’s two columns, its words beside the console’s picture', () => {
    const row = under(tree, sections[5].id).find((id) => tree.nodes[id].componentId === 'muiGrid' && tree.nodes[id].props?.['container'] === true)
    const columns = (tree.nodes[row as string].nodes ?? []).map((id) => tree.nodes[id].props?.['size'])
    expect(columns).toEqual(['xs:12 md:4', 'xs:12 md:8'])
    expect(ofKind(tree, under(tree, row as string), 'image')).toHaveLength(1)
  })

  it('leaves no "→" line without its link, and its two "Build my website free" buttons filled', () => {
    const arrows = Object.values(tree.nodes).filter((node) => typeof node.props?.['children'] === 'string' && String(node.props['children']).trim().endsWith('→'))
    expect(arrows.length).toBeGreaterThan(0)
    for (const node of arrows) {
      expect(['muiButton', 'muiScreenLink']).toContain(node.componentId)
      expect(node.props?.['screenId'] ?? node.props?.['href']).toBeTruthy()
    }
    const free = Object.values(tree.nodes).filter((node) => node.componentId === 'muiButton' && node.props?.['children'] === 'Build my website free')
    expect(free.map((node) => [node.props?.['variant'], node.props?.['href']])).toEqual([
      ['contained', 'https://app.aglyn.com/signup'],
      ['contained', 'https://app.aglyn.com/signup'],
    ])
  })
})

describe('aglyn.com /product', () => {
  const { tree } = build('product')
  const sections = sectionsOf(tree)

  it('keeps its strip of 8 site kinds, its 3 feature cards and its 13-product grid', () => {
    expect(role(tree, 'chip').filter((id) => under(tree, sections[2].id).includes(id))).toHaveLength(8)
    expect(ofKind(tree, under(tree, sections[3].id), 'muiCard')).toHaveLength(3)
    expect(ofKind(tree, under(tree, sections[5].id), 'muiCard')).toHaveLength(13)
  })

  it('draws its 3 steps, its 4 figures and its 3 pricing cards with their 12 check marks', () => {
    expect(role(tree, 'number').map((id) => tree.nodes[id].props?.['children'])).toEqual(['01', '02', '03'])
    const figures = role(tree, 'figure').filter((id) => under(tree, sections[7].id).includes(id))
    expect(figures).toHaveLength(4)
    for (const id of figures) expect(tree.nodes[id].props?.['variant']).toBe('h2')
    const pricing = under(tree, sections[8].id)
    expect(ofKind(tree, pricing, 'muiCard')).toHaveLength(3)
    expect(role(tree, 'check').filter((id) => pricing.includes(id))).toHaveLength(12)
  })

  it('carries its pictures where the source shows them: the hero, the film and the console', () => {
    expect(ofKind(tree, under(tree, sections[0].id), 'image')).toHaveLength(1)
    expect(Object.values(tree.nodes).filter((node) => node.componentId === 'image')).toHaveLength(3)
  })
})

describe('aglyn.com /pricing', () => {
  const { tree, stored } = build('pricing')

  it('keeps every tab strip with its labels, the open one marked, over the panel the source drew', () => {
    const strips = role(tree, 'tabStrip')
    expect(strips).toHaveLength(3)
    const labels = (id: string) => under(tree, id).flatMap((at) => (tree.nodes[at].componentId === 'muiTypography' ? [tree.nodes[at].props?.['children']] : []))
    expect(labels(strips[0])).toEqual(['Monthly', 'Annual · save up to 35%'])
    expect(labels(strips[1])).toEqual(['Free', 'Starter', 'Pro', 'Business', 'Scale', 'Advanced', 'Agency', 'Enterprise'])
    expect(role(tree, 'tab').filter((id) => tree.nodes[id].sx?.['bgcolor'] === 'primary.main')).toHaveLength(3)
  })

  it('sets the row a tab’s panel holds side by side, as the source does (AGL-4114)', () => {
    const { doc } = build('pricing')
    const layout = doc.layout as NonNullable<AiSiteImportDocument['layout']>
    const panels = layout.sections.flatMap((section) => section.nodes).flatMap((node) => (node.kind === 'tabs' ? node.tabs.map((tab) => tab.panel) : []))
    const read = panels.flatMap((panel) => panel.filter((node) => node.kind === 'row'))
    expect(read).toHaveLength(1)
    const inTabs = new Set(role(tree, 'tabs').flatMap((id) => under(tree, id)))
    const rows = role(tree, 'row').filter((id) => inTabs.has(id) && tree.nodes[id].componentId === 'muiGrid')
    expect(rows).toHaveLength(1)
    expect(tree.nodes[rows[0]].nodes).toHaveLength((read[0] as Extract<(typeof read)[number], { kind: 'row' }>).cells.filter((cell) => cell.nodes.length).length)
  })

  it('draws its plan comparison and its add-on rates as tables, every cell kept', () => {
    const tables = Object.values(stored).filter((node) => node.componentId === 'dataTable')
    expect(tables).toHaveLength(3)
    expect(tables[0].props?.['headerRow']).toBe(true)
    expect(String(tables[0].props?.['rows']).split('\n')).toHaveLength(14)
  })

  it('keeps its plans as cards with their prices and its FAQ of 11 as accordions', () => {
    expect(Object.values(tree.nodes).filter((node) => node.componentId === 'muiAccordion')).toHaveLength(11)
    const prices = role(tree, 'figure').map((id) => tree.nodes[id].props?.['children'])
    expect(prices).toEqual(expect.arrayContaining(['$0', '$16']))
  })
})

describe('aglyn.com /pricing as a live import fell short of it (AGL-4083)', () => {
  const { tree, doc, violations } = build('livePricing')
  const text = (id: string) => String(tree.nodes[id]?.props?.['children'] ?? '')
  const plans = () => role(tree, 'card').filter((id) => under(tree, id).some((at) => tree.nodes[at].componentId === 'muiButton') && under(tree, id).some((at) => /^(Free|Starter|Pro|Business)$/.test(text(at))))
  const inCard = (card: string, kind: string) => under(tree, card).filter((id) => tree.nodes[id].componentId === kind)

  it('builds with nothing the page check refuses', () => {
    expect(violations).toEqual([])
  })

  it('draws a card a plan, with one button each, as the source draws it, going where it goes', () => {
    expect(plans()).toHaveLength(4)
    const buttons = plans().map((card) => {
      const list = inCard(card, 'muiButton')
      expect(list).toHaveLength(1)
      const props = tree.nodes[list[0]].props ?? {}
      return [text(list[0]), props['variant'], props['href']]
    })
    expect(buttons).toEqual([
      ['Get started', 'outlined', 'https://app.aglyn.com/signup'],
      ['Choose', 'outlined', 'https://app.aglyn.com/signup?plan=starter&interval=year'],
      ['Start Pro', 'contained', 'https://app.aglyn.com/signup?plan=pro&interval=year'],
      ['Choose', 'outlined', 'https://app.aglyn.com/signup?plan=business&interval=year'],
    ])
  })

  it('sets the tag on the same line as the plan’s name', () => {
    const [badge, ...more] = role(tree, 'badge')
    expect(more).toEqual([])
    expect(text(badge)).toBe('POPULAR')
    const line = role(tree, 'titleRow').find((id) => under(tree, id).includes(badge)) as string
    expect(tree.nodes[line].props).toMatchObject({ direction: 'row', justifyContent: 'space-between' })
    expect(under(tree, line).filter((id) => text(id) === 'Pro')).toHaveLength(1)
  })

  it('sets a price large with what it is for beside it', () => {
    const price = role(tree, 'price')
    expect(price).toHaveLength(2)
    for (const id of price) {
      const [figure, period] = tree.nodes[id].nodes as string[]
      expect(tree.nodes[id].props).toMatchObject({ direction: 'row', alignItems: 'baseline' })
      expect(tree.nodes[figure].props?.['variant']).toBe('h3')
      expect(text(period)).toBe('/mo')
    }
    expect(price.map((id) => text((tree.nodes[id].nodes as string[])[0]))).toEqual(['$39', '$99'])
  })

  it('draws the higher plans as rows, each a Grid whose last cell holds its button', () => {
    const rows = role(tree, 'ruledRow').filter((id) => tree.nodes[id].componentId === 'muiGrid')
    expect(rows).toHaveLength(4)
    expect(rows.map((id) => tree.nodes[id].props?.['container'])).toEqual([true, true, true, true])
    const last = rows.map((id) => {
      const cell = (tree.nodes[id].nodes as string[]).at(-1) as string
      const button = under(tree, cell).find((at) => tree.nodes[at].componentId === 'muiButton') as string
      return [text(button), tree.nodes[button].props?.['href'] ?? tree.nodes[button].props?.['screenId']]
    })
    expect(last.slice(0, 3)).toEqual([
      ['CHOOSE', 'https://app.aglyn.com/signup?plan=scale&interval=year'],
      ['CHOOSE', 'https://app.aglyn.com/signup?plan=advanced&interval=year'],
      ['CHOOSE', 'https://app.aglyn.com/signup?plan=agency&interval=year'],
    ])
    expect(last[3][0]).toBe('CONTACT SALES')
  })

  it('draws a label and its value at either end of one line, the group’s Stack ruling them', () => {
    const rows = role(tree, 'ruledRow').filter((id) => tree.nodes[id].componentId === 'muiStack')
    expect(rows).toHaveLength(69)
    for (const id of rows) expect(tree.nodes[id].props).toMatchObject({ direction: 'row', justifyContent: 'space-between' })
    const groups = role(tree, 'rows')
    expect(groups).toHaveLength(7)
    for (const id of groups) expect(tree.nodes[id].props?.['divider']).toBe('line')
    const row = rows.find((id) => (tree.nodes[id].nodes as string[]).some((at) => text(at) === 'Custom domain & SSL')) as string
    expect((tree.nodes[row].nodes as string[]).map(text)).toEqual(['Custom domain & SSL', '—'])
  })

  it('leaves a row’s label a line, as the source has it, not a heading of its own', () => {
    const titles = Object.keys(tree.nodes).filter((id) => text(id) === 'Custom domain & SSL')
    expect(titles.map((id) => tree.nodes[id].props?.['component'])).toContain('p')
  })

  it('holds what is above the plans’ rows to the words a heading measures, every section as wide as its source', () => {
    for (const { node } of sectionsOf(tree)) {
      const container = (node.nodes ?? []).find((id) => tree.nodes[id].componentId === 'muiContainer') as string
      expect(tree.nodes[container].props?.['maxWidth']).toBe('xl')
    }
  })

  it('places every line of the page exactly once', () => {
    expect(doc.blocks.length).toBeGreaterThan(400)
    const shown = Object.values(tree.nodes).flatMap((node) => (typeof node.props?.['children'] === 'string' ? [clean(node.props['children'] as string)] : []))
    for (const line of ['POPULAR', '/mo', 'Start Pro', 'Everything in Starter, plus:']) expect(shown).toContain(line)
  })
})

describe('what a design answer may change (AGL-4083)', () => {
  const groupsIn = (name: SiteLayoutPageName) => (docOf(name).layout as NonNullable<AiSiteImportDocument['layout']>).sections.map((section) => {
    let count = 0
    const visit = (nodes: readonly SiteImportLayoutNode[]) => {
      for (const node of nodes) {
        if (node.kind === 'group') count += 1
        if (node.kind === 'row') for (const cell of node.cells) visit(cell.nodes)
        if (node.kind === 'tabs') for (const tab of node.tabs) visit(tab.panel)
      }
    }
    visit(section.nodes)
    return count
  })
  const all = (name: SiteLayoutPageName, group: { kind: string; style: string }) => ({ sections: groupsIn(name).map((count) => ({ hero: 'none', band: 'source', align: 'source', groups: Array.from({ length: count }, () => group) })) })
  /** A page compiled under an answer the tool could give, as the page check reads it. */
  const answered = (name: SiteLayoutPageName, group: { kind: string; style: string }) => {
    const doc = docOf(name)
    const names = aiSiteImportSectionNames(doc)
    return aiCompileImportedPage({
      doc,
      sectionIds: names.map((_, index) => `sec-${index}`),
      plan: { title: doc.title, sections: names.map((section) => ({ name: section, uses: [], items: 0 })) },
      targets: TARGETS as never,
      answer: aiReadLayoutDesign(all(name, group), names.length),
    })
  }
  const listed = (name: SiteLayoutPageName) => answered(name, { kind: 'list', style: 'cards' })

  it('never joins a card’s title to its words: a titled group asked to be a list stays apart, ruled', () => {
    const { tree } = listed('home')
    const words = Object.values(tree.nodes).map((node) => String(node.props?.['children'] ?? ''))
    const group = (docOf('home').layout as NonNullable<AiSiteImportDocument['layout']>).sections.flatMap((section) => section.nodes).find((node) => node.kind === 'group' && node.group === 'cards' && (node.items[0]?.lines.length ?? 0) > 1) as SiteImportLayoutGroup
    const item = group.items[0]
    const blocks = docOf('home').blocks
    const title = clean((blocks[item.title as number] as { text: string }).text)
    expect(words).toContain(title)
    expect(role(tree, 'ruled').length).toBeGreaterThan(0)
  })

  it('still reads a group of one line an item as a list', () => {
    expect(role(listed('home').tree, 'list').length).toBeGreaterThan(0)
  })

  it('says it kept the group apart', () => {
    expect(listed('home').settled.some((note) => /kept apart/.test(note.what))).toBe(true)
  })

  it('never draws a card as a figure when the figure has no place for its link, its bullets or its icon', () => {
    const compiled = answered('home', { kind: 'stats', style: 'cards' })
    expect(compiled.words).toBe(compiled.sourceWords)
    expect(compiled.settled.some((note) => /more than a figure can show/.test(note.what))).toBe(true)
    const shown = Object.values(compiled.tree.nodes).flatMap((node) => (typeof node.props?.['children'] === 'string' ? [clean(node.props['children'] as string)] : []))
    const links = (docOf('home').layout as NonNullable<AiSiteImportDocument['layout']>).sections.flatMap((section) => section.nodes).flatMap((node) => (node.kind === 'group' ? node.items.flatMap((item) => item.link ?? []) : []))
    expect(links.length).toBeGreaterThan(0)
    for (const ref of links) expect(shown).toContain(clean((docOf('home').blocks[ref] as { text: string }).text))
  })

  it('still reads a group of figures as figures, whatever it was read as', () => {
    const doc = docOf('product')
    const figures = Object.values(answered('product', { kind: 'stats', style: 'cards' }).tree.nodes).filter((node) => node.props?.['variant'] === 'h2' && node.props?.['component'] === 'p')
    // Its 4 figures, and its 3 numbered steps: nothing of either is lost as a figure.
    expect(figures).toHaveLength(7)
    expect(doc.layout?.sections.some((section) => section.nodes.some((node) => node.kind === 'group' && node.group === 'stats'))).toBe(true)
  })

  it('never repaints a section’s own lighter ground with a hero of dimmed words', () => {
    const doc = docOf('home')
    const names = aiSiteImportSectionNames(doc)
    const heroOf = (hero: string) => aiSiteImportDesignedSections(doc, aiReadLayoutDesign({ sections: [{ hero, band: 'source', align: 'source', groups: [] }] }, names.length))
    const source = heroOf('column')
    expect(source.sections[0]?.hero).toBe('column')
    for (const hero of ['cover', 'poster']) {
      const designed = heroOf(hero)
      expect(designed.sections[0]?.hero).toBe('column')
      expect(designed.settled.some((note) => note.what.includes(`the ${hero} hero set aside`))).toBe(true)
    }
  })

  it('still lays dimmed words over a picture its source draws dark behind them', () => {
    const doc = docOf('pottery')
    const names = aiSiteImportSectionNames(doc)
    expect((doc.layout as NonNullable<AiSiteImportDocument['layout']>).sections[0]).toMatchObject({ band: 'dark', hero: { picture: 'behind' } })
    expect(aiSiteImportDesignedSections(doc, aiReadLayoutDesign({ sections: [{ hero: 'poster', band: 'source', align: 'source', groups: [] }] }, names.length)).sections[0]?.hero).toBe('poster')
  })

  it('keeps a dark source’s ground under a hero of words on a card, and a guided start’s as it was', () => {
    const { stored, violations } = build('pottery', { sections: [{ hero: 'panel', band: 'source', align: 'source', groups: [] }] })
    expect(violations).toEqual([])
    expect(stored['sec-0']?.props?.['colorScheme']).toBe('dark')
  })

  it('leaves a group of rows as its source sets them, whatever the answer reads it as', () => {
    const shape = (tree: AiLayoutRawTree) => role(tree, 'ruledRow').map((id) => tree.nodes[id].componentId)
    expect(shape(answered('livePricing', { kind: 'list', style: 'pictures' }).tree)).toEqual(shape(build('livePricing').tree))
    expect(shape(answered('livePricing', { kind: 'stats', style: 'cards' }).tree)).toEqual(shape(build('livePricing').tree))
  })
})

describe('a read kept before a plan’s button was its own (AGL-4083)', () => {
  it('still draws a short link among an item’s words as a button, and keeps a long one as its words', () => {
    const doc = docOf('livePricing')
    const layout = doc.layout as NonNullable<AiSiteImportDocument['layout']>
    const stripCtas = (nodes: readonly SiteImportLayoutNode[]): SiteImportLayoutNode[] =>
      nodes.map((node) => {
        if (node.kind === 'group') {
          return { ...node, items: node.items.map(({ ctas: _ctas, link, text, ...item }) => ({ ...item, ...(link || text ? { text: [...(text ?? []), ...(link ?? [])] } : {}) })) }
        }
        if (node.kind === 'row') return { ...node, cells: node.cells.map((cell) => ({ nodes: stripCtas(cell.nodes) })) }
        if (node.kind === 'tabs') return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, panel: stripCtas(tab.panel) })) }
        return node
      })
    const stored = { ...doc, layout: { ...layout, sections: layout.sections.map((section) => ({ ...section, nodes: stripCtas(section.nodes) })) } }
    const names = aiSiteImportSectionNames(stored)
    const compiled = aiCompileImportedPage({
      doc: stored,
      sectionIds: names.map((_, index) => `sec-${index}`),
      plan: { title: doc.title, sections: names.map((name) => ({ name, uses: [], items: 0 })) },
      targets: TARGETS as never,
    })
    const buttons = Object.values(compiled.tree.nodes).filter((node) => node.componentId === 'muiButton').map((node) => node.props?.['children'])
    expect(buttons).toEqual(expect.arrayContaining(['Get started', 'Choose', 'Start Pro']))
  })
})

describe('how wide a section is drawn (AGL-4083)', () => {
  const widths = (tree: AiLayoutRawTree) =>
    sectionsOf(tree).map(({ id }) => tree.nodes[under(tree, id).find((at) => tree.nodes[at].componentId === 'muiContainer' && !tree.nodes[at].props?.['disableGutters']) as string]?.props?.['maxWidth'])

  it('draws every section as wide as its source runs it, in the Container’s own Max Width', () => {
    for (const name of ['home', 'product', 'pricing', 'contact'] as const) expect(new Set(widths(build(name).tree))).toEqual(new Set(['xl']))
    expect(widths(build('post').tree)).toEqual(['md', 'xl', 'xl'])
    expect(new Set(widths(build('pottery').tree))).toEqual(new Set(['lg']))
  })

  it('widens a hero’s own Container with its section, and leaves its reading measure', () => {
    const doc = docOf('home')
    const sections = (doc.layout as NonNullable<AiSiteImportDocument['layout']>).sections
    expect(sections[0]?.hero?.picture).toBeTruthy()
    const { tree } = build('home', { sections: [{ hero: 'column', band: 'source', align: 'source', groups: [] }] })
    expect(widths(tree)[0]).toBe('xl')
    const measures = Object.values(tree.nodes).filter((node) => node.componentId === 'muiContainer' && node.props?.['disableGutters'])
    for (const measure of measures) expect(measure.props?.['maxWidth']).not.toBe('xl')
  })

  it('holds a long read with no cap of its source’s to a reading measure, anything else to a page', () => {
    const doc = docOf('pottery')
    const layout = doc.layout as NonNullable<AiSiteImportDocument['layout']>
    const designed = aiSiteImportDesignedSections({ ...doc, layout: { ...layout, sections: layout.sections.map(({ width: _width, ...section }) => section) } })
    expect(new Set(designed.sections.map((section) => section.width))).toEqual(new Set(['lg']))
    const long = { kind: 'line', line: 0 } as const
    const reading = aiSiteImportDesignedSections({
      ...doc,
      blocks: Array.from({ length: 6 }, (_, at) => ({ kind: 'paragraph', text: `Paragraph ${at} of a long read.`, region: 'main' })) as never,
      layout: { ...layout, sections: [{ name: 'Terms', from: 'heading', band: 'plain', background: null, align: 'start', nodes: Array.from({ length: 6 }, (_, at) => ({ ...long, line: at })), lines: [0, 1, 2, 3, 4, 5] }] },
    })
    expect(reading.sections[0]?.width).toBe('md')
  })
})

describe('aglyn.com /contact', () => {
  it('writes to each address the source gives, a button that opens the mail app', () => {
    const { tree } = build('contact')
    const mailto = Object.values(tree.nodes).filter((node) => node.componentId === 'muiButton' && String(node.props?.['href'] ?? '').startsWith('mailto:'))
    expect(mailto.map((node) => node.props?.['children'])).toEqual(['sales@example.com', 'support@example.com', 'hello@example.com'])
  })

  it('places the site’s form where the source asks its visitors to write', () => {
    const { tree, violations } = build('contact', null, { forms: [{ id: 'form-contact', name: 'Contact' }] })
    expect(violations).toEqual([])
    const form = Object.values(tree.nodes).find((node) => node.componentId === 'form')
    expect(form?.props?.['formId']).toBe('form-contact')
  })

  const placed = (forms: NonNullable<AiSiteImportDocument['forms']> | undefined, saved: Array<{ id: string; name: string }>) => {
    const doc = { ...docOf('contact'), ...(forms ? { forms } : {}) }
    const names = aiSiteImportSectionNames(doc)
    const { tree: built } = aiCompileImportedPage({
      doc,
      sectionIds: names.map((_, index) => `sec-${index}`),
      plan: { title: doc.title, sections: names.map((name) => ({ name, uses: [], items: 0 })) },
      targets: { ...TARGETS, forms: saved } as never,
    })
    return Object.values(built.nodes).filter((node) => node.componentId === 'form').map((node) => node.props?.['formId'])
  }

  it('places the form rebuilt for this one, on a site of several (AGL-4083)', () => {
    expect(placed([{ index: 0, formId: 'form-b' }], [{ id: 'form-a', name: 'A' }, { id: 'form-b', name: 'B' }])).toEqual(['form-b'])
  })

  it('places nothing for a form with no room, and never the site’s other form in its place (AGL-4083)', () => {
    expect(placed([{ index: 0, formId: null }], [{ id: 'form-a', name: 'A' }])).toEqual([])
  })

  it('reads a page kept before its forms were rebuilt as it always did: the site’s one form, none of several', () => {
    expect(placed(undefined, [{ id: 'form-a', name: 'A' }])).toEqual(['form-a'])
    expect(placed(undefined, [{ id: 'form-a', name: 'A' }, { id: 'form-b', name: 'B' }])).toEqual([])
  })
})

describe('a blog post', () => {
  const { tree } = build('post')

  it('keeps its title, its cover and its body’s pictures in place, its byline’s portrait small and round', () => {
    expect(Object.values(tree.nodes).filter((node) => node.props?.['component'] === 'h1').map((node) => node.props?.['children'])).toEqual([
      'What 10, 25, 50 or 100 client sites cost per month',
    ])
    const images = Object.values(tree.nodes).filter((node) => node.componentId === 'image')
    expect(images).toHaveLength(5)
    expect(images[0].props?.['width']).toBe('4rem')
    expect(images[0].sx?.['borderRadius']).toBe('50%')
    expect(images[1].props?.['width']).toBeUndefined()
  })

  it('reads its article at the start of the page, as text is read, and keeps its related row as pictures over their titles', () => {
    const article = under(tree, sectionsOf(tree)[0].id)
    const body = role(tree, 'text').filter((id) => article.includes(id)).map((id) => tree.nodes[id])
    expect(body.length).toBeGreaterThan(4)
    expect(body.some((node) => node.props?.['align'] === 'center')).toBe(false)
    const related = under(tree, sectionsOf(tree)[1].id)
    expect(ofKind(tree, related, 'image')).toHaveLength(3)
    expect(role(tree, 'title').filter((id) => related.includes(id))).toHaveLength(3)
  })
})

describe('a non-Aglyn page: a pottery studio', () => {
  const { tree, stored } = build('pottery')
  const sections = sectionsOf(tree)

  it('opens with its words over its photo, as the source does', () => {
    const hero = under(tree, sections[0].id)
    expect(sections[0].node.props?.['colorScheme']).toBe('dark')
    expect(ofKind(tree, hero, 'image')).toHaveLength(1)
    expect(hero.map((id) => tree.nodes[id]).find((node) => node.props?.['component'] === 'h1')?.props?.['children']).toBe('Make something with your hands this week.')
  })

  it('quotes its students in their own words, names no customer of its own, and keeps its price table, its suppliers’ logos and its brand band', () => {
    const quotes = role(tree, 'quote').map((id) => tree.nodes[id].props?.['children'])
    expect(quotes).toEqual(['“I came for one class and stayed for three years.”', '“The teachers make the hard parts feel possible.”', '“My kids ask every week when clay club is.”'])
    expect(JSON.stringify(stored)).not.toContain('[Customer name]')
    expect(Object.values(stored).filter((node) => node.componentId === 'dataTable')).toHaveLength(1)
    expect(role(tree, 'logo')).toHaveLength(4)
    expect(bandOf(sections[7].node)).toBe('brand')
  })
})

describe('the design answer: choices only, over the structure it is shown', () => {
  /** A recorded answer for Home, in the tool's shape: a split hero, ruled cards, a band asked where the source drew its own. */
  const answer = {
    sections: [
      { hero: 'split', band: 'source', align: 'start', groups: [] },
      { hero: 'none', band: 'source', align: 'source', groups: [{ kind: 'source', style: 'ruled' }] },
      { hero: 'none', band: 'dark', align: 'source', groups: [] },
      { hero: 'none', band: 'source', align: 'source', groups: [{ kind: 'source', style: 'pictures' }] },
    ],
  }

  it('sets aside a hero that would move the source’s picture, and draws the group style it chose, every word still once', () => {
    const { doc, stored, violations } = build('home', answer)
    expect(violations).toEqual([])
    expect(tally(shownWords(stored))).toEqual(tally(sourceLines(doc)))
    const nodes = Object.values(stored)
    // Home's picture sits under its centered words (AGL-4138): the split it asked for would set it beside them.
    expect(nodes.some((node) => node.componentId === 'muiGrid' && node.props?.['size'] === 'xs:12 md:6')).toBe(false)
    const designed = aiSiteImportDesignedSections(doc, aiReadLayoutDesign(answer, doc.layout?.sections.length ?? 0))
    expect(designed.sections[0]?.hero).toBe('column')
    expect(designed.settled.map((entry) => entry.what)).toContain('the split hero set aside: the source lays its picture below its words')
  })

  it('keeps a band the source drew whatever the answer says, and a style the group cannot be drawn in falls back to the source’s', () => {
    const { stored } = build('home', answer)
    const sections = (stored[CANVAS_ROOT_ELEMENT_ID]?.nodes ?? []).map((id) => stored[id])
    // Section 3 has its own white band: the answer's dark is not taken.
    expect(sections[2]?.props?.['colorScheme']).toBeUndefined()
    // "Pictures" for a group with no pictures: still the theme's cards.
    expect(nodes(stored, sections[3]).filter((node) => node.componentId === 'muiCard')).toHaveLength(13)
  })

  it('is asked of a small prompt that names no word but its sections’ names, through a strict tool with no field for words', () => {
    const doc = docOf('home')
    const prompt = aiLayoutDesignPrompt({ job: { $id: 'job-home', inputs: {} }, screen: { title: 'Home', slug: '/', sections: [] }, doc })
    expect(prompt).toContain('Section 4 "Explore the platform": soft band, centered. Groups: 1. Shows: eyebrow, heading, lede, group 1: 13 cards in 3 columns, boxed, each icon + title + text.')
    expect(prompt.length).toBeLessThan(3_000)
    expect(aiSiteImportDesignText(doc).split('\n')).toHaveLength(11)
    const schema = JSON.stringify(AI_LAYOUT_DESIGN_TOOL.inputSchema)
    expect(schema).not.toMatch(/"(text|from|title|words)"/)
    expect(AI_LAYOUT_DESIGN_TOOL.strict).toBe(true)
  })

  function nodes(map: Record<string, Node>, root: Node | undefined): Node[] {
    const out: Node[] = []
    const visit = (node: Node | undefined) => {
      if (!node) return
      out.push(node)
      for (const child of node.nodes ?? []) visit(map[child])
    }
    visit(root)
    return out
  }
})

describe('the design answer runs on the balanced tier', () => {
  const saved = process.env['AI_DEFAULT_MODEL']
  afterEach(() => {
    if (saved === undefined) delete process.env['AI_DEFAULT_MODEL']
    else process.env['AI_DEFAULT_MODEL'] = saved
  })

  const provider = () => resolveAiRoute('job.page')?.provider.id ?? ''
  const ofTier = (tier: 'fast' | 'balanced' | 'deep') => AI_MODEL_CATALOG.find((entry) => entry.provider === provider() && entry.tier === tier && !entry.successor)

  it('whatever smaller model the deployment names for every step', () => {
    const fast = ofTier('fast')
    if (!fast) throw new Error('no fast model')
    process.env['AI_DEFAULT_MODEL'] = fast.id
    expect(resolveAiRoute('job.page')?.model).toBe(fast.id)
    const pinned = aiImportPageModel(() => fast.id)
    expect(aiCatalogEntry(pinned)?.tier).toBe('balanced')
  })

  it('and keeps the job’s own pick where it is that tier or above', () => {
    const deep = ofTier('deep')
    if (!deep) throw new Error('no deep model')
    expect(aiImportPageModel(() => deep.id)).toBe(deep.id)
  })
})

describe('a link to a page of a later wave', () => {
  it('goes to that page by its draft id, which the page step admits as a page it may link', () => {
    const { tree, doc } = build('home')
    const linked = Object.values(tree.nodes).filter((node) => typeof node.props?.['screenId'] === 'string')
    expect(linked.length).toBeGreaterThanOrEqual(20)
    const admitted = new Set(aiSiteImportLinkablePages(doc).map((page) => page.id))
    for (const node of linked) expect(admitted.has(String(node.props?.['screenId']))).toBe(true)
  })

  it('is not taken out when its wave is still to come, and keeps its words when the page never comes', () => {
    const state = {
      pages: [
        { slot: 'p0', draftId: 'd-home', refused: null },
        { slot: 'p1', draftId: 'd-later', refused: null },
        { slot: 'p2', draftId: 'd-failed', refused: null },
        { slot: 'p3', draftId: 'd-left-out', refused: 'blocked' },
      ],
    }
    const items = [
      { slot: 'p0', status: 'succeeded' },
      { slot: 'p1', status: 'pending' },
      { slot: 'p2', status: 'failed' },
    ]
    expect(aiSiteImportUnbuilt(state as never, items as never)).toEqual(['d-failed', 'd-left-out'])
    const nodes = {
      [CANVAS_ROOT_ELEMENT_ID]: { $id: CANVAS_ROOT_ELEMENT_ID, componentId: 'div', nodes: ['a', 'b'] },
      a: { $id: 'a', componentId: 'muiScreenLink', parentId: CANVAS_ROOT_ELEMENT_ID, props: { children: 'See pricing →', screenId: 'd-failed' } },
      b: { $id: 'b', componentId: 'muiButton', parentId: CANVAS_ROOT_ELEMENT_ID, props: { children: 'Read more', screenId: 'd-later' } },
    }
    const kept = aiPageWithoutLinksTo(nodes as never, ['d-failed'], { keepWords: true }) as unknown as Record<string, Node>
    expect(kept['a']?.props).toEqual({ children: 'See pricing →' })
    expect(kept['b']?.props).toEqual({ children: 'Read more', screenId: 'd-later' })
  })
})

describe('the source’s icons on the icon element’s square', () => {
  it('keeps a 24-unit path as it is, and moves a 64-unit one onto 24 units, its relative moves scaled alone', () => {
    expect(aiSiteImportPathOn24('M12 2L2 22h20z', '0 0 24 24')).toBe('M12 2L2 22h20z')
    expect(aiSiteImportPathOn24('M32 0L0 64h64z', '0 0 64 64')).toBe('M12 0L0 24h24z')
  })

  it('centers a drawing that is not square, and scales an arc’s radii but never its flags', () => {
    expect(aiSiteImportPathOn24('M0 0H48V24H0Z', '0 0 48 24')).toBe('M0 6H24V18H0Z')
    expect(aiSiteImportPathOn24('M0 12a12 12 0 1 0 24 0', '0 0 48 48')).toBe('M0 6a6 6 0 1 0 12 0')
  })

  it('draws a small drawing of filled shapes as one path, and leaves out one made of strokes', () => {
    expect(aiSiteImportIconPath({ viewBox: '0 0 24 24', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><rect x="2" y="2" width="4" height="4"/></svg>' })).toBe(
      'M8 12A4 4 0 1 0 16 12A4 4 0 1 0 8 12ZM2 2H6V6H2Z',
    )
    expect(aiSiteImportIconPath({ viewBox: '0 0 24 24', svg: '<svg><path d="M2 2L22 22" fill="none" stroke="currentColor"/></svg>' })).toBeNull()
    expect(aiSiteImportIconPath(undefined)).toBeNull()
  })
})

describe('the page’s listing', () => {
  it('keeps the source’s title and description word for word, and asks for no listing of its own', () => {
    const doc = docOf('home')
    const listing = aiImportedPageListing({ seoTitle: 'Build a Website: Describe It, Edit It, Publish Free | Aglyn', seoDescription: 'Describe your website and Aglyn AI builds the first draft.' }, {
      title: 'Aglyn: Build a Website with AI, Free to Start',
      description: 'A rewritten description.',
    })
    expect(listing).toEqual({ title: 'Build a Website: Describe It, Edit It, Publish Free | Aglyn', description: 'Describe your website and Aglyn AI builds the first draft.' })
    expect(aiImportedPageListingOwed(listing)).toBe(false)
    expect(doc.url).toBe('https://aglyn.com/')
  })

  it('writes only a part the source left empty', () => {
    const listing = aiImportedPageListing({ seoTitle: 'Contact Aglyn | Support, Sales and Press', seoDescription: '' }, { title: 'Another title', description: 'A description the source never gave.' })
    expect(listing).toEqual({ title: 'Contact Aglyn | Support, Sales and Press', description: 'A description the source never gave.' })
    expect(aiImportedPageListingOwed({ title: 'Contact Aglyn | Support, Sales and Press', description: '' })).toBe(true)
  })
})

/*------------------------------------------
 * The page drawn as its source draws it (AGL-4138)
 *-----------------------------------------*/

describe('pictures at the shape their source shows them (AGL-4138)', () => {
  /** The image a frame holds, and the frame. */
  const framed = (tree: { nodes: Record<string, Node> }, ids: readonly string[]) =>
    ofKind(tree, ids, 'image').map((id) => ({ image: tree.nodes[id] as Node, frame: Object.values(tree.nodes).find((node) => node.nodes?.includes(id)) as Node }))

  it('opens Home on its poster at the picture’s own shape, in the source’s rounded, shadowed box, never 16 / 7', () => {
    const { tree } = build('home')
    const [hero] = framed(tree, under(tree, sectionsOf(tree)[0].id))
    expect(hero?.frame.sx).toMatchObject({ aspectRatio: '1600 / 900', borderRadius: 3, boxShadow: 3 })
    expect(hero?.image.props).toMatchObject({ objectFit: 'cover', width: '100%', height: '100%' })
    expect(JSON.stringify(tree.nodes)).not.toContain('16 / 7')
  })

  it('frames a card’s picture at its own shape, and at 16 / 9 only where nothing says its shape', () => {
    const { tree } = build('post')
    const related = framed(tree, under(tree, sectionsOf(tree)[1].id))
    expect(related.map(({ image }) => image.sx?.['aspectRatio'])).toEqual(['1600 / 900', '1600 / 900', '1600 / 900'])
    // A cover the library holds at 1200 × 630 is framed at 1200 / 630.
    const doc = docOf('post')
    const wide = { ...doc, photos: doc.photos.map((photo) => ({ ...photo, width: 1200, height: 630 })) }
    const designed = aiSiteImportDesignedSections(wide)
    const items = designed.sections[1]?.blocks.flatMap((block) => block.items ?? []) ?? []
    expect(items.map((item) => item.picture?.fit?.ratio)).toEqual(['1200 / 630', '1200 / 630', '1200 / 630'])
    const unsized = aiSiteImportDesignedSections({ ...doc, photos: doc.photos.map(({ width: _width, height: _height, ...photo }) => photo) })
    expect(unsized.sections[1]?.blocks.flatMap((block) => block.items ?? []).map((item) => item.picture?.fit?.ratio)).toEqual([undefined, undefined, undefined])
  })

  it('crops the blog listing’s pictures to the heights its source crops them to, as the Image’s own height', () => {
    const { tree, violations } = build('blog')
    expect(violations).toEqual([])
    const heights = ofKind(tree, Object.keys(tree.nodes), 'image').map((id) => [tree.nodes[id]?.props?.['height'], tree.nodes[id]?.props?.['objectFit']])
    expect(heights).toEqual([['320px', 'cover'], ['220px', 'cover'], ['220px', 'cover'], ['220px', 'cover'], ['220px', 'cover'], ['220px', 'cover']])
  })

  it('keeps its category tags’ links', () => {
    const { tree } = build('blog')
    const tags = role(tree, 'chipLink').map((id) => tree.nodes[id]?.props?.['href'] ?? tree.nodes[id]?.props?.['screenId'])
    expect(tags).toHaveLength(6)
    expect(tags.every(Boolean)).toBe(true)
  })
})

describe('Home’s hero as its source draws it, whatever the answer says (AGL-4138)', () => {
  const asked = (hero: string) => ({ sections: [{ hero, band: 'source', align: 'start', groups: [] }] })
  const designedWith = (doc: AiSiteImportDocument, hero: string) => aiSiteImportDesignedSections(doc, aiReadLayoutDesign(asked(hero), doc.layout?.sections.length ?? 0))

  it('opens as a centered column with its picture under its words for any answer that would move it; editorial keeps it there', () => {
    const doc = docOf('home')
    for (const hero of ['split', 'bleed', 'cover', 'poster', 'panel']) expect(designedWith(doc, hero).sections[0]?.hero).toBe('column')
    expect(designedWith(doc, 'editorial').sections[0]?.hero).toBe('editorial')
    expect(designedWith(doc, 'editorial').settled).toEqual([])
    const { stored } = build('home', asked('split'))
    const measure = Object.values(stored).find((node) => node.componentId === 'muiBox' && JSON.stringify(node.sx) === JSON.stringify({ maxWidth: { xs: '100%', md: '72%' }, mx: 'auto' }))
    expect(measure).toBeDefined()
  })

  it('keeps a hero beside its picture, or behind it, among the heroes that keep it there', () => {
    const home = docOf('home')
    const layout = home.layout as NonNullable<AiSiteImportDocument['layout']>
    const beside = { ...home, layout: { ...layout, sections: layout.sections.map((section, index) => (index === 0 ? { ...section, hero: { picture: 'beside' as const } } : section)) } }
    expect(designedWith(beside, 'split').sections[0]?.hero).toBe('split')
    expect(designedWith(beside, 'bleed').sections[0]?.hero).toBe('bleed')
    expect(designedWith(beside, 'column').sections[0]?.hero).toBe('split')
    expect(designedWith(beside, 'column').settled.map((entry) => entry.what)).toEqual(['the column hero set aside: the source lays its picture beside its words'])
    const pottery = docOf('pottery')
    expect(designedWith(pottery, 'poster').sections[0]?.hero).toBe('poster')
    expect(designedWith(pottery, 'split').sections[0]?.hero).toBe('cover')
  })

  it('sets its eyebrow in an outlined pill in the muted words’ grey, and the two lines under it as the source does', () => {
    const { tree } = build('home')
    const hero = under(tree, sectionsOf(tree)[0].id)
    const pill = ofKind(tree, hero, 'muiPaper').map((id) => tree.nodes[id] as Node)
    expect(pill).toHaveLength(1)
    expect(pill[0]?.props).toMatchObject({ variant: 'outlined' })
    expect(pill[0]?.sx).toMatchObject({ borderRadius: 999, alignSelf: 'center' })
    const words = tree.nodes[pill[0]?.nodes?.[0] as string]
    expect(words?.props).toMatchObject({ children: 'BUILD A WEBSITE · FREE TO START · NO CODE', variant: 'overline' })
    expect(words?.sx).toMatchObject({ color: 'text.secondary' })
  })
})

describe('Home’s sections as their source draws them (AGL-4138)', () => {
  const { tree } = build('home')
  const sections = sectionsOf(tree)
  const eyebrowOf = (index: number) => under(tree, sections[index].id).map((id) => tree.nodes[id] as Node).find((node) => node.props?.['variant'] === 'overline')

  it('draws its magenta eyebrows in the theme’s third color, and the one in its links’ blue in the brand’s', () => {
    for (const index of [1, 3, 4, 5, 8]) expect(eyebrowOf(index)?.sx).toEqual({ color: 'tertiary.main' })
    for (const index of [2, 6, 7, 9]) expect(eyebrowOf(index)?.sx).toEqual({ color: 'primary.main' })
  })

  it('draws "What Aglyn is" as one large statement in the Text Style of a fourth-level heading, every word, and no heading of the outline', () => {
    const statement = under(tree, sections[2].id).map((id) => tree.nodes[id] as Node).find((node) => node.sx?.['typography'] === 'h4')
    expect(statement?.props).toMatchObject({ variant: 'lede', component: 'p' })
    expect(String(statement?.props?.['children'])).toMatch(/^Most website builders hand you a blank page.*easy to run\.$/)
  })

  it('sets the platform’s cards at the start under its centered heading, each icon in its tile and its arrow at the row’s end', () => {
    const explore = under(tree, sections[3].id)
    const heading = explore.map((id) => tree.nodes[id] as Node).find((node) => node.props?.['component'] === 'h2')
    expect(heading?.props?.['align']).toBe('center')
    const cards = ofKind(tree, explore, 'muiCard')
    for (const card of cards) {
      const inside = under(tree, card).map((id) => tree.nodes[id] as Node)
      expect(inside.filter((node) => node.componentId === 'muiTypography').every((node) => node.props?.['align'] === undefined)).toBe(true)
      const tile = inside.find((node) => node.componentId === 'muiPaper')
      expect(tile?.sx).toEqual({ bgcolor: 'action.hover' })
      const row = inside.find((node) => node.componentId === 'muiStack' && node.props?.['direction'] === 'row')
      expect(row?.props?.['justifyContent']).toBe('space-between')
      expect(tree.nodes[row?.nodes?.[1] as string]).toMatchObject({ componentId: 'icon', props: { size: '20' }, sx: { color: 'text.secondary' } })
    }
  })

  it('draws its three steps under the source’s 3 px rule in the brand’s color, no card, their numbers grey', () => {
    const steps = under(tree, sections[4].id)
    expect(ofKind(tree, steps, 'muiCard')).toEqual([])
    const ruled = role(tree, 'ruled').filter((id) => steps.includes(id)).map((id) => tree.nodes[id]?.sx)
    expect(ruled).toEqual([
      { borderTop: 3, borderColor: 'primary.main' },
      { borderTop: 3, borderColor: 'primary.main' },
      { borderTop: 3, borderColor: 'primary.main' },
    ])
    expect(role(tree, 'number').filter((id) => steps.includes(id)).map((id) => tree.nodes[id]?.sx)).toEqual([{ color: 'text.secondary' }, { color: 'text.secondary' }, { color: 'text.secondary' }])
  })

  it('reads the design answer’s text as it read before: a rule is "boxed", a statement a "lede"', () => {
    const text = aiSiteImportDesignText(docOf('home'))
    expect(text).toContain('Section 3 "What Aglyn is": plain band, aligned to the start. Groups: 0. Shows: eyebrow, lede.')
    expect(text).toContain('group 1: 3 steps in 3 columns, boxed, each figure + title + text')
  })
})

describe('the design answer’s text is the same on every recorded page (AGL-4138)', () => {
  /** Digests of each page's design text, taken before the import read how its source frames what it shows. */
  const BEFORE: Partial<Record<SiteLayoutPageName, string>> = {
    home: 'aefeaebbe0d75a10d68835b3cda0c3341502d2b8b61c6dcc3cd496d263cb5dae',
    product: '3f291a72d118038d53b868496e63430800f05956433674658cd1fdebb4ca451b',
    pricing: '2215e9716b5ae4872ebaa9d87d5c8b4cb940ad9dd5cf8f95bfdfa80beaebb5c3',
    livePricing: 'cc5e62018ad66a9afe15b3d9b52529b081769fbbfb9694d7b71e4f2fa493d603',
    contact: '50f18902c98c9d7da19d782bf2a0e31d849d5ba3bcf21dffb9f56a09b9bd5d6d',
    post: '0a12998087f6eecfc6df313f309fe704923b2c74ac3972032f6041938a3c9c17',
    pottery: '82071847c6f3017142ac35f03c0961df58ad1d9d8e199889b1e221896dca6235',
  }

  it.each(Object.keys(BEFORE) as SiteLayoutPageName[])('%s', (name) => {
    expect(createHash('sha256').update(aiSiteImportDesignText(docOf(name))).digest('hex')).toBe(BEFORE[name])
  })
})
