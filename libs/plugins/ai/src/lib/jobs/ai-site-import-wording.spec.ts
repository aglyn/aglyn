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
 * Also improve my wording (AGL-4152, lane G), with no model: which lines of
 * a recorded page a rewrite may reach, every rule a rewrite is held to, the
 * page rebuilt in its rewrites with every block where it was, and the page
 * step's second answer on a stubbed provider — its rewrites reach the
 * stored page, a refused one keeps the words, and Keep my site, a policy
 * page and a copied page never ask it. Every rewrite here is the source's
 * own words moved or trimmed, so none says what the owner did not.
 */

const mockRunAiRequest = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { siteImportFidelity, siteImportFidelityHolds } from '../model/ai-site-import-fidelity'
import { siteImportReplayDocument, siteImportReplayPage } from '../site-import/fixtures/site-import-fidelity-replay'
import type { SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { AI_LAYOUT_DESIGN_TEXT, aiImportedPageRewords, aiRunLayoutPage, aiSiteImportWordingMaxTokens } from './ai-job-page-language'
import { aiSiteImportSectionNames } from './ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import {
  AI_SITE_IMPORT_WORDING_INSTRUCTIONS,
  AI_SITE_IMPORT_WORDING_TEXT,
  AI_SITE_IMPORT_WORDING_TOOL,
  aiReadWordingAnswer,
  aiSiteImportRewordedDocument,
  aiSiteImportScriptOf,
  aiSiteImportWordingCheck,
  aiSiteImportWordingHolds,
  aiSiteImportWordingPage,
  aiSiteImportWordingPrompt,
  aiSiteImportWordingText,
  aiSiteImportWordingTokens,
  type AiSiteImportRewrite,
} from './ai-site-import-wording'

const textOf = (doc: AiSiteImportDocument, line: number): string => {
  const block = doc.blocks[line]
  return block && block.kind !== 'image' ? block.text.replace(/\s+/g, ' ').trim() : ''
}

/** A line of a recorded page by its words. */
const lineWith = (doc: AiSiteImportDocument, words: string): number => {
  const at = doc.blocks.findIndex((block) => block.kind !== 'image' && block.text.replace(/\s+/g, ' ').trim() === words)
  expect(at).toBeGreaterThanOrEqual(0)
  return at
}

const pottery = () => siteImportReplayDocument('pottery')

/**
 * The pottery studio's page reworded from its own words alone: two sentences
 * swapped, a word or two trimmed, nothing added. Its facts — Friday, eight
 * seats, Tuesday through Thursday — stay where they were.
 */
function potteryRewrites(doc: AiSiteImportDocument): AiSiteImportRewrite[] {
  return [
    {
      line: lineWith(doc, 'Small classes on the wheel and at the table, with glazes we mix ourselves and a kiln that runs every Friday.'),
      text: 'Small classes at the wheel and the table, with glazes we mix ourselves and a kiln that runs every Friday.',
    },
    {
      line: lineWith(doc, 'Every class has eight seats or fewer. You get your own wheel, your own shelf and a teacher who remembers what you made last week.'),
      text: 'You get your own wheel, your own shelf and a teacher who remembers what you made last week. Every class has eight seats or fewer.',
    },
    { line: lineWith(doc, 'See the class calendar'), text: 'See the calendar' },
    {
      line: lineWith(doc, 'No. Every class starts from the beginning, and teachers move at your pace.'),
      text: 'No. Every class starts at the beginning, and teachers move at your own pace.',
    },
  ]
}

