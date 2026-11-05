/**
 * @jest-environment node
 */
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
 * Improve it, generative (AGL-4152), with no model: the tool and its cached
 * text, the ledger, the honesty validator, the page compiled from an answer
 * written by hand, the page step's answer on a stubbed provider with its one
 * re-ask and its fallback, each measure red on what today's build draws and
 * green on a redesign, and the flag off leaving today's Improve it and Keep my
 * site as they were, to the byte.
 */

const mockRunAiRequest = jest.fn()

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

import { createHash } from 'node:crypto'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { isReleaseFlagOnForOrg, RELEASE_FLAGS } from '@aglyn/aglyn/app-utils/release-flags'
import { aiCacheMarkerTtls } from '../providers/contract'
import { AI_LAYOUT_DESIGN_TOOL } from '../layout-language/ai-layout-language'
import { aiLayoutPictureSlots } from '../layout-language/ai-layout-pictures'
import { AI_SITE_IMPORT_LAYOUT_KEPT, aiSiteImportRedesignOf, aiSiteImportWaveStamped, type AiSiteImportPage, type AiSiteImportState } from '../model/ai-site-import'
import { siteImportFidelity, SITE_IMPORT_IMPROVED_LINES, type SiteImportImprovedFidelity } from '../model/ai-site-import-fidelity'
import { siteImportLedger } from '../model/ai-site-import-ledger'
import { aiSiteColors, aiSiteTheme, type AiSiteStyle } from '../model/ai-site-look'
import { aiSiteImportWaveRows } from '../model/ai-site-import-view'
import { aiDoctrineSystemBlocks } from '../runtime/ai-doctrine'
import { validateAiSystemBlocks } from '../runtime/ai-runtime'
import { SITE_IMPORT_GENERATIVE_RELEASE_FLAG } from '../site-import/site-import-flag'
import { siteImportReplayDocument, siteImportReplayFrame, siteImportReplayImproved, siteImportReplayOneGroundSeed, siteImportReplayPage, siteImportReplayTheme } from '../site-import/fixtures/site-import-fidelity-replay'
import { SITE_IMPORT_IMPROVE_ANSWERS } from '../site-import/fixtures/site-import-improve-answers'
import type { SiteBasicPageName } from '../site-import/fixtures/site-layout-recordings'
import { aiSiteImportDocumentFor, aiSiteImportFrameSource } from './ai-job-import-step'
import { AI_LAYOUT_DESIGN_TEXT, aiRunLayoutPage } from './ai-job-page-language'
import { aiSiteImportSectionNames } from './ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, aiSiteImportDocumentOf, type AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportHonesty, aiSiteImportHonestyFacts, aiSiteImportInventedIn, AI_SITE_IMPORT_DROPPED_ITEM_CODE, AI_SITE_IMPORT_INVENTED_FACT_CODE } from './ai-site-import-honesty'
import {
  AI_SITE_IMPORT_IMPROVE_TEXT,
  AI_SITE_IMPORT_IMPROVE_TOOL,
  aiReadImprovedPage,
  aiSiteImportImproveDestinations,
  aiSiteImportImproveInstructions,
  aiSiteImportImproveLedger,
  aiSiteImportImproveScope,
  aiSiteImportImprovedMisses,
  aiSiteImportLedgerText,
} from './ai-site-import-improve'
import { aiSiteImportStyle } from './ai-site-import-look'

const BASIC: readonly SiteBasicPageName[] = ['tax-firm', 'contractor', 'salon', 'clinic']
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

type Answer = { sections: Array<{ blocks: Array<Record<string, unknown>> } & Record<string, unknown>> }
const copied = (name: SiteBasicPageName): Answer => JSON.parse(JSON.stringify(SITE_IMPORT_IMPROVE_ANSWERS[name]))

const honestyOf = (name: SiteBasicPageName, answer: unknown) => {
  const doc = siteImportReplayDocument(name)
  const ledger = aiSiteImportImproveLedger(doc)
  const read = aiReadImprovedPage(answer) ?? []
  const formAt = read.findIndex((section) => section.blocks.some((block) => block.kind === 'keep' && (block as { ref: string }).ref.startsWith('form:')))
  return aiSiteImportHonesty(read, {
    ledger,
    scope: aiSiteImportImproveScope(doc, null),
    destinations: aiSiteImportImproveDestinations(doc, ledger, { sections: read.length, formSection: formAt === -1 ? null : formAt }),
  })
}

