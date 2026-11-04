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
import {
  SITE_IMPORT_REPLAY_HOME_ANSWER,
  siteImportReplayDocument,
  siteImportReplayFrame,
  siteImportReplayPage,
  siteImportReplayTheme,
  type SiteImportReplayPage,
} from '../site-import/fixtures/site-import-fidelity-replay'
import { SITE_LAYOUT_PAGES, type SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { AI_LAYOUT_ALIGNS, AI_LAYOUT_DESIGN_BANDS, AI_LAYOUT_DESIGN_GROUP_KINDS, AI_LAYOUT_DESIGN_SOURCE, AI_LAYOUT_GROUP_STYLES, AI_LAYOUT_IMPORT_HEROES } from '../layout-language/ai-layout-language'
import type { SiteImportGroupKind, SiteImportLayoutNode } from './ai-site-import'
import {
  SITE_IMPORT_FIDELITY_THRESHOLD,
  SITE_IMPORT_IMPROVE_FREE,
  siteImportFidelity,
  siteImportFidelityBandOf,
  siteImportFidelityHolds,
  siteImportFidelityThemeOf,
  siteImportFidelityTreeOf,
  siteImportFrameFidelity,
  siteImportOklabDelta,
  type SiteImportFidelityNode,
  type SiteImportFidelitySource,
  type SiteImportFidelityTheme,
  type SiteImportFidelityTree,
} from './ai-site-import-fidelity'

const FORM = [{ id: 'form-contact', name: 'Contact' }]

const pages = new Map<string, SiteImportReplayPage>()

/** A recorded page built as the page step stores it; a page that holds a form has the site's. */
function page(name: SiteLayoutPageName, options: { answer?: Record<string, unknown>; layout?: boolean; finish?: 'keep' | 'improve' } = {}): SiteImportReplayPage {
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
    /** Pictures framed as the source frames them (AGL-4138): a portrait and a picture behind a hero's words are not scored. */
    framing: number
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
  home: { sections: 11, rows: 2, groups: { cards: 28, steps: 3, list: 12, faq: 11 }, tables: 0, tabs: 0, pictures: 2, framing: 2, icons: 47, lone: 0, buttons: 3, unlinked: 0, headings: 10, forms: 0, videos: 1, words: 1581 },
  product: { sections: 11, rows: 1, groups: { logos: 8, cards: 19, steps: 3, stats: 4, pricing: 3, faq: 7 }, tables: 0, tabs: 0, pictures: 3, framing: 3, icons: 44, lone: 0, buttons: 6, unlinked: 0, headings: 10, forms: 0, videos: 1, words: 1012 },
  pricing: { sections: 7, rows: 1, groups: { pricing: 11, cards: 69, faq: 11 }, tables: 3, tabs: 3, pictures: 0, framing: 0, icons: 24, lone: 0, buttons: 4, unlinked: 0, headings: 9, forms: 0, videos: 0, words: 2292 },
  livePricing: { sections: 7, rows: 1, groups: { pricing: 11, cards: 69, faq: 11 }, tables: 3, tabs: 3, pictures: 0, framing: 0, icons: 24, lone: 0, buttons: 4, unlinked: 0, headings: 9, forms: 0, videos: 0, words: 2292 },
  contact: { sections: 3, rows: 1, groups: { cards: 4 }, tables: 0, tabs: 0, pictures: 0, framing: 0, icons: 4, lone: 0, buttons: 0, unlinked: 0, headings: 7, forms: 1, videos: 0, words: 120 },
  // The post's second row is a byline, drawn small over its words, not as columns across the page.
  post: { sections: 3, rows: 1, groups: { list: 5, logos: 4, cards: 3 }, tables: 1, tabs: 0, pictures: 5, framing: 4, icons: 0, lone: 0, buttons: 2, unlinked: 0, headings: 10, forms: 0, videos: 0, words: 585 },
  // The blog listing (AGL-4138): its cards crop their pictures to a height of their own, kept; its category tags keep their links.
  blog: { sections: 2, rows: 1, groups: { logos: 6, cards: 5 }, tables: 0, tabs: 0, pictures: 6, framing: 6, icons: 0, lone: 0, buttons: 2, unlinked: 1, headings: 9, forms: 0, videos: 0, words: 322 },
  pottery: { sections: 8, rows: 1, groups: { cards: 3, quotes: 3, faq: 3, logos: 4 }, tables: 1, tabs: 0, pictures: 9, framing: 8, icons: 0, lone: 0, buttons: 2, unlinked: 0, headings: 7, forms: 0, videos: 0, words: 279 },
  // Five films (AGL-4140): the one playing behind the opening is drawn as its poster, a picture that fills its
  // band and is not framed; the YouTube frame, the lite-youtube facade, the card's Vimeo film and the head's
  // og:video are each the Video element, their posters framed as the source frames them.
  bakery: { sections: 5, rows: 0, groups: { cards: 3 }, tables: 0, tabs: 0, pictures: 7, framing: 6, icons: 0, lone: 0, buttons: 2, unlinked: 0, headings: 8, forms: 0, videos: 4, words: 137 },
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
    expect(report.framing).toEqual({ source: whole.framing, built: whole.framing, ratio: 1 })
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
    expect(report.icons).toMatchObject({ source: 47, built: 0, ratio: 0 })
  })

  it('framing: a picture cut to a shape not its own, as the 11/1 hero and every card picture were (AGL-4138)', () => {
    const { source, tree } = home()
    // The hero's frame holds its film, poster first (AGL-4140).
    const frames = idsOf(tree.nodes as Nodes, (node) => node.componentId === 'muiBox' && node.sx?.['aspectRatio'] !== undefined && (node.nodes ?? []).some((id) => tree.nodes[id]?.componentId === 'image' || tree.nodes[id]?.componentId === 'video'))
    expect(frames).toHaveLength(1)
    // The hero's poster in the 16 / 7 box the column hero drew it in before.
    const cut = siteImportFidelity(source, changed(tree, (nodes) => ((nodes[frames[0] as string] as Nodes[string]).sx = { ...(nodes[frames[0] as string] as Nodes[string]).sx, aspectRatio: { xs: '4 / 3', md: '16 / 7' } })))
    expect(cut.framing).toEqual({ source: 2, built: 1, ratio: 0.5 })
    expect(cut.score).toBe(0.5)
    expect(cut.lowest).toBe('framing')
    // The blog's cards forced to 16 / 9, their source's height dropped.
    const blog = page('blog')
    const cards = idsOf(blog.tree.nodes as Nodes, (node) => node.componentId === 'image' && node.props?.['height'] === '220px')
    expect(cards).toHaveLength(5)
    const sixteenNine = siteImportFidelity(
      blog.source,
      changed(blog.tree, (nodes) => {
        for (const id of cards) {
          const node = nodes[id] as Nodes[string]
          delete (node.props as Record<string, unknown>)['height']
          node.sx = { aspectRatio: '16 / 9' }
        }
      }),
    )
    expect(sixteenNine.framing).toEqual({ source: 6, built: 1, ratio: 1 / 6 })
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
      // Every word of both panels too (AGL-4139): their columns' headings and lines.
      drawer: { source: 45, built: 45, ratio: 1 },
      phone: { source: 1, built: 1, ratio: 1 },
      nowrap: { source: 1, built: 1, ratio: 1 },
      // The menus as the source builds them (AGL-4139): six columns in order, the featured card, the dark column and the
      // footer's developer card filled, nineteen tiles, the featured picture, both opening on hover, the footer's logo.
      menuColumns: { source: 6, built: 6, ratio: 1 },
      panels: { source: 3, built: 3, ratio: 1 },
      tiles: { source: 19, built: 19, ratio: 1 },
      pictures: { source: 1, built: 1, ratio: 1 },
      hover: { source: 2, built: 2, ratio: 1 },
      logo: { source: 1, built: 1, ratio: 1 },
      columns: { source: 6, built: 6, ratio: 1 },
      // The developer card's link, line and heading are its box's now, not the footer's own links and words.
      links: { source: 53, built: 53, ratio: 1 },
      social: { source: 7, built: 7, ratio: 1 },
      facts: { source: 5, built: 5, ratio: 1 },
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
      // A folder of plain links the source's sheets do not hide: no columns, tiles or hover to keep (AGL-4139).
      menuColumns: { source: 0, built: 0, ratio: 1 },
      tiles: { source: 0, built: 0, ratio: 1 },
      hover: { source: 0, built: 0, ratio: 1 },
      logo: { source: 0, built: 0, ratio: 1 },
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

  it('sees menus that open only on a click, tiles drawn bare, a featured card that lost its picture and its box (AGL-4139)', () => {
    const clickOnly = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => {
      for (const id of Object.keys(nodes)) delete (nodes[id] as Nodes[string] & { interactions?: unknown }).interactions
    }))
    // A name whose hover shows nothing is no menu at all, and a Mega Menu with no hover opens only on a click.
    expect(clickOnly.hover).toEqual({ source: 2, built: 0, ratio: 0 })
    const bare = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => {
      for (const id of idsOf(nodes, (node) => node.componentId === 'icon')) {
        const tile = (nodes[id] as Nodes[string]).parentId as string
        if ((nodes[tile] as Nodes[string]).componentId === 'muiCard') {
          ;(nodes[tile] as Nodes[string]).componentId = 'muiStack'
          delete (nodes[tile] as Nodes[string]).sx
        }
      }
    }))
    expect(bare.tiles.built).toBe(0)
    const plain = siteImportFrameFidelity(aglyn, changed(aglyn.tree, (nodes) => {
      for (const id of idsOf(nodes, (node) => node.componentId === 'image' && String(node.props?.['src']).includes('/mp'))) drop(nodes, id)
    }))
    expect(plain.pictures).toEqual({ source: 1, built: 0, ratio: 0 })
    // Today's frame for the same source, with neither the hover nor the columns, scores below the bar.
    expect(siteImportFrameFidelity(aglyn, headerOf1029()).hover.built).toBe(0)
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

