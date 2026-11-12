/**
 * @jest-environment node
 *
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
 * A generative Improve it's polish after its 11/12 reruns (AGL-4152),
 * offline, on invented sites shaped like the two reference sites' misses: a
 * section left a heading alone over its page's four kinds of work, a row of
 * cards with a picture on two of its three, a footer of links alone, a band
 * with two buttons to the contact page, and a page whose kept photos crowded
 * out the pictures it asked for in words. Every answer here is written by
 * hand in the tool's shape: no model is called.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiLayoutBlock, AiLayoutSettlement } from '../layout-language/ai-layout-language'
import { aiLayoutTextLines, aiReadLayoutBlock } from '../layout-language/ai-layout-language'
import { aiLayoutEvenCardPictures, aiLayoutWithoutHollowSections } from '../layout-language/ai-layout-gaps'
import type { AiJob } from '../model/ai-jobs.types'
import type { AiSiteImportPlan, AiSiteImportState } from '../model/ai-site-import'
import { siteImportReplayDocumentOf, siteImportReplayFrame, siteImportReplayPlanState } from '../site-import/fixtures/site-import-fidelity-replay'
import { siteImportSiteFacts } from '../site-import/site-import-page'
import { aiImportedPageCheck, aiSiteImportRedesignPassed } from './ai-job-page-language'
import { aiSiteImportFinishedPage } from './ai-job-page-step'
import { aiSiteImportFrameFactLines, aiSiteImportFrameJob, aiSiteImportMenuPageIds } from './ai-job-import-step'
import { aiLayoutSiteBrandOf } from './ai-job-layout-language'
import { aiSiteImportPlanRead } from './ai-site-import-plan'
import { aiSiteImportDestinationKey, aiSiteImportSectionActions } from './ai-site-import-actions'
import type { AiSiteImportDocument } from './ai-site-import-document'
import { aiReadImprovedPage, aiSiteImportImproveDestinations, aiSiteImportImprovedPage, aiSiteImportImproveLedger } from './ai-site-import-improve'

const ORIGIN = 'https://www.northfield.example'

function readOf(html: string, path: string, extra: Partial<AiSiteImportDocument> = {}): AiSiteImportDocument {
  const read = siteImportReplayDocumentOf(html, `${ORIGIN}${path}`, (address) => address.origin === ORIGIN)
  return { ...read, finish: 'improve', wording: 'improved', generative: true, ...extra }
}

const section = (band: string, blocks: Array<Record<string, unknown>>, cols: number[] = []) => ({
  band,
  cols,
  align: 'start',
  blocks: blocks.map((block) => ({ col: -1, text: '', to: '', style: 'none', icon: '', items: [], ref: '', ...block })),
})
const item = (title: string, rest: Record<string, unknown> = {}) => ({ title, text: '', to: '', icon: '', ref: '', ...rest })

const DESIGN = { kind: 'business', seed: 7, home: false } as never

/** An answer drawn as a redesign is: read, then compiled into the compiler's sections. */
function drawn(doc: AiSiteImportDocument, answer: unknown) {
  const ledger = aiSiteImportImproveLedger(doc)
  const settled: AiLayoutSettlement[] = []
  const read = aiReadImprovedPage(answer, settled)
  if (!read) throw new Error('no section')
  const formAt = read.findIndex((entry) => entry.blocks.some((block) => block.kind === 'keep' && block.ref.startsWith('form:')))
  const destinations = aiSiteImportImproveDestinations(doc, ledger, { sections: read.length, formSection: formAt === -1 ? null : formAt })
  const page = aiSiteImportImprovedPage(read, { doc, ledger, design: DESIGN, destinations, formId: null })
  return { ledger, page, settled }
}

/** A redesign built as the page step builds it, through the site compiler. */
function built(doc: AiSiteImportDocument, page: ReturnType<typeof drawn>['page']) {
  const sectionIds = page.names.map((_, index) => `sec-${index}`)
  const result = aiImportedPageCheck({
    screen: { title: doc.title, slug: '/x', sections: page.names.map((name) => ({ name, uses: [] as string[], items: 0 })) } as never,
    sectionIds,
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: [], componentIds: [], codeBuilt: true },
    design: DESIGN,
    doc,
    given: page.given,
    rewritten: page.written,
  })(null)
  return result
}

/*------------------------------------------
 * 1. No hollow section, and no item of the source lost
 *-----------------------------------------*/

