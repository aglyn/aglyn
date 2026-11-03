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
 * The layout reader over recorded pages (AGL-4106): the source's sections,
 * bands, rows, groups and their kinds, tables, tabs, pictures, icons and
 * buttons, read by code over the page's own lines.
 *
 * On 10/29 an import of aglyn.com came out one column: its home page was 140
 * lines cut into 10 sections at every `h2`, nine eyebrows in the wrong
 * section, no card, no icon, one picture of two. These rows are the source
 * as it is laid out, which the compile draws from.
 */

import {
  AI_SITE_IMPORT_LAYOUT_MAX_CHARS,
  siteImportLayoutChars,
  siteImportLayoutLines,
  siteImportLayoutWithin,
  type SiteImportLayout,
  type SiteImportLayoutGroup,
  type SiteImportLayoutNode,
  type SiteImportLayoutTable,
  type SiteImportLayoutTabs,
} from '../model/ai-site-import'
import { extractSiteImportPage, type SiteImportBlock } from './site-import-html'
import { siteImportLayout, siteImportLayoutCounts, siteImportLookOfHtml } from './site-import-layout'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from './fixtures/site-layout-recordings'

interface Read {
  layout: SiteImportLayout
  main: SiteImportBlock[]
  text: (ref: number) => string
}

const reads = new Map<SiteLayoutPageName, Read>()

function read(name: SiteLayoutPageName): Read {
  const held = reads.get(name)
  if (held) return held
  const page = extractSiteImportPage(siteLayoutRecording(name), SITE_LAYOUT_PAGES[name].url, siteLayoutSameSite(name), { structure: true })
  const layout = siteImportLayout(page as Parameters<typeof siteImportLayout>[0])
  if (!layout) throw new Error(`no layout for ${name}`)
  const main = page.blocks.filter((block) => block.region === 'main')
  const text = (ref: number) => {
    const block = main[ref]
    return !block ? '' : block.kind === 'image' ? block.alt : block.text
  }
  const out = { layout, main, text }
  reads.set(name, out)
  return out
}

/** Every node of a kind, anywhere in a list of nodes. */
function all<K extends SiteImportLayoutNode['kind']>(nodes: readonly SiteImportLayoutNode[], kind: K): Array<Extract<SiteImportLayoutNode, { kind: K }>> {
  const out: Array<Extract<SiteImportLayoutNode, { kind: K }>> = []
  const visit = (list: readonly SiteImportLayoutNode[]) => {
    for (const node of list) {
      if (node.kind === kind) out.push(node as Extract<SiteImportLayoutNode, { kind: K }>)
      if (node.kind === 'row') for (const cell of node.cells) visit(cell.nodes)
      if (node.kind === 'tabs') for (const tab of node.tabs) visit(tab.panel)
    }
  }
  visit(nodes)
  return out
}

const groupsOf = (name: SiteLayoutPageName) => read(name).layout.sections.flatMap((section) => all(section.nodes, 'group'))
const sectionNamed = (name: SiteLayoutPageName, label: string) => {
  const section = read(name).layout.sections.find((entry) => entry.name === label)
  if (!section) throw new Error(`no section ${label}`)
  return section
}

/** Whether a value holds an array directly inside an array, which Firestore refuses. */
function hasUndefined(value: unknown): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.some(hasUndefined)
  if (value && typeof value === 'object') return Object.values(value).some(hasUndefined)
  return false
}

function hasNestedArray(value: unknown, inArray = false): boolean {
  if (Array.isArray(value)) return inArray || value.some((entry) => hasNestedArray(entry, true))
  if (value && typeof value === 'object') return Object.values(value).some((entry) => hasNestedArray(entry, false))
  return false
}

/** Whether a block is a line of the page: a link inside a sentence is in its sentence. */
const isLine = (block: SiteImportBlock) => (block.kind === 'image' ? !!block.url : block.kind === 'link' ? !block.inline : !!block.text.trim())