/*------------------------------------------
 * Keep my site or Improve it (AGL-4152)
 *-----------------------------------------*/

const FINISHES = ['keep', 'improve'] as const

describe.each(Object.keys(SITE_LAYOUT_PAGES) as SiteLayoutPageName[])('%s: scored as each finish (AGL-4152)', (name) => {
  it('scores as it did before the choice with no finish, and carries none of a finish’s measures', () => {
    const report = scored(name)
    for (const key of ['scoredAs', 'free', 'align', 'boxed', 'ground', 'measure', 'readable', 'design', 'facts', 'lines', 'meaning']) expect(report).not.toHaveProperty(key)
    expect(report.buttons).not.toHaveProperty('case')
    expect(siteImportFidelity(page(name).source, page(name).tree, {})).toEqual(report)
  })

  it('holds the bar as Keep my site, its sections aligned and its groups boxed as the source sets them', () => {
    const report = siteImportFidelity(page(name).source, page(name).tree, { finish: 'keep' })
    expect(report.scoredAs).toEqual({ finish: 'keep', words: 'kept' })
    expect(report.free).toEqual([])
    expect(report.score).toBeGreaterThanOrEqual(SITE_IMPORT_FIDELITY_THRESHOLD)
    expect(report.align?.source).toBeGreaterThan(0)
    expect(report.align?.ratio).toBe(1)
    expect(report.boxed?.ratio).toBe(1)
    // No theme given: no ground or button color is measured, and none is said to be kept.
    expect(report.ground).toMatchObject({ source: 0, theme: null })
    expect(siteImportFidelityHolds(report)).toBe(true)
  })

  it('scores Improve it on its content alone, at 1, with its design computed', () => {
    const report = siteImportFidelity(page(name).source, page(name).tree, { finish: 'improve' })
    expect(report.score).toBe(1)
    expect(report.lowest).toBeNull()
    expect(report.free).toEqual([...SITE_IMPORT_IMPROVE_FREE])
    const lines = Object.entries(report.design ?? {}).filter(([key, line]) => key !== 'better' && line !== null)
    expect(lines.length).toBeGreaterThan(0)
    for (const [, line] of lines) expect(line).toEqual({ source: expect.any(Number), built: expect.any(Number) })
    expect(siteImportFidelityHolds(report)).toBe(true)
  })

  it('still scores the 10/29 control below the bar, kept or improved', () => {
    const lines = page(name, { layout: false })
    for (const finish of FINISHES) {
      const report = siteImportFidelity(lines.source, lines.tree, { finish })
      expect(report.score).toBeLessThan(SITE_IMPORT_FIDELITY_THRESHOLD)
      expect(siteImportFidelityHolds(report)).toBe(false)
    }
  })

  it('places every line once and keeps every fact under improved words, on a page whose words are as written', () => {
    const report = siteImportFidelity(page(name).source, page(name).tree, { finish: 'improve', words: 'improved' })
    expect(report.scoredAs).toEqual({ finish: 'improve', words: 'improved' })
    expect(report.free).toContain('words')
    expect(report.facts).toMatchObject({ ratio: 1, missing: 0, extra: 0 })
    expect(report.lines).toMatchObject({ ratio: 1, extra: 0 })
    expect(report.meaning).toMatchObject({ lines: 0, below: 0, ratio: 1 })
    expect(report.score).toBe(1)
    expect(siteImportFidelityHolds(report)).toBe(true)
  })
})