/** A contractor's thin "Commercial work" page, as its source has it: four kinds of work under "What We Handle". */
const THIN = `<!doctype html><html><head><title>Commercial Work | Northfield Paving</title></head><body>
<header><a href="/">Northfield Paving</a><nav><a href="/">Home</a><a href="/commercial-work">Commercial work</a><a href="/contact">Contact</a></nav></header>
<main>
<section><h1>looking for a Crew?</h1><p>Call (555) 201-3344.</p></section>
<section><h2>Labor only</h2><p>Your materials, our crew.</p><h2>Turnkey</h2><p>We handle the pour start to finish.</p></section>
<section><h2>What We Handle</h2><p><a href="/contact">Request a site visit</a></p><ul><li>parking lots</li><li>Sidewalks/ Curbs &amp; Gutter</li><li>Load Bearing SLabs</li><li>Trench &amp; Pour back</li></ul></section>
</main><footer><p>© Northfield Paving</p></footer></body></html>`

const WORK = ['parking lots', 'Sidewalks/ Curbs & Gutter', 'Load Bearing SLabs', 'Trench & Pour back']

const opening = section('dark', [
  { kind: 'heading', text: 'A concrete crew when you need one' },
  { kind: 'lede', text: 'Labor only or turnkey, we handle the pour.' },
  { kind: 'button', text: 'Request a site visit', to: 'link:1', style: 'primary' },
])
const offers = section('soft', [
  { kind: 'heading', text: 'Two ways to work with us' },
  { kind: 'cards', items: [item('Labor only', { text: 'Your materials, our crew.' }), item('Turnkey', { text: 'We handle the pour start to finish.' })] },
])
const closing = section('brand', [
  { kind: 'heading', text: 'Ready for a site visit?' },
  { kind: 'button', text: 'Request a site visit', to: 'link:1', style: 'primary' },
])

describe('a list the answer wrote as lines of its text (AGL-4152)', () => {
  it('reads each line as an item, and says so', () => {
    const settled: AiLayoutSettlement[] = []
    const block = aiReadLayoutBlock({ kind: 'list', text: 'Parking lots\nSidewalks, curbs and gutters\n• Load-bearing slabs', items: [] }, 'sections[2].blocks[1]', settled)
    expect(block).toEqual({ kind: 'list', items: [{ title: 'Parking lots', text: '' }, { title: 'Sidewalks, curbs and gutters', text: '' }, { title: 'Load-bearing slabs', text: '' }] })
    expect(settled).toEqual([{ at: 'sections[2].blocks[1]', what: 'an empty list; its 3 lines of text read as its items' }])
  })

  it('reads a card’s line as its title and its words, and one line as a paragraph', () => {
    const cards = aiReadLayoutBlock({ kind: 'cards', text: 'Labor only: your materials, our crew.\nTurnkey — we handle the pour.', items: [] }, 'x', [])
    expect(cards?.items).toEqual([
      { title: 'Labor only', text: 'your materials, our crew.' },
      { title: 'Turnkey', text: 'we handle the pour.' },
    ])
    const settled: AiLayoutSettlement[] = []
    expect(aiReadLayoutBlock({ kind: 'steps', text: 'We pour slabs of every size.', items: [] }, 'y', settled)).toEqual({ kind: 'text', text: 'We pour slabs of every size.' })
    expect(settled[0]?.what).toBe('an empty steps; its one line of text read as a paragraph')
    expect(aiLayoutTextLines('One; two; three')).toEqual(['One', 'two', 'three'])
  })

  it('still leaves out a group with neither items nor words, and the redesign’s read records it', () => {
    const settled: AiLayoutSettlement[] = []
    aiReadImprovedPage({ sections: [opening, section('plain', [{ kind: 'heading', text: 'What we handle' }, { kind: 'list' }])] }, settled)
    expect(settled).toEqual([{ at: 'sections[1].blocks[1]', what: 'an empty list; left out' }])
  })
})

