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
 * A generative Improve it's misses from its second 11/7 rerun (AGL-4152),
 * offline, on invented sites: a gallery page's opening shows the page's own
 * photo, beside the words where it is no landscape, and its stock is searched
 * only where the site names its world; the facts ledger takes no ordinary
 * capitalized word for a name, and holds a name in any of its forms; a page
 * whose redesign fell back keeps its layout with each call to action once;
 * and a picture described only by its file name is described by its page.
 * Every answer here is written by hand in the tool's shape: no model is called.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { siteImportFactScope, siteImportFidelity, siteImportNameKey, type SiteImportFidelityTree } from '../model/ai-site-import-fidelity'
import { aiSiteImportAltIsFileName } from '../model/ai-site-import-marks'
import { siteImportReplayBuild, siteImportReplayDocumentOf } from '../site-import/fixtures/site-import-fidelity-replay'
import { aiImportedPageCheck } from './ai-job-page-language'
import { aiLayoutStockPhotoSource, aiStockSourceNamesWorld } from './ai-layout-stock-photos'
import type { AiSiteImportDocument } from './ai-site-import-document'
import { aiReadImprovedPage, aiSiteImportImproveDestinations, aiSiteImportImprovedPage, aiSiteImportImproveHero, aiSiteImportImproveLedger } from './ai-site-import-improve'

type Node = { componentId: string; props?: Record<string, unknown>; nodes?: string[]; parentId?: string | null }

const ORIGIN = 'https://www.larkspur-paving.example'
const sameSite = (url: URL) => url.origin === ORIGIN
const RULES = '.gallery { display: grid; gap: 20px; }'
const NAMES = ['IMG_2459.jpeg', 'IMG_7729.JPG', 'Screenshot 2026-09-27 at 10.37.16 AM.png', 'IMG_7001.jpg', 'IMG_6999.jpg', 'IMG_7002.jpg']
const photo = (name: string) => `<figure><img src="${ORIGIN}/media/${encodeURIComponent(name)}" alt="${name}" width="1200" height="900" sizes="(max-width:768px) 46vw, 28vw" style="object-fit: cover; width: 100%; height: 100%"></figure>`

/** An invented paving firm's gallery page: a heading, a line, and six photos its builder named by their files. */
const GALLERY = `<!doctype html><html><head><title>Residential Gallery</title><style>${RULES}</style></head><body>
<header><a href="/">Larkspur Paving</a><nav><a href="/gallery">Gallery</a><a href="/contact">Contact</a></nav></header>
<main>
<section><h1>Residential Gallery</h1><p>A few of the driveways and patios we have poured.</p></section>
<section><h2>Recent work</h2><div class="gallery">${NAMES.map(photo).join('')}</div></section>
</main><footer><p>Larkspur Paving. Call 555-201-3344.</p></footer></body></html>`

function readOf(html: string, path: string, size?: { width: number; height: number }): AiSiteImportDocument {
  const read = siteImportReplayDocumentOf(html, `${ORIGIN}${path}`, sameSite)
  return { ...read, ...(size ? { photos: read.photos.map((entry) => ({ ...entry, ...size })) } : {}), finish: 'improve', wording: 'improved', generative: true }
}

const section = (band: string, blocks: Array<Record<string, unknown>>, cols: number[] = []) => ({ band, cols, align: 'start', blocks: blocks.map((block) => ({ col: -1, text: '', to: '', style: 'none', icon: '', items: [], ref: '', ...block })) })

/** A gallery page redesigned: an opening that asks for a picture, the gallery kept, a closing call. */
const GALLERY_ANSWER = {
  sections: [
    section('dark', [{ kind: 'image', text: 'A finished stamped patio' }, { kind: 'heading', text: 'Residential gallery' }, { kind: 'lede', text: 'A few of the driveways and patios we have poured.' }]),
    section('plain', [{ kind: 'heading', text: 'Recent work' }, { kind: 'keep', ref: 'gallery:1' }]),
  ],
}