describe('the flag (AGL-4152)', () => {
  const entry = RELEASE_FLAGS.find((flag) => flag.key === SITE_IMPORT_GENERATIVE_RELEASE_FLAG)

  it('is registered off, and only a per-org override turns it on', () => {
    expect(entry?.defaultEnabled).toBe(false)
    const off = { enabled: false, rolloutPercent: 0 }
    expect(isReleaseFlagOnForOrg(SITE_IMPORT_GENERATIVE_RELEASE_FLAG, off, 'org-1', {}, null)).toBe(false)
    expect(isReleaseFlagOnForOrg(SITE_IMPORT_GENERATIVE_RELEASE_FLAG, off, 'org-1', { [SITE_IMPORT_GENERATIVE_RELEASE_FLAG]: true }, null)).toBe(true)
  })

  const state = (choice: Partial<AiSiteImportState>): AiSiteImportState =>
    ({
      domain: 'larkspur-tax.example',
      siteName: 'Larkspur',
      pages: [{ slot: 'p0', url: 'https://larkspur-tax.example/', path: '/', title: 'Home', group: 'main', wave: 1, draftId: 'd0', slug: '/', words: 80, images: 1, build: 'arranged', read: { blocks: siteImportReplayDocument('tax-firm').blocks } }],
      waves: [{ index: 1, label: 'Wave 1', group: 'main', slots: ['p0'], frame: false, status: 'running', startedAt: 'x', finishedAt: null }],
      ...choice,
    }) as unknown as AiSiteImportState

  it('stamps a wave only under Improve it with copy on, and off the document is as it was', () => {
    const asked = { finish: 'improve' as const, wording: true }
    expect(aiSiteImportWaveStamped(state(asked), 1, { generative: true }).waves[0]?.generative).toBe(true)
    expect(aiSiteImportWaveStamped(state({ finish: 'improve', wording: false }), 1, { generative: true }).waves[0]?.generative).toBeUndefined()
    expect(aiSiteImportWaveStamped(state({ finish: 'keep', wording: false }), 1, { generative: true }).waves[0]?.generative).toBeUndefined()

    const off = aiSiteImportWaveStamped(state(asked), 1)
    expect(Object.keys(off.waves[0] ?? {})).not.toContain('generative')
    const doc = aiSiteImportDocumentFor(off, off.pages[0] as AiSiteImportPage)
    for (const key of ['generative', 'siteLines', 'scope', 'plan', 'theme']) expect(Object.keys(doc ?? {})).not.toContain(key)

    const on = aiSiteImportWaveStamped(state(asked), 1, { generative: true })
    const redesigned = aiSiteImportDocumentFor(on, on.pages[0] as AiSiteImportPage)
    expect(redesigned).toMatchObject({ generative: true, finish: 'improve', wording: 'improved' })
    // Through the job's input, as the page step reads it.
    expect(aiSiteImportDocumentOf({ [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: JSON.parse(JSON.stringify(redesigned)) })?.generative).toBe(true)
  })
})

describe('Keep my site and today’s Improve it, to the byte', () => {
  it('leaves submit_design as it was: its text and its tool', () => {
    expect(sha(AI_LAYOUT_DESIGN_TEXT)).toBe('de6ee2cf28bf625e7f982e10af9f49f511239d8f28d4897ef9564cdf09ab3fe4')
    expect(sha(JSON.stringify(AI_LAYOUT_DESIGN_TOOL))).toBe('02fcea665d78b12fcc901866c2d2c6fe3a160e91e371c0f39e817b5f6538c455')
  })

  it('draws a kept theme as it did: a bright brand is no fill of its own without the flag', () => {
    const facts = { ...siteImportReplayDocument('tax-firm').layout?.look } as never
    const keep = aiSiteImportStyle(null, { seed: 7, description: 'x', facts, finish: 'keep', generative: true })
    const off = aiSiteImportStyle(null, { seed: 7, description: 'x', facts, finish: 'keep' })
    expect(keep).toEqual(off)
    const improve = aiSiteImportStyle(null, { seed: 7, description: 'x', facts, finish: 'improve' })
    expect(improve?.brandFill).toBeUndefined()
    expect(aiSiteColors(improve as AiSiteStyle)).toEqual(aiSiteColors({ ...(improve as AiSiteStyle), brandFill: undefined }))
  })
})

describe('the tool and its cached text', () => {
  const blockSchema = (AI_SITE_IMPORT_IMPROVE_TOOL.inputSchema as any).properties.sections.items.properties.blocks.items.properties

  it('adds keep, and a quote or a figure arrives only by keep', () => {
    expect(AI_SITE_IMPORT_IMPROVE_TOOL.name).toBe('submit_improved_page')
    expect(AI_SITE_IMPORT_IMPROVE_TOOL.strict).toBe(true)
    expect(blockSchema.kind.enum).toEqual(expect.arrayContaining(['heading', 'lede', 'text', 'cards', 'steps', 'faq', 'list', 'button', 'image', 'keep']))
    for (const kind of ['quotes', 'stats', 'form', 'component']) expect(blockSchema.kind.enum).not.toContain(kind)
    expect(blockSchema.ref).toEqual({ type: 'string' })
  })

  it('caches the platform’s text, then the site’s digest, and the ledger in neither', () => {
    const system = aiDoctrineSystemBlocks(undefined, { instructions: aiSiteImportImproveInstructions('Larkspur digest'), scope: 'fields' })
    expect(() => validateAiSystemBlocks(system)).not.toThrow()
    const ttls = aiCacheMarkerTtls({ system, messages: [{ role: 'user', content: 'x' }], cacheTtl: '1h' })
    expect(ttls.system.filter(Boolean).at(-2)).toBe('1h')
    // A site's own block keeps the provider's five minutes, whatever the route asks: only one job reads it.
    expect(ttls.system.filter(Boolean).at(-1)).toBe('5m')
    expect(AI_SITE_IMPORT_IMPROVE_TEXT).not.toContain('Larkspur')
  })

  it('demands real design in general terms: nothing of any one site', () => {
    for (const word of ['filled primary button', 'closing call to action', 'Never stack pictures', 'Neighboring sections never share a ground', 'Plan the grid']) expect(AI_SITE_IMPORT_IMPROVE_TEXT).toContain(word)
    expect(AI_SITE_IMPORT_IMPROVE_TEXT).toContain('Never write a name, number, price, date, testimonial, client, award, credential, address or guarantee')
  })
})

describe('the ledger', () => {
  it('names what a page holds by ref, each link’s destination, and its lines', () => {
    const doc = siteImportReplayDocument('tax-firm')
    const ledger = aiSiteImportImproveLedger(doc)
    expect(ledger.items.map((item) => item.ref)).toEqual(['picture:1', 'picture:2', 'picture:3', 'picture:4', 'contact:1', 'form:1'])
    // The picture a page opens on outranks a new one; another may be listed.
    expect(ledger.items.filter((item) => item.must).map((item) => item.ref)).toEqual(['picture:1', 'contact:1', 'form:1'])
    const text = aiSiteImportLedgerText(ledger, doc, aiSiteImportImproveDestinations(doc, ledger))
    expect(text).toContain('picture:1 must (1600×900, "A pen resting on a clean desk")')
    expect(text).toContain('link:1 → page:p-contact ("Start Now")')
    expect(text).toContain('heading: What we do')
  })

  it('holds a table, a quote and a contact line whole, on any basic site', () => {
    const kinds = (name: SiteBasicPageName) => siteImportLedger(siteImportReplayDocument(name) as never).items.map((item) => item.kind)
    expect(kinds('salon')).toEqual(expect.arrayContaining(['table', 'contact']))
    expect(kinds('contractor')).toEqual(expect.arrayContaining(['quote', 'contact']))
    expect(kinds('clinic')).toEqual(expect.arrayContaining(['form', 'contact']))
  })
})

describe('the honesty validator', () => {
  const held = aiSiteImportHonestyFacts(['Family owned since 1994. Tax help from Larkspur for small businesses, by Dana Reyes.'])

  it.each([
    ['a number', 'Serving you for 30 years.'],
    ['a price', 'Returns from $49.'],
    ['a name', 'Work with our partner Marcus Hale today.'],
    ['a credential', 'Our certified team knows the code.'],
    ['a guarantee', 'Every filing is guaranteed.'],
    ['an award', 'An award-winning firm.'],
    ['a count in words', 'Thousands of clients trust our work.'],
    ['a count of years in words', 'Backed by ten years of work.'],
    ['a testimonial', '“They saved my business more than I can say.”'],
  ])('refuses %s the site does not give', (_, line) => {
    expect(aiSiteImportInventedIn(line, held)).toEqual(expect.any(String))
  })

  it.each([
    ['what the source says', 'Family owned since 1994, by Dana Reyes.'],
    ['what this kind of business generally does', 'We prepare your return, answer your questions and file on time.'],
    ['a question list’s short name', 'Read our FAQ before you call.'],
  ])('admits %s', (_, line) => {
    expect(aiSiteImportInventedIn(line, held)).toBeNull()
  })

  it.each(BASIC)('%s: the recorded answer is honest', (name) => {
    expect(honestyOf(name, SITE_IMPORT_IMPROVE_ANSWERS[name])).toEqual([])
  })

  it('names the line an invented fact is on', () => {
    const answer = copied('tax-firm')
    ;(answer.sections[0] as Answer['sections'][number]).blocks[2] = { kind: 'lede', col: -1, text: 'Trusted by 400 families.', to: '', style: 'none', icon: '', items: [], ref: '' }
    const violations = honestyOf('tax-firm', answer)
    expect(violations.map((violation) => violation.code)).toContain(AI_SITE_IMPORT_INVENTED_FACT_CODE)
    expect(violations[0]?.message).toContain('section 1, block 3')
    expect(violations[0]?.message).toContain('Trusted by 400 families.')
  })

  it('refuses a thing the page must keep left out, placed twice, or a ref it does not hold', () => {
    const left = copied('tax-firm')
    const last = left.sections[3] as Answer['sections'][number]
    last.blocks = last.blocks.filter((block) => block['ref'] !== 'form:1')
    expect(honestyOf('tax-firm', left).map((violation) => violation.message)).toEqual(expect.arrayContaining([expect.stringContaining('form:1 is not on the page')]))
    const twice = copied('tax-firm')
    ;(twice.sections[2] as Answer['sections'][number]).blocks.push({ kind: 'keep', col: -1, text: '', to: '', style: 'none', icon: '', items: [], ref: 'form:1' })
    expect(honestyOf('tax-firm', twice).map((violation) => violation.message)).toEqual(expect.arrayContaining([expect.stringContaining('form:1 is placed 2 times')]))
    const none = copied('tax-firm')
    ;(none.sections[2] as Answer['sections'][number]).blocks.push({ kind: 'keep', col: -1, text: '', to: '', style: 'none', icon: '', items: [], ref: 'video:9' })
    expect(honestyOf('tax-firm', none).map((violation) => violation.code)).toContain(AI_SITE_IMPORT_DROPPED_ITEM_CODE)
  })

  it('refuses a link that goes where the source does not, and a source’s link left out', () => {
    const away = copied('salon')
    ;(away.sections[0] as Answer['sections'][number]).blocks[2] = { kind: 'button', col: -1, text: 'Book a chair', to: 'https://elsewhere.example/', style: 'primary', icon: '', items: [], ref: '' }
    const violations = honestyOf('salon', away)
    expect(violations.map((violation) => violation.code)).toContain(AI_SITE_IMPORT_INVENTED_FACT_CODE)
    const dropped = copied('salon')
    const last = dropped.sections[3] as Answer['sections'][number]
    last.blocks = last.blocks.filter((block) => block['to'] !== 'link:2')
    expect(honestyOf('salon', dropped).map((violation) => violation.message)).toEqual(expect.arrayContaining([expect.stringContaining('link:2')]))
  })
})

const NOW_FRAME = (name: SiteBasicPageName) => siteImportReplayFrame(name).tree

/** What today's Improve it draws, on a site whose seed runs one ground, in today's theme. */
function today(name: SiteBasicPageName, wording?: ReadonlyArray<{ line: number; text: string }>, forms: Array<{ id: string; name: string }> = [{ id: 'form-basic', name: 'Contact' }]): SiteImportImprovedFidelity {
  const page = siteImportReplayPage(name, { finish: 'improve', words: 'improved', seed: siteImportReplayOneGroundSeed(), forms, ...(wording ? { wording } : {}) })
  const ledger = aiSiteImportImproveLedger(page.doc)
  const destinations = aiSiteImportImproveDestinations(page.doc, ledger)
  const wanted = [...new Set(ledger.links.flatMap((link) => destinations.get(link.ref) ?? []))]
  const report = siteImportFidelity(page.source, page.tree, { finish: 'improve', words: 'improved', theme: siteImportReplayTheme(name, 'improve'), improved: { destinations: wanted, forms: 1, frame: NOW_FRAME(name) } })
  return report.improved as SiteImportImprovedFidelity
}

function redesigned(name: SiteBasicPageName, answer: unknown = SITE_IMPORT_IMPROVE_ANSWERS[name]): { improved: SiteImportImprovedFidelity; replay: ReturnType<typeof siteImportReplayImproved> } {
  const theme = siteImportReplayTheme(name, 'improve', { generative: true })
  const replay = siteImportReplayImproved(name, answer, { theme })
  const report = siteImportFidelity(replay.source, replay.tree, {
    finish: 'improve',
    words: 'improved',
    theme,
    improved: { scope: replay.scope, destinations: replay.destinations, forms: 1, frame: siteImportReplayFrame(name, { generative: true }).tree },
  })
  return { improved: report.improved as SiteImportImprovedFidelity, replay }
}

describe('each new line, red on today’s output and green on a redesign', () => {
  it('every design line reads red on what today’s build draws, on some basic site', () => {
    const red = new Set(BASIC.flatMap((name) => today(name).red))
    for (const name of SITE_IMPORT_IMPROVED_LINES) expect([name, red.has(name)]).toEqual([name, true])
    expect(red.has('links')).toBe(true)
  })

  it('a kept ledger reads red on today’s output where a rewrite or a missing form loses it', () => {
    const doc = siteImportReplayDocument('contractor')
    const line = (text: string) => doc.blocks.findIndex((block) => block.kind !== 'image' && block.text.startsWith(text))
    // A rewrite that drops a fact, and one that invents a fact and a name.
    const dropped = today('contractor', [{ line: line('Family owned'), text: 'Family owned for many good years. Licensed and insured.' }])
    expect(dropped.red).toContain('facts')
    expect(dropped.ledger.facts.missing).toEqual(expect.arrayContaining(['number:1994']))
    const invented = today('contractor', [{ line: line('Roof repair'), text: 'Roof repair after storms, for 4000 homes with Marcus Hale.' }])
    expect(invented.red).toContain('invented')
    expect(invented.ledger.invented.found).toEqual(expect.arrayContaining(['number:4000', 'name:Marcus']))
    // A form the site could not save is not on the page.
    expect(today('clinic', undefined, []).red).toContain('held')
    // Every line said in other words.
    const unrelated = doc.blocks.flatMap((block, at) => (block.kind === 'image' || block.kind === 'link' ? [] : [{ line: at, text: `Something else entirely ${at}` }]))
    expect(today('contractor', unrelated).red).toContain('meaning')
  })

  it.each(BASIC)('%s: green on the recorded redesign, and the page check holds', (name) => {
    const { improved, replay } = redesigned(name)
    expect(replay.violations).toEqual([])
    expect(improved.red).toEqual([])
    expect(improved.holds).toBe(true)
  })

  it('names what is red for the re-ask, and never asks a page to mend its frame', () => {
    const missed = aiSiteImportImprovedMisses({ improved: today('salon') })
    expect(missed.map((violation) => violation.code)).toEqual(expect.arrayContaining(['improve-cta', 'improve-columns', 'improve-links']))
    expect(missed.find((violation) => violation.code === 'improve-links')?.detail).toContain('instagram')
    expect(missed.map((violation) => violation.code)).not.toContain('improve-frame')
  })
})

describe('the theme under a generative Improve it', () => {
  const MUSTARD = '#dbb024'

  it('fills the buttons in the source’s own bright brand, under a label that reads, and links in a shade that reads', () => {
    const facts = siteImportReplayDocument('tax-firm').layout?.look as never
    expect((facts as { link: string }).link).toBe(MUSTARD)
    const style = aiSiteImportStyle(null, { seed: 7, description: 'x', facts, finish: 'improve', generative: true }) as AiSiteStyle
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    const colors = theme.colorSchemes?.light
    expect(colors?.primary?.light).toBe(MUSTARD)
    expect(colors?.primary?.main).not.toBe(MUSTARD)
    const fidelity = siteImportReplayTheme('tax-firm', 'improve', { generative: true })
    expect(fidelity?.button.fill).toBe(MUSTARD)
    expect(fidelity?.button.label).toBe('#000000')
    // Today's theme deepens it for both: the olive the fixture shows.
    expect(siteImportReplayTheme('tax-firm', 'improve')?.button.fill ?? null).toBeNull()
    expect(siteImportReplayTheme('tax-firm', 'improve')?.light.brand).not.toBe(MUSTARD)
  })

  it('never falls back to the starter’s colors, and leaves a brand that carries white as it was', () => {
    const facts = siteImportReplayDocument('clinic').layout?.look as never
    const on = aiSiteImportStyle(null, { seed: 7, description: 'x', facts, finish: 'improve', generative: true }) as AiSiteStyle
    const off = aiSiteImportStyle(null, { seed: 7, description: 'x', facts, finish: 'improve' }) as AiSiteStyle
    expect(aiSiteColors(on)).toEqual(aiSiteColors(off))
    expect(siteImportReplayTheme('tax-firm', 'improve', { generative: true })?.light.brand).not.toBe(DEFAULT_SITE_THEME.colorSchemes?.light?.primary?.main)
  })
})

describe('a recorded redesign, in structure', () => {
  const nodesOf = (name: SiteBasicPageName, answer?: unknown) => redesigned(name, answer).replay.tree.nodes as unknown as Record<string, { componentId?: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[] }>
  const under = (nodes: ReturnType<typeof nodesOf>, id: string): string[] => [id, ...(nodes[id]?.nodes ?? []).flatMap((child) => under(nodes, child))]

  it('opens as the site’s hero, runs its services across as cards, and closes on a call to action', () => {
    const nodes = nodesOf('tax-firm')
    const sections = nodes[CANVAS_ROOT_ELEMENT_ID]?.nodes ?? []
    expect(sections).toHaveLength(4)
    const opener = under(nodes, sections[0] as string)
    expect(opener.some((id) => nodes[id]?.componentId === 'muiButton' && nodes[id]?.props?.['variant'] === 'contained')).toBe(true)
    expect(opener.some((id) => nodes[id]?.componentId === 'image' && nodes[id]?.props?.['src'])).toBe(true)
    const services = under(nodes, sections[1] as string)
    expect(services.filter((id) => nodes[id]?.componentId === 'muiCard')).toHaveLength(3)
    expect(services.filter((id) => nodes[id]?.componentId === 'image')).toHaveLength(3)
    expect(services.some((id) => nodes[id]?.componentId === 'muiGrid' && nodes[id]?.props?.['container'])).toBe(true)
    expect(nodes[sections[3] as string]?.props?.['colorScheme']).toBe('dark')
    expect(under(nodes, sections[3] as string).some((id) => nodes[id]?.componentId === 'form')).toBe(true)
  })

  it('draws a kept thing exactly as the owner wrote it', () => {
    const nodes = nodesOf('contractor')
    const words = Object.values(nodes).map((node) => node.props?.['children'])
    expect(words).toContain('They showed up when they said, cleaned up every nail, and the roof has not leaked since.')
    expect(words).toContain('Call (555) 013-7788 or stop by 412 Mill Street, Brightwater.')
    const salon = Object.values(nodesOf('salon')).find((node) => node.componentId === 'dataTable')
    expect(String(salon?.props?.['rows'])).toContain('$165')
  })

  it('keeps an image asked for in words as a slot the page step’s pictures fill or drop', () => {
    const answer = copied('clinic')
    ;(answer.sections[2] as Answer['sections'][number]).blocks.push({ kind: 'image', col: -1, text: 'A doctor talking with a family', to: '', style: 'none', icon: '', items: [], ref: '' })
    const { replay } = redesigned('clinic', answer)
    expect(replay.violations).toEqual([])
    expect(replay.page.pictures.slots).toBe(1)
    const slots = aiLayoutPictureSlots(replay.tree.nodes as never, CANVAS_ROOT_ELEMENT_ID, { ids: [], names: [] })
    expect(slots.map((slot) => (replay.tree.nodes[slot.imageId] as { props?: Record<string, unknown> } | undefined)?.props?.['alt'])).toContain('A doctor talking with a family')
  })

  it('says which sections it added', () => {
    expect(redesigned('tax-firm').replay.page.added).toEqual([{ heading: 'How working with us goes', items: 3 }])
  })

  it('never lets a heading of today’s kept path draw a picture it was not given', () => {
    // Today's compile places no image block with words: a verbatim image with neither is nothing.
    const page = siteImportReplayPage('salon', { finish: 'improve', words: 'improved' })
    const images = Object.values(page.tree.nodes).filter((node) => (node as { componentId?: string }).componentId === 'image') as Array<{ props?: Record<string, unknown> }>
    expect(images.every((node) => node.props?.['src'])).toBe(true)
  })
})

/*------------------------------------------
 * The page step, on a stubbed provider
 *-----------------------------------------*/

const ZERO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
const toolAnswer = (name: string, input: unknown) => ({ kind: 'completion', text: '', toolUse: [{ name, input }], usage: ZERO_USAGE, estCostUsd: 0, stopReason: 'tool_use' })
const REFUSAL = { kind: 'refusal', text: '', toolUse: [], usage: ZERO_USAGE, estCostUsd: 0, stopReason: 'refusal' }
const sent = () => mockRunAiRequest.mock.calls.map((call) => call[0] as { system: Array<{ text: string; site?: boolean; cacheBreakpoint?: boolean }>; tools: Array<{ name: string }>; messages: Array<{ role: string; content: unknown }> })

async function runPage(doc: AiSiteImportDocument) {
  const names = aiSiteImportSectionNames(doc)
  const sectionIds = names.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug: '/', sections: names.map((name) => ({ name, uses: [] as string[], items: 0 })) }
  return aiRunLayoutPage({
    job: { $id: 'job-basic-home', brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: 'A basic site', siteKind: 'business', siteStyle: { seed: 7 } } },
    plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
    screen: screen as never,
    sectionIds,
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [{ id: 'form-basic', name: 'Contact' }], formPageId: null, components: [], facts: '' } as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: ['form-basic'], componentIds: [], codeBuilt: true },
    reusableComponents: false,
    inventory: null,
    model: 'claude-sonnet-5-5',
  })
}