describe('a section left a heading alone (AGL-4152)', () => {
  const doc = readOf(THIN, '/commercial-work')

  it('is refilled from the old section its heading names: its four kinds of work, kept as the owner wrote them', () => {
    // The answer wrote the list empty: the read leaves it out, and the section is the heading alone.
    const { page, settled } = drawn(doc, { sections: [opening, offers, section('plain', [{ kind: 'heading', text: 'What we handle' }, { kind: 'list' }]), closing] })
    expect(settled.map((note) => note.what)).toEqual(['an empty list; left out'])
    const work = page.given.sections[2]
    expect(work?.blocks[0]).toMatchObject({ kind: 'heading', text: 'What we handle' })
    expect(work?.blocks.slice(1).flatMap((block) => (block.items ?? []).map((entry) => entry.title))).toEqual(WORK)
    expect(page.mended).toEqual(['"What we handle" refilled from its old section (group:1)'])
    // And the page built from it holds every one of them.
    const result = built(doc, page)
    expect(result.violations).toEqual([])
    const words = Object.values(result.value?.nodes ?? {}).map((node) => String((node as { props?: Record<string, unknown> }).props?.['children'] ?? ''))
    for (const line of WORK) expect(words).toContain(line)
  })

  it('takes the old section’s lines as written, as a list, where they are no group of the ledger', () => {
    const lines = readOf(THIN.replace(/<ul>.*<\/ul>/, '<p>parking lots</p><p>Sidewalks/ Curbs &amp; Gutter</p>'), '/commercial-work')
    const { page } = drawn(lines, { sections: [opening, offers, section('plain', [{ kind: 'eyebrow', text: 'Scope' }, { kind: 'heading', text: 'What we handle' }]), closing] })
    expect(page.given.sections[2]?.blocks).toEqual([
      { kind: 'eyebrow', text: 'Scope' },
      { kind: 'heading', text: 'What we handle' },
      { kind: 'list', items: [{ title: 'parking lots', text: '' }, { title: 'Sidewalks/ Curbs & Gutter', text: '' }], columns: 1 },
    ])
    // The owner's own words are not a rewrite the doctrine holds as one.
    expect(page.written).not.toContain('parking lots')
  })

  it('is handed to the next section as its heading, where it names nothing and that one has none', () => {
    const { page } = drawn(doc, {
      sections: [opening, section('plain', [{ kind: 'heading', text: 'Why crews call us back' }]), section('soft', [{ kind: 'cards', items: [item('On time', { text: 'We show up when we say.' }), item('Clean', { text: 'We leave the site swept.' })] }]), closing],
    })
    expect(page.given.sections).toHaveLength(3)
    expect(page.given.sections[1]?.blocks.map((block) => block.kind)).toEqual(['heading', 'cards'])
    expect(page.mended).toEqual(['"Why crews call us back" handed to the section after it'])
  })

  it('is left out where neither holds', () => {
    const { page } = drawn(doc, { sections: [opening, section('plain', [{ kind: 'heading', text: 'Why crews call us back' }]), offers, closing] })
    expect(page.names).toEqual(['A concrete crew when you need one', 'Two ways to work with us', 'Ready for a site visit?'])
    expect(page.mended).toEqual(['"Why crews call us back" left out, a heading over nothing'])
  })

  it('leaves the opening, and every section that says something, as it was', () => {
    const answer = { sections: [section('dark', [{ kind: 'heading', text: 'Commercial work' }]), offers, closing] }
    const { page } = drawn(doc, answer)
    expect(page.given.sections).toHaveLength(3)
    expect(page.mended).toEqual([])
  })
})