describe('the lines a rewrite may reach (G1, G2)', () => {
  it('offers headings, paragraphs, list items and buttons, and keeps quotes, card titles, tables and plain links as written', () => {
    const doc = pottery()
    const page = aiSiteImportWordingPage(doc)
    const offered = new Map(page.lines.map((line) => [line.line, line]))
    expect(offered.get(lineWith(doc, 'Make something with your hands this week.'))?.kind).toBe('heading')
    expect(offered.get(lineWith(doc, 'See the class calendar'))).toMatchObject({ kind: 'button', limit: 40 })
    expect(offered.get(lineWith(doc, 'Do I need any experience?'))?.kind).toBe('paragraph')
    // A testimonial, a card's name, a link that is no button and the eyebrow keep every word.
    for (const kept of ['“I came for one class and stayed for three years.”', 'Wheel throwing', 'On the harbor since 2009']) expect(offered.has(lineWith(doc, kept))).toBe(false)
    const learnMore = doc.blocks.findIndex((block) => block.kind === 'link' && block.text.startsWith('Learn more'))
    expect(offered.has(learnMore)).toBe(false)
    const text = aiSiteImportWordingText(page)
    expect(text).toContain('a table of 4 rows, as written')
    expect(text).toContain(`[${lineWith(doc, '“I came for one class and stayed for three years.”')}] quote, as written:`)
    expect(page.cut).toBe(false)
  })

  it('keeps a pricing page’s plans whole: its prices, plan names and figures are never offered', () => {
    const doc = siteImportReplayDocument('livePricing')
    const page = aiSiteImportWordingPage(doc)
    for (const kept of ['$16', 'Starter', 'POPULAR', '$192 billed yearly', '1 site']) expect(page.lines.some((line) => line.line === lineWith(doc, kept))).toBe(false)
    // Its questions and answers are the owner's to have reworded.
    expect(page.lines.some((line) => line.text.startsWith('Both. Annual is billed once up front'))).toBe(true)
    // A run of plan lines is told in a few, so the questions fit the prompt.
    expect(aiSiteImportWordingText(page)).toMatch(/\d+ more lines, as written/)
  })

  it('keeps a sentence with a link inside it as written, so the link’s words stay in it', () => {
    const doc = siteImportReplayDocument('post')
    const at = doc.blocks.findIndex((block, index) => block.kind === 'paragraph' && doc.blocks[index + 1]?.kind === 'link' && (doc.blocks[index + 1] as { inline?: boolean }).inline)
    expect(at).toBeGreaterThanOrEqual(0)
    const page = aiSiteImportWordingPage(doc)
    expect(page.lines.some((line) => line.line === at)).toBe(false)
    expect(aiSiteImportWordingHolds({ doc, page }, [{ line: at, text: textOf(doc, at).split(' ').reverse().join(' ') }]).refused[0]?.code).toBe('wording-fixed-line')
  })

  it('offers only the lines a rewrite of every one fits the answer’s ceiling, and wants twice their tokens', () => {
    const doc = siteImportReplayDocument('home')
    const whole = aiSiteImportWordingPage(doc)
    const held = aiSiteImportWordingPage(doc, { maxTokens: aiSiteImportWordingMaxTokens('claude-sonnet-5-5') })
    expect(held.lines.length).toBeLessThan(whole.lines.length)
    expect(held.cut).toBe(true)
    expect(aiSiteImportWordingTokens(held)).toBeLessThanOrEqual(aiSiteImportWordingMaxTokens('claude-sonnet-5-5'))
    // The ceiling is what the page pass's time leaves once its design answer's worst case is spent.
    expect(aiSiteImportWordingMaxTokens('claude-sonnet-5-5')).toBeGreaterThan(3_000)
  })
})

