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
 * A redesign's room inside its page's ceiling (AGL-4152), with no model.
 *
 * A contractor's long home was cut off at 4,909 output tokens, a ceiling the
 * page's 90 credits were said to buy after its input, and its page billed
 * 106. The guess had priced the instructions alone at the five-minute cache
 * write: not the doctrine's block or the tool before them, and not the hour
 * the platform's prefix is written for. And the answer was never told how
 * much room it had, so it wrote a whole page and lost it. A thin page of the
 * same site wrote 3,182 tokens around about eighty words of its own, named a
 * figure the site never gives, and had no room left to be asked again.
 *
 * Here: every byte priced as billed; the answer told its size in sections and
 * words, planned so a re-ask of it still fits; a cut-off re-ask asked for a
 * page half as long, with room for that; a thin page told to stay short and
 * pad with no figure; an invented value named with its sentence; and a
 * fallback's log saying what each answer had and wrote.
 */

const mockRunAiRequest = jest.fn()
jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

import { estimateAiBilledUsd } from '../providers/catalog'
import type { AiSystemBlock, AiUsage } from '../providers/contract'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { siteImportFidelity } from '../model/ai-site-import-fidelity'
import { siteImportReplayDocument, siteImportReplayDocumentOf, siteImportReplayImproved, siteImportReplayTheme, siteImportReplayFrame } from '../site-import/fixtures/site-import-fidelity-replay'
import { SITE_IMPORT_IMPROVE_ANSWERS } from '../site-import/fixtures/site-import-improve-answers'
import { aiRunLayoutPage } from './ai-job-page-language'
import { aiSiteImportSectionNames } from './ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import {
  AI_SITE_IMPORT_CUT_OFF_REASK_ROOM,
  AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS,
  AI_SITE_IMPORT_IMPROVE_CUT_OFF_SMALLER,
  AI_SITE_IMPORT_IMPROVE_MOST_TOKENS,
  AI_SITE_IMPORT_REASK_ROOM,
  AI_SITE_IMPORT_ROOM_SHARE,
  AI_SITE_IMPORT_SECTION_TOKENS,
  AI_SITE_IMPORT_THIN_MOST_SECTIONS,
  AI_SITE_IMPORT_WORD_TOKENS,
  aiSiteImportImproveCredits,
  aiSiteImportImproveLedger,
  aiSiteImportImprovedMisses,
  aiSiteImportImproveReaskInput,
  aiSiteImportImproveReaskTokens,
  aiSiteImportImproveRoom,
  aiSiteImportImproveSizeLines,
  aiSiteImportImproveTokensWithin,
} from './ai-site-import-improve'

const model = 'claude-sonnet-5-5'
const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

type Sent = { system: AiSystemBlock[]; tools: unknown[]; messages: Array<{ role: string; content: unknown }>; maxTokens: number }
const sent = () => mockRunAiRequest.mock.calls.map((call) => call[0] as Sent)
const answerOf = (input: unknown, usage: AiUsage, stopReason = 'tool_use') => ({ kind: 'completion', text: '', toolUse: [{ name: 'submit_improved_page', input }], usage, estCostUsd: 0, stopReason })

/**
 * Today's guess, as the run that was cut off made it: the instructions alone
 * (every system block but the doctrine's, which leads), three characters a
 * token, written at the five-minute rate, the prompt as input, and no hour.
 */
function todaysFirst(request: Sent): number {
  const systemChars = request.system.slice(1).reduce((total, block) => total + block.text.length, 0)
  const promptChars = String(request.messages[0]?.content ?? '').length
  const input: AiUsage = { ...ZERO, inputTokens: Math.ceil(promptChars / 3), cacheWriteTokens: Math.ceil(systemChars / 3) }
  const credits = (usage: AiUsage) => assistCreditsFromUsd(estimateAiBilledUsd(usage, model))
  let low = 0
  let high = AI_SITE_IMPORT_IMPROVE_MOST_TOKENS
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (credits({ ...input, outputTokens: mid }) <= AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS) low = mid
    else high = mid - 1
  }
  return low
}

/** What the length line tells, read back: the sections and the words. */
function toldOf(prompt: string): { sections: number; words: number } | null {
  const told = /Length: write this page in at most (\d+) sections and about (\d+) words in all/.exec(prompt)
  return told ? { sections: Number(told[1]), words: Number(told[2]) } : null
}