describe('the replay builds a page as its finish stamps it (AGL-4152)', () => {
  it('carries the finish and the words on the page’s document, and builds the same page while the compile reads neither', () => {
    const kept = siteImportReplayPage('home', { finish: 'keep', words: 'kept' })
    expect(kept.doc).toMatchObject({ finish: 'keep', wording: 'kept' })
    expect(kept.violations).toEqual([])
    expect(siteImportFidelity(kept.source, kept.tree, { finish: 'keep' }).score).toBe(1)
    expect(siteImportReplayPage('home').doc).not.toHaveProperty('finish')
  })

  it('draws a recorded page’s theme from the site style its look facts draw, and says so', () => {
    const theme = siteImportReplayTheme('home')
    expect(theme?.from).toBe('style')
    expect(theme?.light.ground).toMatch(/^#[0-9a-f]{6}$/)
    expect(theme?.dark?.ground).toMatch(/^#[0-9a-f]{6}$/)
  })
})

/** The nodes holding one, nearest first. */
function holders(tree: SiteImportFidelityTree, id: string): string[] {
  const parent = new Map<string, string>()
  for (const [at, node] of Object.entries(tree.nodes)) for (const child of node.nodes ?? []) parent.set(child, at)
  const out: string[] = []
  for (let at = parent.get(id); at; at = parent.get(at)) out.push(at)
  return out
}

describe('Keep my site sees each of the 11/4 Home gaps (AGL-4152)', () => {
  /**
   * aglyn.com's Home as the 11/4 live read saw it: a dark slate closer, cyan
   * capital buttons with a dark label, and a hero heading held to half its
   * section.
   */
  const source = (): SiteImportFidelitySource => {
    const { source: read } = page('home')
    const sections = read.layout.sections.map((section, index) => ({
      ...section,
      ...(section.band === 'dark' ? { background: '#2b2f36' } : {}),
      ...(index === 0 && section.hero ? { hero: { ...section.hero, measure: 640 } } : {}),
    }))
    return { ...read, layout: { ...read.layout, sections, look: { ...read.layout.look, darkBackground: '#2b2f36', buttonCase: 'upper', buttonFill: '#00b0ff', buttonText: '#0b1f2a' } } }
  }
  /** A theme that keeps all of it, as lane D's Keep my site draws one. */
  const KEPT: SiteImportFidelityTheme = {
    from: 'theme',
    light: { ground: '#ffffff', paper: '#f5f5f5', brand: '#00b0ff', onBrand: '#0b1f2a', ink: '#000000' },
    dark: { ground: '#2b2f36', paper: '#353a42', brand: '#00b0ff', onBrand: '#0b1f2a', ink: '#ffffff' },
    button: { fill: '#00b0ff', label: '#0b1f2a', case: 'upper' },
  }
  /** The built Home with its hero words held to a share of their section, as the compile sets them. */
  const heldTo = (share: string) =>
    changed(page('home').tree, (nodes) => {
      const title = idsOf(nodes, (node) => node.props?.['component'] === 'h1')[0] as string
      const box = holders({ rootId: '_@_', nodes }, title).find((id) => (nodes[id] as Nodes[string]).sx?.['maxWidth'] !== undefined) as string
      ;(nodes[box] as Nodes[string]).sx = { ...(nodes[box] as Nodes[string]).sx, maxWidth: { xs: '100%', md: share } }
    })
  const keep = (tree: SiteImportFidelityTree, theme: SiteImportFidelityTheme) => siteImportFidelity(source(), tree, { finish: 'keep', theme })

  it('keeps the page whole where the theme and the build keep the source’s look', () => {
    const report = keep(heldTo('50%'), KEPT)
    expect(report.ground).toMatchObject({ source: 11, built: 11, ratio: 1, theme: 'theme' })
    expect(report.measure).toEqual({ source: 1, built: 1, ratio: 1, shares: { source: 0.5, built: 0.5 } })
    expect(report.buttons).toMatchObject({ source: 3, built: 3, ratio: 1, case: { source: 3, built: 3, ratio: 1 }, fill: { ratio: 1 } })
    expect(report.readable?.ratio).toBe(1)
    expect(report.score).toBe(1)
    expect(siteImportFidelityHolds(report)).toBe(true)
  })

  it('a near-black dark ground: the closer’s slate drawn on #0d1117', () => {
    const report = keep(heldTo('50%'), { ...KEPT, dark: { ...(KEPT.dark as NonNullable<SiteImportFidelityTheme['dark']>), ground: '#0d1117' } })
    expect(siteImportOklabDelta('#2b2f36', '#0d1117')).toBeGreaterThan(0.05)
    expect(report.ground).toMatchObject({ source: 11, built: 10 })
    expect(report.ground?.worst).toBeGreaterThan(0.05)
    expect(report.lowest).toBe('ground')
    expect(siteImportFidelityHolds(report)).toBe(false)
  })

  it('sentence-case buttons where the source sets them in capitals', () => {
    const report = keep(heldTo('50%'), { ...KEPT, button: { ...KEPT.button, case: 'none' } })
    expect(report.buttons.case).toEqual({ source: 3, built: 0, ratio: 0 })
    expect(report.buttons.built).toBe(0)
    expect(report.lowest).toBe('buttons')
    expect(siteImportFidelityHolds(report)).toBe(false)
    // A button that sets its own case is read by its own.
    const own = siteImportFidelity(
      source(),
      changed(heldTo('50%'), (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiButton')) (nodes[id] as Nodes[string]).sx = { ...(nodes[id] as Nodes[string]).sx, textTransform: 'uppercase' }
      }),
      { finish: 'keep', theme: { ...KEPT, button: { ...KEPT.button, case: 'none' } } },
    )
    expect(own.buttons.case?.ratio).toBe(1)
  })

  it('a deepened button fill: the cyan drawn as #0970a4', () => {
    const report = keep(heldTo('50%'), { ...KEPT, light: { ...KEPT.light, brand: '#0970a4', onBrand: '#ffffff' }, button: { fill: null, label: null, case: 'upper' } })
    expect(report.buttons.fill?.built).toBeLessThan(report.buttons.fill?.source as number)
    expect(report.buttons.ratio).toBeLessThan(1)
    expect(report.lowest).toBe('buttons')
    expect(siteImportFidelityHolds(report)).toBe(false)
  })

  it('a wider heading measure: the hero heading at 72% of its section where the source holds it to half', () => {
    const report = keep(heldTo('72%'), KEPT)
    expect(report.measure).toEqual({ source: 1, built: 0, ratio: 0, shares: { source: 0.5, built: 0.72 } })
    expect(report.lowest).toBe('measure')
    expect(siteImportFidelityHolds(report)).toBe(false)
    // The compile now holds Home's words to the width step its 920 px measure maps to (md).
    expect(siteImportFidelity(page('home').source, page('home').tree, { finish: 'keep', theme: KEPT }).measure?.ratio).toBe(1)
  })

  it('holds the recorded page’s own ground and fill on the theme the look pass now draws', () => {
    // Keep's look keeps its dark band's own ground. Its 10/29 white label cannot be read on its cyan, so the
    // reading rule deepens that fill, and a fill the source's own label cannot be read on is not a loss.
    const theme = siteImportReplayTheme('home')
    const report = siteImportFidelity(page('home').source, page('home').tree, { finish: 'keep', theme })
    expect(report.ground?.ratio).toBe(1)
    expect(report.buttons.fill?.ratio).toBe(1)
  })

  it('leaves all four free under Improve it', () => {
    const report = siteImportFidelity(source(), heldTo('72%'), { finish: 'improve', theme: { ...KEPT, dark: { ...(KEPT.dark as NonNullable<SiteImportFidelityTheme['dark']>), ground: '#0d1117' }, button: { fill: '#0970a4', label: '#ffffff', case: 'none' } } })
    expect(report.score).toBe(1)
    expect(report.buttons).not.toHaveProperty('case')
    expect(report.ground?.ratio).toBeLessThan(1)
    expect(report.measure?.ratio).toBe(0)
    expect(siteImportFidelityHolds(report)).toBe(true)
  })
})

describe('Keep my site sees an alignment and a box the source did not draw (AGL-4152)', () => {
  it('align: a section the source sets at the start, centered', () => {
    const { source, tree } = page('home')
    const at = source.layout.sections.findIndex((section, index) => index > 0 && section.align === 'start')
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        const root = (nodes[tree.rootId] as Nodes[string]).nodes?.[at] as string
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiTypography')) {
          if (holders({ rootId: tree.rootId, nodes }, id).includes(root)) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['align'] = 'center'
        }
      }),
      { finish: 'keep' },
    )
    expect(report.align?.built).toBe((report.align?.source as number) - 1)
    expect(report.lowest).toBe('align')
    expect(siteImportFidelityHolds(report)).toBe(false)
  })

  it('boxed: a boxed group drawn open, as the recorded answer’s ruled style draws it on an improved page', () => {
    // Kept, the compile holds the source's boxes whatever the answer says.
    const kept = page('home', { answer: SITE_IMPORT_REPLAY_HOME_ANSWER as Record<string, unknown> })
    expect(siteImportFidelity(kept.source, kept.tree, { finish: 'keep' }).boxed?.ratio).toBe(1)
    // Improved, the answer's ruled style draws a boxed group open: Keep's measure sees it.
    const arranged = page('home', { answer: SITE_IMPORT_REPLAY_HOME_ANSWER as Record<string, unknown>, finish: 'improve' })
    const report = siteImportFidelity(arranged.source, arranged.tree, { finish: 'keep' })
    expect(report.boxed?.built).toBeLessThan(report.boxed?.source as number)
    expect(siteImportFidelityHolds(report)).toBe(false)
    // Under Improve it the style is the answer's to choose.
    expect(siteImportFidelityHolds(siteImportFidelity(arranged.source, arranged.tree, { finish: 'improve' }))).toBe(true)
  })

  it('boxed: cards drawn open, the open groups still open', () => {
    const { source, tree } = page('home')
    const groupsOf = (nodes: readonly SiteImportLayoutNode[]): Array<Extract<SiteImportLayoutNode, { kind: 'group' }>> =>
      nodes.flatMap((node) => (node.kind === 'group' ? [node] : node.kind === 'row' ? node.cells.flatMap((cell) => groupsOf(cell.nodes)) : []))
    const scored = source.layout.sections.flatMap((section) => groupsOf(section.nodes)).filter((group) => !group.inline && group.group !== 'faq' && group.group !== 'text')
    expect(scored.filter((group) => group.boxed).length).toBe(4)
    const report = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiCard')) (nodes[id] as Nodes[string]).componentId = 'muiStack'
      }),
      { finish: 'keep' },
    )
    expect(report.boxed).toEqual({ source: scored.length, built: scored.length - 4, ratio: (scored.length - 4) / scored.length })
    expect(report.lowest).toBe('boxed')
  })
})

