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
 * A section draws every row its source sets, and a quote keeps its link
 * (AGL-4152). On a live import the first row of a section stood in columns and
 * the rest ran down the page, and "See more" under each customer's words was
 * gone. Invented pages, read, built and scored with no model.
 */

import { siteImportFidelity, siteImportFidelityHolds, type SiteImportFidelityNode, type SiteImportFidelityOptions } from '../model/ai-site-import-fidelity'
import { siteImportReplayBuild, siteImportReplayDocumentOf, type SiteImportReplayPage } from '../site-import/fixtures/site-import-fidelity-replay'

const URL_OF_PAGE = 'https://www.larkspur-paving.example/'
const sameSite = (url: URL) => url.hostname === 'www.larkspur-paving.example'
const photo = (name: string) => `<img src="https://www.larkspur-paving.example/media/${name}.jpg" alt="A ${name}" width="1200" height="800">`
const RULES = '.row { display: flex; flex-direction: row; } .wide { flex: 2; } .narrow { flex: 1; } .button { display: inline-block; padding: 12px 20px; background-color: #1420e0; color: #ffffff; }'
const page = (body: string) => `<!doctype html><html><head><title>A page</title><style>${RULES}</style></head><body><main>${body}</main></body></html>`

const SLAB = 'Flatwork built for the load, set out to spec and finished clean every single time.'
const LOT = 'Full parking-lot concrete: layout, grading, pour and finish, built to carry the traffic.'
const PATIO = 'Patios and driveways stamped and colored, with a walkthrough before the first pour.'

const card = (name: string, title: string, words: string, side = '') => `<div class="wide">${photo(name)}</div><div class="narrow"><h4>${title}</h4><p>${words}</p>${side}</div>`
const threeRows = page(`<section><h1>What we pour</h1><p>Every job starts with a walk of the site and a plain price.</p></section><section><h2>Our work</h2>
<div class="row">${card('slab', 'Slabs', SLAB, '<a class="button" href="/slabs">See slabs</a>')}</div>
<div class="row">${card('lot', 'Parking lots', LOT)}</div>
<div class="row"><div class="narrow"><h4>Patios</h4><p>${PATIO}</p></div><div class="narrow">${photo('patio')}</div><div class="narrow">${photo('deck')}</div></div>
<p>Call for a quote.</p></section>`)

const built = (html: string, options: { finish?: 'keep' | 'improve' } = {}): SiteImportReplayPage => siteImportReplayBuild(siteImportReplayDocumentOf(html, URL_OF_PAGE, sameSite), '/', true, { ...options, words: 'kept' })
const scored = (page_: SiteImportReplayPage, options: SiteImportFidelityOptions = {}) => siteImportFidelity(page_.source, page_.tree, { words: 'kept', ...options })

const isRow = (node: SiteImportFidelityNode) => node.componentId === 'muiGrid' && (node.props?.['container'] === true || node.props?.['container'] === 'true')
const nodesOf = (page_: SiteImportReplayPage) => page_.tree.nodes as Record<string, SiteImportFidelityNode>
/** The grids a page sets side by side, by what each column holds, words and pictures in order. */
function gridsOf(page_: SiteImportReplayPage): string[][][] {
  const nodes = nodesOf(page_)
  const said = (id: string): string[] => {
    const node = nodes[id]
    const own = node?.componentId === 'image' ? ['picture'] : typeof node?.props?.['children'] === 'string' ? [node.props['children'] as string] : []
    return [...own, ...(node?.nodes ?? []).flatMap(said)]
  }
  return Object.values(nodes)
    .filter(isRow)
    .map((node) => (node.nodes ?? []).map(said))
}