async function runPage(doc: AiSiteImportDocument, slug = '/') {
  const names = aiSiteImportSectionNames(doc)
  const screen = { title: doc.title, slug, sections: names.map((name) => ({ name, uses: [] as string[], items: 0 })) }
  return aiRunLayoutPage({
    job: { $id: 'job-room-home', brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: 'Stoneline Paving', siteKind: 'business', siteStyle: { seed: 7 } } },
    plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
    screen: screen as never,
    sectionIds: names.map((_, index) => `sec-${index}`),
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: [], componentIds: [], codeBuilt: true },
    reusableComponents: false,
    inventory: null,
    model,
  })
}

/**
 * A long home's request at the size of the run that was cut off: the replay's
 * long home, its site's digest grown with what the site says of itself until
 * today's guess gives the 4,909 tokens that run was asked at.
 */
const SITE_LINE = 'Stoneline Paving pours driveways, patios and walks across the county, with free estimates and clean job sites.'
const longHome = (lines: number): AiSiteImportDocument => ({
  ...siteImportReplayDocument('home'),
  finish: 'improve',
  wording: 'improved',
  generative: true,
  siteLines: ['Stoneline Paving', ...Array.from({ length: lines }, () => SITE_LINE)],
})

describe('a long home, at the size of the run that was cut off', () => {
  beforeEach(() => {
    mockRunAiRequest.mockReset()
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  /** The site's own lines past its name: none, and today's guess asks about the run's 4,909 tokens. */
  const LINES = 0

  it('was asked 4,909 tokens by today’s guess, which its real bill breaks; now it asks what the ceiling buys', async () => {
    mockRunAiRequest.mockResolvedValue(answerOf({ sections: [] }, ZERO))
    await runPage(longHome(LINES))
    const request = sent()[0] as Sent
    const today = todaysFirst(request)
    expect(today).toBeGreaterThanOrEqual(4_800)
    expect(today).toBeLessThanOrEqual(4_960)

    // The same bytes priced as they are billed on a cold cache: the doctrine's block and the tool, at the hour.
    const room = aiSiteImportImproveRoom({
      model,
      spent: ZERO,
      system: request.system,
      toolChars: JSON.stringify(request.tools[0]).length,
      promptChars: String(request.messages[0]?.content).length,
      hour: true,
      most: 7_630,
      ledger: aiSiteImportImproveLedger(longHome(LINES)),
    })
    // Today's ask, at its real input, passes the ceiling: the run's page billed 106 of its 100.
    expect(aiSiteImportImproveCredits({ ...room.estimated, outputTokens: today }, model)).toBeGreaterThan(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS + 8)
    // What it asks now holds it, to the token.
    expect(request.maxTokens).toBe(room.first)
    expect(aiSiteImportImproveCredits({ ...room.estimated, outputTokens: request.maxTokens }, model)).toBeLessThanOrEqual(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS)
    expect(aiSiteImportImproveCredits({ ...room.estimated, outputTokens: request.maxTokens + 20 }, model)).toBeGreaterThan(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS)
    expect(request.maxTokens).toBeLessThan(today)
    expect(request.maxTokens).toBeGreaterThan(3_800)
  })

  it('tells the answer a page that fits its room, and one whose re-ask still fits the ceiling', async () => {
    mockRunAiRequest.mockResolvedValue(answerOf({ sections: [] }, ZERO))
    await runPage(longHome(LINES))
    const request = sent()[0] as Sent
    const prompt = String(request.messages[0]?.content)
    const told = toldOf(prompt)
    expect(told).not.toBeNull()
    if (!told) return
    // One line, in plain words, before the ledger; a long group kept whole is cheaper than written again.
    expect(prompt.split('\n').filter((line) => line.startsWith('Length:'))).toHaveLength(1)
    expect(prompt.indexOf('Length:')).toBeLessThan(prompt.indexOf("The page's ledger"))
    expect(prompt).toContain('Keep a long group of the ledger whole with keep rather than writing its items again.')
    expect(told.sections).toBeGreaterThanOrEqual(5)
    expect(told.words).toBeGreaterThanOrEqual(400)
    // The page told, at what a section and a word cost, fits the share of the room it is planned to.
    const size = told.sections * AI_SITE_IMPORT_SECTION_TOKENS + told.words * AI_SITE_IMPORT_WORD_TOKENS
    expect(size).toBeLessThanOrEqual(request.maxTokens * AI_SITE_IMPORT_ROOM_SHARE)
    // And an answer of that size leaves a full re-ask of it inside the ceiling, its prefix read from the cache it wrote.
    const room = aiSiteImportImproveRoom({ model, spent: ZERO, system: request.system, toolChars: JSON.stringify(request.tools[0]).length, promptChars: prompt.length, hour: true, most: 7_630, ledger: aiSiteImportImproveLedger(longHome(LINES)) })
    const afterFirst = { ...room.estimated, outputTokens: Math.ceil(size) }
    expect(aiSiteImportImproveReaskTokens({ model, spent: afterFirst, lastOutput: Math.ceil(size), most: 7_630 })).toBeGreaterThan(0)
  })

  it('never tells a page fewer words than keeping its owner’s meaning takes, where the room holds them', () => {
    // A long page whose words are its own lines, not groups a keep carries: 900 words in thirty lines.
    const lines = Array.from({ length: 30 }, (_, line) => ({ line, section: Math.floor(line / 3), kind: 'text', text: Array.from({ length: 30 }, (_, at) => `word${at}`).join(' ') }))
    const room = aiSiteImportImproveRoom({ model, spent: ZERO, system: [{ text: 'x'.repeat(10_000), cacheBreakpoint: true }], toolChars: 1_400, promptChars: 6_000, hour: true, most: 7_630, ledger: { lines } as never })
    expect(room.words).toBeGreaterThanOrEqual(700)
    expect(room.sections * AI_SITE_IMPORT_SECTION_TOKENS + room.words * AI_SITE_IMPORT_WORD_TOKENS).toBeLessThanOrEqual(room.first * AI_SITE_IMPORT_ROOM_SHARE)
  })

  it('falls back as today on an answer cut off at the whole room, with a log that says what it had and wrote', async () => {
    let asked = 0
    mockRunAiRequest.mockImplementation(async (request: Sent) => {
      asked = request.maxTokens
      return answerOf({}, { inputTokens: 1_400, outputTokens: request.maxTokens, cacheReadTokens: 0, cacheWriteTokens: 4_200, cacheWriteHourTokens: 3_700 }, 'max_tokens')
    })
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const result = await runPage(longHome(LINES))
    // A cut-off at the whole room leaves nothing for a re-ask of half its length: one request, the layout kept.
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.value.redesign?.missed).toEqual(['answer-cut-off'])
    const logged = info.mock.calls.find((call) => call[0] === 'ai imported page: its redesign did not pass, its layout kept')?.[1] as Record<string, unknown> | undefined
    expect(logged?.['answers']).toEqual([{ room: asked, outputTokens: asked }])
    expect(logged?.['reask']).toEqual({ ran: false, room: 0, needs: Math.ceil(asked * AI_SITE_IMPORT_CUT_OFF_REASK_ROOM), cutOff: true })
    expect(logged?.['planned']).toEqual(expect.objectContaining({ sections: expect.any(Number), words: expect.any(Number), target: expect.any(Number) }))
    expect(logged?.['inputCredits']).toEqual({ estimated: expect.any(Number), billed: expect.any(Number) })
    // Never a word of the page.
    expect(JSON.stringify(logged)).not.toContain('Stoneline')
  })
})

describe('a re-ask', () => {
  it('reads the prefix its first request wrote from the cache: room the second write had starved', () => {
    // A first request that wrote the platform's prefix at the hour, and the site's block at five minutes.
    const spent: AiUsage = { inputTokens: 1_500, outputTokens: 1_400, cacheReadTokens: 0, cacheWriteTokens: 4_300, cacheWriteHourTokens: 3_700 }
    const again = aiSiteImportImproveReaskInput(spent)
    expect(again).toEqual({ inputTokens: 2_100, outputTokens: 0, cacheReadTokens: 4_300, cacheWriteTokens: 0 })
    const now = aiSiteImportImproveTokensWithin({ model, spent, input: again, most: 8_000 })
    const twice = aiSiteImportImproveTokensWithin({ model, spent, input: { ...again, cacheReadTokens: 0, cacheWriteTokens: 4_300 }, most: 8_000 })
    expect(now - twice).toBeGreaterThan(900)
    expect(aiSiteImportImproveReaskTokens({ model, spent, lastOutput: 1_400, most: 8_000 })).toBe(now)
    // Written again, it would not have run.
    expect(twice).toBeLessThan(Math.ceil(1_400 * AI_SITE_IMPORT_REASK_ROOM))
  })

  it('after a cut-off needs room for a page about half as long, not for the one cut off', () => {
    // An answer of 2,600 tokens cut off at a ceiling under the most: room for 0.6 of it, not 0.9.
    const spent: AiUsage = { inputTokens: 1_200, outputTokens: 2_600, cacheReadTokens: 3_900, cacheWriteTokens: 0 }
    const room = aiSiteImportImproveTokensWithin({ model, spent, input: aiSiteImportImproveReaskInput(spent), most: 8_000, ceiling: 85 })
    expect(room).toBeGreaterThanOrEqual(Math.ceil(2_600 * AI_SITE_IMPORT_CUT_OFF_REASK_ROOM))
    expect(room).toBeLessThan(Math.ceil(2_600 * AI_SITE_IMPORT_REASK_ROOM))
    expect(aiSiteImportImproveReaskTokens({ model, spent, lastOutput: 2_600, most: 8_000, ceiling: 85 })).toBe(0)
    expect(aiSiteImportImproveReaskTokens({ model, spent, lastOutput: 2_600, cutOff: true, most: 8_000, ceiling: 85 })).toBe(room)
  })

  it('after a cut-off is asked for the smaller page, and taken', async () => {
    mockRunAiRequest.mockReset()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const doc: AiSiteImportDocument = { ...siteImportReplayDocument('tax-firm'), finish: 'improve', wording: 'improved', generative: true, siteLines: ['A basic site'], forms: [{ index: 0, formId: 'form-basic' }] }
    const small = { inputTokens: 900, outputTokens: 1_900, cacheReadTokens: 3_900, cacheWriteTokens: 0 }
    mockRunAiRequest.mockResolvedValueOnce(answerOf({}, small, 'max_tokens')).mockResolvedValueOnce(answerOf(SITE_IMPORT_IMPROVE_ANSWERS['tax-firm'], { ...small, outputTokens: 1_100 }))
    const names = aiSiteImportSectionNames(doc)
    const screen = { title: doc.title, slug: '/', sections: names.map((name) => ({ name, uses: [] as string[], items: 0 })) }
    const result = await aiRunLayoutPage({
      job: { $id: 'job-basic-home', brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: 'A basic site', siteKind: 'business', siteStyle: { seed: 7 } } },
      plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
      screen: screen as never,
      sectionIds: names.map((_, index) => `sec-${index}`),
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [{ id: 'form-basic', name: 'Contact' }], formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: doc.links.map((link) => link.id), formIds: ['form-basic'], componentIds: [], codeBuilt: true },
      reusableComponents: false,
      inventory: null,
      model,
    })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    const reasked = String(sent()[1]?.messages.at(-1)?.content)
    expect(reasked).toContain(AI_SITE_IMPORT_IMPROVE_CUT_OFF_SMALLER)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.value.redesign?.status).toBe('redesigned')
    // The two answers together inside the ceiling.
    expect(aiSiteImportImproveCredits(result.usage, model)).toBeLessThanOrEqual(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS)
    jest.restoreAllMocks()
  })
})