describe.each(Object.keys(SITE_LAYOUT_PAGES) as SiteLayoutPageName[])('%s: every line placed once', (name) => {
  it('places every line of the page exactly once, in a section', () => {
    const { layout, main } = read(name)
    const placed = layout.sections.flatMap((section) => section.lines)
    const expected = main.flatMap((block, index) => (isLine(block) ? [index] : []))
    expect([...placed].sort((a, b) => a - b)).toEqual(expected)
    // A film playing behind a section's words places its poster there first (AGL-4140).
    for (const section of layout.sections) {
      const behind = section.backdrop?.kind === 'video' && section.backdrop.poster !== undefined ? [section.backdrop.poster] : []
      expect([...behind, ...siteImportLayoutLines(section.nodes)]).toEqual(section.lines)
    }
  })

  it('reads the same blocks with its structure kept as without', () => {
    const html = siteLayoutRecording(name)
    const { url } = SITE_LAYOUT_PAGES[name]
    expect(extractSiteImportPage(html, url, siteLayoutSameSite(name), { structure: true }).blocks).toEqual(extractSiteImportPage(html, url, siteLayoutSameSite(name)).blocks)
  })

  it('fits one page’s layout budget on the job document', () => {
    expect(siteImportLayoutChars(read(name).layout)).toBeLessThanOrEqual(AI_SITE_IMPORT_LAYOUT_MAX_CHARS)
  })

  it('is a value the Firestore job document it rides can hold: no array inside an array, nothing undefined', () => {
    expect(hasNestedArray(read(name).layout)).toBe(false)
    expect(hasUndefined(read(name).layout)).toBe(false)
  })
})

