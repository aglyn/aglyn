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
 * Bring my site never rewrites (AGL-4084), replayed on aglyn.com as AglynBot
 * read it on 2026-10-28: a page copied as it is keeps every word in order
 * with no model at all, and an arranged page places every source line
 * exactly once whatever its answer says, rewording none.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AGLYN_ORIGIN, aglynPage } from '../site-import/fixtures/aglyn-com-recordings'
import { extractSiteImportPage, type SiteImportBlock } from '../site-import/site-import-html'
import { siteImportPageRead } from '../site-import/site-import-page'
import { aiImportedPageCheck, aiLayoutArrangePrompt, aiRunLayoutPage, AI_LAYOUT_ARRANGE_TEXT } from './ai-job-page-language'
import {
  AI_LAYOUT_IMPORTED_SECTIONS_INPUT,
  aiCompileImportedDocument,
  aiSiteImportDocLines,
  aiSiteImportDocumentOf,
  aiSiteImportTextParts,
  type AiSiteImportDocument,
} from './ai-site-import-document'

const same = (url: URL) => url.origin === AGLYN_ORIGIN

/** A recorded page's main region, as a wave's read keeps it. */
function blocksOf(path: string): SiteImportBlock[] {
  const extract = extractSiteImportPage(aglynPage(path), `${AGLYN_ORIGIN}${path}`, same)
  const read = siteImportPageRead({ ...extract, url: `${AGLYN_ORIGIN}${path}`, path, foundBy: path === '/' ? 'home' : 'sitemap', bytes: 0 }, 'now')
  return read.blocks ?? []
}

function docOf(path: string, build: AiSiteImportDocument['build'], title: string): AiSiteImportDocument {
  return {
    build,
    title,
    url: `${AGLYN_ORIGIN}${path}`,
    blocks: blocksOf(path),
    photos: [],
    links: [{ path: '/pricing', id: 'page-pricing' }],
    origins: [AGLYN_ORIGIN, `https://www.aglyn.com`],
  }
}

/** Every word a visitor reads on a stored page, in tree order. */
function shown(nodes: Record<string, unknown>): string[] {
  const out: string[] = []
  const visit = (id: string) => {
    const node = nodes[id] as { props?: Record<string, unknown>; nodes?: string[] } | undefined
    if (!node) return
    for (const key of ['children', 'primary', 'secondary']) {
      const value = node.props?.[key]
      if (typeof value === 'string' && value.trim()) out.push(value)
    }
    for (const child of node.nodes ?? []) visit(child)
  }
  visit(CANVAS_ROOT_ELEMENT_ID)
  return out
}

const textOf = (block: SiteImportBlock) => (block.kind === 'image' ? '' : block.text.replace(/\s+/g, ' ').trim())

function checkFor(doc: AiSiteImportDocument) {
  const { sections } = aiSiteImportDocLines(doc.blocks, doc.title)
  const sectionIds = sections.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug: '/x', sections: sections.map((section) => ({ name: section.name, uses: [], items: 0 })) }
  return {
    sections,
    sectionIds,
    screen,
    check: aiImportedPageCheck({
      screen: screen as never,
      sectionIds,
      targets: { pageId: 'p0', pages: [{ id: 'page-pricing', label: 'Pricing', slug: '/pricing' }], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: ['page-pricing'], formIds: [], componentIds: [], codeBuilt: true, reusableComponents: false },
      doc,
    }),
  }
}

describe('a page copied as it is keeps every word, in order, with no model (AGL-4084)', () => {
  it('the privacy policy: its opening and all 13 sections, every line, its last paragraph last', () => {
    const doc = docOf('/legal/privacy', 'copied', 'Privacy Policy')
    const { sections, check } = checkFor(doc)
    expect(sections).toHaveLength(14)
    const result = check(null)
    expect(result.violations).toEqual([])
    const words = shown(result.value?.nodes as unknown as Record<string, unknown>)
    const source = doc.blocks.filter((block) => block.kind !== 'image' && !(block.kind === 'link' && block.inline)).map(textOf).filter(Boolean)
    // Every line, in source order, nothing reworded and nothing added.
    expect(words).toEqual(source.flatMap((text) => aiSiteImportTextParts(text)))
    const h2s = doc.blocks.filter((block) => block.kind === 'heading' && block.level === 2).map(textOf)
    expect(h2s).toHaveLength(13)
    let at = -1
    for (const heading of h2s) {
      const next = words.indexOf(heading, at + 1)
      expect(next).toBeGreaterThan(at)
      at = next
    }
    expect(words[words.length - 1]).toBe(source[source.length - 1])
  })

  it('runs no model: the page step is handed the page with nothing spent', async () => {
    const doc = docOf('/legal/privacy', 'copied', 'Privacy Policy')
    const { sectionIds, screen } = checkFor(doc)
    const result = await aiRunLayoutPage({
      job: { $id: 'job-privacy', brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc } },
      plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
      screen: screen as never,
      sectionIds,
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true },
      reusableComponents: false,
      inventory: null,
      model: 'claude-sonnet-5-5',
    })
    expect(result.status).toBe('ok')
    expect(result.attempts).toBe(0)
    expect(result.estCostUsd).toBe(0)
    expect(result.usage.outputTokens).toBe(0)
  })

  it('the contact page: every email address a button that writes to it, every section kept', () => {
    const doc = docOf('/contact', 'copied', 'Contact')
    const result = checkFor(doc).check(null)
    expect(result.violations).toEqual([])
    const nodes = Object.values(result.value?.nodes as unknown as Record<string, { componentId: string; props?: Record<string, unknown> }>)
    const mailto = nodes.filter((node) => node.componentId === 'muiButton' && String(node.props?.['href'] ?? '').startsWith('mailto:'))
    expect(mailto.map((node) => [node.props?.['children'], node.props?.['href']])).toEqual([
      ['sales@example.com', 'mailto:sales@example.com'],
      ['support@example.com', 'mailto:support@example.com'],
      ['hello@example.com', 'mailto:hello@example.com'],
    ])
    // A link out keeps its address, opening in a new tab.
    expect(nodes.find((node) => node.props?.['href'] === 'https://github.com/aglyn')?.props?.['target']).toBe('_blank')
    const words = shown(result.value?.nodes as unknown as Record<string, unknown>)
    for (const heading of doc.blocks.filter((block) => block.kind === 'heading').map(textOf)) expect(words).toContain(heading)
  })

  it('splits a paragraph longer than a text element holds between sentences, every word kept', () => {
    const sentence = 'Every word of this sentence is the owner’s own. '
    const long = sentence.repeat(60).trim()
    const parts = aiSiteImportTextParts(long)
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(2_000)
    expect(parts.join(' ')).toBe(long)
  })
})