describe('a thin page', () => {
  // A page that does not exist: a paving company's commercial page of a few labels and about seventy words.
  const URL_OF_PAGE = 'https://www.stoneline-paving.example/commercial'
  const html = `<!doctype html><html><head><title>Commercial</title></head><body><main>
    <section><h1>Need a crew for your next pour?</h1><p><a href="tel:+15550100200">Call now</a></p></section>
    <section><h2>Two ways to work with us</h2><ul><li>Labor only: your materials, our crew</li><li>Full service: we handle the job start to finish</li></ul></section>
    <section><h2>What we pave</h2><ul><li>Parking lots</li><li>Walks, curbs and gutters</li><li>Loading pads</li><li>Trench patching</li></ul><p><a href="/contact">Ask for a site visit</a></p></section>
  </main></body></html>`
  const doc: AiSiteImportDocument = { ...siteImportReplayDocumentOf(html, URL_OF_PAGE, (url) => url.hostname === 'www.stoneline-paving.example'), finish: 'improve', wording: 'improved', generative: true, siteLines: ['Stoneline Paving'] }

  it('is told to stay short and to give no figure the site does not, in at most six sections', () => {
    const ledger = aiSiteImportImproveLedger(doc)
    const room = aiSiteImportImproveRoom({ model, spent: ZERO, system: [{ text: 'x'.repeat(10_000), cacheBreakpoint: true }], toolChars: 1_400, promptChars: 3_000, hour: true, most: 7_630, ledger })
    expect(room.thin).toBeGreaterThan(20)
    expect(room.thin).toBeLessThan(120)
    expect(room.sections).toBeLessThanOrEqual(AI_SITE_IMPORT_THIN_MOST_SECTIONS)
    // About four times its owner's words, not the whole room.
    expect(room.words).toBeLessThanOrEqual(Math.max(200, (room.thin ?? 0) * 4 + 150))
    const lines = aiSiteImportImproveSizeLines(room, { most: 7_630, groups: false })
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('give a count, size, year or quantity only where the site states it')
    // A long page is not thin.
    const long = aiSiteImportImproveRoom({ model, spent: ZERO, system: [{ text: 'x'.repeat(10_000), cacheBreakpoint: true }], toolChars: 1_400, promptChars: 3_000, hour: true, most: 7_630, ledger: aiSiteImportImproveLedger(longHome(0)) })
    expect(long.thin).toBeNull()
    expect(aiSiteImportImproveSizeLines(long, { most: 7_630, groups: true })).toHaveLength(1)
    // A page with the whole of its most has no length line: only a cheap model's would.
    expect(aiSiteImportImproveSizeLines({ ...long, first: 7_630 }, { most: 7_630, groups: true })).toEqual([])
  })

  it('carries both lines on its request, and a page the plan proposed is never thin', async () => {
    mockRunAiRequest.mockReset()
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    mockRunAiRequest.mockResolvedValue(answerOf({ sections: [] }, ZERO))
    await runPage(doc, '/commercial')
    const prompt = String(sent()[0]?.messages[0]?.content)
    expect(prompt).toContain('This page says little, so it stays short')
    expect(toldOf(prompt)?.sections).toBeLessThanOrEqual(AI_SITE_IMPORT_THIN_MOST_SECTIONS)
    const ledger = aiSiteImportImproveLedger(doc)
    expect(aiSiteImportImproveRoom({ model, spent: ZERO, system: [], toolChars: 0, promptChars: 0, most: 7_630, ledger: { lines: [] }, proposed: true }).thin).toBeNull()
    expect(ledger.lines.length).toBeGreaterThan(0)
    jest.restoreAllMocks()
  })
})