describe('aglyn.com home', () => {
  it('reads its 11 sections by their own names, in the source’s bands', () => {
    const { layout } = read('home')
    expect(layout.sections.map((section) => section.name)).toEqual([
      'Introduction',
      'Who it’s for'.replace('’', "'"),
      'What Aglyn is',
      'Explore the platform',
      'How it works',
      'For agencies and multi-brand teams',
      'What a portfolio gets',
      "What's included",
      'Start building',
      'Frequently asked questions',
      'Get started',
    ])
    expect(layout.sections.map((section) => section.band)).toEqual(['plain', 'soft', 'plain', 'soft', 'plain', 'soft', 'plain', 'soft', 'soft', 'soft', 'dark'])
    expect(layout.sections.every((section) => section.from === 'landmark')).toBe(true)
    expect(layout.sections[10]?.backdrop).toEqual({ kind: 'gradient' })
  })

  it('keeps the eyebrow that opens a section in it, nine times', () => {
    const { layout, text } = read('home')
    const eyebrows = layout.sections.flatMap((section) => all(section.nodes, 'line').filter((line) => line.role === 'eyebrow').map((line) => ({ section: section.name, text: text(line.line), first: section.lines[0] === line.line })))
    expect(eyebrows.map((entry) => entry.text)).toEqual([
      'BUILD A WEBSITE · FREE TO START · NO CODE',
      'WHO BUILDS WEBSITES ON AGLYN',
      'WHY AGLYN',
      'EVERYTHING YOU NEED TO BUILD A WEBSITE',
      'HOW TO BUILD A WEBSITE WITH AGLYN',
      'FOR AGENCIES & MULTI-BRAND TEAMS',
      'WHAT WILL YOU BUILD?',
      'BUILD A WEBSITE FOR FREE',
      'START BUILDING',
      'BEFORE YOU START',
    ])
    expect(eyebrows.every((entry) => entry.first)).toBe(true)
  })

  it('reads the hero with its words, its two buttons and its picture below them', () => {
    const { layout, text, main } = read('home')
    const hero = layout.sections[0]
    expect(hero?.hero).toEqual({ picture: 'below' })
    expect(hero?.align).toBe('center')
    const buttons = all(hero?.nodes ?? [], 'line').filter((line) => line.button)
    expect(buttons.map((line) => [text(line.line), line.button])).toEqual([
      ['Build my website free', 'primary'],
      ['Watch the 40-second film', 'secondary'],
    ])
    // The film's play button over its poster is the film (AGL-4140): one video, its poster the picture
    // inside it, in the box the source shadows, and no picture of its own beside it.
    expect(all(hero?.nodes ?? [], 'picture')).toEqual([])
    const [film] = all(hero?.nodes ?? [], 'video')
    expect(film).toMatchObject({ kind: 'video', video: 0, shadow: true })
    expect(main[film?.poster ?? -1]).toMatchObject({ kind: 'image', url: 'https://aglyn.com/api/media/cdn/org:FixtureOrg:FixtureHst/v2sbemHaD1' })
    expect(hero?.lines).toContain(film?.poster)
  })

  it('reads "Explore the platform" as 13 cards in 3 columns, each with its icon, its title and its link', () => {
    const [grid] = all(sectionNamed('home', 'Explore the platform').nodes, 'group')
    const { text } = read('home')
    expect(grid).toMatchObject({ group: 'cards', columns: 3, boxed: true })
    expect(grid?.items).toHaveLength(13)
    expect(grid?.items.every((item) => item.icon !== undefined && item.title !== undefined && item.text?.length === 1 && item.to?.startsWith('https://aglyn.com/product/'))).toBe(true)
    expect(new Set(grid?.items.map((item) => item.icon)).size).toBe(13)
    expect(grid?.items.map((item) => text(item.title as number)).slice(0, 3)).toEqual(['Besigner', 'Console', 'Commerce'])
  })

  it('reads "Who it’s for" and "Start building" as three cards each, with an icon and a "See …" link', () => {
    for (const name of ["Who it's for", 'Start building']) {
      const [cards] = all(sectionNamed('home', name).nodes, 'group')
      expect(cards).toMatchObject({ group: 'cards', columns: 3 })
      expect(cards?.items).toHaveLength(3)
      for (const item of cards?.items ?? []) {
        expect(item.icon).toBeDefined()
        expect(item.link).toHaveLength(1)
        expect(read('home').text((item.link as number[])[0] as number)).toMatch(/→$/)
      }
    }
  })

  it('reads the FAQ as 11 questions and answers, the steps as three numbered steps', () => {
    const { text } = read('home')
    const [faq] = all(sectionNamed('home', 'Frequently asked questions').nodes, 'group')
    expect(faq).toMatchObject({ group: 'faq', columns: 2 })
    expect(faq?.items).toHaveLength(11)
    expect(faq?.items.every((item) => text(item.title as number).endsWith('?') && item.text?.length === 1)).toBe(true)
    const [steps] = all(sectionNamed('home', 'How it works').nodes, 'group')
    expect(steps?.group).toBe('steps')
    expect(steps?.items.map((item) => [text(item.figure as number), text(item.title as number)])).toEqual([
      ['01', 'Describe'],
      ['02', 'Edit'],
      ['03', 'Publish'],
    ])
  })

  it('reads "For agencies" as a wide and a narrow column, the words beside the picture', () => {
    const [row] = all(sectionNamed('home', 'For agencies and multi-brand teams').nodes, 'row')
    expect(row?.cols).toEqual([4, 8])
    expect(all(row?.cells[0]?.nodes ?? [], 'group')[0]).toMatchObject({ group: 'cards' })
    expect(all(row?.cells[1]?.nodes ?? [], 'picture')).toHaveLength(1)
  })

  it('counts what the page is made of: 2 pictures, 3 buttons, the icons, and every "→" line a link', () => {
    const { layout, main } = read('home')
    const counts = siteImportLayoutCounts(layout, main)
    expect(counts).toMatchObject({ sections: 11, pictures: 2, buttons: 3, lines: 142 })
    expect(counts.groups).toEqual({ cards: 5, steps: 1, list: 1, faq: 1 })
    expect(counts.icons).toBeGreaterThanOrEqual(13 + 3 + 3 + 3 + 12)
    // 10/29: 14 "See … →" lines came out as plain words; every one is a link with its address.
    for (const block of main) if (block.kind !== 'image' && /→\s*$/.test(block.text)) expect(block.kind).toBe('link')
  })

  it('reads the look: Roboto Flex, the buttons’ #00b0ff with 4 px corners, the links’ #0077ad, the grey page', () => {
    expect(read('home').layout.look).toEqual({
      fonts: { body: 'Roboto Flex', headings: 'Roboto Flex', google: [] },
      background: '#f5f5f5',
      text: '#000000',
      buttonFill: '#00b0ff',
      buttonText: '#ffffff',
      buttonRadius: 4,
      link: '#0077ad',
      header: '#f5f5f5',
    })
    expect(siteImportLookOfHtml(siteLayoutRecording('home'), SITE_LAYOUT_PAGES.home.url)).toEqual(read('home').layout.look)
  })
})