describe('an arranged page places every source line exactly once and rewords none (AGL-4084)', () => {
  const doc = docOf('/', 'arranged', 'Home')
  const lines = aiSiteImportDocLines(doc.blocks, doc.title)
  const sourceLines = lines.lines.filter((line) => line.block.kind !== 'image').map((line) => textOf(line.block))

  /** A recorded-shape arrangement: the opening in two columns, a later section's lines as cards, one line named twice, one reworded. */
  function answer() {
    const [opening, second] = lines.sections
    return {
      sections: lines.sections.map((section, index) => {
        if (index === 0) {
          const [first, ...rest] = opening.lines
          return {
            band: 'plain',
            cols: [7, 5],
            align: 'start',
            blocks: [
              { kind: 'heading', col: 0, from: [first], style: 'none', items: [], text: 'A heading the model wrote itself' },
              { kind: 'lede', col: 0, from: rest.slice(0, 1), style: 'none', items: [] },
              { kind: 'text', col: 1, from: rest.slice(1, 3), style: 'none', items: [] },
            ],
          }
        }
        if (section === second) {
          const [title, ...rest] = second.lines
          return {
            band: 'dark',
            cols: [],
            align: 'center',
            blocks: [
              { kind: 'heading', col: -1, from: [title], style: 'none', items: [] },
              { kind: 'cards', col: -1, from: [], style: 'none', items: [{ from: rest.slice(0, 2) }, { from: rest.slice(2, 4) }] },
              // Names a line already placed: dropped, its other line added at the end.
              { kind: 'text', col: -1, from: [title, ...rest.slice(4, 5)], style: 'none', items: [] },
              // A line of another section is not taken from it.
              { kind: 'text', col: -1, from: [opening.lines[opening.lines.length - 1]], style: 'none', items: [] },
            ],
          }
        }
        return { band: index % 2 ? 'soft' : 'plain', cols: [], align: 'start', blocks: [{ kind: 'text', col: -1, from: section.lines, style: 'none', items: [], text: 'Reworded.' }] }
      }),
    }
  }

  it('home: nine sections and its opening, every source line on the page once, none reworded', () => {
    expect(lines.sections).toHaveLength(10)
    const result = checkFor(doc).check(answer())
    expect(result.violations).toEqual([])
    const words = shown(result.value?.nodes as unknown as Record<string, unknown>)
    const joined = words.join('\n')
    expect(joined).not.toContain('A heading the model wrote itself')
    expect(joined).not.toContain('Reworded.')
    // Each source line once: a card's text is its text lines joined, so compare the words.
    const tally = (list: string[]) => (list.join(' ').match(/[\p{L}\p{N}]+/gu) ?? []).sort()
    expect(tally(words)).toEqual(tally(sourceLines))
  })

  it('compiles the same lines whatever the answer, and keeps the page’s one h1', () => {
    const { sectionIds } = checkFor(doc)
    const compiled = aiCompileImportedDocument({ doc, sectionIds, pages: [], arrangement: { sections: lines.sections.map(() => null) } })
    expect([...compiled.placed].sort((a, b) => a - b)).toEqual(lines.lines.filter((line) => line.block.kind !== 'image').map((line) => line.n))
    const h1s = Object.values(compiled.tree.nodes).filter((node) => node.props?.['component'] === 'h1')
    expect(h1s).toHaveLength(1)
  })

  it('is told to arrange only, with the lines fenced as the owner’s data', () => {
    expect(AI_LAYOUT_ARRANGE_TEXT).toContain('Arrange; keep every line as written; add nothing; reword nothing.')
    const prompt = aiLayoutArrangePrompt({ job: { $id: 'job-home', inputs: {} }, screen: { title: 'Home', slug: '/', sections: [] }, doc })
    expect(prompt).toContain('[2] (heading 1) Build your website.')
    expect(prompt).toMatch(/<untrusted[^>]*>/i)
  })
})

describe('the page input', () => {
  it('reads back what the import step hands the page step, and nothing on any other job', () => {
    const doc = docOf('/contact', 'copied', 'Contact')
    expect(aiSiteImportDocumentOf({ [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc })?.blocks).toEqual(doc.blocks)
    expect(aiSiteImportDocumentOf({ importedPage: { url: 'x', text: 'y' } })).toBeNull()
  })
})
