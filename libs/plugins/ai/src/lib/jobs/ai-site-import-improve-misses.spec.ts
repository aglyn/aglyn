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
 * A generative Improve it's misses from its 11/6 reruns (AGL-4152), offline,
 * on invented sites: a page of pictures kept one by one compiles without a
 * repeated inline style; a contact page redesigned as its role asks (a short
 * opening, the form beside how to reach the business) passes; the honesty
 * scope holds what the redesign was told (its plan, the site's picture words,
 * the platform's own words, its name as a visitor says it, a heading's words
 * in any ending); and what a visitor sees: one shape for a row of cards, a
 * call to action never to the page it is on, columns at the top beside a
 * form, a cover photo edge to edge, and one primary fill for every button.
 * Every answer here is written by hand in the tool's shape: no model is called.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiLayoutItem } from '../layout-language/ai-layout-language'
import type { AiSiteImportPlan } from '../model/ai-site-import'
import { siteImportFactScope, siteImportFactTokens, siteImportFidelity, SITE_IMPORT_IMPROVED_MEANING, type SiteImportFidelityTree } from '../model/ai-site-import-fidelity'
import { siteImportReplayDocumentOf } from '../site-import/fixtures/site-import-fidelity-replay'
import { aiImportedPageCheck, type AiLayoutPageBuilt } from './ai-job-page-language'
import { aiSiteImportOneFrame } from './ai-site-import-compile'
import type { AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportHonesty, aiSiteImportHonestyFacts, aiSiteImportInventedIn } from './ai-site-import-honesty'
import {
  AI_SITE_IMPORT_IMPROVE_FRAME_PX,
  aiReadImprovedPage,
  aiSiteImportImproveCheck,
  aiSiteImportImproveDestinations,
  aiSiteImportImprovedMisses,
  aiSiteImportImprovedPage,
  aiSiteImportImproveLedger,
  aiSiteImportImproveRoleLines,
  aiSiteImportImproveScope,
  aiSiteImportMeaningShare,
  aiSiteImportNameVariants,
  aiSiteImportNewSectionsWanted,
  aiSiteImportOwnPage,
  aiSiteImportPageRoleOf,
  aiSiteImportPlanLines,
} from './ai-site-import-improve'

type Node = { componentId: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[]; parentId?: string | null; interactions?: unknown[] }

const block = (kind: string, rest: Record<string, unknown> = {}) => ({ kind, col: -1, text: '', to: '', style: 'none', icon: '', items: [], ref: '', ...rest })
const item = (title: string, text: string, rest: Record<string, string> = {}) => ({ title, text, to: '', icon: '', ref: '', ...rest })
const section = (band: string, blocks: Array<Record<string, unknown>>, rest: { cols?: number[]; align?: string } = {}) => ({ band, cols: rest.cols ?? [], align: rest.align ?? 'start', blocks })

/** An invented builder's page of four pictured kinds of work, each with its own link. */
const BUILDER = `<!doctype html><html><head><title>Commercial work | Northfield Builders</title></head><body>
<header><a href="/">Northfield Builders</a><nav><a href="/work">Work</a><a href="/contact">Contact</a></nav></header>
<main>
<section><img src="https://www.northfield.example/media/lobby.jpg" alt="A finished office lobby" width="1600" height="900"><h1>Commercial work</h1><p>We build offices, shops and warehouses across the county.</p><p><a href="https://www.northfield.example/contact">Request a quote</a></p></section>
<section><h2>Projects</h2>
<img src="https://www.northfield.example/media/a.jpg" alt="An office fit-out" width="1200" height="800"><h3>Office fit-outs</h3><p>Open floors, meeting rooms and kitchens for teams of every size.</p><p><a href="https://www.northfield.example/work/offices">See office work</a></p>
<img src="https://www.northfield.example/media/b.jpg" alt="A shop front" width="800" height="1000"><h3>Shop fronts</h3><p>Glazing, signage and counters for shops on the high street.</p><p><a href="https://www.northfield.example/work/shops">See shop work</a></p>
<img src="https://www.northfield.example/media/c.jpg" alt="A warehouse" width="1600" height="700"><h3>Warehouses</h3><p>Steel frames, loading bays and racking for warehouses.</p><p><a href="https://www.northfield.example/work/warehouses">See warehouse work</a></p>
<img src="https://www.northfield.example/media/d.jpg" alt="A restaurant" width="1000" height="1000"><h3>Restaurants</h3><p>Kitchens, dining rooms and bars for restaurants.</p><p><a href="https://www.northfield.example/work/restaurants">See restaurant work</a></p>
</section>
</main><footer><p>Northfield Builders. Call 555-201-3344.</p></footer></body></html>`