describe('a finished page’s last word on hollow sections (AGL-4152)', () => {
  type Spec = { componentId: string; props?: Record<string, unknown>; nodes?: string[]; interactions?: unknown[] }
  const text = (children: string, variant = 'body1'): Spec => ({ componentId: 'muiTypography', props: { children, variant } })
  const nodes = (): NodesMap =>
    ({
      root: { componentId: 'div', nodes: ['hero', 'work', 'gallery', 'close'] },
      hero: { componentId: 'section', props: { ariaLabel: 'Hero' }, nodes: ['h1', 'toWork'] },
      h1: text('A crew when you need one', 'h1'),
      toWork: {
        componentId: 'muiButton',
        props: { children: 'See what we handle' },
        interactions: [{ id: 'go', enabled: true, trigger: { event: 'elementClick' }, steps: [{ type: 'scrollTo', selector: '[data-aglyn="leaf:work"]' }] }],
      },
      work: { componentId: 'section', props: { ariaLabel: 'What we handle' }, nodes: ['workBox'] },
      workBox: { componentId: 'muiContainer', nodes: ['workStack'] },
      workStack: { componentId: 'muiStack', nodes: ['workHead', 'workIcon'] },
      workHead: text('What we handle', 'h2'),
      workIcon: { componentId: 'icon', props: { iconId: 'truck' } },
      gallery: { componentId: 'section', props: { ariaLabel: 'Our work' }, nodes: ['galleryHead', 'film'] },
      galleryHead: text('Our work', 'h2'),
      film: { componentId: 'video', props: { src: 'https://video.example/pour.mp4' } },
      close: { componentId: 'section', props: { ariaLabel: 'Close' }, nodes: ['closeHead', 'closeButton'] },
      closeHead: text('Ready?', 'h2'),
      closeButton: { componentId: 'muiButton', props: { children: 'Request a site visit', screenId: 'p-contact' } },
    }) as unknown as NodesMap

  it('takes out a section showing only its heading, with the link that scrolled to it, and nothing that says something', () => {
    const { nodes: out, dropped } = aiLayoutWithoutHollowSections(nodes(), 'root')
    const kept = out as unknown as Record<string, Spec>
    expect(kept['root']?.nodes).toEqual(['hero', 'gallery', 'close'])
    expect(kept['toWork']).toBeUndefined()
    expect(dropped).toEqual(['the section "What we handle", left with only its heading', '"See what we handle", a link to that section'])
  })

  it('is said once in the page step’s log, rows evened first', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const page = nodes() as unknown as Record<string, Spec>
    page[CANVAS_ROOT_ELEMENT_ID] = page['root'] as Spec
    delete page['root']
    const out = aiSiteImportFinishedPage(page as unknown as NodesMap, { jobId: 'job-1', slug: 'commercial-work' }) as unknown as Record<string, Spec>
    expect(out[CANVAS_ROOT_ELEMENT_ID]?.nodes).toEqual(['hero', 'gallery', 'close'])
    expect(info).toHaveBeenCalledWith('ai imported page: its finished page mended', {
      jobId: 'job-1',
      slug: 'commercial-work',
      rowsEvened: 0,
      dropped: ['the section "What we handle", left with only its heading', '"See what we handle", a link to that section'],
    })
    info.mockRestore()
  })

  it('leaves a page with none as it was, to the object', () => {
    const page = nodes() as unknown as Record<string, Spec>
    page['workStack'] = { componentId: 'muiStack', nodes: ['workHead', 'workLine'] }
    page['workLine'] = text('Parking lots, sidewalks and slabs.')
    const input = page as unknown as NodesMap
    expect(aiLayoutWithoutHollowSections(input, 'root').nodes).toBe(input)
  })
})

/*------------------------------------------
 * 2. Even card rows
 *-----------------------------------------*/

/** A tax firm's Services page: an opening photo, and three photos of what is included. */
const SERVICES = `<!doctype html><html><head><title>Services | Larkspur Tax</title></head><body>
<header><a href="/">Larkspur Tax</a><nav><a href="/services">Services</a><a href="/contact">Contact</a></nav></header>
<main>
<section><img src="${ORIGIN}/media/office.jpg" alt="Our front office" width="1600" height="900"><h1>Tax help for families and small firms</h1><p>Returns, planning and books, all year.</p></section>
<section><h2>What is included</h2>
<img src="${ORIGIN}/media/desk.jpg" alt="A planner at a desk" width="1200" height="900"><p>Planning for the year ahead.</p>
<img src="${ORIGIN}/media/forms.jpg" alt="Forms on a table" width="1200" height="900"><p>Returns filed on time.</p>
<img src="${ORIGIN}/media/ledger.jpg" alt="A ledger" width="1200" height="900"><p>Bookkeeping every month.</p></section>
</main></body></html>`

const servicesOpening = section('plain', [{ kind: 'keep', ref: 'picture:1' }, { kind: 'heading', text: 'Tax help for families and small firms' }, { kind: 'lede', text: 'Returns, planning and books, all year.' }])