describe('Improve it: what it may change is free, and better is better on every line (AGL-4152)', () => {
  it('bands and widths changed: below the bar kept, whole improved', () => {
    const { source, tree } = page('home')
    const redrawn = changed(tree, (nodes) => {
      for (const id of (nodes[tree.rootId] as Nodes[string]).nodes ?? []) {
        const node = nodes[id] as Nodes[string]
        delete (node.props as Record<string, unknown>)['colorScheme']
        node.sx = { ...node.sx, bgcolor: 'background.paper' }
      }
      for (const id of idsOf(nodes, (node) => node.componentId === 'muiContainer')) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['maxWidth'] = 'lg'
    })
    expect(siteImportFidelity(source, redrawn, { finish: 'keep' }).score).toBeLessThan(SITE_IMPORT_FIDELITY_THRESHOLD)
    const improved = siteImportFidelity(source, redrawn, { finish: 'improve' })
    expect(improved.score).toBe(1)
    expect(improved.bands?.ratio).toBeLessThan(1)
    expect(improved.widths?.ratio).toBeLessThan(1)
    expect(siteImportFidelityHolds(improved)).toBe(true)
  })

  /** /pricing with its sections' bands redrawn, one by one. */
  const pricingIn = (bands: ReadonlyArray<'plain' | 'soft'>) => {
    const { source, tree } = page('livePricing')
    return siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        ;((nodes[tree.rootId] as Nodes[string]).nodes ?? []).forEach((id, index) => {
          const node = nodes[id] as Nodes[string]
          node.sx = bands[index] === 'soft' ? { ...node.sx, bgcolor: 'background.paper' } : Object.fromEntries(Object.entries(node.sx ?? {}).filter(([key]) => key !== 'bgcolor'))
        })
      }),
      { finish: 'improve' },
    )
  }

  it('better: the same page with its sections set apart, band after band', () => {
    const report = pricingIn(['plain', 'soft', 'plain', 'soft', 'plain', 'soft', 'plain'])
    expect(report.design?.rhythm).toEqual({ source: 0.333, built: 1 })
    expect(report.design?.better).toBe(true)
  })

  it('different alone is not better: the bands moved, set apart no more often', () => {
    // The source is plain, plain, plain, plain, soft, plain, plain: two neighbors set apart of six.
    const report = pricingIn(['soft', 'plain', 'plain', 'plain', 'plain', 'plain', 'plain'])
    expect(report.design?.rhythm).toEqual({ source: 0.333, built: 0.167 })
    expect(report.design?.better).toBe(false)
    const same = pricingIn(['plain', 'plain', 'soft', 'plain', 'plain', 'plain', 'plain'])
    expect(same.design?.rhythm?.built).toBe(same.design?.rhythm?.source)
    expect(same.design?.better).toBe(false)
  })

  it('measure: words run no wider than lg, and a long read no wider than md', () => {
    const { source, tree } = page('home')
    const narrowed = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        for (const id of idsOf(nodes, (node) => node.componentId === 'muiContainer' && node.props?.['maxWidth'] === 'xl')) ((nodes[id] as Nodes[string]).props as Record<string, unknown>)['maxWidth'] = 'lg'
      }),
      { finish: 'improve' },
    )
    expect(narrowed.design?.measure).toEqual({ source: 0, built: 1 })
    expect(narrowed.design?.better).toBe(true)
  })
})