function redesigned(doc: AiSiteImportDocument, answer: unknown) {
  const ledger = aiSiteImportImproveLedger(doc)
  const read = aiReadImprovedPage(answer)
  if (!read) throw new Error('no section')
  const design = { kind: 'business', seed: 7, home: false } as never
  const page = aiSiteImportImprovedPage(read, { doc, ledger, design, destinations: aiSiteImportImproveDestinations(doc, ledger), formId: null })
  return { ledger, page }
}

const imagesIn = (blocks: ReadonlyArray<{ kind: string; picture?: { src: string }; items?: ReadonlyArray<{ picture?: { src: string } }> }>) =>
  blocks.flatMap((block) => [...(block.picture?.src ? [block.picture.src] : []), ...(block.items ?? []).flatMap((item) => (item.picture?.src ? [item.picture.src] : []))])

describe('a redesigned page’s opening picture', () => {
  it('is the page’s own photo, taken from the gallery it keeps, never a slot the stock library fills', () => {
    const doc = readOf(GALLERY, '/gallery')
    const { ledger, page } = redesigned(doc, GALLERY_ANSWER)
    expect(ledger.items.filter((item) => item.kind === 'gallery')).toHaveLength(1)
    const opening = page.given.sections[0]
    const picture = opening?.blocks.find((block) => block.kind === 'image')?.picture
    expect(picture?.src).toMatch(/^media:host-import\//)
    expect(page.pictures.slots).toBe(0)
    expect(page.pictures.source).toBe(1)
    // Shown once: the gallery shows the rest.
    const all = page.given.sections.flatMap((entry) => imagesIn(entry.blocks as never))
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(NAMES.length)
  })

  it('takes a photo no section places before one the gallery shows', () => {
    const html = GALLERY.replace('<section><h2>Recent work</h2>', `<section><img src="${ORIGIN}/media/crew-pour.jpg" alt="Our crew pouring a driveway" width="1600" height="900"><p>Every pour is finished by hand.</p></section><section><h2>Recent work</h2>`)
    const doc = readOf(html, '/gallery')
    const { page } = redesigned(doc, GALLERY_ANSWER)
    const picture = page.given.sections[0]?.blocks.find((block) => block.kind === 'image')?.picture
    expect(picture?.alt).toBe('Our crew pouring a driveway')
    expect(page.pictures.unplaced).toEqual([])
  })

  it('is left to the slot where the page has no photo at all', () => {
    const doc = readOf(GALLERY.replace(/<section><h2>Recent work<\/h2>[\s\S]*?<\/section>/, ''), '/gallery')
    const { page } = redesigned(doc, { sections: [GALLERY_ANSWER.sections[0]] })
    expect(page.given.sections[0]?.blocks.find((block) => block.kind === 'image')?.picture).toBeUndefined()
    expect(page.pictures.slots).toBe(1)
  })

  it('sits beside the words, not behind them, where it is a square or a portrait', () => {
    const plan = { design: { hero: 'cover', group: 'cards', rhythm: 'alternate', cta: 'band' } } as never
    const design = { kind: 'business', seed: 7, home: false } as never
    expect(aiSiteImportImproveHero(design, plan, { ratio: 0.75 })).toBe('split')
    expect(aiSiteImportImproveHero(design, plan, { ratio: 1 })).toBe('split')
    expect(aiSiteImportImproveHero(design, plan, { ratio: 1.78 })).toBe('cover')
    // A slot's shape is not known until it is filled: the plan's own hero.
    expect(aiSiteImportImproveHero(design, plan, null)).toBe('cover')
    const doc = readOf(GALLERY, '/gallery', { width: 900, height: 1200 })
    const { page } = redesigned(doc, GALLERY_ANSWER)
    expect(page.given.sections[0]?.hero).not.toBe('cover')
    expect(page.given.sections[0]?.hero).not.toBe('poster')
    expect(page.given.sections[0]?.hero).not.toBe('panel')
  })
})

describe('a redesign’s stock photos', () => {
  const provider = { search: jest.fn(async () => []) }
  const ingest = { ingest: jest.fn(), findStockPhoto: jest.fn(async () => null) }
  const deps = { provider: () => provider as never, ingest: () => ingest as never }
  const input = { hostId: 'host-1', uid: 'u1', seed: 'job:page', sectionNames: ['Opening'] }

  it('are searched only where the site names its world', () => {
    expect(aiStockSourceNamesWorld({ business: '' })).toBe(false)
    expect(aiStockSourceNamesWorld({ business: 'A concrete contractor pouring driveways and patios' })).toBe(true)
    expect(aiLayoutStockPhotoSource({ ...input, business: '', worldOnly: true }, deps)).toBeNull()
    expect(aiLayoutStockPhotoSource({ ...input, business: 'A concrete contractor pouring driveways and patios', worldOnly: true }, deps)).not.toBeNull()
    // A page that is no redesign searches as it always has.
    expect(aiLayoutStockPhotoSource({ ...input, business: '' }, deps)).not.toBeNull()
  })
})

/** An invented contractor's home: an ordinary word capitalized after "We", and a store's name with its possessive. */
const HOME = `<!doctype html><html><head><title>Larkspur Paving</title></head><body>
<header><a href="/">Larkspur Paving</a><nav><a href="/contact">Contact</a></nav></header>
<main>
<section><h1>Concrete for homes and shops</h1><p>We Specialize in driveways, patios and shop floors across Harlow County.</p><p>We Document every pour on our page, start to finish.</p><p>Our crew poured the lot behind the OBR’s market on Elm Road.</p></section>
</main><footer><p>Larkspur Paving.</p></footer></body></html>`

describe('the facts a redesign must keep', () => {
  it('takes no ordinary word for a name: one after its sentence’s subject, or one the site also writes small', () => {
    const scope = siteImportFactScope(['We Specialize in driveways.', 'We Document every pour.', 'Every pour starts with a Plan.', 'We draw a plan first.', 'We met Rosa at the Elm Road site.'])
    expect([...scope.names].sort()).toEqual(['Elm', 'Road', 'Rosa'])
  })

  it('holds a name in any of its forms: its possessive, its initials with stops or hyphens', () => {
    expect(['OBR’s', 'OBR', "OBR's", 'O-B-R', 'O.B.R.'].map(siteImportNameKey)).toEqual(['obr', 'obr', 'obr', 'obr', 'obr'])
  })

  it('misses none of them on a page that rewrites them in its own words', () => {
    const doc = readOf(HOME, '/')
    const ledger = aiSiteImportImproveLedger(doc)
    const answer = {
      sections: [
        section('dark', [
          { kind: 'heading', text: 'Concrete for homes and shops' },
          { kind: 'lede', text: 'We pour driveways, patios and shop floors across Harlow County.' },
          { kind: 'text', text: 'Every pour is on our page, start to finish.' },
          { kind: 'text', text: 'Our crew poured the lot behind the O-B-R market on Elm Road.' },
        ]),
      ],
    }
    const read = aiReadImprovedPage(answer)
    if (!read) throw new Error('no section')
    const design = { kind: 'business', seed: 7, home: true } as never
    const page = aiSiteImportImprovedPage(read, { doc, ledger, design, destinations: aiSiteImportImproveDestinations(doc, ledger), formId: null })
    const built = aiImportedPageCheck({
      screen: { title: doc.title, slug: '/', sections: page.names.map((name) => ({ name, uses: [], items: 0 })) } as never,
      sectionIds: page.names.map((_, index) => `sec-${index}`),
      targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: doc.links.map((link) => link.id), formIds: [], componentIds: [], codeBuilt: true },
      design,
      doc,
      given: page.given,
      rewritten: page.written,
    })(null)
    expect(built.violations).toEqual([])
    const tree: SiteImportFidelityTree = { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: built.value?.nodes as unknown as SiteImportFidelityTree['nodes'] }
    const source = { layout: doc.layout as NonNullable<AiSiteImportDocument['layout']>, blocks: doc.blocks, photos: doc.photos }
    const report = siteImportFidelity(source, tree, { finish: 'improve', words: 'improved', improved: { scope: [], destinations: [], forms: 0 } })
    expect(report.improved?.ledger.facts.missing).toEqual([])
  })
})