describe('a row of cards with a picture on some (AGL-4152)', () => {
  const doc = readOf(SERVICES, '/services')
  const cardsOf = (page: ReturnType<typeof drawn>['page']) => page.given.sections[1]?.blocks.find((block) => block.kind === 'cards') as AiLayoutBlock

  it('gives every card one where most have one: the page’s own photo no section places, the one whose words it says', () => {
    const { page } = drawn(doc, {
      sections: [
        servicesOpening,
        section('soft', [
          { kind: 'heading', text: 'What is included' },
          {
            kind: 'cards',
            items: [item('Planning', { text: 'Planning for the year ahead.', icon: 'calendar' }), item('Returns', { text: 'Returns filed on time.', ref: 'picture:3' }), item('Bookkeeping', { text: 'Bookkeeping every month.', ref: 'picture:4' })],
          },
        ]),
      ],
    })
    const cards = cardsOf(page)
    expect(cards.items?.map((entry) => entry.picture?.alt)).toEqual(['A planner at a desk', 'Forms on a table', 'A ledger'])
    // Icons on every card or on none.
    expect(cards.items?.some((entry) => entry.icon)).toBe(false)
    expect(cards.variant === 'pictures' || cards.variant === 'articles').toBe(true)
    expect(page.mended).toEqual(['3 cards each given a picture, 2 of them had one (0 to fill)', '3 cards drawn with no icon, 1 of them had one'])
    expect(page.pictures.unplaced).toEqual([])
  })

  it('leaves a slot the page step fills where the page has no photo of its own left', () => {
    const { page } = drawn(doc, {
      sections: [
        servicesOpening,
        section('soft', [{ kind: 'keep', ref: 'picture:2' }]),
        section('soft', [
          { kind: 'heading', text: 'What is included' },
          { kind: 'cards', items: [item('Planning', { text: 'For the year ahead.' }), item('Returns', { text: 'Returns filed on time.', ref: 'picture:3' }), item('Bookkeeping', { text: 'Bookkeeping every month.', ref: 'picture:4' })] },
        ]),
      ],
    })
    const cards = page.given.sections[2]?.blocks.find((block) => block.kind === 'cards')
    expect(cards?.items?.[0]?.picture).toMatchObject({ src: '', alt: 'Planning' })
    expect(page.pictures.slots).toBe(1)
    // Built, the card's picture is a slot the page step's pictures fill: its words and no source.
    const result = built(doc, page)
    expect(result.violations).toEqual([])
    const slots = Object.values(result.value?.nodes ?? {}).filter((node) => (node as { componentId?: string }).componentId === 'image' && !(node as { props?: Record<string, unknown> }).props?.['src'])
    expect(slots.map((node) => (node as { props?: Record<string, unknown> }).props?.['alt'])).toEqual(['Planning'])
  })

  it('gives none where most have none, and the photos it takes off are the page’s to place again', () => {
    const { page } = drawn(doc, {
      sections: [
        servicesOpening,
        section('soft', [
          { kind: 'heading', text: 'What is included' },
          { kind: 'cards', items: [item('Planning', { text: 'For the year ahead.', ref: 'picture:2', icon: 'calendar' }), item('Returns', { text: 'Filed on time.', icon: 'document' }), item('Bookkeeping', { text: 'Every month.', icon: 'chart' })] },
        ]),
      ],
    })
    const cards = cardsOf(page)
    expect(cards.items?.every((entry) => !entry.picture && entry.icon)).toBe(true)
    expect(page.pictures.unplaced).toContain(`${ORIGIN}/media/desk.jpg`)
  })

  it('leaves an even row as it was', () => {
    const { page } = drawn(doc, {
      sections: [servicesOpening, section('soft', [{ kind: 'heading', text: 'What is included' }, { kind: 'cards', items: [item('Planning', { text: 'For the year.', icon: 'calendar' }), item('Returns', { text: 'On time.', icon: 'document' })] }])],
    })
    expect(page.mended).toEqual([])
  })

  it('takes every picture off a finished row one of whose pictures could not be found, and never a split row’s', () => {
    const card = (pictured: boolean) => (pictured ? ['img', 'content'] : ['content'])
    const nodes: Record<string, { componentId: string; props?: Record<string, unknown>; nodes?: string[] }> = {
      root: { componentId: 'div', nodes: ['row', 'split'] },
      row: { componentId: 'muiGrid', props: { container: true }, nodes: ['c1', 'c2', 'c3'] },
      split: { componentId: 'muiGrid', props: { container: true }, nodes: ['words', 'photoCell'] },
      words: { componentId: 'muiStack', nodes: ['wordsText'] },
      wordsText: { componentId: 'muiTypography', props: { children: 'Since 1994.' } },
      photoCell: { componentId: 'muiGrid', nodes: ['photo'] },
      photo: { componentId: 'image', props: { src: 'media:h/photo' } },
    }
    ;[true, true, false].forEach((pictured, at) => {
      const n = at + 1
      nodes[`c${n}`] = { componentId: 'muiGrid', props: { size: 'xs:12 md:4' }, nodes: [`card${n}`] }
      nodes[`card${n}`] = { componentId: 'muiCard', nodes: card(pictured).map((part) => `${part}${n}`) }
      if (pictured) nodes[`img${n}`] = { componentId: 'image', props: { src: `media:h/${n}` } }
      nodes[`content${n}`] = { componentId: 'muiCardContent', nodes: [] }
    })
    const { nodes: out, evened } = aiLayoutEvenCardPictures(nodes as unknown as NodesMap)
    const kept = out as unknown as typeof nodes
    expect(evened).toBe(1)
    expect([kept['card1']?.nodes, kept['card2']?.nodes, kept['card3']?.nodes]).toEqual([['content1'], ['content2'], ['content3']])
    expect(kept['img1']).toBeUndefined()
    expect(kept['photo']).toBeDefined()
  })
})