describe('improved words: facts, lines and meaning (G4)', () => {
  /** A line of a recorded page that is its own paragraph, the first one `test` takes. */
  const lineOf = (name: SiteLayoutPageName, test: (text: string) => boolean): number => {
    const doc = siteImportReplayDocument(name)
    const buttons = new Set<number>()
    const walk = (nodes: readonly SiteImportLayoutNode[]): void => {
      for (const node of nodes) {
        if (node.kind === 'line' && node.button) buttons.add(node.line)
        if (node.kind === 'row') for (const cell of node.cells) walk(cell.nodes)
        if (node.kind === 'group') for (const item of node.items) for (const cta of item.ctas ?? []) buttons.add(cta.line)
      }
    }
    for (const section of doc.layout?.sections ?? []) walk(section.nodes)
    const at = doc.blocks.findIndex((block, index) => block.kind === 'paragraph' && !buttons.has(index) && test(block.text))
    expect(at).toBeGreaterThanOrEqual(0)
    return at
  }
  const improved = (name: SiteLayoutPageName, wording: Array<{ line: number; text: string }>) => {
    const built = siteImportReplayPage(name, { finish: 'improve', words: 'improved', wording, ...(name === 'contact' ? { forms: FORM } : {}) })
    expect(built.violations).toEqual([])
    return siteImportFidelity(built.source, built.tree, { finish: 'improve', words: 'improved' })
  }
  const textOf = (name: SiteLayoutPageName, line: number) => String((siteImportReplayDocument(name).blocks[line] as { text?: string }).text)

  it('a clean rewrite: every line placed once, every fact kept, its meaning kept, the structure whole', () => {
    const line = lineOf('home', (text) => text.split(' ').length > 12 && !/\d/.test(text))
    const words = textOf('home', line).split(' ')
    const report = improved('home', [{ line, text: [...words.slice(words.length / 2), ...words.slice(0, words.length / 2)].join(' ') }])
    expect(report.lines).toMatchObject({ ratio: 1, extra: 0 })
    expect(report.facts?.ratio).toBe(1)
    expect(report.meaning).toMatchObject({ lines: 1, below: 0 })
    expect(report.words.ratio).toBe(1)
    expect(report.score).toBe(1)
    expect(siteImportFidelityHolds(report)).toBe(true)
    // Scored as written, the same page loses the line and its structure with it.
    expect(siteImportFidelity(page('home').source, siteImportReplayPage('home', { wording: [{ line, text: 'Something else entirely' }] }).tree).words.ratio).toBeLessThan(1)
  })

  it('facts: a price the rewrite dropped', () => {
    const line = lineOf('livePricing', (text) => /\$\d/.test(text) && text.split(' ').length > 4)
    const price = /\$\d+(?:[.,]\d+)*/.exec(textOf('livePricing', line))?.[0] as string
    const report = improved('livePricing', [{ line, text: textOf('livePricing', line).replace(price, 'a fair price') }])
    expect(report.facts?.ratio).toBeLessThan(1)
    expect(report.facts?.examples.missing).toContain(`number:${price}`)
    expect(report.lines?.ratio).toBe(1)
    expect(siteImportFidelityHolds(report)).toBe(false)
  })

  it('facts: a name or a number the rewrite made up', () => {
    const line = lineOf('home', (text) => text.split(' ').length > 12 && !/\d/.test(text))
    const report = improved('home', [{ line, text: `${textOf('home', line)} Trusted by Zorblatt in 4,000 towns.` }])
    expect(report.facts?.examples.extra).toEqual(expect.arrayContaining(['number:4,000', 'name:Zorblatt']))
    expect(report.facts?.ratio).toBeLessThan(1)
  })

  it('meaning: a line rewritten into words of its own is flagged under 0.4', () => {
    const line = lineOf('home', (text) => text.split(' ').length > 12 && !/\d/.test(text))
    const report = improved('home', [{ line, text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed tempor incididunt.' }])
    expect(report.lines?.ratio).toBe(1)
    expect(report.meaning).toMatchObject({ lines: 1, below: 1, ratio: 0 })
    expect(report.meaning?.examples[0]?.line).toBe(line)
    expect(report.meaning?.examples[0]?.kept).toBeLessThan(0.4)
    expect(siteImportFidelityHolds(report)).toBe(false)
  })

  it('lines: a line the rewrite dropped, and one it added', () => {
    const { source, tree } = siteImportReplayPage('home', { finish: 'improve', words: 'improved' })
    const line = idsOf(tree.nodes as Nodes, (node) => node.componentId === 'muiTypography' && node.props?.['variant'] === 'body1')[0] as string
    const dropped = siteImportFidelity(source, changed(tree, (nodes) => drop(nodes, line)), { finish: 'improve', words: 'improved' })
    expect(dropped.lines?.built).toBe((dropped.lines?.source as number) - 1)
    const added = siteImportFidelity(
      source,
      changed(tree, (nodes) => {
        nodes['added'] = { componentId: 'muiTypography', props: { children: 'A line no source ever said.', variant: 'body1' } }
        ;(nodes[(nodes[tree.rootId] as Nodes[string]).nodes?.[1] as string] as Nodes[string]).nodes?.push('added')
      }),
      { finish: 'improve', words: 'improved' },
    )
    expect(added.lines).toMatchObject({ extra: 1 })
    expect(added.lines?.ratio).toBeLessThan(1)
  })
})

describe('the theme a page is drawn in (AGL-4152)', () => {
  const theme = {
    colorSchemes: {
      light: { background: { default: '#FFF', paper: '#f5f5f5' }, primary: { main: '#0970a4', contrastText: '#ffffff' }, text: { primary: '#111111' } },
      dark: { background: { default: '#2b2f36', paper: '#353a42' }, primary: { main: '#7fd3ff', contrastText: '#0b1f2a' }, text: { primary: '#f5f5f5' } },
    },
    typography: { variants: { button: { textTransform: 'none' } } },
    components: { MuiButton: { variants: [{ props: { variant: 'contained' }, style: { backgroundColor: '#00b0ff', color: 'primary.contrastText' } }], styleOverrides: { root: { textTransform: 'uppercase' } } } },
  }

  it('reads each scheme’s grounds, brand and ink, and a filled button’s own fill, label and case', () => {
    expect(siteImportFidelityThemeOf(theme)).toEqual({
      from: 'theme',
      light: { ground: '#ffffff', paper: '#f5f5f5', brand: '#0970a4', onBrand: '#ffffff', ink: '#111111' },
      dark: { ground: '#2b2f36', paper: '#353a42', brand: '#7fd3ff', onBrand: '#0b1f2a', ink: '#f5f5f5' },
      // The component's case over the Text Style's.
      button: { fill: '#00b0ff', label: '#ffffff', case: 'upper' },
    })
  })

  it('falls back to the Text Style’s case, and to no fill of its own, and says where it came from', () => {
    const plain = siteImportFidelityThemeOf({ ...theme, components: {} }, 'style')
    expect(plain).toMatchObject({ from: 'style', button: { fill: null, label: null, case: 'none' } })
    expect(siteImportFidelityThemeOf({})).toBeNull()
  })

  it('measures colors apart in OKLab', () => {
    expect(siteImportOklabDelta('#ffffff', '#ffffff')).toBe(0)
    expect(siteImportOklabDelta('#ffffff', '#f5f5f5')).toBeLessThan(0.05)
    expect(siteImportOklabDelta('#00b0ff', '#0970a4')).toBeGreaterThan(0.05)
  })
})