describe('what every rewrite holds (G3)', () => {
  const holds = (doc: AiSiteImportDocument, rewrites: AiSiteImportRewrite[], siteName?: string) =>
    aiSiteImportWordingHolds({ doc, page: aiSiteImportWordingPage(doc), ...(siteName ? { siteName } : {}) }, rewrites)
  const codeOf = (doc: AiSiteImportDocument, rewrite: AiSiteImportRewrite, siteName?: string) => {
    const result = holds(doc, [rewrite], siteName)
    expect(result.held.size).toBe(0)
    return result.refused[0]?.code
  }

  it('keeps a clean rewrite: its own words moved and trimmed, every fact in place', () => {
    const doc = pottery()
    const result = holds(doc, potteryRewrites(doc))
    expect(result.refused).toEqual([])
    expect(result.held.size).toBe(4)
  })

  it('refuses a dropped price', () => {
    const doc = siteImportReplayDocument('product')
    const line = doc.blocks.findIndex((block) => block.kind === 'paragraph' && block.text.startsWith('Need more? Starter $25'))
    const result = holds(doc, [{ line, text: textOf(doc, line).replace(' · Scale $249', ' · Scale') }])
    expect(result.refused).toEqual([expect.objectContaining({ line, code: 'wording-dropped-fact', detail: expect.stringContaining('"$249"') })])
  })

  it('refuses an added phone number', () => {
    const doc = pottery()
    const line = lineWith(doc, 'Gift cards for any class, any amount, sent by email the same day.')
    expect(codeOf(doc, { line, text: 'Gift cards for any class, any amount, sent by email the same day. Call 512-555-0142.' })).toBe('wording-invented-fact')
  })

  it('refuses a changed name, the site’s own among them', () => {
    const doc = siteImportReplayDocument('home')
    const line = doc.blocks.findIndex((block) => block.kind === 'paragraph' && block.text.startsWith('Tell Aglyn what your website is for'))
    expect(codeOf(doc, { line, text: textOf(doc, line).replace('and Aglyn AI builds', 'and our AI builds') })).toBe('wording-dropped-name')
    // A name said at a sentence's start is still the site's: its own name is held as often as the line says it.
    expect(codeOf(doc, { line, text: textOf(doc, line).replace('Tell Aglyn what', 'Tell us what') }, 'Aglyn')).toBe('wording-dropped-name')
  })

  it('refuses a quote line, and a line no part of the page is', () => {
    const doc = pottery()
    expect(codeOf(doc, { line: lineWith(doc, '“I came for one class and stayed for three years.”'), text: '“I came for one class and stayed three years.”' })).toBe('wording-fixed-line')
    expect(codeOf(doc, { line: 9_999, text: 'Classes' })).toBe('wording-no-line')
  })

  it('refuses a line twice as long, and one past its place’s characters', () => {
    const doc = pottery()
    const paragraph = lineWith(doc, 'Small classes on the wheel and at the table, with glazes we mix ourselves and a kiln that runs every Friday.')
    expect(codeOf(doc, { line: paragraph, text: `${textOf(doc, paragraph)} ${textOf(doc, paragraph)}` })).toBe('wording-length')
    const button = lineWith(doc, 'See the class calendar')
    expect(codeOf(doc, { line: button, text: 'See the whole calendar of every class' })).toBe('wording-length')
  })

  it('refuses a changed script', () => {
    const doc = pottery()
    expect(aiSiteImportScriptOf('Сделайте что-нибудь своими руками')).toBe('cyrillic')
    expect(codeOf(doc, { line: lineWith(doc, 'Make something with your hands this week.'), text: 'Сделайте что-нибудь своими руками на этой неделе.' })).toBe('wording-script')
  })

  it('refuses a line that no longer says what it said, and one given twice', () => {
    const doc = pottery()
    const line = lineWith(doc, 'Clothes you do not mind getting clay on, and short nails if you can.')
    expect(codeOf(doc, { line, text: 'Anything works in the studio, really, whatever suits you and your day.' })).toBe('wording-meaning')
    const twice = holds(doc, [
      { line, text: 'Clothes you do not mind getting clay on, and short nails if you can manage.' },
      { line, text: 'Clothes you do not mind getting clay on.' },
    ])
    expect(twice.held.size).toBe(1)
    expect(twice.refused.map((refusal) => refusal.code)).toEqual(['wording-repeated-line'])
  })

  it('reads an answer defensively: only whole line numbers with words', () => {
    expect(aiReadWordingAnswer({ lines: [{ line: 3, text: 'a' }, { line: 2.5, text: 'b' }, { line: '4', text: 'c' }, null] })).toEqual([{ line: 3, text: 'a' }])
    expect(aiReadWordingAnswer({ sections: [] })).toBeNull()
  })
})

