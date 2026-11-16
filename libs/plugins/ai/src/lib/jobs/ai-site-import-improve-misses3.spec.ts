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
 * and address, which its header and footer give on every page. Every answer
 * here is written by hand in the tool's shape: no model is called.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  siteImportFidelity,
  type SiteImportFidelityTree,
} from '../model/ai-site-import-fidelity'
import { siteImportReplayDocumentOf } from '../site-import/fixtures/site-import-fidelity-replay'
import { aiImportedPageCheck } from './ai-job-page-language'
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

const readOf = (siteLines: string[] = []): AiSiteImportDocument => ({
  ...siteImportReplayDocumentOf(PAGE, `${ORIGIN}/work`, sameSite),
  finish: 'improve',
  wording: 'improved',
  generative: true,
  siteLines,
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
    '555-201-3344',
    'hello@larkspur-paving.example',
    'Page: Work (/work)',
  ]

  it('may call and write to the site’s own number and address', () => {
    const doc = readOf(SITE)
    const destinations = aiSiteImportImproveDestinations(
      doc,
      aiSiteImportImproveLedger(doc),
    )
    expect(destinations.get('phone')).toBe('tel:5552013344')
    expect(destinations.get('email')).toBe(
      'mailto:hello@larkspur-paving.example',
    )
  })

  it('takes no other run of the site’s digits for a phone', () => {
    const doc = readOf(['Larkspur Paving', 'Driveways since 2019-2024 seasons'])
    expect(
      aiSiteImportImproveDestinations(doc, aiSiteImportImproveLedger(doc)).has(
        'phone',
      ),
    ).toBe(false)
  })

  it('passes the honesty gate with a button that calls the site', () => {
    const doc = readOf(SITE)
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