/** An invented accountant's contact page: a heading, a longer welcome, the form, and how to reach the office under labels. */
const CONTACT = `<!doctype html><html><head><title>Contact | Maple Ledger Accounting</title></head><body>
<header><a href="/">Maple Ledger Accounting</a><nav><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>
<main>
<section><h1>Contact Us</h1><p>We'd love to hear from you.</p><p>Whether you need help filing your individual return, catching up on years of unfiled taxes, or setting up bookkeeping for your small business, our team is here to help. Reach out today to schedule a free consultation with one of our tax professionals.</p><p><a href="https://www.mapleledger.example/contact">Contact us</a></p></section>
<section><h2>Get in Touch</h2>
<form action="/contact" method="post"><label>Name<input name="name"></label><label>Email<input name="email" type="email"></label><label>Message<textarea name="message"></textarea></label><button type="submit">Submit</button></form>
</section>
<section><h3>Office</h3><p>220 Birch Avenue, Suite 4, Fairhaven</p><h3>Phone</h3><p>(555) 014-2290</p><h3>Email</h3><p>office@mapleledger.example</p><h3>Hours</h3><p>Mon - Fri: 9am - 5pm</p><p>Saturday: By Appointment</p></section>
</main><footer><p>Maple Ledger Accounting. Fairhaven.</p></footer></body></html>`

function readOf(html: string, url: string, extraLinks: Array<{ path: string; id: string }> = []): AiSiteImportDocument {
  const origin = new URL(url).origin
  const read = siteImportReplayDocumentOf(html, url, (address) => address.origin === origin)
  const links = [...read.links, ...extraLinks.filter((link) => !read.links.some((entry) => entry.path === link.path))]
  return { ...read, links, finish: 'improve', wording: 'improved', generative: true }
}

const FORM = { id: 'form-1', name: 'Contact' }

/** A redesign compiled and held as the page step holds it: its page, its build and its check's misses. */
function improved(doc: AiSiteImportDocument, answer: unknown, options: { slug: string; seed?: number; form?: boolean } = { slug: '/' }) {
  const ledger = aiSiteImportImproveLedger(doc)
  const read = aiReadImprovedPage(answer)
  if (!read) throw new Error('no section')
  const formAt = read.findIndex((entry) => entry.blocks.some((entry) => entry.kind === 'keep' && entry.ref.startsWith('form:')))
  const destinations = aiSiteImportImproveDestinations(doc, ledger, { sections: read.length, formSection: formAt === -1 ? null : formAt })
  const design = { kind: 'business', seed: options.seed ?? 7, home: options.slug === '/' } as never
  const forms = options.form ? [FORM] : []
  const page = aiSiteImportImprovedPage(read, { doc, ledger, design, destinations, formId: options.form ? FORM.id : null })
  const built = aiImportedPageCheck({
    screen: { title: doc.title, slug: options.slug, sections: page.names.map((name) => ({ name, uses: [], items: 0 })) } as never,
    sectionIds: page.names.map((_, index) => `sec-${index}`),
    targets: { pageId: 'p0', pages: [], homeIds: [], forms, formPageId: null, components: [], facts: '' } as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: forms.map((form) => form.id), componentIds: [], codeBuilt: true },
    design,
    doc,
    given: page.given,
    rewritten: page.written,
  })(null)
  return { page, built, nodes: (built.value?.nodes ?? {}) as unknown as Record<string, Node> }
}