const generativeDoc = (name: SiteBasicPageName): AiSiteImportDocument => ({
  ...siteImportReplayDocument(name),
  finish: 'improve',
  wording: 'improved',
  generative: true,
  siteLines: ['A basic site'],
  forms: [{ index: 0, formId: 'form-basic' }],
})

describe('the page step’s redesign', () => {
  beforeEach(() => {
    mockRunAiRequest.mockReset()
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it('asks one answer in place of design and wording, with its ledger in the turn and the digest cached', async () => {
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer('submit_improved_page', SITE_IMPORT_IMPROVE_ANSWERS['tax-firm']))
    const result = await runPage(generativeDoc('tax-firm'))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('ok')
    const [request] = sent()
    expect(request?.tools.map((tool) => tool.name)).toEqual(['submit_improved_page'])
    expect(request?.system.map((block) => block.text)).toContain(AI_SITE_IMPORT_IMPROVE_TEXT)
    expect(request?.system.filter((block) => block.site)).toHaveLength(1)
    expect(String(request?.messages[0]?.content)).toContain('form:1 must (a form)')
    expect(String(request?.system.find((block) => block.site)?.text)).not.toContain('form:1')
    if (result.status !== 'ok') return
    expect(result.value.words).toBe('improved')
    expect(result.value.redesign?.status).toBe('redesigned')
    expect(result.value.redesign?.added).toEqual([{ heading: 'How working with us goes', items: 3 }])
    // Past its source's three sections, each its own.
    const root = (result.value.nodes as unknown as Record<string, { nodes?: string[] }>)[CANVAS_ROOT_ELEMENT_ID]
    expect(root?.nodes).toHaveLength(4)
    expect(root?.nodes?.slice(0, 3)).toEqual(['sec-0', 'sec-1', 'sec-2'])
  })

  it('re-asks once naming the invented line, and takes the mended answer', async () => {
    const bad = copied('salon')
    ;(bad.sections[0] as Answer['sections'][number]).blocks[1] = { kind: 'lede', col: -1, text: 'Voted the best salon by 900 clients.', to: '', style: 'none', icon: '', items: [], ref: '' }
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer('submit_improved_page', bad)).mockResolvedValueOnce(toolAnswer('submit_improved_page', SITE_IMPORT_IMPROVE_ANSWERS.salon))
    const result = await runPage(generativeDoc('salon'))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(String(sent()[1]?.messages.at(-1)?.content)).toContain('Voted the best salon by 900 clients.')
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.value.redesign?.status).toBe('redesigned')
  })

  it('re-asks once on a design line in red', async () => {
    const flat = copied('clinic')
    // The opening's button gone quiet, every section on one ground.
    ;(flat.sections[0] as Answer['sections'][number]).blocks[2] = { kind: 'button', col: -1, text: 'Plan a visit', to: 'link:1', style: 'quiet', icon: '', items: [], ref: '' }
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer('submit_improved_page', flat)).mockResolvedValueOnce(toolAnswer('submit_improved_page', SITE_IMPORT_IMPROVE_ANSWERS.clinic))
    const result = await runPage(generativeDoc('clinic'))
    expect(mockRunAiRequest).toHaveBeenCalledTimes(2)
    expect(String(sent()[1]?.messages.at(-1)?.content)).toContain('filled primary button')
    expect(result.status).toBe('ok')
  })

  it.each([
    ['misses twice', () => mockRunAiRequest.mockResolvedValue(toolAnswer('submit_improved_page', { sections: [] }))],
    ['is refused', () => mockRunAiRequest.mockResolvedValue(REFUSAL)],
  ])('falls back to today’s compile with a row that says so, when its answer %s', async (_, arrange) => {
    arrange()
    const doc = generativeDoc('tax-firm')
    const result = await runPage(doc)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.value.words).toBe('kept')
    expect(result.value.redesign).toEqual({ status: 'layout-kept', added: [], pictures: null })
    expect(result.value.settled).toEqual(expect.arrayContaining([{ at: 'page', what: AI_SITE_IMPORT_LAYOUT_KEPT }]))
    const words = Object.values(result.value.nodes as unknown as Record<string, { props?: Record<string, unknown> }>).map((node) => node.props?.['children'])
    expect(words).toContain('Keep Your Taxes Calm')
  })

  it('asks the design and wording answers as it always did, with the flag off', async () => {
    const { generative: _generative, siteLines: _lines, ...off } = generativeDoc('salon')
    mockRunAiRequest.mockResolvedValueOnce(toolAnswer('submit_design', { sections: [] })).mockResolvedValueOnce(toolAnswer('submit_wording', { lines: [] }))
    await runPage(off)
    expect(sent().map((request) => request.tools[0]?.name)).toEqual(['submit_design', 'submit_wording'])
    expect(sent()[0]?.system.map((block) => block.text)).toContain(AI_LAYOUT_DESIGN_TEXT)
  })

  it('asks Keep my site and a policy page no redesign, flag or no flag', async () => {
    mockRunAiRequest.mockResolvedValue(toolAnswer('submit_design', { sections: [] }))
    await runPage({ ...generativeDoc('salon'), finish: 'keep', wording: 'kept' })
    expect(sent().map((request) => request.tools[0]?.name)).toEqual(['submit_design'])
    mockRunAiRequest.mockClear()
    await runPage({ ...generativeDoc('salon'), url: 'https://www.juniper-row.example/privacy', title: 'Privacy policy' })
    expect(sent().map((request) => request.tools[0]?.name)).not.toContain('submit_improved_page')
  })
})