/*------------------------------------------
 * 3. A fuller footer
 *-----------------------------------------*/

describe('how a site is reached, as its home page states it (AGL-4152)', () => {
  const page = (blocks: Array<Record<string, unknown>>) => siteImportSiteFacts({ blocks: blocks as never, organization: null })

  it('takes a call link’s number where its words are only "Call now", and a link of the page’s body', () => {
    const facts = page([
      { kind: 'link', text: 'Call Now', href: 'tel:+15552013344', region: 'main' },
      { kind: 'link', text: 'Email us', href: 'mailto:Office@Northfield.example?subject=Quote', region: 'main' },
    ])
    expect(facts.phones).toEqual(['+15552013344'])
    expect(facts.emails).toEqual(['Office@Northfield.example'])
  })

  it('takes a number or an address written out in full, and never a span of years or a license number', () => {
    const facts = page([
      { kind: 'paragraph', text: 'Family owned 1998-2024. License 88213-4410.', region: 'main' },
      { kind: 'paragraph', text: 'Call (555) 013-7788 or write to crew@northfield.example.', region: 'main' },
    ])
    expect(facts.phones).toEqual(['(555) 013-7788'])
    expect(facts.emails).toEqual(['crew@northfield.example'])
  })

  it('puts the header’s and footer’s own first', () => {
    const facts = page([
      { kind: 'link', text: '555-201-3344', href: 'tel:5552013344', region: 'main' },
      { kind: 'link', text: '555-999-0000', href: 'tel:5559990000', region: 'footer' },
    ])
    expect(facts.phones).toEqual(['555-999-0000', '555-201-3344'])
  })
})