/** A redesign's whole check, as the page step runs it: honesty, plan, build and score. */
function checked(doc: AiSiteImportDocument, answer: Record<string, unknown>, slug: string) {
  const ledger = aiSiteImportImproveLedger(doc)
  const role = aiSiteImportPageRoleOf(doc, slug)
  const needs = { role, wanted: aiSiteImportNewSectionsWanted(role, ledger, false) }
  const vocabulary = aiSiteImportImproveRoleLines({ ...needs, folded: ledger.folded, seed: 1 })
  const scope = aiSiteImportImproveScope(doc, null)
  const source = { layout: doc.layout as NonNullable<AiSiteImportDocument['layout']>, blocks: doc.blocks, photos: doc.photos }
  const design = { kind: 'business', seed: 7, home: false } as never
  const check = aiSiteImportImproveCheck<AiLayoutPageBuilt>({
    doc,
    ledger,
    design,
    scope,
    formId: FORM.id,
    needs,
    vocabulary,
    build: (page) =>
      aiImportedPageCheck({
        screen: { title: doc.title, slug, sections: page.names.map((name) => ({ name, uses: [], items: 0 })) } as never,
        sectionIds: page.names.map((_, index) => `sec-${index}`),
        targets: { pageId: 'p0', pages: [], homeIds: [], forms: [FORM], formPageId: null, components: [], facts: '' } as never,
        context: { screenIds: doc.links.map((link) => link.id), formIds: [FORM.id], componentIds: [], codeBuilt: true },
        design,
        doc,
        given: page.given,
        rewritten: page.written,
      })(null),
    score: (built, destinations) => {
      const tree: SiteImportFidelityTree = { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: built.nodes as unknown as SiteImportFidelityTree['nodes'] }
      const report = siteImportFidelity(source, tree, { finish: 'improve', words: 'improved', improved: { scope, destinations, forms: 1, vocabulary, meaning: aiSiteImportMeaningShare(role) } })
      return aiSiteImportImprovedMisses(report)
    },
  })
  return { result: check(answer), role, source, scope, vocabulary }
}

const codes = (violations: ReadonlyArray<{ code: string }>) => violations.map((violation) => violation.code)

describe('a page of pictures kept one by one repeats no inline style (duplicated-inline-style)', () => {
  const doc = readOf(BUILDER, 'https://www.northfield.example/commercial', [{ path: '/commercial', id: 'p-commercial' }])
  const hero = section('dark', [block('keep', { ref: 'picture:1' }), block('heading', { text: 'Offices, shops and warehouses, built to open on time' }), block('lede', { text: 'We build offices, shops and warehouses across the county.' }), block('button', { text: 'Request a quote', to: 'link:1', style: 'primary' })])
  const closing = section('brand', [block('heading', { text: 'Plan your next build with us' }), block('button', { text: 'Request a quote', to: 'link:1', style: 'primary' })], { align: 'center' })

  it('compiles four pictured cards, each with its own button, with every style once', () => {
    const answer = {
      sections: [
        hero,
        section('plain', [
          block('heading', { text: 'Work we build' }),
          block('cards', {
            items: [
              item('Office fit-outs', 'Open floors, meeting rooms and kitchens for teams of every size.', { ref: 'picture:2', to: 'link:2' }),
              item('Shop fronts', 'Glazing, signage and counters for shops on the high street.', { ref: 'picture:3', to: 'link:3' }),
              item('Warehouses', 'Steel frames, loading bays and racking for warehouses.', { ref: 'picture:4', to: 'link:4' }),
              item('Restaurants', 'Kitchens, dining rooms and bars for restaurants.', { ref: 'picture:5', to: 'link:5' }),
            ],
          }),
        ]),
        closing,
      ],
    }
    for (const seed of [1, 4, 7, 12]) {
      const { built, nodes } = improved(doc, answer, { slug: '/commercial', seed })
      expect(codes(built.violations)).toEqual([])
      // Every card's photo cropped to one shape, so the row's cards stand alike.
      const ratios = Object.values(nodes).filter((node) => node.componentId === 'image' && node.sx?.['aspectRatio']).map((node) => node.sx?.['aspectRatio'])
      expect(new Set(ratios)).toEqual(new Set(['4 / 3']))
    }
  })

  it('compiles pictures kept one to a column, two rows of them, with every style once', () => {
    const answer = {
      sections: [
        hero,
        section('soft', [block('heading', { text: 'Recent builds' }), block('keep', { ref: 'picture:2', col: 0 }), block('text', { col: 0, text: 'Office fit-outs' }), block('keep', { ref: 'picture:3', col: 1 }), block('text', { col: 1, text: 'Shop fronts' })], { cols: [1, 1] }),
        section('plain', [block('keep', { ref: 'picture:4', col: 0 }), block('text', { col: 0, text: 'Warehouses' }), block('keep', { ref: 'picture:5', col: 1 }), block('text', { col: 1, text: 'Restaurants' })], { cols: [1, 1] }),
        closing,
      ],
    }
    for (const seed of [1, 4, 7, 12]) {
      const { built, nodes } = improved(doc, answer, { slug: '/commercial', seed })
      // Cropped by the Image's own height, its rounding its one style key: four alike were refused as a repeated inline style.
      expect(codes(built.violations)).toEqual([])
      const kept = Object.values(nodes).filter((node) => node.componentId === 'image' && node.props?.['height'] === `${AI_SITE_IMPORT_IMPROVE_FRAME_PX.column}px`)
      expect(kept).toHaveLength(4)
      for (const node of kept) expect(Object.keys(node.sx ?? {})).toEqual(['borderRadius'])
    }
  })
})