describe('aglyn.com /product', () => {
  const groups = () => groupsOf('product')
  const { text } = { text: (ref: number) => read('product').text(ref) }

  it('reads the strip of eight site kinds, three feature cards, the 13 products, three steps and four figures', () => {
    const kinds = groups().map((group) => `${group.group}:${group.items.length}`)
    expect(kinds).toEqual(['logos:8', 'cards:3', 'cards:3', 'cards:13', 'steps:3', 'stats:4', 'pricing:3', 'faq:7'])
    const stats = groups().find((group) => group.group === 'stats') as SiteImportLayoutGroup
    expect(stats.items.map((item) => text(item.figure as number))).toEqual(['1', 'All', '0', '1-click'])
  })

  it('reads three pricing cards, each a price, a call to action and its features with a check mark, 12 in all', () => {
    const pricing = groups().find((group) => group.group === 'pricing') as SiteImportLayoutGroup
    expect(pricing.items.map((item) => [text(item.title as number), text(item.figure as number)])).toEqual([
      ['Free', '$0'],
      ['Pro', '$56'],
      ['Business', '$139'],
    ])
    expect(pricing.items.every((item) => item.listIcon !== undefined && item.link?.length === 1)).toBe(true)
    expect(pricing.items.reduce((total, item) => total + (item.list?.length ?? 0), 0)).toBe(12)
  })

  it('places its pictures: the hero, the film poster and the console beside its words', () => {
    const { layout, main } = read('product')
    expect(siteImportLayoutCounts(layout, main).pictures).toBe(3)
    const [row] = all(sectionNamed('product', 'One console').nodes, 'row')
    expect(all(row?.cells[1]?.nodes ?? [], 'picture')).toHaveLength(1)
    expect(layout.sections[0]?.hero).toEqual({ picture: 'below' })
  })
})

describe('aglyn.com /pricing', () => {
  it('reads its tab strips with their labels, the selected tab’s plans as pricing cards', () => {
    const { layout, text } = read('pricing')
    const tabs = layout.sections.flatMap((section) => all(section.nodes, 'tabs')) as SiteImportLayoutTabs[]
    expect(tabs.length).toBeGreaterThanOrEqual(2)
    expect(tabs[0]?.tabs.map((tab) => text(tab.label as number))).toEqual(['Monthly', 'Annual · save up to 35%'])
    expect(tabs[0]?.tabs[1]?.selected).toBe(true)
    const plans = all(tabs[0]?.tabs[1]?.panel ?? [], 'group')[0]
    expect(plans).toMatchObject({ group: 'pricing', columns: 4 })
    expect(tabs[1]?.tabs.map((tab) => text(tab.label as number))).toEqual(['Free', 'Starter', 'Pro', 'Business', 'Scale', 'Advanced', 'Agency', 'Enterprise'])
  })

  it('reads the plan table as a table: the plans across, the limits down', () => {
    const { layout, text } = read('pricing')
    const [table] = all(sectionNamed('pricing', 'What each plan actually includes.').nodes, 'table') as SiteImportLayoutTable[]
    expect(table?.header).toBe(true)
    expect(table?.rows).toHaveLength(14)
    expect(table?.rows[0]?.cells.slice(1).map((cell) => text(cell.lines[0] as number))).toEqual(['Free', 'Starter', 'Pro', 'Business', 'Scale', 'Advanced', 'Agency', 'Enterprise'])
    expect(layout.sections.some((section) => all(section.nodes, 'group').some((group) => group.group === 'faq' && group.items.length === 11))).toBe(true)
  })
})

