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
 * A generative Improve it's misses from its 11/7 reruns (AGL-4152), offline,
 * on invented sites: each call to action of a redesigned section once and in
 * its place (a link every review repeats, two buttons to one page side by
 * side, buttons in a row of their own under the cards they go to), and a
 * brand's mark never taken for the opening's photo or for a slot's.
 * Every answer here is written by hand in the tool's shape: no model is called.
 */

import type { AiLayoutBlock, AiLayoutItem } from '../layout-language/ai-layout-language'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiSiteImportIsBrandMark } from '../model/ai-site-import-marks'
import { siteImportReplayDocumentOf } from '../site-import/fixtures/site-import-fidelity-replay'
import type { AiSiteImportDocument } from './ai-site-import-document'
import { aiReadImprovedPage, aiSiteImportImproveDestinations, aiSiteImportImprovedPage, aiSiteImportImproveLedger, aiSiteImportSectionActions } from './ai-site-import-improve'
import { aiSiteImportPictureSource, aiSiteImportPictureTally } from './ai-site-import-pictures'

const REVIEWS = 'https://reviews.example/northfield-paving'
const review = (title: string): AiLayoutItem => ({ title, text: 'Five stars.', links: [{ text: 'See more reviews', to: REVIEWS, style: 'primary' }] })
const button = (text: string, to: string, rest: Partial<AiLayoutBlock> = {}): AiLayoutBlock => ({ kind: 'button', text, to, ...rest })
const kinds = (blocks: readonly AiLayoutBlock[]) => blocks.map((block) => (block.kind === 'button' ? `button:${block.text}:${block.style ?? 'filled'}` : block.kind))

describe('a link every item of a group repeats', () => {
  it('is shown once, after the group, as the section’s own button where it already has one', () => {
    const quotes: AiLayoutBlock = { kind: 'quotes', items: [review('Ann'), review('Bo'), review('Cy')] }
    const { blocks } = aiSiteImportSectionActions({ blocks: [{ kind: 'heading', text: 'What customers say' }, quotes, button('See More Reviews', REVIEWS, { style: 'secondary' })] })
    expect(kinds(blocks)).toEqual(['heading', 'quotes', 'button:See More Reviews:secondary'])
    expect(blocks[1]?.items?.every((item) => !item.links)).toBe(true)
  })

  it('is shown once, after the group, where the section has none', () => {
    const quotes: AiLayoutBlock = { kind: 'quotes', items: [review('Ann'), review('Bo')], col: 1 }
    const { blocks } = aiSiteImportSectionActions({ cols: [1, 1], blocks: [{ kind: 'heading', text: 'Reviews', col: 0 }, quotes] })
    expect(blocks.slice(1)).toEqual([{ ...quotes, items: [{ title: 'Ann', text: 'Five stars.' }, { title: 'Bo', text: 'Five stars.' }] }, button('See more reviews', REVIEWS, { style: 'primary', col: 1 })])
  })

  it('stays on each item where only some carry it: each is that item’s own action', () => {
    const cards: AiLayoutBlock = { kind: 'cards', items: [review('Ann'), review('Bo'), { title: 'Cy', text: 'Five stars.', links: [{ text: 'Book a visit', to: 'page:p-book' }] }] }
    expect(aiSiteImportSectionActions({ blocks: [cards] }).blocks).toEqual([cards])
  })
})

describe('buttons side by side', () => {
  it('to one page are one: the first, or the one with the header’s words, in the first’s fill', () => {
    const pair = [button('Request a Quote', 'page:p-contact'), button('Contact Us', 'page:p-contact')]
    expect(kinds(aiSiteImportSectionActions({ blocks: [{ kind: 'heading', text: 'Start your pour' }, ...pair] }).blocks)).toEqual(['heading', 'button:Request a Quote:filled'])
    expect(aiSiteImportSectionActions({ blocks: pair }, 'Contact us').blocks).toEqual([button('Contact Us', 'page:p-contact')])
  })

  it('to two places keep both, the second outlined', () => {
    const { blocks } = aiSiteImportSectionActions({ blocks: [button('Request a quote', 'page:p-contact', { style: 'primary' }), button('Call us', 'tel:5550142200')] })
    expect(kinds(blocks)).toEqual(['button:Request a quote:primary', 'button:Call us:secondary'])
    // Apart, each keeps its fill.
    const apart = [button('Request a quote', 'page:p-contact'), { kind: 'text', text: 'Or write to us.' } as AiLayoutBlock, button('Call us', 'tel:5550142200')]
    expect(aiSiteImportSectionActions({ blocks: apart }).blocks).toEqual(apart)
  })
})