describe('a contact page redesigned as its role asks', () => {
  const doc = readOf(CONTACT, 'https://www.mapleledger.example/contact', [{ path: '/contact', id: 'p-contact' }])
  // A short, welcoming opening and the form beside how to reach the office: no closing band, no button in the opening.
  const answer = {
    sections: [
      section('soft', [block('eyebrow', { text: 'Contact' }), block('heading', { text: 'Talk with an accountant about your taxes' }), block('lede', { text: 'Tell us what you need: a return, back taxes or bookkeeping. We will set up a free consultation.' })], { align: 'center' }),
      section('plain', [
        block('heading', { col: 0, text: 'Send us a message' }),
        block('text', { col: 0, text: 'A real person reads every note.' }),
        block('keep', { ref: 'contact:1', col: 0 }),
        block('keep', { ref: 'contact:2', col: 0 }),
        block('keep', { ref: 'contact:3', col: 0 }),
        block('note', { col: 0, text: 'Mon - Fri: 9am - 5pm. Saturday by appointment.' }),
        block('button', { col: 0, text: 'Call the office', to: 'phone', style: 'secondary' }),
        block('keep', { ref: 'form:1', col: 1 }),
      ], { cols: [5, 7] }),
    ],
  }

  it('reads as a contact page, which asks no new section', () => {
    const { role } = checked(doc, answer, '/contact')
    expect(role).toBe('contact')
    expect(aiSiteImportMeaningShare('contact')).toBeLessThan(SITE_IMPORT_IMPROVED_MEANING)
    expect(aiSiteImportMeaningShare('home')).toBe(SITE_IMPORT_IMPROVED_MEANING)
  })

  it('passes: the form is its call to action, and its words keep the intent, its form, its contacts and its facts', () => {
    const { result, source, scope, vocabulary } = checked(doc, answer, '/contact')
    expect(result.violations).toEqual([])
    expect(result.value?.missed).toBeUndefined()
    // The same page held to the share a home page is held to drifts: the long welcome is said in fewer words, as the role asks.
    const built = result.value?.built.nodes as unknown as SiteImportFidelityTree['nodes']
    const report = siteImportFidelity(source, { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: built }, { finish: 'improve', words: 'improved', improved: { scope, destinations: [], forms: 1, vocabulary } })
    expect(report.improved?.ledger.meaning.ok).toBe(false)
    expect(report.improved?.ledger.facts.ok).toBe(true)
    expect(report.improved?.ledger.held.ok).toBe(true)
    expect(report.improved?.design.cta?.ok).toBe(true)
    expect(report.improved?.design.columns?.ok).toBe(true)
  })

  it('needs no link to itself: the source’s "Contact us" on the contact page asks nothing of the redesign', () => {
    const ledger = aiSiteImportImproveLedger(doc)
    expect(ledger.links.length).toBeGreaterThan(0)
    expect(aiSiteImportOwnPage(doc)).toBe('page:p-contact')
    const read = aiReadImprovedPage(answer)
    if (!read) throw new Error('no section')
    const destinations = aiSiteImportImproveDestinations(doc, ledger, { sections: read.length, formSection: 1 })
    const scope = aiSiteImportImproveScope(doc, null)
    expect(codes(aiSiteImportHonesty(read, { ledger, scope, destinations, own: 'page:p-contact' }))).toEqual([])
    expect(codes(aiSiteImportHonesty(read, { ledger, scope, destinations }))).toEqual(['improve-dropped-item'])
  })

  it('sends a call to action to the page it is on to its form, and leaves one out where there is none', () => {
    const asked = JSON.parse(JSON.stringify(answer)) as typeof answer
    asked.sections[0]!.blocks.push(block('button', { text: 'Request a quote', to: 'page:p-contact', style: 'primary' }))
    const { nodes } = improved(doc, asked, { slug: '/contact', form: true })
    const quote = Object.values(nodes).find((node) => node.componentId === 'muiButton' && node.props?.['children'] === 'Request a quote')
    expect(quote?.props?.['screenId']).toBeUndefined()
    // It scrolls to the form's section, the second.
    expect(JSON.stringify(quote?.interactions)).toContain('sec-1')
    // With no form, it goes nowhere a visitor is not already: it is left out.
    const formless = JSON.parse(JSON.stringify(asked)) as typeof answer
    formless.sections[1]!.blocks = formless.sections[1]!.blocks.filter((entry) => entry['ref'] !== 'form:1')
    const ledger = aiSiteImportImproveLedger(doc)
    const read = aiReadImprovedPage(formless)
    if (!read) throw new Error('no section')
    const page = aiSiteImportImprovedPage(read, { doc, ledger, design: { kind: 'business', seed: 7, home: false } as never, destinations: aiSiteImportImproveDestinations(doc, ledger, { sections: read.length, formSection: null }), formId: null })
    expect(page.given.sections[0]?.blocks.some((entry) => entry.kind === 'button')).toBe(false)
    expect(page.written).not.toContain('Request a quote')
  })

  it('sets the words beside its form at the top of the row, never centered over a gap', () => {
    const { nodes } = improved(doc, answer, { slug: '/contact', form: true })
    const form = Object.entries(nodes).find(([, node]) => node.componentId === 'form')?.[0]
    let at = form ? nodes[form]?.parentId : null
    while (at && !(nodes[at]?.componentId === 'muiGrid' && nodes[at]?.props?.['container'])) at = nodes[at]?.parentId
    expect(at && nodes[at]?.sx?.['alignItems']).toBe('flex-start')
  })
})