describe('aglyn.com /pricing as a live import fell short of it (AGL-4083)', () => {
  const { layout, text } = read('livePricing')
  const tabs = layout.sections.flatMap((section) => all(section.nodes, 'tabs')) as SiteImportLayoutTabs[]
  const groups = all(tabs[0]?.tabs[1]?.panel ?? [], 'group')
  const plans = groups[0] as SiteImportLayoutGroup
  const higher = groups[1] as SiteImportLayoutGroup
  const said = (ref: number | undefined) => (ref === undefined ? undefined : text(ref))

  it('finds every plan’s button wherever it sits, as the source draws it', () => {
    // A plain line sits under the button of every plan but Free's, and left the button in the plan's words.
    expect(plans.items.map((item) => item.ctas?.map((cta) => [text(cta.line), cta.style]))).toEqual([
      [['Get started', 'secondary']],
      [['Choose', 'secondary']],
      [['Start Pro', 'primary']],
      [['Choose', 'secondary']],
    ])
    for (const item of plans.items) {
      expect(item.link).toEqual(item.ctas?.map((cta) => cta.line))
      expect(item.text?.some((ref) => item.link?.includes(ref))).toBe(false)
    }
  })

  it('reads the tag on a plan as its tag, and what a price is for as its period', () => {
    expect(plans.items.map((item) => [said(item.title), said(item.figure), said(item.period), said(item.badge)])).toEqual([
      ['Free', '$0', undefined, undefined],
      ['Starter', '$16', undefined, undefined],
      ['Pro', '$39', '/mo', 'POPULAR'],
      ['Business', '$99', '/mo', undefined],
    ])
    expect(plans.items[2]?.text?.map(text)).toEqual(['$468 billed yearly', 'For pros running a few sites.', 'Everything in Starter, plus:'])
  })

  it('keeps every line of an item in exactly one of its parts', () => {
    for (const group of [plans, higher]) {
      for (const item of group.items) {
        const parts = [item.title, item.figure, item.period, item.badge, item.image, ...(item.text ?? []), ...(item.list ?? []), ...(item.link ?? [])].filter((ref) => ref !== undefined)
        expect([...parts].sort((a, b) => (a as number) - (b as number))).toEqual([...item.lines].sort((a, b) => a - b))
      }
    }
  })

  it('reads the higher plans as rows, and leaves the plan cards as cards', () => {
    expect(plans.inline).toBeUndefined()
    expect(higher).toMatchObject({ group: 'pricing', columns: 1, inline: true })
    expect(higher.items.map((item) => text(item.title as number))).toEqual(['Scale', 'Advanced', 'Agency', 'Enterprise'])
    expect(higher.items.map((item) => item.ctas?.map((cta) => text(cta.line)))).toEqual([['CHOOSE'], ['CHOOSE'], ['CHOOSE'], ['CONTACT SALES']])
  })

  it('reads a plan’s labels and values as rows, six groups of them', () => {
    const rows = all(tabs[1]?.tabs[0]?.panel ?? [], 'group')
    expect(rows.map((group) => [group.group, group.inline, group.items.length])).toEqual([
      ['cards', true, 12],
      ['cards', true, 5],
      ['cards', true, 16],
      ['cards', true, 24],
      ['cards', true, 9],
      ['cards', true, 3],
    ])
    expect([said(rows[0]?.items[4]?.title), ...(rows[0]?.items[4]?.text ?? []).map(text)]).toEqual(['Custom domain & SSL', '—'])
  })

  it('never reads an icon beside its words as a row of parts: that is a card', () => {
    expect(groupsOf('home').some((group) => group.inline)).toBe(false)
    expect(groupsOf('contact').some((group) => group.inline)).toBe(false)
  })
})

