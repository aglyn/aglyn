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
 * A generative Improve it, tuned from its first paid eval (AGL-4152), offline:
 * a page is planned as a designer's page with the new sections its role asks
 * for; a long page folds its groups, so one answer places them whole inside
 * its ceiling; the ceiling holds in code, re-ask included; and the design
 * lines go red on a page that draws no group, never on a question list.
 * Every answer here is written by hand in the tool's shape: no model is called.
 */

const mockRunAiRequest = jest.fn()
jest.mock('../runtime/ai-runtime', () => ({
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_SITE_IMPORT_PAGE_CEILING_CREDITS, AI_SITE_IMPORT_GENERATED_PICTURES_DEFAULT, aiSiteImportGeneratedPicturesOn } from '../model/ai-site-import'
import { siteImportFidelity, type SiteImportFidelityTree } from '../model/ai-site-import-fidelity'
import { siteImportLedger } from '../model/ai-site-import-ledger'
import { siteImportReplayDocument, siteImportReplayDocumentOf, siteImportReplayImproved } from '../site-import/fixtures/site-import-fidelity-replay'
import { SITE_IMPORT_IMPROVE_ANSWERS, SITE_IMPORT_IMPROVE_LONG_HOME_ANSWER } from '../site-import/fixtures/site-import-improve-answers'
import { aiRunLayoutPage } from './ai-job-page-language'
import { aiSiteImportSectionNames } from './ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportHonesty } from './ai-site-import-honesty'
import {
  AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS,
  aiReadImprovedPage,
  aiSiteImportImproveCredits,
  aiSiteImportImproveDestinations,
  aiSiteImportImproveLedger,
  aiSiteImportImproveNewSections,
  aiSiteImportImprovePlanMisses,
  aiSiteImportImproveReaskTokens,
  aiSiteImportImproveRoleLines,
  aiSiteImportImproveScope,
  aiSiteImportImproveTokensWithin,
  aiSiteImportLedgerText,
  aiSiteImportNewSectionsWanted,
  aiSiteImportPageRoleOf,
} from './ai-site-import-improve'

type Answer = { sections: Array<{ band: string; cols: number[]; align: string; blocks: Array<Record<string, unknown>> }> }

const block = (kind: string, rest: Partial<{ col: number; text: string; to: string; style: string; icon: string; items: Array<Record<string, string>>; ref: string }> = {}) => ({
  kind,
  col: rest.col ?? -1,
  text: rest.text ?? '',
  to: rest.to ?? '',
  style: rest.style ?? 'none',
  icon: rest.icon ?? '',
  items: rest.items ?? [],
  ref: rest.ref ?? '',
})
const item = (title: string, text: string, rest: Partial<{ to: string; icon: string; ref: string }> = {}) => ({ title, text, to: rest.to ?? '', icon: rest.icon ?? '', ref: rest.ref ?? '' })
const section = (band: string, blocks: Array<Record<string, unknown>>, rest: Partial<{ cols: number[]; align: string }> = {}) => ({ band, cols: rest.cols ?? [], align: rest.align ?? 'start', blocks })
const keep = (ref: string, col = -1) => block('keep', { ref, col })

/**
 * The contractor's page as the first eval's answers drew it, in structure: a
 * hero, the services as cards, two pictures side by side, the quote beside the
 * contact line, a closing band. Organized, and timid: nothing the old page
 * did not have.
 */
const TIMID: Answer = {
  sections: [
    section('dark', [block('heading', { col: 0, text: 'Roofs and remodels done right' }), block('lede', { col: 0, text: 'Licensed and insured, license 88213.' }), block('button', { col: 0, text: 'Ask for an estimate', to: 'link:1', style: 'primary' }), block('button', { col: 0, text: 'See our projects', to: 'link:2', style: 'quiet' }), keep('picture:1', 1)], { cols: [6, 5] }),
    section('plain', [block('heading', { text: 'Our services' }), block('cards', { items: [item('Roof repair', 'Fixes after storms, leaks and age.', { icon: 'roof' }), item('New roofs', 'Asphalt, metal and cedar.', { icon: 'roof' }), item('Siding and gutters', 'Fitted and sealed.', { icon: 'home' }), item('Kitchen remodels', 'From cabinets to counters.', { icon: 'hammer' })] })], { align: 'center' }),
    section('soft', [block('heading', { text: 'Recent work' }), keep('picture:2', 0), block('text', { col: 0, text: 'A standing seam roof on a lake house.' }), keep('picture:3', 1), block('text', { col: 1, text: 'A kitchen opened up to the dining room.' })], { cols: [1, 1] }),
    section('plain', [block('heading', { col: 0, text: 'What neighbors say' }), keep('quote:1', 0), keep('contact:1', 1)], { cols: [7, 5] }),
    section('brand', [block('heading', { text: 'Ready for a roof or kitchen you can count on?' }), block('button', { text: 'Ask for an estimate', to: 'link:1', style: 'primary' })], { align: 'center' }),
  ],
}

const honest = (doc: AiSiteImportDocument, answer: Answer) => {
  const ledger = aiSiteImportImproveLedger(doc)
  const read = aiReadImprovedPage(answer)
  if (!read) throw new Error('no section')
  const formAt = read.findIndex((entry) => entry.blocks.some((entry) => entry.kind === 'keep' && entry.ref.startsWith('form:')))
  return aiSiteImportHonesty(read, { ledger, scope: aiSiteImportImproveScope(doc, null), destinations: aiSiteImportImproveDestinations(doc, ledger, { sections: read.length, formSection: formAt === -1 ? null : formAt }), framing: null })
}

describe('a long page folds its groups, so one answer holds it', () => {
  const doc = siteImportReplayDocument('home')
  const ledger = aiSiteImportImproveLedger(doc)

  it('folds: every group and whole thing is kept whole, each group shown by its titles, its links held by its keep', () => {
    expect(ledger.folded).toBe(true)
    const groups = ledger.items.filter((entry) => entry.kind === 'group')
    expect(groups.length).toBeGreaterThanOrEqual(6)
    expect(groups.every((entry) => entry.must && entry.folded)).toBe(true)
    expect(ledger.items.filter((entry) => entry.kind === 'picture').every((entry) => entry.section === 0 || !entry.must)).toBe(true)
    const text = aiSiteImportLedgerText(ledger, doc, aiSiteImportImproveDestinations(doc, ledger))
    // The 13 like items are one line, and their 13 links are not listed again.
    expect(text).toMatch(/group:\d+ must \(13 cards, 13 linked: "Besigner"/)
    expect(text).not.toContain('page:p-product-workflows')
    expect(text.length).toBeLessThan(7_000)
  })

  it('keeps every item of a group of more than seven, where the layout language stops at seven', () => {
    const read = aiReadImprovedPage({ sections: [section('plain', [block('cards', { items: Array.from({ length: 13 }, (_, at) => item(`Item ${at + 1}`, 'Words.')) })])] })
    expect(read?.[0]?.blocks[0]).toMatchObject({ kind: 'cards' })
    expect((read?.[0]?.blocks[0] as { items?: unknown[] }).items).toHaveLength(13)
  })

  it('takes a page answered with its groups kept: honest, built, and every ledger and design line green', () => {
    expect(honest(doc, SITE_IMPORT_IMPROVE_LONG_HOME_ANSWER as Answer)).toEqual([])
    const replay = siteImportReplayImproved('home', SITE_IMPORT_IMPROVE_LONG_HOME_ANSWER)
    expect(replay.violations).toEqual([])
    const report = siteImportFidelity(replay.source, replay.tree, { finish: 'improve', words: 'improved', improved: { scope: replay.scope, destinations: replay.destinations, forms: 0 } })
    expect(report.improved?.holds).toBe(true)
    expect(report.improved?.red).toEqual([])
    // Kept whole, the 13 linked cards are all on the page.
    const hrefs = Object.values(replay.tree.nodes).map((node) => (node as { props?: Record<string, unknown> }).props?.['screenId'])
    for (const page of ['p-product-workflows', 'p-product-ai', 'p-create-a-website']) expect(hrefs).toContain(page)
  })

  it('refuses a group left out, and a picture placed again inside a group kept whole', () => {
    const left: Answer = JSON.parse(JSON.stringify(SITE_IMPORT_IMPROVE_LONG_HOME_ANSWER)) as Answer
    left.sections[3]!.blocks = left.sections[3]!.blocks.filter((entry) => entry['ref'] !== 'group:2')
    expect(honest(doc, left).map((violation) => violation.message)).toEqual(expect.arrayContaining([expect.stringContaining('group:2 is not on the page. Place it with a keep block, exactly once: this page is long')]))
    const small = siteImportReplayDocument('tax-firm')
    const smallLedger = aiSiteImportImproveLedger(small)
    const cards = smallLedger.items.find((entry) => entry.kind === 'group')
    if (cards?.holds?.length) {
      const twice: Answer = JSON.parse(JSON.stringify(SITE_IMPORT_IMPROVE_ANSWERS['tax-firm']))
      twice.sections[1]!.blocks = [block('heading', { text: 'What we do' }), keep(cards.ref), keep(cards.holds[0] as string)]
      expect(honest(small, twice).map((violation) => violation.message)).toEqual(expect.arrayContaining([expect.stringContaining(`keeping ${cards.ref} whole places it already`)]))
    }
  })

  it('asks no new section of a long page, and says it is long', () => {
    expect(aiSiteImportNewSectionsWanted('home', ledger)).toBe(0)
    expect(aiSiteImportImproveRoleLines({ role: 'home', wanted: 0, folded: true, kind: 'business', seed: 7 }).join(' ')).toContain('It is long')
  })
})

describe('a page planned as a designer’s page', () => {
  it('reads a page’s role from its plan, else its address and what it holds', () => {
    const doc = siteImportReplayDocument('contractor')
    expect(aiSiteImportPageRoleOf(doc, '/')).toBe('home')
    expect(aiSiteImportPageRoleOf({ ...doc, title: 'Contact' }, '/contact')).toBe('contact')
    expect(aiSiteImportPageRoleOf({ ...doc, title: 'Our story' }, '/about')).toBe('about')
    expect(aiSiteImportPageRoleOf({ ...doc, title: 'Roof repair' }, '/roof-repair')).toBe('service')
    expect(aiSiteImportPageRoleOf({ ...doc, role: 'gallery' }, '/anything')).toBe('gallery')
  })

  it('asks two new sections of a small home page and none of a contact page, whose form is framed', () => {
    const ledger = aiSiteImportImproveLedger(siteImportReplayDocument('contractor'))
    expect(aiSiteImportNewSectionsWanted('home', ledger)).toBe(2)
    expect(aiSiteImportNewSectionsWanted('service', ledger)).toBe(2)
    expect(aiSiteImportNewSectionsWanted('contact', ledger)).toBe(0)
    expect(aiSiteImportNewSectionsWanted('home', ledger, true)).toBe(0)
    const home = aiSiteImportImproveRoleLines({ role: 'home', wanted: 2, folded: false, kind: 'trades', seed: 7 }).join(' ')
    expect(home).toContain("This page's role: home")
    expect(home).toContain('at least 2 new sections')
    // A home tells its story as a site start's does.
    expect(home).toContain('This home tells its story in this order')
    expect(aiSiteImportImproveRoleLines({ role: 'contact', wanted: 0, folded: false, seed: 7 }).join(' ')).toContain('the form on a framed ground')
  })

  it('reads the first eval’s timid page red: no new section; the designer’s page green, with two', () => {
    const doc = siteImportReplayDocument('contractor')
    const ledger = aiSiteImportImproveLedger(doc)
    const needs = { role: 'home' as const, wanted: aiSiteImportNewSectionsWanted('home', ledger) }
    const timid = aiReadImprovedPage(TIMID)
    expect(aiSiteImportImproveNewSections(timid ?? [], ledger)).toEqual([])
    expect(aiSiteImportImprovePlanMisses(timid ?? [], { ledger, needs }).map((miss) => miss.code)).toEqual(['improve-new-sections'])
    const designed = aiReadImprovedPage(SITE_IMPORT_IMPROVE_ANSWERS.contractor) ?? []
    expect(aiSiteImportImproveNewSections(designed, ledger).length).toBe(2)
    expect(aiSiteImportImprovePlanMisses(designed, { ledger, needs })).toEqual([])
  })

  it('names an opening with no picture, and a page drawn in one or two shapes', () => {
    const ledger = aiSiteImportImproveLedger(siteImportReplayDocument('contractor'))
    const flat = aiReadImprovedPage({
      sections: [
        section('plain', [block('heading', { text: 'Roofs and remodels done right' }), block('button', { text: 'Ask for an estimate', to: 'link:1', style: 'primary' })]),
        section('soft', [block('heading', { text: 'Roof repair' }), block('text', { text: 'After storms, leaks and age.' })]),
        section('plain', [block('heading', { text: 'New roofs' }), block('text', { text: 'Asphalt, metal and cedar.' })]),
        section('soft', [block('heading', { text: 'Kitchens' }), block('text', { text: 'From cabinets to counters.' })]),
      ],
    })
    const codes = aiSiteImportImprovePlanMisses(flat ?? [], { ledger, needs: { role: 'home', wanted: 0 } }).map((miss) => miss.code)
    expect(codes).toEqual(['improve-opening', 'improve-shapes'])
  })

  it('reads a paragraph that is only its link’s words as the link, never a line of its own', () => {
    const ledger = siteImportLedger({ layout: siteImportReplayDocument('contractor').layout as never, blocks: siteImportReplayDocument('contractor').blocks })
    expect(ledger.lines.filter((line) => line.text === 'Ask for an estimate')).toEqual([])
    expect(ledger.links.map((link) => link.text)).toContain('Ask for an estimate')
  })
})

describe('the design lines', () => {
  const lines = (name: 'contractor' | 'clinic', answer: Answer) => {
    const replay = siteImportReplayImproved(name, answer)
    return siteImportFidelity(replay.source, replay.tree, { finish: 'improve', words: 'improved', improved: { scope: replay.scope, destinations: replay.destinations, forms: 1 } }).improved
  }

  it('go red on a page that draws no group, and green on the designer’s page', () => {
    const noGroup: Answer = JSON.parse(JSON.stringify(TIMID))
    noGroup.sections[1] = section('plain', [block('heading', { col: 0, text: 'Our services' }), block('text', { col: 0, text: 'Roof repair after storms, leaks and age, and new roofs in asphalt, metal and cedar.' }), block('text', { col: 1, text: 'Siding and gutters, fitted and sealed, and kitchen remodels from cabinets to counters.' })], { cols: [1, 1] })
    expect(lines('contractor', noGroup)?.design.columns?.ok).toBe(false)
    expect(lines('contractor', SITE_IMPORT_IMPROVE_ANSWERS.contractor as Answer)?.design.columns?.ok).toBe(true)
  })

  it('never read a question list’s questions and answers as lines stacked one under another', () => {
    const answer: Answer = JSON.parse(JSON.stringify(SITE_IMPORT_IMPROVE_ANSWERS.clinic))
    const faq = answer.sections.find((entry) => entry.blocks.some((entry) => entry['kind'] === 'faq'))
    const group = faq?.blocks.find((entry) => entry['kind'] === 'faq') as { items: Array<Record<string, string>> }
    group.items.push(item('Do you see children?', 'Yes. Primary care for children and adults.'), item('Can I come this week?', 'Yes, with same-week visits.'))
    expect(lines('clinic', answer)?.design.columns?.ok).toBe(true)
  })
})

describe('the ceiling holds per page, in code', () => {
  const model = 'claude-sonnet-5-5'
  const usage = (input: number, output: number, cached = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: cached, cacheWriteTokens: 0 })

  it('asks no more output than the page’s ceiling buys', () => {
    const input = usage(3_000, 0, 4_000)
    const most = aiSiteImportImproveTokensWithin({ model, spent: usage(0, 0), input, most: 8_000 })
    expect(most).toBeGreaterThan(2_000)
    expect(aiSiteImportImproveCredits({ ...input, outputTokens: most }, model)).toBeLessThanOrEqual(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS)
    expect(aiSiteImportImproveCredits({ ...input, outputTokens: most + 200 }, model)).toBeGreaterThan(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS)
    expect(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS).toBeLessThan(AI_SITE_IMPORT_PAGE_CEILING_CREDITS)
  })

  it('asks no re-ask it cannot pay for: a long answer missed is the page’s fallback, a short one is asked again', () => {
    expect(aiSiteImportImproveReaskTokens({ model, spent: usage(5_500, 4_000, 4_600), lastOutput: 4_000, most: 8_000 })).toBe(0)
    const room = aiSiteImportImproveReaskTokens({ model, spent: usage(900, 1_300, 2_900), lastOutput: 1_300, most: 8_000 })
    expect(room).toBeGreaterThanOrEqual(1_300)
    expect(aiSiteImportImproveCredits({ ...usage(900 * 2 + 600, 1_300 + room, 2_900 * 2) }, model)).toBeLessThanOrEqual(AI_SITE_IMPORT_IMPROVE_CEILING_CREDITS)
  })

  it('falls back on a long page’s miss without a second request, inside its ceiling', async () => {
    mockRunAiRequest.mockReset()
    const left: Answer = JSON.parse(JSON.stringify(SITE_IMPORT_IMPROVE_LONG_HOME_ANSWER)) as Answer
    left.sections[3]!.blocks = left.sections[3]!.blocks.filter((entry) => entry['ref'] !== 'group:2')
    mockRunAiRequest.mockResolvedValue({ kind: 'completion', text: '', toolUse: [{ name: 'submit_improved_page', input: left }], usage: usage(2_400, 3_400, 4_600), estCostUsd: 0, stopReason: 'tool_use' })
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const doc: AiSiteImportDocument = { ...siteImportReplayDocument('home'), finish: 'improve', wording: 'improved', generative: true, siteLines: ['Aglyn'] }
    const names = aiSiteImportSectionNames(doc)
    const screen = { title: doc.title, slug: '/', sections: names.map((name) => ({ name, uses: [] as string[], items: 0 })) }
    const result = await aiRunLayoutPage({
      job: { $id: 'job-long-home', brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: 'Aglyn', siteKind: 'landing', siteStyle: { seed: 7 } } },
      plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
      screen: screen as never,
      sectionIds: names.map((_, index) => `sec-${index}`),
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: doc.links.map((link) => link.id), formIds: [], componentIds: [], codeBuilt: true },
      reusableComponents: false,
      inventory: null,
      model,
    })
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    const asked = mockRunAiRequest.mock.calls[0]?.[0] as { maxTokens: number }
    expect(asked.maxTokens).toBeLessThan(8_000)
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.value.redesign?.status).toBe('layout-kept')
    expect(aiSiteImportImproveCredits(result.usage, model)).toBeLessThanOrEqual(AI_SITE_IMPORT_PAGE_CEILING_CREDITS)
    const root = (result.status === 'ok' ? (result.value.nodes as unknown as SiteImportFidelityTree['nodes']) : {})[CANVAS_ROOT_ELEMENT_ID]
    expect(root).toBeTruthy()
  })
})