describe('what the honesty scope holds', () => {
  const doc = readOf(BUILDER, 'https://www.northfield.example/commercial', [{ path: '/commercial', id: 'p-commercial' }])

  it('holds the plan the redesign was told: its summary, its menu and its proposed page', () => {
    const plan = {
      site: { what: 'A builder of offices and shops in Harrow County.', audience: 'business owners', kind: 'professional', voice: 'plain' },
      nav: { groups: [{ label: 'Our Projects', pages: ['p1'] }], primaryCta: { label: 'Request a quote', target: 'form' }, footer: [] },
      design: { hero: 'cover', group: 'cards', rhythm: 'alternate', cta: 'band' },
      proposed: { title: 'Common questions', slug: 'common-questions', purpose: 'Answers on schedules and permits.', on: true },
    } as unknown as AiSiteImportPlan
    expect(aiSiteImportPlanLines(plan)).toEqual(expect.arrayContaining(['A builder of offices and shops in Harrow County.', 'Our Projects', 'Common questions']))
    const line = 'We build across Harrow County.'
    expect(aiSiteImportInventedIn(line, aiSiteImportHonestyFacts(aiSiteImportImproveScope(doc, null)))).toMatch(/"Harrow"/)
    expect(aiSiteImportInventedIn(line, aiSiteImportHonestyFacts(aiSiteImportImproveScope({ ...doc, plan }, null)))).toBeNull()
  })

  it('holds what the site’s pictures say', () => {
    expect(aiSiteImportImproveScope(doc, null)).toContain('A finished office lobby')
  })

  it('holds a heading’s words in any ending, so a title-case heading names no one', () => {
    const scope = ['We file taxes and keep the books for small shops.']
    const facts = aiSiteImportHonestyFacts(scope)
    // "Filing" and "Taxes" in a heading in title case: said, as "file" and "taxes", in sentence case.
    expect(aiSiteImportInventedIn('Tax Filing for small shops', facts)).toBeNull()
    // Without stems it read as two names.
    const bare = siteImportFactScope(scope)
    expect(siteImportFactTokens('Tax Filing for small shops', { names: bare.names, said: bare.said }, true)).toEqual(['name:Filing'])
    // A word no line of the site says is still a name.
    expect(aiSiteImportInventedIn('Tax filing in Brookfield', facts)).toMatch(/"Brookfield"/)
  })

  it('holds the platform’s own words for a page, which name and claim nothing', () => {
    const vocabulary = aiSiteImportImproveRoleLines({ role: 'home', wanted: 2, folded: false, seed: 1 })
    const scope = ['We pour driveways and patios.']
    expect(aiSiteImportInventedIn('Why Choose Us for your driveway', aiSiteImportHonestyFacts(scope))).toMatch(/"Choose"/)
    expect(aiSiteImportInventedIn('Why Choose Us for your driveway', aiSiteImportHonestyFacts(scope, vocabulary))).toBeNull()
    // A claim stays the owner's, whatever the platform's words say.
    expect(aiSiteImportInventedIn('Licensed and insured crews', aiSiteImportHonestyFacts(scope, [...vocabulary, 'licensed insured']))).toMatch(/licensed/)
  })

  it('holds the site’s name as a visitor says it, where the site writes it as an address or run together', () => {
    const said = new Set(['ridgeline', 'builders', 'roofing', 'site', 'abc'])
    expect(aiSiteImportNameVariants('RidgelineBuilders.com', said)).toEqual(expect.arrayContaining(['RidgelineBuilders', 'Ridgeline Builders']))
    expect(aiSiteImportNameVariants('ABCroofingsite.com', said)).toEqual(expect.arrayContaining(['ABC Roofing Site']))
    expect(aiSiteImportNameVariants('Ridgeline Builders', said)).toEqual([])
    const named = { ...doc, siteLines: ['ABCroofingsite.com', 'We fix roofing on every kind of site.'] }
    const facts = aiSiteImportHonestyFacts(aiSiteImportImproveScope(named, null))
    expect(aiSiteImportInventedIn('Call ABC Roofing for a new roof', facts)).toBeNull()
    expect(aiSiteImportInventedIn('Call ABC Roofing for a new roof', aiSiteImportHonestyFacts([...aiSiteImportImproveScope(doc, null), 'ABCroofingsite.com']))).toMatch(/"ABC"|"Roofing"/)
  })
})

