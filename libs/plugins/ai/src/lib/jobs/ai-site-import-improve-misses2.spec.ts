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

import { aiSiteImportAltIsFileName } from '../model/ai-site-import-marks'
import { siteImportReplayBuild, siteImportReplayDocumentOf } from '../site-import/fixtures/site-import-fidelity-replay'
import type { AiSiteImportDocument } from './ai-site-import-document'
import { aiReadImprovedPage, aiSiteImportImproveDestinations, aiSiteImportImprovedPage, aiSiteImportImproveLedger } from './ai-site-import-improve'

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