describe('the page reworded keeps every block at its index (G3)', () => {
  it('swaps only the rewritten lines’ words, pins the source’s layout, and is built with every line once', () => {
    const doc = pottery()
    const rewrites = potteryRewrites(doc)
    const reworded = aiSiteImportRewordedDocument(doc, new Map(rewrites.map((rewrite) => [rewrite.line, rewrite.text])))
    expect(reworded.blocks).toHaveLength(doc.blocks.length)
    doc.blocks.forEach((block, index) => {
      const rewrite = rewrites.find((entry) => entry.line === index)
      expect(reworded.blocks[index]).toEqual(rewrite ? { ...block, text: rewrite.text } : block)
    })
    expect(reworded.layout).toBe(doc.layout)
    expect(aiSiteImportSectionNames(reworded)).toEqual(aiSiteImportSectionNames(doc))
  })

  it('keeps the sections a page with no layout was read in, whatever its headings now say', () => {
    const { layout: _layout, ...doc } = pottery()
    const heading = doc.blocks.findIndex((block) => block.kind === 'heading' && block.level === 2)
    const reworded = aiSiteImportRewordedDocument(doc, new Map([[heading, 'A studio and not a factory']]))
    expect(aiSiteImportSectionNames(reworded)).toEqual(aiSiteImportSectionNames(doc))
  })
})

describe('fidelity over a recorded rewrite (G4)', () => {
  it.each(['pottery'] as SiteLayoutPageName[])('%s: facts 1, lines 1, every line’s meaning at the floor, the content whole', (name) => {
    const doc = siteImportReplayDocument(name)
    const wording = potteryRewrites(doc)
    expect(aiSiteImportWordingHolds({ doc, page: aiSiteImportWordingPage(doc) }, wording).refused).toEqual([])
    const built = siteImportReplayPage(name, { finish: 'improve', words: 'improved', wording })
    expect(built.violations).toEqual([])
    const report = siteImportFidelity(built.source, built.tree, { finish: 'improve', words: 'improved' })
    expect(report.facts?.ratio).toBe(1)
    expect(report.lines).toMatchObject({ ratio: 1, extra: 0 })
    expect(report.meaning).toMatchObject({ below: 0 })
    expect(report.meaning?.lines).toBeGreaterThan(0)
    expect(report.meaning?.lowest).toBeGreaterThanOrEqual(0.4)
    expect(siteImportFidelityHolds(report)).toBe(true)
  })
})

describe('the wording check, answer by answer', () => {
  const doc = pottery()
  const page = aiSiteImportWordingPage(doc)
  const good = potteryRewrites(doc)[0] as AiSiteImportRewrite
  const gift = lineWith(doc, 'Gift cards for any class, any amount, sent by email the same day.')
  const bad = { line: gift, text: 'Gift cards for any class, any amount, sent by email the same day. Call 512-555-0142.' }
  const built: Array<{ words: string[]; rewritten: readonly string[] }> = []
  const build = (reworded: AiSiteImportDocument, rewritten: readonly string[]) => {
    built.push({ words: reworded.blocks.map((block) => (block.kind === 'image' ? '' : block.text)), rewritten })
    return { value: { ok: true }, violations: [] }
  }
  beforeEach(() => {
    built.length = 0
  })

  it('asks a refused line again once, keeping the lines that held, then keeps it as written', () => {
    const check = aiSiteImportWordingCheck({ doc, page, build })
    const first = check({ lines: [good, bad] })
    expect(first.value).toBeNull()
    expect(first.violations.map((violation) => violation.code)).toEqual(['wording-invented-fact', 'wording-kept-lines'])
    expect(first.offending).toEqual({ lines: [bad] })
    const second = check({ lines: [bad] })
    expect(second.violations).toEqual([])
    expect(second.value?.rewrites).toEqual(new Map([[good.line, good.text]]))
    expect(second.value?.kept.map((refusal) => [refusal.line, refusal.code])).toEqual([[gift, 'wording-invented-fact']])
    expect(built).toHaveLength(1)
    expect(built[0]?.words[gift]).toBe(textOf(doc, gift))
    expect(built[0]?.rewritten).toEqual([good.text])
  })

  it('refuses a page that cannot be built in its rewrites whole', () => {
    const check = aiSiteImportWordingCheck({ doc, page, build: () => ({ value: null, violations: [{ rule: 14, code: 'filler-copy', message: 'filler' }] }) })
    expect(check({ lines: [good] })).toEqual({ value: null, violations: [{ rule: 14, code: 'filler-copy', message: 'filler' }] })
  })
})