describe('what a visitor sees', () => {
  it('crops a row of pictures of different shapes to one, on a page asked improved; a page kept keeps them', () => {
    const items: AiLayoutItem[] = [
      { title: 'A', text: '', picture: { src: 'media:a', alt: '', ratio: 1.5, fit: { ratio: '1200 / 800' } } },
      { title: 'B', text: '', picture: { src: 'media:b', alt: '', ratio: 0.8, fit: { ratio: '800 / 1000' } } },
      { title: 'C', text: '', picture: { src: 'media:c', alt: '', ratio: 1.33, fit: { ratio: '1600 / 1200' } } },
    ]
    const framed = aiSiteImportOneFrame(items, true)
    expect(framed.map((entry) => entry.picture?.fit)).toEqual(Array(3).fill({ ratio: '4 / 3', cropped: true, objectFit: 'cover' }))
    expect(aiSiteImportOneFrame(items, false)).toBe(items)
    // One shape already, or a shape the source crops to: as they are.
    const alike = items.map((entry) => ({ ...entry, picture: { ...(entry.picture as NonNullable<AiLayoutItem['picture']>), ratio: 1.5 } }))
    expect(aiSiteImportOneFrame(alike, true)).toBe(alike)
  })

  it('draws a filled button on a dark band in the site’s one primary, the light scheme its header’s is drawn in', () => {
    const doc = readOf(BUILDER, 'https://www.northfield.example/commercial', [{ path: '/commercial', id: 'p-commercial' }])
    const answer = {
      sections: [
        section('plain', [block('keep', { ref: 'picture:1', col: 1 }), block('heading', { col: 0, text: 'Offices, shops and warehouses' }), block('lede', { col: 0, text: 'We build offices, shops and warehouses across the county.' }), block('button', { col: 0, text: 'See our work', to: 'link:2', style: 'primary' })], { cols: [7, 5] }),
        section('dark', [block('heading', { text: 'Plan your next build with us' }), block('button', { text: 'Request a quote', to: 'link:1', style: 'primary' })], { align: 'center' }),
      ],
    }
    const { built, nodes } = improved(doc, answer, { slug: '/commercial' })
    expect(codes(built.violations)).toEqual([])
    const button = (label: string) => Object.values(nodes).find((node) => node.componentId === 'muiButton' && node.props?.['children'] === label)
    const onDark = button('Request a quote')
    const parent = onDark?.parentId ? nodes[onDark.parentId] : undefined
    expect(parent).toMatchObject({ componentId: 'muiBox', props: { colorScheme: 'light' } })
    // On the page's own ground it is the primary already.
    const onPage = button('See our work')
    expect(onPage?.parentId ? nodes[onPage.parentId]?.props?.['colorScheme'] : undefined).toBeUndefined()
  })
})
