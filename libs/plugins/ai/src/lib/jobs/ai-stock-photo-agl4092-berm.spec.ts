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

import type { PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { StockPhoto, StockPhotoProvider } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiLayoutStockPhotoSource,
  aiStockCraftSearches,
  aiStockForgetJobPhotos,
  aiStockFreshShootsFirst,
  aiStockJudgementFor,
  aiStockProductSearches,
  aiStockRelevance,
  aiStockSameShoot,
  aiStockSearchesFor,
  aiStockSlotPart,
  aiStockSourceTerms,
  aiStockSubjectWords,
  type AiStockSearch,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import { aiAgl4065Judgement } from './fixtures/ai-stock-photo-agl4065-judge'
import { AGL4092_ANSWERS, AGL4092_HITS, AGL4092_PEOPLE_ANSWERS } from './fixtures/ai-stock-photo-agl4092-recordings'

/*
 * Berm & Bolt Moto Parts of the 2026-10-28 live check (AGL-4092), a dirt bike
 * and ATV parts shop, replayed from what Pixabay answers its searches
 * (fixtures/ai-stock-photo-agl4092-recordings.ts):
 *
 * - its "Engine and air" collection tile showed a bare foot, tagged "body
 *   part": the shop's craft was read as "part", and a tile's broad searches
 *   took any hit naming it;
 * - "Brake Pad Set" found nothing by its pad, then searched "part" alone and
 *   took a transmission chain tagged "mechanical part";
 * - "ATV Front Tire" and "Rear Dirt Bike Tire" took two photos of one
 *   contributor's shoot, 32 uploads apart, one tagged "tire" fourth.
 *
 * Through core's seams only: a fake provider answering each search by its
 * words with what Pixabay answered on 2026-10-28, and a fake library. No
 * network, no model.
 */

const BERM_AND_BOLT = {
  business: 'Dirt bike and ATV parts shop: OEM and aftermarket parts, tires, riding gear, special orders; in-store pickup',
  audience: 'Weekend riders, motocross racers and ranch ATV owners around Kyle who need parts fast and real advice',
  kind: 'store',
  name: 'Berm & Bolt Moto Parts',
  language: 'en',
}

const BARE_FOOT = '7280258'
const TRANSMISSION_CHAIN = '7187205'
const RAILWAY_BRAKE = '4761975'
const ATV_TIRE_SHOOT = '7283987'
const REAR_TIRE_SHOOT = '7284019'

/** A hit's first tags name the motocross world: what a moto shop's photo is OF. */
const MOTO_LEAD = /\b(?:motocross|motorcycles?|motorbikes?|dirt ?bikes?|enduro|supercross|atv|quad bike)\b/

const byId = (id: string) => AGL4092_HITS.get(id) as StockPhoto
const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: [...((request.people ? AGL4092_PEOPLE_ANSWERS : AGL4092_ANSWERS)[request.query] ?? [])], cached: true }
    },
    download: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' }),
    credit: (found) => ({
      providerLabel: 'Pixabay',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false,
      text: `Photo by ${found.photographer} on Pixabay.`,
    }),
  }
  const library = new Map<string, string>()
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      const id = String(request.stockPhoto?.id)
      const src = `media:site/${id}`
      library.set(String(request.stockPhoto?.key), src)
      return { ok: true, mediaId: id, src, width: 1280, height: 853 }
    },
    findStockPhoto: async ({ sourceKey }) => {
      const src = library.get(sourceKey)
      return src ? { mediaId: src.split('/').pop() as string, src, width: 1280, height: 853 } : null
    },
  }
  return { provider, ingest, asked }
}

const tile = (alt: string): AiLayoutPictureSlot => ({ imageId: `img-${alt}`, frameId: 'frame', iconId: null, alt, aspect: 4 / 3, sectionIndex: 1, role: 'gallery' })

/** A product card as the site step draws it (`aiSiteProductPhotos`). */
const product = (name: string, index = 0): AiLayoutPictureSlot => ({
  imageId: `product${index}`,
  frameId: null,
  iconId: null,
  alt: name,
  aspect: 4 / 5,
  sectionIndex: 0,
  role: 'gallery',
  product: { subjects: [name] },
})

/** Every search a slot tries before any wider world, as the source builds it. */
function searchesOf(terms: AiStockSiteTerms, slot: AiLayoutPictureSlot, sectionName: string) {
  const subject = aiStockSubjectWords(slot.alt, sectionName)
  const own = slot.product
    ? aiStockProductSearches(slot, terms.craft, terms.domain, {
        broad: terms.broad,
        core: terms.core,
        ...(terms.held ? { held: terms.held } : {}),
        ...(terms.leadWord ? { leadWord: terms.leadWord } : {}),
      })
    : aiStockSearchesFor(slot, terms, subject, aiStockSlotPart(slot, sectionName), sectionName)
  return [...own, ...aiStockCraftSearches(slot, terms)].map((search) => ({
    search,
    judgement: aiStockJudgementFor(slot, search, subject, terms, sectionName),
  }))
}

beforeEach(() => aiStockForgetJobPhotos())

