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
 * Bring my site is scored against its source (AGL-4109), over the recorded
 * pages: aglyn.com's Home, /product, /pricing, /contact and a blog post, and
 * a non-Aglyn studio page, each read, compiled and checked as the page step
 * stores it, and each recorded home page's header and footer drawn with no
 * model. Each page holds the bar (`SITE_IMPORT_FIDELITY_THRESHOLD`, words at
 * exactly 1) with the source's own counts. The same pages built as the 10/29
 * import built them, one column of lines, score 0, and each measure falls when
 * the thing it measures is taken off the page. No live AI: the one design
 * answer here is recorded.
 */

import { compress } from '@aglyn/aglyn/app-utils/compress'
import { decodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { SITE_IMPORT_REPLAY_HOME_ANSWER, siteImportReplayFrame, siteImportReplayPage, type SiteImportReplayPage } from '../site-import/fixtures/site-import-fidelity-replay'
import { SITE_LAYOUT_PAGES, type SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { AI_LAYOUT_ALIGNS, AI_LAYOUT_DESIGN_BANDS, AI_LAYOUT_DESIGN_GROUP_KINDS, AI_LAYOUT_DESIGN_SOURCE, AI_LAYOUT_GROUP_STYLES, AI_LAYOUT_IMPORT_HEROES } from '../layout-language/ai-layout-language'
import type { SiteImportGroupKind, SiteImportLayoutNode } from './ai-site-import'
import {
  SITE_IMPORT_FIDELITY_THRESHOLD,
  siteImportFidelity,
  siteImportFidelityBandOf,
  siteImportFidelityTreeOf,
  siteImportFrameFidelity,
  type SiteImportFidelityNode,
  type SiteImportFidelityTree,
} from './ai-site-import-fidelity'

const FORM = [{ id: 'form-contact', name: 'Contact' }]

const pages = new Map<string, SiteImportReplayPage>()

/** A recorded page built as the page step stores it; a page that holds a form has the site's. */
function page(name: SiteLayoutPageName, options: { answer?: Record<string, unknown>; layout?: boolean } = {}): SiteImportReplayPage {
  const key = `${name}:${JSON.stringify(options)}`
  const held = pages.get(key)
  if (held) return held
  const built = siteImportReplayPage(name, { ...options, ...(name === 'contact' ? { forms: FORM } : {}) })
  pages.set(key, built)
  return built
}

const scored = (name: SiteLayoutPageName) => siteImportFidelity(page(name).source, page(name).tree)

/** What each recorded page's source holds, counted on the page built from it. */
const WHOLE: Record<
  SiteLayoutPageName,
  {
    sections: number
    rows: number
    groups: Partial<Record<SiteImportGroupKind, number>>
    tables: number
    tabs: number
    pictures: number
    icons: number
    lone: number
    buttons: number
    unlinked: number
    headings: number
    forms: number
    /** Films drawn as the Video element (AGL-4140). */
    videos: number
    words: number
  }
> = {
  // Home's and /product's film are the Video element (AGL-4140): its play mark is its own, no lone icon,
  // and Home's "Watch the 40-second film" is a button that plays it.
  home: { sections: 11, rows: 2, groups: { cards: 28, steps: 3, list: 12, faq: 11 }, tables: 0, tabs: 0, pictures: 2, icons: 34, lone: 0, buttons: 3, unlinked: 0, headings: 10, forms: 0, videos: 1, words: 1581 },
  product: { sections: 11, rows: 1, groups: { logos: 8, cards: 19, steps: 3, stats: 4, pricing: 3, faq: 7 }, tables: 0, tabs: 0, pictures: 3, icons: 31, lone: 0, buttons: 6, unlinked: 0, headings: 10, forms: 0, videos: 1, words: 1012 },
  pricing: { sections: 7, rows: 1, groups: { pricing: 11, cards: 69, faq: 11 }, tables: 3, tabs: 3, pictures: 0, icons: 24, lone: 0, buttons: 4, unlinked: 0, headings: 9, forms: 0, videos: 0, words: 2292 },
  livePricing: { sections: 7, rows: 1, groups: { pricing: 11, cards: 69, faq: 11 }, tables: 3, tabs: 3, pictures: 0, icons: 24, lone: 0, buttons: 4, unlinked: 0, headings: 9, forms: 0, videos: 0, words: 2292 },
  contact: { sections: 3, rows: 1, groups: { cards: 4 }, tables: 0, tabs: 0, pictures: 0, icons: 4, lone: 0, buttons: 0, unlinked: 0, headings: 7, forms: 1, videos: 0, words: 120 },
  // The post's second row is a byline, drawn small over its words, not as columns across the page.
  post: { sections: 3, rows: 1, groups: { list: 5, logos: 4, cards: 3 }, tables: 1, tabs: 0, pictures: 5, icons: 0, lone: 0, buttons: 2, unlinked: 0, headings: 10, forms: 0, videos: 0, words: 585 },
  pottery: { sections: 8, rows: 1, groups: { cards: 3, quotes: 3, faq: 3, logos: 4 }, tables: 1, tabs: 0, pictures: 9, icons: 0, lone: 0, buttons: 2, unlinked: 0, headings: 7, forms: 0, videos: 0, words: 279 },
  // Five films (AGL-4140): the one playing behind the opening is drawn as its poster, a picture; the YouTube
  // frame, the lite-youtube facade, the card's Vimeo film and the head's og:video are each the Video element.
  bakery: { sections: 5, rows: 0, groups: { cards: 3 }, tables: 0, tabs: 0, pictures: 7, icons: 0, lone: 0, buttons: 2, unlinked: 0, headings: 8, forms: 0, videos: 4, words: 137 },
}

describe.each(Object.keys(SITE_LAYOUT_PAGES) as SiteLayoutPageName[])('%s: scored against its source', (name) => {
  const whole = WHOLE[name]

  it('passes the page check the page step holds it to', () => {
    expect(page(name).violations).toEqual([])
  })

  it('shows every word of the source exactly once, and none of its own', () => {
    expect(scored(name).words).toEqual({ source: whole.words, built: whole.words, missing: 0, extra: 0, ratio: 1, examples: { missing: [], extra: [] } })
  })

  it('holds the bar with the structure the source has', () => {
    const report = scored(name)
    expect(report.score).toBeGreaterThanOrEqual(SITE_IMPORT_FIDELITY_THRESHOLD)
    expect(report.score).toBe(1)
    expect(report.lowest).toBeNull()
    expect(report.sections).toEqual({ source: whole.sections, built: whole.sections, ratio: 1 })
    expect(report.bands).toMatchObject({ source: whole.sections, built: whole.sections, ratio: 1 })
    expect(report.widths).toEqual({ source: whole.sections, built: whole.sections, ratio: 1 })
    expect(report.rows).toEqual({ source: whole.rows, built: whole.rows, ratio: 1 })
    expect(Object.fromEntries(Object.entries(report.groups).map(([kind, entry]) => [kind, entry.items.built]))).toEqual(whole.groups)
    for (const entry of Object.values(report.groups)) {
      expect(entry.items.ratio).toBe(1)
      expect(entry.groups.ratio).toBe(1)
    }
    expect(report.tables).toEqual({ source: whole.tables, built: whole.tables, ratio: 1 })
    expect(report.tabs).toEqual({ source: whole.tabs, built: whole.tabs, ratio: 1 })
    expect(report.pictures).toEqual({ source: whole.pictures, built: whole.pictures, ratio: 1 })
    expect(report.icons).toEqual({ source: whole.icons, built: whole.icons, ratio: 1, lone: whole.lone })
    expect(report.buttons).toEqual({ source: whole.buttons, built: whole.buttons, ratio: 1, unlinked: whole.unlinked })
    expect(report.headings).toEqual({ source: whole.headings, built: whole.headings, ratio: 1 })
    expect(report.forms).toEqual({ source: whole.forms, built: whole.forms, ratio: 1 })
    expect(report.videos).toEqual({ source: whole.videos, built: whole.videos, ratio: 1 })
  })

  it('reads the page as Firestore stores it just as it reads the compiled one', () => {
    const { source, tree } = page(name)
    const stored = decodeStoredNodes<SiteImportFidelityTree['nodes']>(Buffer.from(compress(tree.nodes)))
    expect(siteImportFidelity(source, siteImportFidelityTreeOf(stored as SiteImportFidelityTree['nodes']))).toEqual(scored(name))
  })

  it('scores 0 built as the 10/29 import built it, one section of lines at each heading', () => {
    const lines = page(name, { layout: false })
    const report = siteImportFidelity(lines.source, lines.tree)
    expect(report.score).toBeLessThan(SITE_IMPORT_FIDELITY_THRESHOLD)
    expect(report.score).toBe(0)
    expect(report.words.ratio).toBe(1)
  })
})

describe('aglyn.com Home, the rows §2.5 of the plan holds it to', () => {
  it('draws its bands as the source does, its closer dark', () => {
    expect(scored('home').bands.drawn).toEqual(['plain', 'soft', 'plain', 'soft', 'plain', 'soft', 'plain', 'soft', 'soft', 'soft', 'dark'])
    expect(scored('home').bands.drawn).toEqual(scored('home').bands.read)
  })

  it('scores the same arranged by its recorded design answer: the design changes no structure', () => {
    const arranged = page('home', { answer: SITE_IMPORT_REPLAY_HOME_ANSWER as Record<string, unknown> })
    expect(arranged.violations).toEqual([])
    const report = siteImportFidelity(arranged.source, arranged.tree)
    expect(report.score).toBe(1)
    expect(report.words).toEqual(scored('home').words)
    expect(report.groups).toEqual(scored('home').groups)
  })
})

/*------------------------------------------
 * No design answer costs a page its structure
 *-----------------------------------------*/

/** Each section's groups, counted as the answer numbers them. */
function groupsBySection(name: SiteLayoutPageName): number[] {
  return page(name).source.layout.sections.map((section) => {
    const count = (nodes: readonly SiteImportLayoutNode[]): number =>
      nodes.reduce((total, node) => {
        if (node.kind === 'group') return total + 1
        if (node.kind === 'row') return total + node.cells.reduce((sum, cell) => sum + count(cell.nodes), 0)
        if (node.kind === 'tabs') return total + node.tabs.reduce((sum, tab) => sum + count(tab.panel), 0)
        return total
      }, 0)
    return count(section.nodes)
  })
}

/** One answer the tool admits, the same to every section and every group of a page. */
function answerOf(name: SiteLayoutPageName, group: { kind: string; style: string }, section: { hero?: string; band?: string; align?: string } = {}): Record<string, unknown> {
  return { sections: groupsBySection(name).map((count) => ({ hero: 'none', band: 'source', align: 'source', ...section, groups: Array.from({ length: count }, () => group) })) }
}

/** Every answer the tool admits, by what it chooses: each kind by each style, and each hero, band and alignment over the source's groups. */
function everyAnswer(name: SiteLayoutPageName): Array<[string, Record<string, unknown>]> {
  const kinds = [AI_LAYOUT_DESIGN_SOURCE, ...AI_LAYOUT_DESIGN_GROUP_KINDS]
  const keep = { kind: AI_LAYOUT_DESIGN_SOURCE, style: 'cards' }
  return [
    ...kinds.flatMap((kind) => AI_LAYOUT_GROUP_STYLES.map((style): [string, Record<string, unknown>] => [`${kind} / ${style}`, answerOf(name, { kind, style })])),
    ...AI_LAYOUT_IMPORT_HEROES.map((hero): [string, Record<string, unknown>] => [`hero ${hero}`, answerOf(name, keep, { hero })]),
    ...AI_LAYOUT_DESIGN_BANDS.map((band): [string, Record<string, unknown>] => [`band ${band}`, answerOf(name, keep, { band })]),
    ...AI_LAYOUT_ALIGNS.map((align): [string, Record<string, unknown>] => [`align ${align}`, answerOf(name, keep, { align })]),
  ]
}

describe.each(Object.keys(SITE_LAYOUT_PAGES) as SiteLayoutPageName[])('%s: no design answer the tool admits costs it its structure', (name) => {
  it('stays whole under every kind, style, hero, band and alignment', () => {
    const whole = scored(name)
    const fell: string[] = []
    for (const [label, answer] of everyAnswer(name)) {
      const built = siteImportReplayPage(name, { answer, ...(name === 'contact' ? { forms: FORM } : {}) })
      const report = siteImportFidelity(built.source, built.tree)
      const groups = Object.entries(report.groups).filter(([, entry]) => entry.items.ratio < 1).map(([kind, entry]) => `${kind} ${entry.items.built}/${entry.items.source}`)
      const short = [...(built.violations.length ? ['refused'] : []), ...(report.words.ratio < 1 ? [`words ${report.words.ratio}`] : []), ...groups, ...(report.score < 1 ? [`score ${report.score} (${report.lowest})`] : [])]
      if (short.length) fell.push(`${label}: ${short.join(', ')}`)
    }
    expect(fell).toEqual([])
    expect(whole.score).toBe(1)
  })
})

/*------------------------------------------
 * Each measure falls when its thing is taken off the page
 *-----------------------------------------*/

type Nodes = Record<string, SiteImportFidelityNode & { nodes?: string[]; props?: Record<string, unknown>; sx?: Record<string, unknown> }>

/** A built page with something changed, the original left as it was. */
function changed(tree: SiteImportFidelityTree, change: (nodes: Nodes) => void): SiteImportFidelityTree {
  const nodes = JSON.parse(JSON.stringify(tree.nodes)) as Nodes
  change(nodes)
  return { rootId: tree.rootId, nodes }
}

/** Takes a node off the page, with everything under it. */
function drop(nodes: Nodes, id: string): void {
  for (const node of Object.values(nodes)) if (node.nodes?.includes(id)) node.nodes = node.nodes.filter((child) => child !== id)
}

const idsOf = (nodes: Nodes, test: (node: Nodes[string]) => boolean) => Object.keys(nodes).filter((id) => test(nodes[id] as Nodes[string]))

const shows = (words: string) => (node: Nodes[string]) => node.props?.['children'] === words

describe('a measure sees what is lost', () => {
  const home = () => page('home')

  it('words: a line lost is missing, a line twice and a line of its own are extra', () => {
    const { source, tree } = home()
    const line = idsOf(tree.nodes as Nodes, (node) => node.componentId === 'muiTypography' && typeof node.props?.['children'] === 'string' && node.props['component'] === 'h2')[0] as string
    const said = String(tree.nodes[line]?.props?.['children'])
    const lost = siteImportFidelity(source, changed(tree, (nodes) => drop(nodes, line))).words
    expect(lost.missing).toBeGreaterThan(0)
    expect(lost.ratio).toBeLessThan(1)
    expect(lost.examples.missing.length).toBeGreaterThan(0)

    const doubled = siteImportFidelity(source, changed(tree, (nodes) => (((nodes[line] as Nodes[string]).props as Record<string, unknown>)['children'] = `${said} ${said}`))).words
    expect(doubled.missing).toBe(0)
    expect(doubled.extra).toBeGreaterThan(0)
    expect(doubled.ratio).toBeLessThan(1)

    const own = siteImportFidelity(source, changed(tree, (nodes) => (((nodes[line] as Nodes[string]).props as Record<string, unknown>)['children'] = `${said} Zebrawords`))).words
    expect(own.extra).toBe(1)
    expect(own.examples.extra).toEqual(['Zebrawords'])
  })

  it('sections: a section left out, or the page in one', () => {
    const { source, tree } = home()
    const last = tree.nodes[tree.rootId]?.nodes?.at(-1) as string
    const report = siteImportFidelity(source, changed(tree, (nodes) => drop(nodes, last)))
    expect(report.sections).toEqual({ source: 11, built: 10, ratio: 10 / 11 })
    expect(report.bands.built).toBeLessThan(11)
    expect(report.score).toBeLessThan(1)
  })

  it('bands: the dark closer drawn plain', () => {
    const { source, tree } = home()
    const last = tree.nodes[tree.rootId]?.nodes?.at(-1) as string
    const report = siteImportFidelity(source, changed(tree, (nodes) => delete ((nodes[last] as Nodes[string]).props as Record<string, unknown>)['colorScheme']))
    expect(report.bands).toMatchObject({ source: 11, built: 10 })
    expect(report.bands.drawn.at(-1)).toBe('plain')
  })

  it('rows: columns stacked, on a Grid that is no longer a row', () => {
    const { source, tree } = home()
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiGrid' && node.props?.['container'] === true)) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['container'] = false
      }),
    )
    expect(report.rows.built).toBe(0)
    expect(report.score).toBe(0)
    expect(report.lowest).toBe('rows')
  })

  it('widths: a section drawn narrower than its source runs it, and not one drawn wider', () => {
    const { source, tree } = page('livePricing')
    const containers = idsOf(tree.nodes as Nodes, (node) => node.componentId === 'muiContainer' && node.props?.['maxWidth'] === 'xl')
    const narrower = siteImportFidelity(source, changed(tree, (nodes) => (((nodes[containers[0] as string] as Nodes[string]).props as Record<string, unknown>)['maxWidth'] = 'md')))
    expect(narrower.widths).toEqual({ source: 7, built: 6, ratio: 6 / 7 })
    expect(narrower.lowest).toBe('widths')
    expect(narrower.score).toBe(6 / 7)

    const post = page('post')
    const column = idsOf(post.tree.nodes as Nodes, (node) => node.componentId === 'muiContainer' && node.props?.['maxWidth'] === 'md')[0] as string
    const wider = siteImportFidelity(post.source, changed(post.tree, (nodes) => (((nodes[column] as Nodes[string]).props as Record<string, unknown>)['maxWidth'] = 'xl')))
    expect(wider.widths.ratio).toBe(1)
  })

  it('widths: a section the source sets no cap on counts as kept', () => {
    const { source, tree } = page('home')
    const uncapped = { ...source, layout: { ...source.layout, sections: source.layout.sections.map(({ width: _width, ...section }) => section) } }
    const report = siteImportFidelity(uncapped, changed(tree, (nodes) => {
      for (const id of idsOf(nodes, (node) => node.componentId === 'muiContainer')) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['maxWidth'] = 'sm'
    }))
    expect(report.widths).toEqual({ source: 11, built: 11, ratio: 1 })
  })

  it('groups: a value of marks alone, joined to its label by a build, is still in its row', () => {
    const { source, tree } = page('livePricing')
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        // The label's words and the value's mark in one line, as a build that read the rows as a list drew them.
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiStack' && node.props?.['justifyContent'] === 'space-between')) {
          const row = nodes[id] as Nodes[string]
          const [label, value] = row.nodes ?? []
          const labelNode = nodes[label as string]
          const valueNode = nodes[value as string]
          if (!labelNode?.props || typeof valueNode?.props?.['children'] !== 'string' || /[\p{L}\p{N}]/u.test(valueNode.props['children'])) continue
          labelNode.props['children'] = `${String(labelNode.props['children'])} ${valueNode.props['children']}`
          row.nodes = [label as string]
        }
      }),
    )
    expect(report.groups.cards?.items).toEqual({ source: 69, built: 69, ratio: 1 })
    expect(report.words.ratio).toBe(1)
  })

  it('groups: a mark is never taken from the row further down that holds its own', () => {
    const { source, tree } = page('livePricing')
    const report = siteImportFidelity(source, tree)
    expect(report.groups.cards?.groups).toEqual({ source: 6, built: 6, ratio: 1 })
  })

  it('groups: an FAQ with no accordion is no FAQ, though every word stays', () => {
    const { source, tree } = home()
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiAccordion')) (nodes[id] as Nodes[string]).componentId = 'muiBox'
      }),
    )
    expect(report.groups.faq?.items).toEqual({ source: 11, built: 0, ratio: 0 })
    expect(report.groups.faq?.groups).toEqual({ source: 1, built: 0, ratio: 0 })
    expect(report.words.ratio).toBe(1)
    expect(report.lowest).toBe('faq items')
  })

  it('groups: an item whose link went from it, as the 10/29 cards lost their pages', () => {
    const { source, tree } = home()
    const withLink = source.layout.sections.flatMap((section) => section.nodes).flatMap((node) => (node.kind === 'group' ? node.items.filter((item) => item.to) : []))
    expect(withLink.length).toBeGreaterThan(0)
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const node of Object.values(nodes)) {
          for (const key of ['screenId', 'href', 'to']) delete node.props?.[key]
          delete (node as { interactions?: unknown }).interactions
        }
      }),
    )
    expect(report.groups.cards?.items.built).toBeLessThan(28)
    expect(report.buttons.built).toBe(0)
  })

  it('tables: a table drawn as lines; tabs: a tab strip gone', () => {
    const { source, tree } = page('pricing')
    const tables = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'dataTable')) drop(nodes, id)
      }),
    )
    expect(tables.tables).toEqual({ source: 3, built: 0, ratio: 0 })
    const tabs = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiStack' && node.props?.['direction'] === 'row')) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['direction'] = 'column'
      }),
    )
    expect(tabs.tabs.built).toBeLessThan(3)
  })

  it('pictures and icons: taken off the page', () => {
    const { source, tree } = home()
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        drop(nodes, idsOf(nodes, (node) => node.componentId === 'image')[0] as string)
        for (const id of idsOf(nodes, (node) => node.componentId === 'icon')) drop(nodes, id)
      }),
    )
    expect(report.pictures).toEqual({ source: 2, built: 1, ratio: 0.5 })
    expect(report.icons).toMatchObject({ source: 34, built: 0, ratio: 0 })
  })

  it('pictures: counted over what is drawn when the library’s copies are not known', () => {
    const { source, tree } = home()
    const read = { layout: source.layout, blocks: source.blocks }
    expect(siteImportFidelity(read, tree).pictures).toEqual({ source: 2, built: 2, ratio: 1 })
    expect(siteImportFidelity(read, changed(tree, (nodes) => drop(nodes, idsOf(nodes, (node) => node.componentId === 'image')[0] as string))).pictures).toEqual({ source: 2, built: 1, ratio: 0.5 })
  })

  it('buttons: drawn in another style, or going nowhere', () => {
    const { source, tree } = home()
    const buttons = idsOf(tree.nodes as Nodes, (node) => node.componentId === 'muiButton')
    const restyled = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of buttons) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['variant'] = 'text'
      }),
    )
    // The film's own button is one of them (AGL-4140).
    expect(restyled.buttons).toMatchObject({ source: 3, built: 0, ratio: 0 })
    const silent = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of buttons) delete (nodes[id] as Nodes[string]).interactions
      }),
    )
    // The button that plays the film is kept only while it plays it.
    expect(silent.buttons).toMatchObject({ source: 3, built: 2 })
  })

  it('videos: the film drawn as its picture is no film', () => {
    const { source, tree } = home()
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'video')) {
          const node = nodes[id] as Nodes[string]
          nodes[id] = { ...node, componentId: 'image', props: { src: node.props?.['poster'], decorative: true } }
        }
      }),
    )
    expect(report.videos).toEqual({ source: 1, built: 0, ratio: 0 })
    // Its poster is still placed; the score is the film it lost.
    expect(report.pictures).toEqual({ source: 2, built: 2, ratio: 1 })
    expect(report.lowest).toBe('videos')
  })

  it('headings: a heading drawn as a line', () => {
    const { source, tree } = home()
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => /^h[1-6]$/.test(String(node.props?.['component'])))) delete ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['component']
      }),
    )
    expect(report.headings.built).toBeLessThan(10)
  })

  it('forms: the source’s form left out', () => {
    const { source, tree } = page('contact')
    const report = siteImportFidelity(source, changed(tree, (nodes) => drop(nodes, idsOf(nodes, (node) => node.componentId === 'form')[0] as string)))
    expect(report.forms).toEqual({ source: 1, built: 0, ratio: 0 })
    expect(report.lowest).toBe('forms')
  })

  it('names the lowest measure, the score is its ratio', () => {
    const { source, tree } = home()
    // The hero's picture taken off: its film's poster (AGL-4140).
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'video')) delete ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['poster']
      }),
    )
    expect(report.score).toBe(0.5)
    expect(report.lowest).toBe('pictures')
  })
})