describe('buttons in a row of their own under a row of cards', () => {
  const cards = (...to: string[]): AiLayoutBlock => ({ kind: 'cards', items: to.map((page, at) => ({ title: `Service ${at + 1}`, text: 'What it is.', to: page })) })

  it('sit in the cards they go to, where each goes where one card does', () => {
    const { cols, blocks } = aiSiteImportSectionActions({
      cols: [1, 1],
      blocks: [{ kind: 'heading', text: 'Services' }, cards('page:p-slabs', 'page:p-lots', 'page:p-homes'), button('See slab work', 'page:p-slabs', { col: 0 }), button('See home work', 'page:p-homes', { col: 1 })],
    })
    expect(cols).toBeUndefined()
    expect(kinds(blocks)).toEqual(['heading', 'cards'])
    expect(blocks[1]?.items?.map((item) => item.links)).toEqual([[{ text: 'See slab work', to: 'page:p-slabs', style: 'secondary' }], undefined, [{ text: 'See home work', to: 'page:p-homes', style: 'secondary' }]])
  })

  it('stand together under the cards where a button goes where several cards do, never a grid half filled', () => {
    const { cols, blocks } = aiSiteImportSectionActions({
      cols: [1, 1],
      blocks: [{ kind: 'heading', text: 'Services' }, cards('page:p-work', 'page:p-work', 'page:p-homes'), button('See commercial work', 'page:p-work', { col: 0 }), button('See home work', 'page:p-homes', { col: 1 })],
    })
    expect(cols).toBeUndefined()
    expect(blocks.map((block) => block.col)).toEqual([undefined, undefined, undefined, undefined])
    expect(kinds(blocks)).toEqual(['heading', 'cards', 'button:See commercial work:filled', 'button:See home work:secondary'])
  })

  it('leaves a row whose columns hold more than buttons as it is', () => {
    const row = { cols: [1, 1], blocks: [cards('page:p-a', 'page:p-b'), { kind: 'text', text: 'Since 1998.', col: 0 } as AiLayoutBlock, button('See work', 'page:p-a', { col: 1 })] }
    expect(aiSiteImportSectionActions(row)).toEqual(row)
  })
})

/** An invented contractor's page that opens on a client's logo, with job photos further down. */
const BUILT_FOR = `<!doctype html><html><head><title>Driveways | Northfield Paving</title></head><body>
<header><a href="/">Northfield Paving</a><nav><a href="/driveways">Driveways</a><a href="/contact">Contact</a></nav></header>
<main>
<section><img src="https://www.northfield.example/media/Grocer+Logo.jpg" alt="" width="1800" height="1011"><h1>Driveways</h1><p>We have poured slabs for regional grocers and for homes across the county.</p></section>
<section><h2>Recent driveways</h2><img src="https://www.northfield.example/media/IMG_2210.jpg" alt="A broom-finished driveway" width="1600" height="1000"><p>A broom finish holds up to winter.</p><img src="https://www.northfield.example/media/IMG_2214.jpg" alt="A stamped patio" width="1000" height="1000"><p>Stamped patios in any color.</p></section>
</main><footer><p>Northfield Paving. Call 555-201-3344.</p></footer></body></html>`

function readOf(html: string, url: string): AiSiteImportDocument {
  const origin = new URL(url).origin
  const read = siteImportReplayDocumentOf(html, url, (address) => address.origin === origin)
  return { ...read, finish: 'improve', wording: 'improved', generative: true }
}

const section = (band: string, blocks: Array<Record<string, unknown>>, cols: number[] = []) => ({ band, cols, align: 'start', blocks: blocks.map((block) => ({ col: -1, text: '', to: '', style: 'none', icon: '', items: [], ref: '', ...block })) })