describe('a gallery', () => {
  // A page that does not exist: a heading, a line, and nine photos laid out as a grid.
  const URL_OF_PAGE = 'https://www.harbor-tile.example/work'
  const photo = (name: string) => `<figure><img src="https://www.harbor-tile.example/media/${name}.jpg" alt="A tiled ${name}" width="1200" height="900" sizes="(max-width:768px) 46vw, 28vw" style="object-fit: cover; width: 100%; height: 100%"></figure>`
  const html = `<!doctype html><html><head><title>Our work</title><style>.gallery { display: grid; gap: 20px; }</style></head><body><main><section><h1>Our work</h1><p>Floors, walls and showers, set by hand.</p></section><section><h2>Recent jobs</h2><div class="gallery">${['floor', 'wall', 'shower', 'bath', 'kitchen', 'porch', 'stair', 'hall', 'entry'].map(photo).join('')}</div></section></main></body></html>`
  const doc = siteImportReplayDocumentOf(html, URL_OF_PAGE, (url) => url.hostname === 'www.harbor-tile.example')

  it('is one keep ref, its photos with it, drawn as a grid of them', () => {
    const ledger = aiSiteImportImproveLedger(doc)
    const gallery = ledger.items.find((entry) => entry.kind === 'gallery')
    expect(gallery?.ref).toBe('gallery:1')
    expect(ledger.items.filter((entry) => entry.kind === 'picture')).toEqual([])
    expect(aiSiteImportLedgerText(ledger, doc, aiSiteImportImproveDestinations(doc, ledger))).toMatch(/gallery:1 \(a gallery of 9 photos, drawn as a grid/)
    const read = aiReadImprovedPage({
      sections: [
        section('plain', [block('heading', { text: 'Tile work, set by hand' }), block('lede', { text: 'Floors, walls and showers.' })]),
        section('soft', [block('heading', { text: 'Recent jobs' }), keep('gallery:1')]),
      ],
    })
    expect(aiSiteImportHonesty(read ?? [], { ledger, scope: aiSiteImportImproveScope(doc, null), destinations: aiSiteImportImproveDestinations(doc, ledger), framing: null })).toEqual([])
  })
})

describe('generated pictures', () => {
  it('are on where the owner has not said, with a switch that turns them off', () => {
    expect(AI_SITE_IMPORT_GENERATED_PICTURES_DEFAULT).toBe(true)
    expect(aiSiteImportGeneratedPicturesOn({})).toBe(true)
    expect(aiSiteImportGeneratedPicturesOn({ generatedPictures: false })).toBe(false)
  })
})
