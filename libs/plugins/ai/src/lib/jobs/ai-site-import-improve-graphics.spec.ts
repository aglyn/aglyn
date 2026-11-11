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
 * A picture whose pixels make it a graphic is no photo (AGL-4152), offline,
 * on an invented builder's home page: it opens on a partner's wordmark a
 * phone named "IMG_4295.webp", with no alt, beside its "Serving …" words.
 * Its name says nothing, so its photo entry's `graphic`, read when the
 * import brought it in, keeps it out of the opening, the ledger's "must"
 * and every slot a photo fills, as a mark's name already did; the partner
 * row the source showed its marks in still shows them. Every answer is
 * written by hand in the tool's shape: no model is called.
 */

import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import type { AiSiteImportPhoto } from '../model/ai-site-import'
import { aiSiteImportImageIsMark, aiSiteImportIsBrandMark } from '../model/ai-site-import-marks'
import { siteImportReplayDocumentOf } from '../site-import/fixtures/site-import-fidelity-replay'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, aiSiteImportDocumentOf, type AiSiteImportDocument } from './ai-site-import-document'
import { aiReadImprovedPage, aiSiteImportImproveDestinations, aiSiteImportImprovedPage, aiSiteImportImproveLedger } from './ai-site-import-improve'
import { aiSiteImportPictureSource, aiSiteImportPictureTally } from './ai-site-import-pictures'

const ORIGIN = 'https://www.builders.example'
const MARK = `${ORIGIN}/uploads/IMG_4295.webp`
const KITCHEN = `${ORIGIN}/uploads/IMG_5101.jpg`
const PARTNERS = [`${ORIGIN}/uploads/IMG_7001.png`, `${ORIGIN}/uploads/IMG_7002.png`, `${ORIGIN}/uploads/IMG_7003.png`]

const HOME = `<!doctype html><html><head><title>Home | Example Builders</title></head><body>
<header><a href="/">Example Builders</a><nav><a href="/about">About</a><a href="/contact">Contact</a></nav></header>
<main>
<section><h1>Serving the valley since 1998</h1><p>Homes, additions and kitchens built to last.</p><img src="${MARK}" alt="" width="1200" height="900"></section>
<section><h2>Recent work</h2><img src="${KITCHEN}" alt="A finished kitchen" width="1600" height="1000"><p>A kitchen opened to the yard.</p></section>
<section><h2>Who we build with</h2><ul>${PARTNERS.map((url) => `<li><img src="${url}" alt="" width="300" height="120"></li>`).join('')}</ul></section>
</main><footer><p>Example Builders. Call 555-010-2000.</p></footer></body></html>`

/** The page as the import read it, its photos flagged as their pixels were read: `graphics` are graphics, the rest photos; `unread` have no flag. */
function homeOf(flags: { graphics?: readonly string[]; unread?: boolean } = {}): AiSiteImportDocument {
  const read = siteImportReplayDocumentOf(HOME, `${ORIGIN}/`, (address) => address.origin === ORIGIN)
  const graphics = new Set(flags.graphics ?? [MARK, ...PARTNERS])
  const photos = read.photos.map((photo): AiSiteImportPhoto => (flags.unread ? photo : { ...photo, graphic: graphics.has(photo.from ?? '') }))
  return { ...read, photos, finish: 'improve', wording: 'improved', generative: true }
}

const section = (band: string, blocks: Array<Record<string, unknown>>, cols: number[] = []) => ({ band, cols, align: 'start', blocks: blocks.map((block) => ({ col: -1, text: '', to: '', style: 'none', icon: '', items: [], ref: '', ...block })) })

function improved(doc: AiSiteImportDocument, sections: ReturnType<typeof section>[]) {
  const ledger = aiSiteImportImproveLedger(doc)
  const answer = aiReadImprovedPage({ sections })
  if (!answer) throw new Error('no section')
  return aiSiteImportImprovedPage(answer, { doc, ledger, design: { kind: 'business', seed: 7, home: true } as never, destinations: aiSiteImportImproveDestinations(doc, ledger), formId: null })
}

const srcOf = (doc: AiSiteImportDocument, from: string) => doc.photos.find((photo) => photo.from === from)?.src