describe('the footer a site’s plan draws (AGL-4152)', () => {
  it('opens with the site’s name and says how to reach it, which the frame’s check holds to what the site states', () => {
    const state = siteImportReplayPlanState('contractor')
    const pages = state.pages.filter((entry) => entry.slug !== '/')
    const held = aiSiteImportPlanRead(
      {
        site: { what: 'Plain words.', audience: 'visitors', kind: 'business', voice: 'plain' },
        nav: { groups: [{ label: 'What we do', pages: pages.map((entry) => entry.draftId) }], cta: { label: 'Start', target: (pages[0] as { draftId: string }).draftId }, footer: [{ label: 'Pages', pages: pages.map((entry) => entry.draftId) }] },
        design: { hero: 'split', group: 'cards', rhythm: 'alternate', cta: 'band' },
        proposed: { title: '', slug: '', purpose: '' },
      },
      { state, scope: ['Plain words. visitors plain what we do start pages', ...pages.map((entry) => entry.title)], required: aiSiteImportMenuPageIds(state), roomForPage: true },
    )
    const frame = siteImportReplayFrame('contractor', { generative: true, plan: held.plan as AiSiteImportPlan })
    expect(frame.violations).toEqual([])
    const nodes = Object.values(frame.tree.nodes) as Array<{ componentId?: string; props?: Record<string, unknown> }>
    const footerNode = nodes.find((node) => node.componentId === 'section' && node.props?.['element'] === 'footer')
    expect(footerNode).toBeDefined()
    // The number the contractor's reviews give, as a link that calls it; the name as a wordmark, since it has no logo.
    expect(nodes.find((node) => node.props?.['href'] === 'tel:5550137788')?.props?.['children']).toBe('(555) 013-7788')
    // (The recorded state names the site "import-check".)
    expect(nodes.filter((node) => node.componentId === 'muiTypography' && node.props?.['variant'] === 'h6').map((node) => node.props?.['children'])).toEqual(['import-check'])
  })

  it('opens with the logo under Improve it, whatever the source’s footer opened with', () => {
    const base = siteImportReplayPlanState('contractor')
    const home = base.home as NonNullable<typeof base.home>
    const state = {
      ...base,
      home: { ...home, brand: { ...home.brand, kind: 'logo-and-name' as const }, ...(home.footer ? { footer: { ...home.footer, logo: false } } : {}) },
      look: { ...(base.look as NonNullable<typeof base.look>), logo: { mediaId: 'm9', src: 'media:host-import/m9', width: 400, height: 400 } },
    }
    const job = { $id: 'importJob', orgId: 'org', hostId: 'host', kind: 'import', inputs: {}, steps: [], outputs: [] } as unknown as AiJob
    const wave = state.waves[0] as AiSiteImportState['waves'][number]
    expect(aiLayoutSiteBrandOf(aiSiteImportFrameJob(job, state, { ...wave, generative: true }, []).inputs)).toMatchObject({ logo: { src: 'media:host-import/m9' }, footer: true })
    expect(aiLayoutSiteBrandOf(aiSiteImportFrameJob(job, state, { ...wave, generative: undefined } as never, []).inputs)).not.toHaveProperty('footer')
  })

  it('holds a frame’s contact details to the footer’s facts only where a plan draws it', () => {
    const footer = { columns: [], links: [], text: [], social: [], address: null, phone: '(555) 013-7788', email: 'crew@northfield.example', copyright: null }
    expect(aiSiteImportFrameFactLines(['Open 7 to 5'], { planned: true, nav: [], ctas: [], header: 'paper', footer })).toEqual(['Open 7 to 5', '(555) 013-7788', 'crew@northfield.example'])
    expect(aiSiteImportFrameFactLines(['Open 7 to 5'], { nav: [], ctas: [], header: 'paper', footer })).toEqual(['Open 7 to 5'])
  })
})

/*------------------------------------------
 * 4. One button per destination in a band
 *-----------------------------------------*/

const button = (text: string, to: string, rest: Partial<AiLayoutBlock> = {}): AiLayoutBlock => ({ kind: 'button', text, to, ...rest })
const kinds = (blocks: readonly AiLayoutBlock[]) => blocks.map((block) => (block.kind === 'button' ? `button:${block.text}:${block.style ?? 'filled'}` : block.kind))

describe('buttons in one section to one place (AGL-4152)', () => {
  it('are one, the strongest, wherever they stand; a call is another place', () => {
    const band = [
      { kind: 'heading', text: 'Ready to pour?' } as AiLayoutBlock,
      button('Contact Us', 'page:p-contact', { style: 'secondary' }),
      button('Call (555) 201-3344', 'tel:5552013344'),
      { kind: 'text', text: 'We answer the same day.' } as AiLayoutBlock,
      button('Request a Quote', 'page:p-contact', { style: 'primary' }),
    ]
    expect(kinds(aiSiteImportSectionActions({ blocks: band }).blocks)).toEqual(['heading', 'button:Call (555) 201-3344:filled', 'text', 'button:Request a Quote:primary'])
  })

  it('keep the first of equals, with the header’s words where one has them', () => {
    const apart = [button('Contact Us', 'page:p-contact'), { kind: 'text', text: 'Or stop by.' } as AiLayoutBlock, button('Request a quote', 'page:p-contact')]
    expect(kinds(aiSiteImportSectionActions({ blocks: apart }).blocks)).toEqual(['button:Contact Us:filled', 'text'])
    expect(kinds(aiSiteImportSectionActions({ blocks: apart }, 'Request a quote').blocks)).toEqual(['button:Request a quote:filled', 'text'])
  })

  it('reads a number by its digits and an address without its trailing slash', () => {
    expect(aiSiteImportDestinationKey('tel:+1 (555) 201-3344')).toBe(aiSiteImportDestinationKey('tel:+15552013344'))
    expect(aiSiteImportDestinationKey('https://Reviews.example/northfield/')).toBe(aiSiteImportDestinationKey('https://reviews.example/northfield'))
    expect(aiSiteImportDestinationKey('page:p-contact')).not.toBe(aiSiteImportDestinationKey('tel:5552013344'))
  })

  it('come out one in a redesign’s closing band whose "Contact us" and "Request a quote" both go to the contact page', () => {
    const doc = readOf(THIN, '/commercial-work', { formPage: 'p-contact' })
    const { page } = drawn(doc, {
      sections: [
        opening,
        offers,
        section('brand', [
          { kind: 'heading', text: 'Ready for a site visit?' },
          { kind: 'button', text: 'Call (555) 201-3344', to: 'phone', style: 'primary' },
          { kind: 'button', text: 'Contact Us', to: 'page:p-contact', style: 'secondary' },
          { kind: 'button', text: 'Request a Quote', to: 'form', style: 'secondary' },
        ]),
      ],
    })
    const band = page.given.sections[2]?.blocks ?? []
    expect(band.filter((block) => block.kind === 'button').map((block) => [block.text, block.to])).toEqual([
      ['Call (555) 201-3344', 'tel:5552013344'],
      ['Contact Us', 'page:p-contact'],
    ])
  })
})

