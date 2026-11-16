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
 * A generative Improve it's misses from its 11/15 live run (AGL-4152),
 * offline, on an invented site: a short tagline mostly in title case names no
 * one, so a redesign that leaves it out loses no fact, while a sentence still
 * holds its names; and any page may call or write to the site's own number
 * and address, which its header and footer give on every page, as its home
 * page gives them. Every answer
 * here is written by hand in the tool's shape: no model is called.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  siteImportFidelity,
  type SiteImportFidelityTree,
} from '../model/ai-site-import-fidelity'
import { siteImportReplayDocumentOf } from '../site-import/fixtures/site-import-fidelity-replay'
import {
  aiSiteImportWaveStamped,
  type AiSiteImportPage,
  type AiSiteImportState,
} from '../model/ai-site-import'
import { siteImportReplayDocument } from '../site-import/fixtures/site-import-fidelity-replay'
import { aiSiteImportDocumentFor } from './ai-job-import-step'
import { aiImportedPageCheck } from './ai-job-page-language'
import {
  AI_LAYOUT_IMPORTED_SECTIONS_INPUT,
  aiSiteImportDocumentOf,
} from './ai-site-import-document'
import type { AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportHonesty } from './ai-site-import-honesty'
import {
  aiReadImprovedPage,
  aiSiteImportImproveDestinations,
  aiSiteImportImprovedPage,
  aiSiteImportImproveLedger,
  aiSiteImportImproveScope,
} from './ai-site-import-improve'

const ORIGIN = 'https://www.larkspur-paving.example'
const sameSite = (url: URL) => url.origin === ORIGIN

/** An invented paving firm's page: a tagline mostly in title case, and a sentence that names a client and a street. The phone is only in the footer. */
const PAGE = `<!doctype html><html><head><title>Residential Work</title></head><body>
<header><a href="/">Larkspur Paving</a><nav><a href="/work">Work</a><a href="/contact">Contact</a></nav></header>
<main>
<section><h1>Residential work</h1><p>Everything Done right</p></section>
<section><h2>Recent pours</h2><p>We poured a driveway for Rosa on Elm Road last spring.</p></section>
</main><footer><p>Larkspur Paving. Call 555-201-3344.</p></footer></body></html>`

const readOf = (
  siteLines: string[] = [],
  siteContacts?: AiSiteImportDocument['siteContacts'],
): AiSiteImportDocument => ({
  ...siteImportReplayDocumentOf(PAGE, `${ORIGIN}/work`, sameSite),
  finish: 'improve',
  wording: 'improved',
  generative: true,
  siteLines,
  ...(siteContacts ? { siteContacts } : {}),
})

const section = (band: string, blocks: Array<Record<string, unknown>>) => ({
  band,
  cols: [],
  align: 'start',
  blocks: blocks.map((block) => ({
    col: -1,
    text: '',
    to: '',
    style: 'none',
    icon: '',
    items: [],
    ref: '',
    ...block,
  })),
})

/** The facts a built redesign misses, as the improved score reads them. */
function missingFacts(doc: AiSiteImportDocument, answer: unknown): string[] {
  const ledger = aiSiteImportImproveLedger(doc)
  const read = aiReadImprovedPage(answer)
  if (!read) throw new Error('no section')
  const design = { kind: 'business', seed: 7, home: false } as never
  const page = aiSiteImportImprovedPage(read, {
    doc,
    ledger,
    design,
    destinations: aiSiteImportImproveDestinations(doc, ledger),
    formId: null,
  })
  const built = aiImportedPageCheck({
    screen: {
      title: doc.title,
      slug: '/work',
      sections: page.names.map((name) => ({ name, uses: [], items: 0 })),
    } as never,
    sectionIds: page.names.map((_, index) => `sec-${index}`),
    targets: {
      pageId: 'p0',
      pages: [],
      homeIds: [],
      forms: [],
      formPageId: null,
      components: [],
      facts: '',
    } as never,
    context: {
      screenIds: doc.links.map((link) => link.id),
      formIds: [],
      componentIds: [],
      codeBuilt: true,
    },
    design,
    doc,
    given: page.given,
    rewritten: page.written,
  })(null)
  expect(built.violations).toEqual([])
  const tree: SiteImportFidelityTree = {
    rootId: CANVAS_ROOT_ELEMENT_ID,
    nodes: built.value?.nodes as unknown as SiteImportFidelityTree['nodes'],
  }
  const source = {
    layout: doc.layout as NonNullable<AiSiteImportDocument['layout']>,
    blocks: doc.blocks,
    photos: doc.photos,
  }
  return (
    siteImportFidelity(source, tree, {
      finish: 'improve',
      words: 'improved',
      improved: { scope: [], destinations: [], forms: 0 },
    }).improved?.ledger.facts.missing ?? []
  )
}

describe('a short tagline mostly in title case', () => {
  const opening = section('dark', [
    { kind: 'heading', text: 'Driveways and patios for your home' },
  ])

  it('names no one: a redesign that leaves it out misses no fact', () => {
    const answer = {
      sections: [
        opening,
        section('plain', [
          {
            kind: 'text',
            text: 'We poured a driveway for Rosa on Elm Road last spring.',
          },
        ]),
      ],
    }
    expect(missingFacts(readOf(), answer)).toEqual([])
  })

  it('leaves a sentence its names: a redesign that drops the client misses her', () => {
    const answer = {
      sections: [
        opening,
        section('plain', [
          { kind: 'text', text: 'We poured a driveway last spring.' },
        ]),
      ],
    }
    expect(missingFacts(readOf(), answer)).toEqual(
      expect.arrayContaining(['name:Rosa', 'name:Elm', 'name:Road']),
    )
  })
})