describe('a picture its pixels make a graphic', () => {
  it('is a mark whatever its name, and a photo’s name and alt decide where its pixels were never read', () => {
    expect(aiSiteImportIsBrandMark({ from: MARK, graphic: true })).toBe(true)
    expect(aiSiteImportIsBrandMark({ from: MARK, graphic: false })).toBe(false)
    expect(aiSiteImportIsBrandMark({ from: MARK })).toBe(false)
    // Its pixels read as a photo do not unsay a name that calls it a logo.
    expect(aiSiteImportIsBrandMark({ from: `${ORIGIN}/uploads/partner-logo.jpg`, graphic: false })).toBe(true)
    const photos = homeOf().photos
    expect(aiSiteImportImageIsMark({ url: MARK, alt: '' }, photos)).toBe(true)
    expect(aiSiteImportImageIsMark({ url: KITCHEN, alt: 'A finished kitchen' }, photos)).toBe(false)
    expect(aiSiteImportImageIsMark({ url: MARK, alt: '' }, new Map(photos.map((photo) => [photo.from ?? '', photo])))).toBe(true)
    expect(aiSiteImportImageIsMark({ url: MARK, alt: '' }, null)).toBe(false)
  })

  it('rides the page’s document through its job’s inputs', () => {
    const doc = homeOf()
    const through = (value: AiSiteImportDocument) => aiSiteImportDocumentOf({ [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: JSON.parse(JSON.stringify(value)) })
    expect(through(doc)?.photos.map((photo) => photo.graphic)).toEqual([true, false, true, true, true])
    expect(through(homeOf({ unread: true }))?.photos.some((photo) => 'graphic' in photo)).toBe(false)
  })

  it('is not the opening picture the ledger asks to keep; unread, the old rule stands', () => {
    const must = (doc: AiSiteImportDocument) => aiSiteImportImproveLedger(doc).items.filter((item) => item.kind === 'picture').map((item) => item.must)
    expect(must(homeOf())).toEqual([false, false])
    expect(must(homeOf({ unread: true }))).toEqual([true, false])
  })

  it('kept beside the opening’s words, gives way to the page’s own photo', () => {
    const doc = homeOf()
    const page = improved(doc, [
      section('plain', [{ kind: 'heading', col: 0, text: 'Serving the valley since 1998' }, { kind: 'lede', col: 0, text: 'Homes, additions and kitchens built to last.' }, { kind: 'keep', ref: 'picture:1', col: 1 }], [7, 5]),
      section('plain', [{ kind: 'heading', text: 'Who we build with' }, { kind: 'keep', ref: 'logos:1' }]),
    ])
    const opening = page.given.sections[0]?.blocks.find((block) => block.kind === 'image')
    expect(opening?.picture?.src).toBe(srcOf(doc, KITCHEN))
    expect(page.pictures.unplaced).toEqual([MARK])
  })

  it('is never the photo an opening asks for', () => {
    const doc = homeOf({ graphics: [MARK, ...PARTNERS] })
    const page = improved(doc, [section('dark', [{ kind: 'image', text: 'A builder at work' }, { kind: 'heading', text: 'Serving the valley since 1998' }])])
    const opening = page.given.sections[0]?.blocks.find((block) => block.kind === 'image')
    expect(opening?.picture?.src).toBe(srcOf(doc, KITCHEN))
    // With no photo left, the opening's slot stays the library's to fill.
    const bare = improved(homeOf({ graphics: [MARK, KITCHEN, ...PARTNERS] }), [section('dark', [{ kind: 'image', text: 'A builder at work' }, { kind: 'heading', text: 'Serving the valley since 1998' }])])
    expect(bare.given.sections[0]?.blocks.find((block) => block.kind === 'image')?.picture).toBeUndefined()
  })

  it('still shows in the partner row the source showed it in', () => {
    const doc = homeOf()
    const page = improved(doc, [
      section('plain', [{ kind: 'heading', text: 'Serving the valley since 1998' }, { kind: 'keep', ref: 'picture:2' }]),
      section('soft', [{ kind: 'heading', text: 'Who we build with' }, { kind: 'keep', ref: 'logos:1' }]),
    ])
    const shown = JSON.stringify(page.given.sections[1])
    for (const url of PARTNERS) expect(shown).toContain(String(srcOf(doc, url)))
  })

  it('never fills a slot a photo fills', async () => {
    const doc = homeOf()
    const slot = (imageId: string, role: AiLayoutPictureSlot['role']): AiLayoutPictureSlot => ({ imageId, frameId: null, iconId: null, alt: 'A new kitchen', aspect: 16 / 9, sectionIndex: 0, role })
    const source = aiSiteImportPictureSource({ photos: doc.photos, next: null, nodes: {} as never, tally: aiSiteImportPictureTally() })
    const found = await source?.([slot('hero', 'hero'), slot('band', 'gallery'), slot('side', 'about')])
    expect(found?.map((photo) => photo?.src ?? null)).toEqual([srcOf(doc, KITCHEN), null, null])
  })
})