describe('Berm & Bolt Moto Parts (AGL-4092, 2026-10-28)', () => {
  const terms = aiStockSourceTerms(BERM_AND_BOLT)
  const takes = (id: string, slot: AiLayoutPictureSlot, sectionName: string) =>
    searchesOf(terms, slot, sectionName).some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)
  const source = (deps: ReturnType<typeof fakes>, sectionNames: string[], seed: string) =>
    aiLayoutStockPhotoSource(
      { hostId: 'berm-and-bolt', uid: 'member-1', seed, ...BERM_AND_BOLT, sectionNames, jobId: 'g03QCuPqPq' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )

  it('holds the shop’s things to the world it serves, never to its craft "part"', () => {
    expect(terms.craft).toBe('part')
    expect(terms.held).toEqual(expect.arrayContaining(['dirt bike', 'motocross', 'atv']))
    expect(terms.held).not.toContain('part')
    // Its own world is off-road: "motorcycle" alone names a street bike as often.
    expect(terms.lead).toEqual(expect.arrayContaining(['dirt bike', 'motocross', 'atv']))
    expect(terms.lead).not.toContain('motorcycle')
  })

  it('never tiles "Engine and air" with a bare foot tagged "body part", and asks for a dirt bike engine', async () => {
    const deps = fakes()
    const [photo] = (await source(deps, ['Hero: the right part, in stock, before the weekend', 'Shop by collection'], 'g03QCuPqPq:home')?.([tile('Engine and air')])) ?? []
    expect(deps.asked[0]).toBe('dirt bike engine')
    expect(idOf(photo?.src)).not.toBe(BARE_FOOT)
    const placed = byId(idOf(photo?.src))
    expect(placed).toBeDefined()
    // An engine of the shop's world, named among its first tags.
    expect(placed.tags.slice(0, 5).join(', ')).toMatch(/\bengine\b/)
    expect(placed.tags.slice(0, 3).join(', ')).toMatch(MOTO_LEAD)
    // Under none of the tile's searches, the broad ones last.
    expect(takes(BARE_FOOT, tile('Engine and air'), 'Shop by collection')).toBe(false)
  })

  it('never searches "Brake Pad Set" by a bare "part", never shows a transmission chain or a railway brake for it', async () => {
    const queries = aiStockProductSearches(product('Brake Pad Set'), terms.craft, terms.domain, {
      broad: terms.broad,
      core: terms.core,
      ...(terms.held ? { held: terms.held } : {}),
      ...(terms.leadWord ? { leadWord: terms.leadWord } : {}),
    }).map((search) => search.query)
    expect(queries).not.toContain('part')
    expect(queries.slice(0, 3)).toEqual(['brake pad set', 'motorcycle brake disc', 'dirt bike brake'])
    for (const id of [TRANSMISSION_CHAIN, RAILWAY_BRAKE]) expect([id, takes(id, product('Brake Pad Set'), 'Products')]).toEqual([id, false])
    const deps = fakes()
    const [photo] = (await source(deps, ['Products'], 'g03QCuPqPq:products')?.([product('Brake Pad Set')])) ?? []
    expect(deps.asked).not.toContain('part')
    expect(deps.asked).toContain('motorcycle brake disc')
    expect([TRANSMISSION_CHAIN, RAILWAY_BRAKE]).not.toContain(idOf(photo?.src))
    if (photo?.src) expect(byId(idOf(photo.src)).tags.join(', ')).toMatch(MOTO_LEAD)
  })

  it('never shows one shoot under both tires', async () => {
    // The catalog's five products, in its order (the site step's one call).
    const names = ['Air Filter', 'Chain and Sprocket Kit', 'Brake Pad Set', 'Rear Dirt Bike Tire', 'ATV Front Tire']
    const deps = fakes()
    const photos = (await source(deps, ['Products'], 'g03QCuPqPq:products')?.(names.map(product))) ?? []
    const rear = byId(idOf(photos[3]?.src))
    const front = byId(idOf(photos[4]?.src))
    expect(rear).toBeDefined()
    expect(front).toBeDefined()
    expect(aiStockSameShoot(rear, front)).toBe(false)
    for (const tire of [rear, front]) expect(tire.tags.slice(0, 3).join(', ')).toMatch(/\b(?:tires?|wheels?)\b/)
    // No product shows the transmission chain for a brake, nor a bare foot.
    expect(idOf(photos[2]?.src)).not.toBe(TRANSMISSION_CHAIN)
    expect(photos.map((photo) => idOf(photo?.src))).not.toContain(BARE_FOOT)
  })

  it('ranks a tire tagged "tire" second over one tagged it fourth, and a product’s fresh shoot over the one another shows', () => {
    const atv = product('ATV Front Tire', 4)
    const [own] = aiStockProductSearches(atv, terms.craft, terms.domain, { broad: terms.broad, core: terms.core })
    expect(own?.query).toBe('atv front tire')
    const judgement = aiAgl4065Judgement(terms, atv, own as AiStockSearch, 'atv front tire')
    const second = aiStockRelevance(byId(REAR_TIRE_SHOOT), judgement)
    const fourth = aiStockRelevance(byId(ATV_TIRE_SHOOT), judgement)
    expect(fourth).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(fourth)
    // One contributor's shoot, 32 uploads apart: a product whose best is of
    // the shoot another product shows takes a fresh one it also accepts.
    expect(aiStockSameShoot(byId(REAR_TIRE_SHOOT), byId(ATV_TIRE_SHOOT))).toBe(true)
    const fresh = byId('3572874')
    expect(aiStockRelevance(fresh, judgement)).toBeGreaterThan(0)
    const ranked = [byId(ATV_TIRE_SHOOT), fresh].sort((a, b) => aiStockRelevance(b, judgement) - aiStockRelevance(a, judgement))
    expect(aiStockFreshShootsFirst(ranked, [byId(REAR_TIRE_SHOOT)], judgement, { whole: true })[0]?.id).toBe(fresh.id)
  })
})