describe('every row of a section stands in its columns', () => {
  it.each(['keep', 'improve'] as const)('three rows, as %s', (finish) => {
    const page_ = built(threeRows, { finish })
    expect(page_.violations).toEqual([])
    expect(gridsOf(page_)).toEqual([
      [['picture'], ['Slabs', SLAB, 'See slabs']],
      [['picture'], ['Parking lots', LOT]],
      [['Patios', PATIO], ['picture'], ['picture']],
    ])
    const report = scored(page_, { finish })
    expect(report.rows).toMatchObject({ source: 3, built: 3 })
    expect(report.words.missing).toBe(0)
    expect(report.words.extra).toBe(0)
    expect(report.pictures).toMatchObject({ source: 4, built: 4 })
    expect(report.headings).toMatchObject({ source: 5, built: 5 })
  })

  it('each row by the source’s own widths', () => {
    const nodes = nodesOf(built(threeRows))
    const rows = Object.values(nodes).filter(isRow)
    expect(rows.map((row) => (row.nodes ?? []).map((id) => nodes[id]?.props?.['size']))).toEqual([
      ['xs:12 md:8', 'xs:12 md:4'],
      ['xs:12 md:8', 'xs:12 md:4'],
      ['xs:12 md:4', 'xs:12 md:4', 'xs:12 md:4'],
    ])
  })

  it('keeps what stands above and below the rows in its place', () => {
    const nodes = nodesOf(built(threeRows))
    const words = (id: string): unknown[] => [...(typeof nodes[id]?.props?.['children'] === 'string' ? [nodes[id]?.props?.['children']] : []), ...(nodes[id]?.nodes ?? []).flatMap(words)]
    const all = words('_@_')
    expect(all.indexOf('Our work')).toBeLessThan(all.indexOf('Slabs'))
    expect(all.indexOf(PATIO)).toBeLessThan(all.indexOf('Call for a quote.'))
  })

  it('a row inside a column', () => {
    const page_ = built(page(`<section><h1>Who we have worked with</h1><p>Builders and stores across the whole county, for years now.</p></section><section><h2>Partners</h2>
      <div class="row"><div class="narrow">${photo('one')}</div><div class="wide"><div class="row"><div class="narrow">${photo('two')}</div><div class="narrow">${photo('three')}</div></div></div></div></section>`))
    expect(gridsOf(page_)).toEqual(expect.arrayContaining([[['picture'], ['picture', 'picture']], [['picture'], ['picture']]]))
    expect(scored(page_).rows).toMatchObject({ source: 2, built: 2 })
  })

  it('a second row in the section that opens the page, its h1 kept and no other written', () => {
    const page_ = built(page(`<section><div class="row"><div class="wide">${photo('crew')}</div><div class="narrow">${photo('truck')}</div></div>
      <div class="row"><div class="wide"><h1>Paving for the whole county</h1><p>${SLAB}</p></div><div class="narrow">${photo('pour')}</div></div></section><section><h2>More</h2><p>${LOT}</p></section>`))
    const nodes = Object.values(nodesOf(page_))
    expect(nodes.filter((node) => node.props?.['component'] === 'h1').map((node) => node.props?.['children'])).toEqual(['Paving for the whole county'])
    expect(scored(page_).rows).toMatchObject({ source: 2, built: 2 })
    expect(scored(page_).headings).toMatchObject({ source: 2, built: 2 })
  })

  it('a second row of a tab panel', () => {
    const tabs = page(`<section><h1>Plans</h1><p>${SLAB}</p></section><section><h2>Choose</h2><div role="tablist"><button role="tab" aria-controls="a" aria-selected="true">One</button><button role="tab" aria-controls="b">Two</button></div>
      <div role="tabpanel" id="a"><div class="row">${card('slab', 'Slabs', SLAB)}</div><div class="row">${card('lot', 'Lots', LOT)}</div></div><div role="tabpanel" id="b"><p>${PATIO}</p></div></section>`)
    expect(scored(built(tabs)).rows).toMatchObject({ source: 2, built: 2 })
  })

  it('a byline is still its portrait over its words, wherever it stands', () => {
    const page_ = built(page(`<section><h1>A story</h1><div class="row">${card('slab', 'Slabs', SLAB)}</div><div class="row"><div class="narrow">${photo('writer')}</div><div class="wide"><p>A writer, today</p></div></div><p>${LOT}</p></section>`))
    expect(gridsOf(page_)).toHaveLength(1)
  })

  it('a row of more columns than the site draws runs down the page, every word kept', () => {
    const cell = (at: number) => `<div class="narrow"><h3>Part ${at}</h3><p>The words of part ${at} of this long row.</p>${photo(`p${at}`)}<p>More of it here.</p></div>`
    const page_ = built(page(`<section><h1>Parts</h1><div class="row">${cell(1)}${cell(2)}</div><div class="row">${[3, 4, 5, 6, 7, 8].map(cell).join('')}</div></section>`))
    expect(scored(page_).words.missing).toBe(0)
  })

  it('draws no empty column', () => {
    const page_ = built(page(`<section><h1>A page</h1><div class="row">${card('slab', 'Slabs', SLAB)}</div><div class="row"><div class="wide"><p>${LOT}</p></div><div class="narrow"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></div></div></section>`))
    expect(page_.violations).toEqual([])
    expect(gridsOf(page_).every((grid) => grid.every((column) => column.length))).toBe(true)
  })
})