/*------------------------------------------
 * The page step, its second answer on a stubbed provider
 *-----------------------------------------*/

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const toolAnswer = (name: string, input: unknown) => ({ kind: 'completion', text: '', toolUse: [{ name, input }], usage: ZERO_USAGE, estCostUsd: 0, stopReason: 'tool_use' })

interface SentRequest {
  system: Array<{ text: string }>
  tools: Array<{ name: string; inputSchema: unknown }>
  messages: Array<{ role: string; content: unknown }>
  maxTokens: number
}
const sent = (): SentRequest[] => mockRunAiRequest.mock.calls.map((call) => call[0] as SentRequest)

/** Every word a visitor reads on a stored page. */
function shown(nodes: Record<string, unknown>): string[] {
  const out: string[] = []
  const visit = (id: string) => {
    const node = nodes[id] as { props?: Record<string, unknown>; nodes?: string[] } | undefined
    if (!node) return
    for (const key of ['children', 'primary', 'secondary']) {
      const value = node.props?.[key]
      if (typeof value === 'string' && value.trim()) out.push(value.replace(/\s+/g, ' ').trim())
    }
    for (const child of node.nodes ?? []) visit(child)
  }
  visit(CANVAS_ROOT_ELEMENT_ID)
  return out
}

async function runPage(doc: AiSiteImportDocument, slug = '/') {
  const names = aiSiteImportSectionNames(doc)
  const sectionIds = names.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug, sections: names.map((name) => ({ name, uses: [] as string[], items: 0 })) }
  return aiRunLayoutPage({
    job: { $id: 'job-pottery-home', brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: 'Tidewater Pottery Studio' } },
    plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
    screen: screen as never,
    sectionIds,
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: [], componentIds: [], codeBuilt: true },
    reusableComponents: false,
    inventory: null,
    model: 'claude-sonnet-5-5',
  })
}

const improved = (doc: AiSiteImportDocument): AiSiteImportDocument => ({ ...doc, build: 'arranged', finish: 'improve', wording: 'improved' })
const DESIGN = { sections: [] }