describe('a brand’s mark', () => {
  it('reads as one by its file name or its words, never by a photo’s', () => {
    expect(aiSiteImportIsBrandMark({ from: 'https://cdn.example/a1/Grocer+Logo.jpg?format=1500w' })).toBe(true)
    expect(aiSiteImportIsBrandMark({ url: 'https://cdn.example/a1/ClientLogo.png' })).toBe(true)
    expect(aiSiteImportIsBrandMark({ url: 'https://cdn.example/a1/IMG_2210.jpg', alt: 'The award badge we won' })).toBe(true)
    expect(aiSiteImportIsBrandMark({ url: 'https://cdn.example/a1/IMG_2210.jpg', alt: 'A broom-finished driveway' })).toBe(false)
    expect(aiSiteImportIsBrandMark({ url: 'https://cdn.example/a1/catalog-technology.jpg', alt: '' })).toBe(false)
  })

  it('is not the page’s opening picture its ledger asks to keep, and an opening that keeps it takes a photo instead', () => {
    const doc = readOf(BUILT_FOR, 'https://www.northfield.example/driveways')
    const ledger = aiSiteImportImproveLedger(doc)
    const pictures = ledger.items.filter((item) => item.kind === 'picture')
    expect(pictures.map((item) => item.must)).toEqual([false, false, false])
    const answer = aiReadImprovedPage({
      sections: [
        section('dark', [{ kind: 'keep', ref: 'picture:1' }, { kind: 'heading', text: 'Driveways that hold up' }, { kind: 'lede', text: 'We pour slabs for homes across the county.' }]),
        section('plain', [{ kind: 'heading', text: 'Recent driveways' }, { kind: 'keep', ref: 'picture:3' }, { kind: 'text', text: 'Stamped patios in any color.' }]),
      ],
    })
    if (!answer) throw new Error('no section')
    const page = aiSiteImportImprovedPage(answer, { doc, ledger, design: { kind: 'business', seed: 7, home: false } as never, destinations: aiSiteImportImproveDestinations(doc, ledger), formId: null })
    const opening = page.given.sections[0]?.blocks.find((block) => block.kind === 'image')
    expect(opening?.picture?.alt).toBe('A broom-finished driveway')
    // The mark is left for no one: the page's photos are placed, and the mark is what it left off.
    expect(page.pictures.unplaced).toEqual(['https://www.northfield.example/media/Grocer+Logo.jpg'])
  })

  it('is left out, and the row drawn as one column, where the page has no photo to take its place', () => {
    const doc = readOf(BUILT_FOR, 'https://www.northfield.example/driveways')
    const ledger = aiSiteImportImproveLedger(doc)
    const answer = aiReadImprovedPage({
      sections: [
        section('plain', [{ kind: 'heading', col: 0, text: 'Driveways that hold up' }, { kind: 'keep', ref: 'picture:1', col: 1 }], [7, 5]),
        section('plain', [{ kind: 'keep', ref: 'picture:2' }, { kind: 'keep', ref: 'picture:3' }]),
      ],
    })
    if (!answer) throw new Error('no section')
    const page = aiSiteImportImprovedPage(answer, { doc, ledger, design: { kind: 'business', seed: 7, home: false } as never, destinations: aiSiteImportImproveDestinations(doc, ledger), formId: null })
    const opening = page.given.sections[0]
    expect(opening?.cols).toBeUndefined()
    expect(opening?.blocks.map((block) => [block.kind, block.col])).toEqual([['heading', undefined]])
  })

  it('never fills a redesign’s slot', async () => {
    const slot = (imageId: string, role: AiLayoutPictureSlot['role']): AiLayoutPictureSlot => ({ imageId, frameId: null, iconId: null, alt: 'A new driveway', aspect: 16 / 9, sectionIndex: 0, role })
    const source = aiSiteImportPictureSource({
      photos: [
        { mediaId: 'm-logo', src: 'media:h/m-logo', width: 1800, height: 1011, from: 'https://www.northfield.example/media/Grocer+Logo.jpg' },
        { mediaId: 'm-drive', src: 'media:h/m-drive', width: 1600, height: 1000, from: 'https://www.northfield.example/media/IMG_2210.jpg' },
      ],
      next: null,
      nodes: {} as never,
      tally: aiSiteImportPictureTally(),
    })
    const found = await source?.([slot('hero', 'hero'), slot('band', 'gallery')])
    expect(found?.map((photo) => photo?.src ?? null)).toEqual(['media:h/m-drive', null])
  })
})