describe('a quote keeps its link and its words', () => {
  const quote = (words: string) => `<li><h2>“${words}”</h2><div><a href="/reviews">See more reviews</a></div></li>`
  const quotes = page(`<section><h1>What customers say</h1><p>Here are some of our reviews, in their own words.</p></section><section><h2>Reviews</h2><ul class="quotes">${quote('They answered every call and the patio has not moved in years.')}${quote('So glad we chose them for our back yard, it came out great.')}${quote('They came through for us when another crew walked off the job.')}</ul></section>`)

  it.each(['keep', 'improve'] as const)('as %s', (finish) => {
    const page_ = built(quotes, { finish })
    expect(page_.violations).toEqual([])
    const report = scored(page_, { finish })
    expect(report.words.missing).toBe(0)
    expect(report.groups.quotes?.items).toMatchObject({ source: 3, built: 3 })
    const nodes = Object.values(nodesOf(page_))
    const links = nodes.filter((node) => node.props?.['children'] === 'See more reviews')
    expect(links).toHaveLength(3)
    for (const link of links) expect(JSON.stringify(link)).toMatch(/reviews/i)
  })

  it('a quote the source sets in a heading is a quote: it costs no heading', () => {
    const report = scored(built(quotes))
    expect(report.headings).toMatchObject({ source: 2, built: 2 })
    expect(siteImportFidelityHolds(report, 0.9)).toBe(true)
  })

  it('a figure keeps its link too', () => {
    const stat = (figure: string, label: string) => `<div class="stat"><p>${figure}</p><p>${label}</p><a href="/work">See the work</a></div>`
    const page_ = built(page(`<section><h1>By the numbers</h1><p>${SLAB}</p></section><section><h2>Numbers</h2><div class="stats">${stat('120', 'Driveways poured')}${stat('45', 'Parking lots laid')}${stat('8', 'Years at it')}</div></section>`))
    expect(scored(page_).words.missing).toBe(0)
  })
})

describe('an opening kept as it is', () => {
  const opening = page(`<section style="text-align: center"><div class="row"><div class="narrow"><h1>Paving for the whole county</h1><p>${SLAB}</p><a class="button" href="/contact">Request a quote</a></div><div class="narrow">${photo('pour')}</div></div></section><section><h2>More</h2><p>${LOT}</p></section>`)

  it('keeps its centered words centered beside its picture', () => {
    const page_ = built(opening, { finish: 'keep' })
    const h1 = Object.values(nodesOf(page_)).find((node) => node.props?.['component'] === 'h1')
    expect(h1?.props?.['align']).toBe('center')
    expect(scored(page_, { finish: 'keep' }).align?.ratio).toBe(1)
  })

  it('improved, the hero places them', () => {
    const h1 = Object.values(nodesOf(built(opening, { finish: 'improve' }))).find((node) => node.props?.['component'] === 'h1')
    expect(h1?.props?.['align']).toBeUndefined()
  })
})