describe('how wide the source runs a section (AGL-4083)', () => {
  it('reads aglyn.com’s column from the rule a wider screen applies, on every page', () => {
    for (const name of ['home', 'product', 'pricing', 'livePricing', 'contact'] as const) {
      expect(new Set(read(name).layout.sections.map((section) => section.width))).toEqual(new Set([1536]))
    }
  })

  it('reads a post’s narrower article column as its own', () => {
    expect(read('post').layout.sections.map((section) => section.width)).toEqual([760, 1536, 1536])
  })

  it('reads a framework’s container class where the sheets say nothing', () => {
    expect(new Set(read('pottery').layout.sections.map((section) => section.width))).toEqual(new Set([1320]))
  })

  const widthOf = (html: string) => {
    const page = extractSiteImportPage(`<html><head><style>${html.match(/<style>(.*)<\/style>/)?.[1] ?? ''}</style></head><body><main>${html.replace(/<style>.*<\/style>/, '')}</main></body></html>`, 'https://example.com/', () => true, { structure: true })
    return siteImportLayout(page as Parameters<typeof siteImportLayout>[0])?.sections.map((section) => section.width)
  }

  it('takes the narrowest cap on a section and the wrappers inside it', () => {
    const body = '<section><div class="wide"><div class="measure"><h2>One</h2><p>Words of the section.</p></div></div></section><section><h2>Two</h2><p>Words.</p></section>'
    expect(widthOf(`<style>.wide{max-width:1200px}.measure{max-width:72rem}</style>${body}`)).toEqual([1152, undefined])
  })

  it('leaves a section with no cap unset, and is not read from a percentage or a screen unit', () => {
    const body = '<section class="a"><h2>One</h2><p>Words of the section.</p></section><section class="b"><h2>Two</h2><p>Words.</p></section>'
    expect(widthOf(`<style>.a{max-width:80%}.b{max-width:90vw}</style>${body}`)).toEqual([undefined, undefined])
  })
})

describe('a tag and a button in markup of any site (AGL-4083)', () => {
  const STYLE = '<style>.card{border:1px solid #ddd;display:block}.tag{background-color:#c4622d;border-radius:999px;padding:2px 8px}.plain{color:#333}.btn{padding:10px;background-color:#c4622d}</style>'
  const card = (name: string, tag: string) => `<article class="card"><h3>${name}</h3>${tag}<p>A line of what ${name} is.</p><a class="btn" href="/${name}">Choose</a><p>A line under its button.</p></article>`
  const groupOf = (cards: string) => {
    const page = extractSiteImportPage(`<html><head>${STYLE}</head><body><main><section><h2>Plans</h2><div>${cards}</div></section><section><h2>More</h2><p>Words.</p></section></main></body></html>`, 'https://example.com/', () => true, { structure: true })
    const layout = siteImportLayout(page as Parameters<typeof siteImportLayout>[0]) as SiteImportLayout
    const main = page.blocks.filter((block) => block.region === 'main')
    const text = (ref: number | undefined) => (ref === undefined ? undefined : (main[ref] as { text: string }).text)
    return { group: layout.sections.flatMap((section) => all(section.nodes, 'group'))[0] as SiteImportLayoutGroup, text }
  }

  it('reads a word or two in a filled pill as a tag, however it is worded', () => {
    const { group, text } = groupOf([card('One', '<p class="tag">New</p>'), card('Two', '<p class="tag">Best value</p>'), card('Three', '')].join(''))
    expect(group.items.map((item) => text(item.badge))).toEqual(['New', 'Best value', undefined])
  })

  it('leaves a short line with no fill, or a long one in a pill, in the words', () => {
    const { group, text } = groupOf([card('One', '<p class="plain">New</p>'), card('Two', '<p class="tag">Our most popular plan this year by far</p>'), card('Three', '')].join(''))
    expect(group.items.map((item) => text(item.badge))).toEqual([undefined, undefined, undefined])
  })

  it('takes a button above a closing line as the card’s call to action', () => {
    const { group, text } = groupOf([card('One', ''), card('Two', ''), card('Three', '')].join(''))
    expect(group.items.map((item) => item.ctas?.map((cta) => [text(cta.line), cta.style]))).toEqual([[['Choose', 'primary']], [['Choose', 'primary']], [['Choose', 'primary']]])
  })
})

describe('aglyn.com /contact', () => {
  it('keeps the form where it sat, beside its heading, and the email cards with their mailto: links', () => {
    const { layout, text } = read('contact')
    const [row] = layout.sections.flatMap((section) => all(section.nodes, 'row'))
    expect(all(row?.cells[1]?.nodes ?? [], 'form')).toEqual([{ kind: 'form', form: 0 }])
    const [cards] = groupsOf('contact')
    expect(cards?.items.map((item) => [text(item.title as number), item.to])).toEqual([
      ['Talk to sales', 'mailto:sales@example.com'],
      ['Support', 'mailto:support@example.com'],
      ['General', 'mailto:hello@example.com'],
      ['Open source', 'https://github.com/aglyn'],
    ])
  })
})