describe('the page step’s wording answer (G1)', () => {
  beforeEach(() => mockRunAiRequest.mockReset())

  it('asks after the design, and the reworded words reach the stored page', async () => {
    const doc = improved(pottery())
    const rewrites = potteryRewrites(doc)
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer('submit_design', DESIGN)).mockResolvedValueOnce(toolAnswer('submit_wording', { lines: rewrites }))
    const result = await runPage(doc)
    expect(result.status).toBe('ok')
    expect(result.attempts).toBe(2)
    const [design, wording] = sent()
    // The design answer is asked exactly as before, and the wording answer on its own tool and cached text.
    expect(design?.system.map((block) => block.text)).toContain(AI_LAYOUT_DESIGN_TEXT)
    expect(design?.tools.map((tool) => tool.name)).toContain('submit_design')
    expect(wording?.tools.map((tool) => tool.name)).toEqual(['submit_wording'])
    expect(wording?.tools[0]?.inputSchema).toEqual(AI_SITE_IMPORT_WORDING_TOOL.inputSchema)
    expect(wording?.system.map((block) => block.text)).toEqual(expect.arrayContaining(AI_SITE_IMPORT_WORDING_INSTRUCTIONS.map((block) => block.text)))
    expect(wording?.system.map((block) => block.text)).toContain(AI_SITE_IMPORT_WORDING_TEXT)
    const prompt = String(wording?.messages[0]?.content)
    expect(prompt).toContain('<untrusted-data source=')
    expect(prompt).toContain('Tidewater Pottery Studio')
    if (result.status !== 'ok') return
    expect(result.value.words).toBe('improved')
    const words = shown(result.value.nodes as unknown as Record<string, unknown>)
    for (const rewrite of rewrites) {
      expect(words).toContain(rewrite.text)
      expect(words).not.toContain(textOf(doc, rewrite.line))
    }
  })

  it('keeps every word when its rewrite is refused twice, and the page reads as kept', async () => {
    const doc = improved(pottery())
    const gift = lineWith(doc, 'Gift cards for any class, any amount, sent by email the same day.')
    const invented = { lines: [{ line: gift, text: 'Gift cards for any class, any amount, sent by email the same day. Call 512-555-0142.' }] }
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer('submit_design', DESIGN))
      .mockResolvedValueOnce(toolAnswer('submit_wording', invented))
      .mockResolvedValueOnce(toolAnswer('submit_wording', invented))
    const result = await runPage(doc)
    expect(mockRunAiRequest).toHaveBeenCalledTimes(3)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.words).toBe('kept')
    expect(result.value.settled).toEqual(expect.arrayContaining([{ at: `line ${gift}`, what: 'kept as written, refused twice: wording-invented-fact' }]))
    const words = shown(result.value.nodes as unknown as Record<string, unknown>)
    expect(words).toContain(textOf(doc, gift))
    expect(words.join(' ')).not.toContain('555')
    // The re-ask named the line and what it added.
    expect(String(sent()[2]?.messages.at(-1)?.content)).toContain(`Line ${gift}`)
  })

  it('keeps the page as its design drew it when the wording answer cannot be read twice', async () => {
    const doc = improved(pottery())
    mockRunAiRequest
      .mockResolvedValueOnce(toolAnswer('submit_design', DESIGN))
      .mockResolvedValueOnce(toolAnswer('submit_wording', { sections: [] }))
      .mockResolvedValueOnce(toolAnswer('submit_wording', { sections: [] }))
    const result = await runPage(doc)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.words).toBe('kept')
    expect(result.attempts).toBe(3)
  })

  it('never asks it under Keep my site, with the switch off, of a policy page or of a page copied as it is', async () => {
    const base = pottery()
    for (const doc of [{ ...base, build: 'arranged', finish: 'keep', wording: 'kept' }, { ...base, build: 'arranged', finish: 'improve', wording: 'kept' }] as AiSiteImportDocument[]) {
      mockRunAiRequest.mockReset().mockResolvedValueOnce(toolAnswer('submit_design', DESIGN))
      const result = await runPage(doc)
      expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
      expect(result.status === 'ok' && result.value.words).toBeUndefined()
    }
    mockRunAiRequest.mockReset().mockResolvedValueOnce(toolAnswer('submit_design', DESIGN))
    await runPage(improved(base), '/privacy-policy')
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    mockRunAiRequest.mockReset()
    await runPage({ ...improved(base), build: 'copied' })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(aiImportedPageRewords(improved(base), { slug: '/', title: 'Terms of service' })).toBe(false)
    expect(aiImportedPageRewords(improved(base), { slug: '/', title: base.title })).toBe(true)
  })

  it('tells the answer the site’s name and the page’s lines fenced as the owner’s data', () => {
    const doc = pottery()
    const prompt = aiSiteImportWordingPrompt({ screen: { title: 'Home', slug: '/' }, doc, page: aiSiteImportWordingPage(doc), siteName: 'Tidewater Pottery Studio' })
    expect(prompt.match(/<untrusted-data source=/g)).toHaveLength(2)
    expect(prompt).toContain(`[${lineWith(doc, 'See the class calendar')}] button, up to 40 characters: See the class calendar`)
  })
})