/** An invented contractor's home whose three reviews each carry the same link. */
const REVIEWED = `<!doctype html><html><head><title>Larkspur Paving</title></head><body>
<header><a href="/">Larkspur Paving</a><nav><a href="/contact">Contact</a></nav></header>
<main>
<section><h1>Concrete for homes and shops</h1><p>Driveways, patios and shop floors.</p></section>
<section><h2>Why us?</h2><p>Here are some of our clients’ reviews.</p>
<div><blockquote>“On time and on budget. The patio is perfect.”</blockquote><a href="https://reviews.example/larkspur">See More Reviews</a></div>
<div><blockquote>“They poured our driveway in a day and cleaned up after.”</blockquote><a href="https://reviews.example/larkspur">See More Reviews</a></div>
<div><blockquote>“Honest prices and a crew that listens.”</blockquote><a href="https://reviews.example/larkspur">See More Reviews</a></div>
</section>
</main><footer><p>Larkspur Paving.</p></footer></body></html>`

describe('a page whose redesign fell back, under Improve it', () => {
  const buttonsOf = (nodes: Record<string, Node>, text: string) => Object.values(nodes).filter((node) => node.componentId === 'muiButton' && node.props?.['children'] === text)

  it('keeps its layout with each call to action once', () => {
    const read = siteImportReplayDocumentOf(REVIEWED, `${ORIGIN}/`, sameSite)
    const kept = siteImportReplayBuild(read, '/', true, { finish: 'keep', words: 'kept' })
    const improved = siteImportReplayBuild(read, '/', true, { finish: 'improve', words: 'kept' })
    expect(kept.violations).toEqual([])
    expect(improved.violations).toEqual([])
    // Kept as it is, the source's own three; improved, one.
    expect(buttonsOf(kept.tree.nodes as unknown as Record<string, Node>, 'See More Reviews')).toHaveLength(3)
    expect(buttonsOf(improved.tree.nodes as unknown as Record<string, Node>, 'See More Reviews')).toHaveLength(1)
  })
})

