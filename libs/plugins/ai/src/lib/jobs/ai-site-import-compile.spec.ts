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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_LAYOUT_DESIGN_TOOL } from '../layout-language/ai-layout-language'
import type { AiLayoutRawTree } from '../layout-language/ai-layout-tree'
import { AI_MODEL_CATALOG, aiCatalogEntry } from '../providers/catalog'
import { resolveAiRoute } from '../providers/routing'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { extractSiteImportPage, type SiteImportBlock } from '../site-import/site-import-html'
import { siteImportLayout, siteImportLayoutCounts } from '../site-import/site-import-layout'
import { siteImportPageRead } from '../site-import/site-import-page'
import { aiPageWithoutLinksTo } from './ai-site-publish'
import { aiSiteImportUnbuilt } from './ai-site-import-publish'
import { aiImportedPageCheck, aiLayoutDesignPrompt } from './ai-job-page-language'
import {
  aiCompileImportedPage,
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

  it('draws "Explore the platform" as 13 of the theme’s cards in 3 columns, each with its icon, each a link to its page', () => {
    const explore = under(tree, sections[3].id)
    const cards = ofKind(tree, explore, 'muiCard')
    expect(cards).toHaveLength(13)
    for (const card of cards) expect(ofKind(tree, under(tree, card), 'icon')).toHaveLength(1)
    const linked = ofKind(tree, explore, 'muiLinkBox')
    expect(linked).toHaveLength(13)
    expect(linked.map((id) => tree.nodes[id].props?.['screenId'])).toContain('p-product-besigner')
    const cells = explore.filter((id) => tree.nodes[id].componentId === 'muiGrid' && tree.nodes[id].props?.['size'] === 'xs:12 md:4')
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

  it('draws the hero it chose, beside the source’s picture, and the group style it chose, every word still once', () => {
    const { doc, stored, violations } = build('home', answer)
    expect(violations).toEqual([])
    expect(tally(shownWords(stored))).toEqual(tally(sourceLines(doc)))
    const nodes = Object.values(stored)
    // A split hero: the words and the picture side by side.
    expect(nodes.some((node) => node.componentId === 'muiGrid' && node.props?.['size'] === 'xs:12 md:6')).toBe(true)
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