describe('the row, and the header', () => {
  const state = {
    domain: 'x.example',
    frame: null,
    finish: 'improve',
    wording: true,
    pages: [{ slot: 'p0', url: 'https://x.example/', path: '/', title: 'Home', group: 'main', wave: 1, draftId: 'd0', slug: '/', words: 10, images: 0, build: 'arranged', wording: 'kept' }],
    waves: [{ index: 1, label: 'Wave 1', group: 'main', slots: ['p0'], frame: false, status: 'review', startedAt: 'x', finishedAt: 'y', finish: 'improve', wording: true, generative: true }],
  } as unknown as AiSiteImportState

  it('reads “Layout kept” where a redesign did not pass, and what it added where one did', () => {
    const kept = aiSiteImportRedesignOf(state, 'p0', 'layout-kept')
    const rows = aiSiteImportWaveRows({ items: [], status: 'needs_review', siteImport: kept } as never, kept.waves[0] as never)
    expect(rows[0]?.build).toBe('Layout kept: the redesign did not pass')
    const done = aiSiteImportRedesignOf(state, 'p0', 'redesigned', [{ heading: 'Why us' }], { source: 1, stock: 0, generated: 0, slots: 0, unplaced: [] })
    expect(done.pages[0]).toMatchObject({ redesign: 'redesigned', added: [{ heading: 'Why us' }], pictures: { source: 1 } })
  })

  it('fills a redesigned header’s first button, and takes the menu’s own call to action where the source draws none', () => {
    const home = {
      url: 'https://x.example/',
      title: '',
      description: '',
      ogImage: null,
      siteName: 'X',
      brand: { kind: 'name-only', text: 'X', logo: null },
      facts: { lines: [], emails: [], phones: [], social: [], address: '' },
      nav: { items: [{ label: 'Projects', href: 'https://x.example/projects', items: [] }, { label: 'Free estimate', href: 'https://x.example/estimate', items: [] }], ctas: [], background: null },
    }
    const site = { ...state, home, pages: [...state.pages, { ...state.pages[0], slot: 'p1', path: '/estimate', slug: 'estimate', draftId: 'd1' }] } as unknown as AiSiteImportState
    expect(aiSiteImportFrameSource(site, { index: 1 })?.ctas).toEqual([])
    expect(aiSiteImportFrameSource(site, { index: 1, generative: true })?.ctas).toEqual([{ label: 'Free estimate', to: 'page:d1', style: 'primary' }])
  })
})