describe('a page with no contact line of its own', () => {
  const SITE = [
    'Larkspur Paving',
    'Driveways since 2019-2024 seasons',
    'Call- 555-201-3344',
    'Page: Work (/work)',
  ]
  // As a home page's read keeps them: a phone link's words, and a bare number.
  const CONTACTS = {
    phones: ['Call- 555-201-3344', '5559990000'],
    emails: ['hello@larkspur-paving.example'],
  }
  const destinationsOf = (doc: AiSiteImportDocument) =>
    aiSiteImportImproveDestinations(doc, aiSiteImportImproveLedger(doc))

  it('may call and write to the site’s own number and address, the first the home page gives', () => {
    const destinations = destinationsOf(readOf(SITE, CONTACTS))
    expect(destinations.get('phone')).toBe('tel:5552013344')
    expect(destinations.get('email')).toBe(
      'mailto:hello@larkspur-paving.example',
    )
  })

  it('takes a bare number the home page gives', () => {
    expect(
      destinationsOf(readOf(SITE, { phones: ['5559990000'], emails: [] })).get(
        'phone',
      ),
    ).toBe('tel:5559990000')
  })

  it('takes no run of the site’s other lines for a phone', () => {
    expect(destinationsOf(readOf(SITE)).has('phone')).toBe(false)
  })

  it('passes the honesty gate with a button that calls the site', () => {
    const doc = readOf(SITE, CONTACTS)
    const ledger = aiSiteImportImproveLedger(doc)
    const read = aiReadImprovedPage({
      sections: [
        section('dark', [
          { kind: 'heading', text: 'Residential work' },
          { kind: 'button', text: 'Call us', to: 'phone', style: 'filled' },
        ]),
        section('plain', [
          {
            kind: 'text',
            text: 'We poured a driveway for Rosa on Elm Road last spring.',
          },
        ]),
      ],
    })
    if (!read) throw new Error('no section')
    const violations = aiSiteImportHonesty(read, {
      ledger,
      scope: aiSiteImportImproveScope(doc, null),
      destinations: aiSiteImportImproveDestinations(doc, ledger, {
        sections: read.length,
      }),
    })
    expect(
      violations.filter(
        (violation) => violation.code === 'improve-invented-fact',
      ),
    ).toEqual([])
  })
})

describe('a redesigned page’s document', () => {
  const state = {
    domain: 'larkspur-paving.example',
    siteName: 'Larkspur',
    finish: 'improve',
    wording: true,
    home: {
      siteName: 'Larkspur Paving',
      title: 'Larkspur Paving',
      description: '',
      brand: { kind: 'name', text: 'Larkspur Paving' },
      facts: {
        emails: ['hello@larkspur-paving.example'],
        phones: ['Call- 555-201-3344'],
        lines: [],
        address: '',
        social: [],
      },
    },
    pages: [
      {
        slot: 'p0',
        url: `${ORIGIN}/`,
        path: '/',
        title: 'Home',
        group: 'main',
        wave: 1,
        draftId: 'd0',
        slug: '/',
        words: 80,
        images: 1,
        build: 'arranged',
        read: { blocks: siteImportReplayDocument('contractor').blocks },
      },
    ],
    waves: [
      {
        index: 1,
        label: 'Wave 1',
        group: 'main',
        slots: ['p0'],
        frame: false,
        status: 'running',
        startedAt: 'x',
        finishedAt: null,
      },
    ],
  } as unknown as AiSiteImportState

  it('carries the site’s own phones and emails, through the job’s input', () => {
    const on = aiSiteImportWaveStamped(state, 1, { generative: true })
    const doc = aiSiteImportDocumentFor(on, on.pages[0] as AiSiteImportPage)
    expect(doc?.siteContacts).toEqual({
      phones: ['Call- 555-201-3344'],
      emails: ['hello@larkspur-paving.example'],
    })
    const read = aiSiteImportDocumentOf({
      [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: JSON.parse(JSON.stringify(doc)),
    })
    expect(read?.siteContacts).toEqual(doc?.siteContacts)
    if (!read) throw new Error('no document')
    // The page's own number comes first: the site's is for a page that gives none.
    expect(
      aiSiteImportImproveDestinations(
        read,
        aiSiteImportImproveLedger(read),
      ).get('phone'),
    ).toBe('tel:5550137788')
    const bare = { ...read, blocks: [] }
    expect(
      aiSiteImportImproveDestinations(
        bare,
        aiSiteImportImproveLedger(bare),
      ).get('phone'),
    ).toBe('tel:5552013344')
  })

  it('carries none off a redesigned wave', () => {
    const off = aiSiteImportWaveStamped(state, 1)
    expect(
      Object.keys(
        aiSiteImportDocumentFor(off, off.pages[0] as AiSiteImportPage) ?? {},
      ),
    ).not.toContain('siteContacts')
  })
})