describe('what the score leaves out, by name', () => {
  it('a lone icon and a button that goes nowhere are reported and do not score', () => {
    // Home as its read stood before its film was read (AGL-4140): the poster a picture, a play mark beside it, the
    // film's button its words. A play mark is no word and no picture, and a button its script ran goes nowhere here.
    const { source, tree } = page('home')
    const asPicture = (nodes: readonly SiteImportLayoutNode[]): SiteImportLayoutNode[] =>
      nodes.flatMap((node): SiteImportLayoutNode[] =>
        node.kind === 'video' ? [...(node.poster !== undefined ? [{ kind: 'picture' as const, line: node.poster, button: true as const }] : []), { kind: 'icon' as const, icon: 0 }] : [node],
      )
    const before = { ...source, layout: { ...source.layout, sections: source.layout.sections.map((section) => ({ ...section, nodes: asPicture(section.nodes) })) } }
    const flat = changed(tree, (nodes) => {
      for (const id of idsOf(nodes, (node) => node.componentId === 'video')) {
        const node = nodes[id] as Nodes[string]
        nodes[id] = { ...node, componentId: 'image', props: { src: node.props?.['poster'], decorative: true } }
      }
      for (const id of idsOf(nodes, (node) => node.componentId === 'muiButton' && (node.interactions?.length ?? 0) > 0)) {
        nodes[id] = { componentId: 'muiTypography', props: { children: (nodes[id] as Nodes[string]).props?.['children'], variant: 'body1' } }
      }
    })
    const report = siteImportFidelity(before, flat)
    expect(report.icons.lone).toBe(1)
    expect(report.buttons.unlinked).toBe(1)
    expect(report.videos).toEqual({ source: 0, built: 0, ratio: 1 })
    expect(report.score).toBe(1)
  })

  it('a byline is not a row: the post reads 2 rows and scores 1', () => {
    const { source } = page('post')
    expect(source.layout.sections.flatMap((section) => section.nodes).filter((node) => node.kind === 'row').length).toBeGreaterThanOrEqual(1)
    expect(scored('post').rows).toEqual({ source: 1, built: 1, ratio: 1 })
  })
})