describe('a picture described only by its file name', () => {
  it('reads as no description', () => {
    expect(NAMES.map(aiSiteImportAltIsFileName)).toEqual(NAMES.map(() => true))
    expect(['C274D972-1C41-4543-9C4F-36AF0AFDAD5F.JPG', 'temp_image_for_default_share.png', 'DSC01234', 'PXL_20260927_101500'].map(aiSiteImportAltIsFileName)).toEqual([true, true, true, true])
    expect(['A broom-finished driveway', 'Our crew at the 2024 job', 'Photo of the patio', ''].map(aiSiteImportAltIsFileName)).toEqual([false, false, false, false])
  })

  it('is described by its page and its place on it, whether the page is kept or redesigned', () => {
    const read = siteImportReplayDocumentOf(GALLERY, `${ORIGIN}/gallery`, sameSite)
    const kept = siteImportReplayBuild(read, '/gallery', false, { finish: 'keep', words: 'kept' })
    const alts = Object.values(kept.tree.nodes as unknown as Record<string, Node>).flatMap((node) => (node.componentId === 'image' ? [node.props?.['alt']] : []))
    expect(alts).toEqual(NAMES.map((_, at) => `Residential Gallery photo ${at + 1}`))
    const { page } = redesigned(readOf(GALLERY, '/gallery'), GALLERY_ANSWER)
    const given = page.given.sections.flatMap((entry) => entry.blocks.flatMap((block) => [...(block.picture ? [block.picture.alt] : []), ...(block.items ?? []).flatMap((item) => (item.picture ? [item.picture.alt] : []))]))
    expect(given.some((alt) => aiSiteImportAltIsFileName(alt))).toBe(false)
  })
})