/*------------------------------------------
 * 5. The picture cap counts only pictures asked for in words
 *-----------------------------------------*/

/** A contractor's Projects page: four of the owner's photos it keeps, two to a row. */
const PROJECTS = `<!doctype html><html><head><title>Projects | Northfield Paving</title></head><body>
<header><a href="/">Northfield Paving</a></header>
<main>
<section><h1>Recent pours</h1><p>Lots, slabs and walks across the county.</p></section>
<section><h2>Lots</h2><img src="${ORIGIN}/media/lot1.jpg" alt="A striped lot" width="1600" height="1000"><p>A grocer's lot.</p><img src="${ORIGIN}/media/lot2.jpg" alt="A church lot" width="1600" height="1000"><p>A church lot.</p></section>
<section><h2>Slabs</h2><img src="${ORIGIN}/media/slab1.jpg" alt="A shop slab" width="1600" height="1000"><p>A shop floor.</p><img src="${ORIGIN}/media/slab2.jpg" alt="A barn slab" width="1600" height="1000"><p>A barn floor.</p></section>
</main></body></html>`

describe('the pictures a redesign asks for in words (AGL-4152)', () => {
  const doc = readOf(PROJECTS, '/projects')
  const answer = (asked: number) => ({
    sections: [
      section('plain', [{ kind: 'heading', text: 'Recent pours' }, { kind: 'lede', text: 'Lots, slabs and walks across the county.' }, { kind: 'image', text: 'A crew finishing a slab' }]),
      section('soft', [{ kind: 'heading', text: 'Lots' }, { kind: 'keep', ref: 'picture:1', col: 0 }, { kind: 'keep', ref: 'picture:2', col: 1 }], [1, 1]),
      section('plain', [{ kind: 'heading', text: 'Slabs' }, { kind: 'keep', ref: 'picture:3', col: 0 }, { kind: 'keep', ref: 'picture:4', col: 1 }], [1, 1]),
      ...Array.from({ length: asked - 1 }, (_, at) => section(at % 2 ? 'plain' : 'soft', [{ kind: 'heading', text: `Walks ${at + 1}` }, { kind: 'text', text: 'Sidewalks and curbs.' }, { kind: 'image', text: `A new sidewalk ${at + 1}` }])),
    ],
  })
  const slotsOf = (result: ReturnType<typeof built>) =>
    Object.values(result.value?.nodes ?? {}).filter((node) => (node as { componentId?: string }).componentId === 'image' && !(node as { props?: Record<string, unknown> }).props?.['src']).length

  it('are never crowded out by the owner’s own photos the page keeps', () => {
    const { page } = drawn(doc, answer(3))
    const result = built(doc, page)
    expect(result.violations).toEqual([])
    expect(slotsOf(result)).toBe(3)
    expect(result.value?.settled.filter((note) => /past the page/.test(note.what))).toEqual([])
  })

  it('still stop at three, and the one past them is said in the page’s log line', () => {
    const { page } = drawn(doc, answer(4))
    const result = built(doc, page)
    expect(slotsOf(result)).toBe(3)
    expect(aiSiteImportRedesignPassed({ built: result.value as never, page, read: [] })).toMatchObject({ pastCap: 1, readDropped: [], mended: [] })
  })
})