/*------------------------------------------
 * The frame
 *-----------------------------------------*/

describe('the header and footer, scored against the source’s', () => {
  const aglyn = siteImportReplayFrame('home')
  const pottery = siteImportReplayFrame('pottery')

  it('aglyn.com: its menu, its buttons, its phone menu and its footer, all there', () => {
    expect(aglyn.violations).toEqual([])
    const report = siteImportFrameFidelity(aglyn, aglyn.tree)
    expect(report).toMatchObject({
      score: 1,
      lowest: null,
      inOrder: true,
      items: { source: 5, built: 5, ratio: 1 },
      menus: { source: 2, built: 2, ratio: 1 },
      entries: { source: 30, built: 30, ratio: 1 },
      details: { source: 38, built: 38, ratio: 1 },
      ctas: { source: 2, built: 2, ratio: 1 },
      drawer: { source: 37, built: 37, ratio: 1 },
      phone: { source: 1, built: 1, ratio: 1 },
      nowrap: { source: 1, built: 1, ratio: 1 },
      columns: { source: 6, built: 6, ratio: 1 },
      links: { source: 54, built: 54, ratio: 1 },
      social: { source: 7, built: 7, ratio: 1 },
      facts: { source: 7, built: 7, ratio: 1 },
    })
  })

  it('a site that is not ours: its own menu, one button, its footer', () => {
    expect(pottery.violations).toEqual([])
    const report = siteImportFrameFidelity(pottery, pottery.tree)
    expect(report).toMatchObject({
      score: 1,
      lowest: null,
      items: { source: 4, built: 4, ratio: 1 },
      menus: { source: 1, built: 1, ratio: 1 },
      entries: { source: 3, built: 3, ratio: 1 },
      details: { source: 0, built: 0, ratio: 1 },
      ctas: { source: 1, built: 1, ratio: 1 },
      drawer: { source: 8, built: 8, ratio: 1 },
      columns: { source: 1, built: 1, ratio: 1 },
      links: { source: 3, built: 3, ratio: 1 },
      social: { source: 2, built: 2, ratio: 1 },
      facts: { source: 5, built: 5, ratio: 1 },
    })
  })

  it('reads the frame as Firestore stores it just as it reads the compiled one', () => {
    const stored = decodeStoredNodes<SiteImportFidelityTree['nodes']>(Buffer.from(compress(aglyn.tree.nodes)))
    expect(siteImportFrameFidelity(aglyn, siteImportFidelityTreeOf(stored as SiteImportFidelityTree['nodes']))).toEqual(siteImportFrameFidelity(aglyn, aglyn.tree))
  })

  /** The 10/29 header: the site's first pages by their titles, a button to the wrong page, a footer of those pages again. */
  const TITLES = ['All-in-One Website Platform', 'Drag and Drop Website', 'Manage Multiple Websites', 'Ecommerce Website Builder', 'POS System Built Into Your', 'Website Form Builder', 'Pricing']
  const headerOf1029 = (): SiteImportFidelityTree => {
    const links = Object.fromEntries(TITLES.map((title, at) => [`link${at}`, { componentId: 'muiScreenLink', props: { children: title, screenId: `s${at}` } }]))
    return {
      rootId: '_@_',
      nodes: {
        '_@_': { componentId: 'root', nodes: ['bar', 'foot'] },
        bar: { componentId: 'muiAppBar', nodes: ['row', 'start'] },
        row: { componentId: 'muiStack', props: { component: 'nav', direction: 'row' }, nodes: Object.keys(links) },
        ...links,
        start: { componentId: 'muiButton', props: { children: 'Start free', variant: 'contained', screenId: 's5' } },
        foot: { componentId: 'muiBox', props: { element: 'footer' }, nodes: ['line'] },
        line: { componentId: 'muiTypography', props: { children: '© import-check-1029' } },
      },
    }
  }

  it('scores the 10/29 header low: page titles for a menu, no menus, no phone menu, no footer', () => {
    const report = siteImportFrameFidelity(aglyn, headerOf1029())
    expect(report.score).toBeLessThan(SITE_IMPORT_FIDELITY_THRESHOLD)
    expect(report.score).toBe(0)
    expect(report.menus).toEqual({ source: 2, built: 0, ratio: 0 })
    expect(report.entries.built).toBe(0)
    expect(report.phone.built).toBe(0)
    expect(report.nowrap.built).toBe(0)
    expect(report.columns.built).toBe(0)
  })

  it('counts a row of the site’s own page titles against the source’s items: the larger of the two', () => {
    const tree = headerOf1029()
    const report = siteImportFrameFidelity({ nav: { ...aglyn.nav, items: [{ label: 'Pricing', items: [] }, { label: 'Docs', items: [] }] } as never, footer: null }, tree)
    expect(report.items).toEqual({ source: 2, built: 1, ratio: 1 / 7 })
  })

  it('says when the row is out of the source’s order', () => {
    const report = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => {
      const row = idsOf(nodes, (node) => node.props?.['component'] === 'nav')[0] as string
      ;(nodes[row] as Nodes[string]).nodes?.reverse()
    }))
    expect(report.inOrder).toBe(false)
  })

  it('sees a phone menu with nothing in it, a row that wraps, and a button redrawn', () => {
    const drawer = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => drop(nodes, idsOf(nodes, (node) => node.componentId === 'muiDrawer')[0] as string)))
    expect(drawer.drawer.built).toBe(0)
    expect(drawer.phone.built).toBe(0)
    const wraps = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => {
      const row = idsOf(nodes, (node) => node.props?.['component'] === 'nav')[0] as string
      delete (nodes[row] as Nodes[string]).sx?.['whiteSpace']
    }))
    expect(wraps.nowrap).toEqual({ source: 1, built: 0, ratio: 0 })
    const restyled = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => {
      for (const id of idsOf(nodes, shows('Start free'))) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['variant'] = 'text'
    }))
    expect(restyled.ctas.built).toBe(1)
  })

  it('sees a footer that lost its profiles', () => {
    const report = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => {
      for (const id of idsOf(nodes, (node) => node.componentId === 'socialLinks')) drop(nodes, id)
    }))
    // One profile is also a link in the source's columns, which the footer still shows.
    expect(report.social).toEqual({ source: 7, built: 1, ratio: 1 / 7 })
    expect(report.lowest).toBe('social')
  })

  it('a source with no menu read and no footer read asks nothing of the frame', () => {
    const report = siteImportFrameFidelity({ nav: null, footer: null }, aglyn.tree)
    expect(report.items.source).toBe(0)
    expect(report.columns.source).toBe(0)
  })
})

/*------------------------------------------
 * The helpers a stored site is read through
 *-----------------------------------------*/

describe('a stored page’s tree and bands', () => {
  it('finds the canvas root, else the node with no parent', () => {
    expect(siteImportFidelityTreeOf({ '_@_': { nodes: ['a'] }, a: { parentId: '_@_' } }).rootId).toBe('_@_')
    expect(siteImportFidelityTreeOf({ a: { parentId: 'b' }, b: { nodes: ['a'] } }).rootId).toBe('b')
    expect(siteImportFidelityTreeOf({}).rootId).toBe('_@_')
  })

  it('reads a band as the compiler draws it', () => {
    expect(siteImportFidelityBandOf({ props: { colorScheme: 'dark' } })).toBe('dark')
    expect(siteImportFidelityBandOf({ sx: { bgcolor: 'background.paper' } })).toBe('soft')
    expect(siteImportFidelityBandOf({ sx: { bgcolor: 'primary.main' } })).toBe('brand')
    expect(siteImportFidelityBandOf({})).toBe('plain')
    expect(siteImportFidelityBandOf(undefined)).toBe('plain')
  })
})