describe('an invented value', () => {
  it('is named with the sentence it sat in, cut short, for the re-ask and the log', () => {
    const answer = JSON.parse(JSON.stringify(SITE_IMPORT_IMPROVE_ANSWERS.contractor)) as { sections: Array<{ blocks: Array<Record<string, unknown>> }> }
    const long = 'Every slab is poured to the grade the engineer sets and cured before it carries a load, and every one of our crews pours 6-inch slabs with steel set in place, checked twice before the trucks arrive on site.'
    const lede = answer.sections.flatMap((section) => section.blocks).find((block) => block['kind'] === 'lede') as Record<string, unknown>
    lede['text'] = long
    const theme = siteImportReplayTheme('contractor', 'improve', { generative: true })
    const replay = siteImportReplayImproved('contractor', answer, { theme })
    const report = siteImportFidelity(replay.source, replay.tree, { finish: 'improve', words: 'improved', theme, improved: { scope: replay.scope, destinations: replay.destinations, forms: 1, frame: siteImportReplayFrame('contractor', { generative: true }).tree } })
    const invented = report.improved?.ledger.invented
    expect(invented?.found).toEqual(expect.arrayContaining(['number:6']))
    const at = invented?.at?.find((line) => line.includes('6-inch')) ?? ''
    expect(at.length).toBeLessThanOrEqual(120)
    expect(at.startsWith('…')).toBe(true)
    const miss = aiSiteImportImprovedMisses(report).find((violation) => violation.code === 'improve-invented')
    expect(miss?.detail).toContain('Named: ')
    expect(miss?.detail).toContain(`In: "${at}"`)
    expect(miss?.message).toContain('say only what the site states')
  })
})