describe('aglyn.com, one blog post', () => {
  it('reads the title, the cover below it, the table in place and the "Keep reading" row of three', () => {
    const { layout, text, main } = read('post')
    const [article, related, closer] = layout.sections
    expect(article?.hero).toEqual({ picture: 'below' })
    const pictures = all(article?.nodes ?? [], 'picture').map((picture) => text(picture.line))
    expect(pictures).toContain('What 10, 25, 50 or 100 client sites cost per month')
    expect(all(article?.nodes ?? [], 'table')[0]).toMatchObject({ header: true })
    expect(related?.name).toBe('Keep reading')
    const [cards] = all(related?.nodes ?? [], 'group')
    expect(cards).toMatchObject({ group: 'cards', columns: 3 })
    expect(cards?.items.every((item) => item.image !== undefined && main[item.title as number]?.kind === 'heading' && item.to?.startsWith('https://aglyn.com/blog/'))).toBe(true)
    expect(closer?.band).toBe('dark')
  })
})

describe('a page built with Squarespace’s markup', () => {
  it('reads its sections’ themes as bands, its photo behind the hero and the image beside the words', () => {
    const { layout } = read('pottery')
    expect(layout.sections.map((section) => section.band)).toEqual(['dark', 'plain', 'soft', 'plain', 'soft', 'plain', 'plain', 'brand'])
    expect(layout.sections[0]?.hero).toEqual({ picture: 'behind' })
    const [row] = all(layout.sections[1]?.nodes ?? [], 'row')
    expect(row?.cols).toEqual([1, 1])
    expect(all(row?.cells[0]?.nodes ?? [], 'picture')).toHaveLength(1)
  })

  it('reads its summary cards, quotes, price table, accordion and logo strip', () => {
    const { text } = read('pottery')
    expect(groupsOf('pottery').map((group) => `${group.group}:${group.items.length}:${group.columns}`)).toEqual(['cards:3:3', 'quotes:3:1', 'faq:3:1', 'logos:4:4'])
    const [cards] = groupsOf('pottery')
    expect(cards?.items.map((item) => [text(item.title as number), item.image !== undefined, item.to])).toEqual([
      ['Wheel throwing', true, 'https://www.tidewater-pottery.example/wheel-throwing'],
      ['Hand building', true, 'https://www.tidewater-pottery.example/hand-building'],
      ['Kids clay club', true, 'https://www.tidewater-pottery.example/kids-clay'],
    ])
    const table = read('pottery').layout.sections.flatMap((section) => all(section.nodes, 'table'))[0]
    expect(table?.rows.map((row) => row.cells.map((cell) => text(cell.lines[0] as number)))).toEqual([
      ['Class', 'Weeks', 'Price'],
      ['Wheel throwing', '6', '$320'],
      ['Hand building', '6', '$280'],
      ['Kids clay club', '8', '$190'],
    ])
  })

  it('reads its look from the fonts it loads and the buttons it draws', () => {
    expect(read('pottery').layout.look).toMatchObject({
      fonts: { body: 'Work Sans', headings: 'Fraunces', google: ['Fraunces', 'Work Sans'] },
      buttonFill: '#c4622d',
      buttonRadius: 300,
      link: '#8a3f17',
      header: '#f4efe8',
    })
  })
})

describe('a layout as a wave keeps it', () => {
  it('drops what a cut read no longer holds, and keeps the rest in place', () => {
    const { layout } = read('home')
    const cut = siteImportLayoutWithin(layout, 30)
    const placed = cut.sections.flatMap((section) => section.lines)
    expect(Math.max(...placed)).toBeLessThan(30)
    expect(placed).toEqual(layout.sections.flatMap((section) => section.lines).filter((ref) => ref < 30))
    expect(cut.sections.length).toBeLessThan(layout.sections.length)
  })
})
