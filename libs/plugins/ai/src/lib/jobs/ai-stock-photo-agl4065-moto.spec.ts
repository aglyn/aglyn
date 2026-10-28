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
  aiStockForgetJobPhotos,
  aiStockProductSearches,
  aiStockRelevance,
  aiStockSourceTerms,
  type AiStockJudgement,
  type AiStockSiteTerms,
} from './ai-layout-stock-photos'
import {
  AGL4065_HITS,
  ATV_PARTS_ORDER,
  ATV_TIRE,
  BIKE_IT,
  BIKE_IT_WILL_FIT,
  BIKE_PARTS_ORDER,
  BIKE_TELL_US_MACHINE,
  BIKE_VISIT_SHOP,
  BIKE_WE_SOURCE_IT,
  DESCRIBE_PART,
  DIRT_BIKE,
  DIRT_BIKE_TIRE,
  GEAR,
  MOTOCROSS_RACE_TEAM,
  MOTORCYCLE,
  PART,
  PARTS,
  RIDING_GEAR,
  TEAM,
  TEAM_READY_RIDE,
  TIRES,
  UPCOMING_RACE,
} from './fixtures/ai-stock-photo-agl4065-recordings'
import { aiAgl4065Searches } from './fixtures/ai-stock-photo-agl4065-judge'

/*
 * The three motocross sites of the 2026-10-25 booth kit (AGL-4065), replayed
 * from the photos Pixabay gave them (fixtures/ai-stock-photo-agl4065-recordings.ts):
 *
 * - Rut Runners Racing opened all four pages on a pit lane of race cars with
 *   their makers' logos (4462875), covered two race cards with cyclists and
 *   horses, and its closing band with a horse ride;
 * - Holeshot Moto Repair opened on a street cruiser (7749462) and showed a
 *   Honda scooter and a moped;
 * - Berm & Bolt Moto Parts tiled "Parts for the ranch" with a canoe, put a car
 *   tire under "ATV Tire", a gear wheel under "Riding Gear Item", trees under
 *   "OEM ATV Parts Order" and a cyclist under "Not sure it will fit?".
 *
 * Through core's seams only: a fake provider answering each search by its
 * words with what those words placed on 2026-10-25 (a search the starts never
 * sent answers nothing) and a fake library. No network, no model.
 */

const RUT_RUNNERS = {
  business: 'Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries',
  audience: 'Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join',
  kind: 'fitness',
  name: 'Rut Runners Racing',
  language: 'en',
}
const HOLESHOT = {
  business: 'Motorcycle and dirt bike repair shop: engine rebuilds, suspension, tires, race prep, service; books repair appointments',
  audience: 'Dirt bike and street riders, motocross racers and youth-racer parents around San Marcos who want fast, honest repairs',
  kind: 'trades',
  name: 'Holeshot Moto Repair',
  language: 'en',
}
const BERM_AND_BOLT = {
  business: 'Dirt bike and ATV parts shop: OEM and aftermarket parts, tires, riding gear, special orders; in-store pickup',
  audience: 'Weekend riders, motocross racers and ranch ATV owners around Kyle who need parts fast and real advice',
  kind: 'store',
  name: 'Berm & Bolt Moto Parts',
  language: 'en',
}

const PORSCHES = '4462875'
const CYCLISTS = '1851269'
const HORSES = '394205'
const HORSE_RIDE = '7594065'
const INDIAN_CRUISER = '7749462'
const HONDA_SCOOTER = '7425471'
const MOPED = '7356527'
const CANOE = '4612334'
const CAR_TIRE = '3267701'
const GEAR_WHEEL = '408364'
const TREES = '4450390'
const DELIVERY_MAN = '4756327'
const CYCLIST_HELMET = '7576306'
const CYCLISTS_RACING = '4367285'
const SCOOTER_STORE = '7006089'
const BICYCLE_GEARS = '2291916'
const AUTO_PARTS = '4753080'

/** What each search placed on 2026-10-25, by its words. */
const RECORDED: Record<string, StockPhoto[]> = {
  'motocross race team': MOTOCROSS_RACE_TEAM,
  team: TEAM,
  'team ready ride': TEAM_READY_RIDE,
  'upcoming race': UPCOMING_RACE,
  motorcycle: MOTORCYCLE,
  'dirt bike': DIRT_BIKE,
  parts: PARTS,
  part: PART,
  'describe part': DESCRIBE_PART,
  'atv tire': ATV_TIRE,
  'riding gear': RIDING_GEAR,
  'bike parts order': BIKE_PARTS_ORDER,
  'atv parts order': ATV_PARTS_ORDER,
  'bike it': BIKE_IT,
  'bike it will fit': BIKE_IT_WILL_FIT,
  'bike tell us machine': BIKE_TELL_US_MACHINE,
  'bike visit shop': BIKE_VISIT_SHOP,
  'bike we source it': BIKE_WE_SOURCE_IT,
  tires: TIRES,
  'dirt bike tire': DIRT_BIKE_TIRE,
  gear: GEAR,
}

function fakes() {
  const asked: string[] = []
  const provider: StockPhotoProvider = {
    id: 'pixabay',
    label: 'Pixabay',
    isConfigured: () => true,
    search: async (request) => {
      asked.push(request.query)
      return { photos: request.people ? [] : (RECORDED[request.query] ?? []), cached: true }
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

const idOf = (src: string | undefined) => src?.split('/').pop() ?? ''
const byId = (id: string) => AGL4065_HITS.get(id) as StockPhoto

/** How the source judges a slot's search, from the site's terms. */
const judged = (terms: AiStockSiteTerms, extra: AiStockJudgement): AiStockJudgement => ({
  domain: terms.domain,
  ...(terms.lead ? { world: terms.lead } : {}),
  named: terms.named,
  rivals: terms.rivals,
  ...(terms.shun.length ? { shun: terms.shun } : {}),
  ...(terms.shunLead.length ? { shunLead: terms.shunLead } : {}),
  ...extra,
})

const slot = (alt: string, aspect: number, role: AiLayoutPictureSlot['role'], extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: `img-${alt}`,
  frameId: 'frame',
  iconId: null,
  alt,
  aspect,
  sectionIndex: role === 'hero' ? 0 : 1,
  role,
  ...extra,
})

/** A hit's first tags name the motocross world: what a moto site's photo is OF. */
const MOTO_LEAD = /\b(?:motocross|motorcycles?|motorbikes?|dirt bike|dirtbike|enduro|supercross)\b/

beforeEach(() => aiStockForgetJobPhotos())

describe('Rut Runners Racing (AGL-4065, 2026-10-25)', () => {
  const terms = aiStockSourceTerms(RUT_RUNNERS)
  const hero = judged(terms, { subject: '', category: terms.core, first: true })
  const source = (deps: ReturnType<typeof fakes>, sectionNames: string[]) =>
    aiLayoutStockPhotoSource(
      { hostId: 'rut-runners', uid: 'member-1', seed: 'GTxJrcby9-:home', ...RUT_RUNNERS, sectionNames, jobId: 'GTxJrcby9-' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )

  it('never opens a page on the pit lane of race cars, nor on any maker’s photo', () => {
    expect(aiStockRelevance(byId(PORSCHES), hero)).toBe(0)
    // The KTM's own tag names its maker.
    expect(aiStockRelevance(byId('7690696'), hero)).toBe(0)
    expect(aiStockRelevance(byId('10135205'), hero)).toBeGreaterThan(0)
  })

  it('opens the home page on a motocross photo', async () => {
    const deps = fakes()
    const [photo] = (await source(deps, ['Hero: built in Lockhart, raced across Texas'])?.([slot('Built in Lockhart, raced across Texas', 16 / 9, 'hero', { standIn: true })])) ?? []
    const placed = byId(idOf(photo?.src))
    expect(placed).toBeDefined()
    expect([PORSCHES, '386673']).not.toContain(placed.id)
    expect(placed.tags.slice(0, 3).join(', ')).toMatch(MOTO_LEAD)
    expect(deps.asked).not.toContain('team')
  })

  it('never covers a race with cyclists or horses', () => {
    const race = judged(terms, { subject: 'upcoming race', strict: true })
    expect(aiStockRelevance(byId(CYCLISTS), race)).toBe(0)
    expect(aiStockRelevance(byId(HORSES), race)).toBe(0)
    expect(aiStockRelevance(byId(HORSE_RIDE), judged(terms, { subject: 'ready ride', strict: true }))).toBe(0)
  })

  it('never searches a placeholder record’s "upcoming"', async () => {
    const deps = fakes()
    const covers = await source(deps, ['Upcoming races'])?.([
      slot('Upcoming race 1 (details to be added)', 4 / 3, 'gallery', { record: {} }),
      slot('Upcoming race 2 (details to be added)', 4 / 3, 'gallery', { record: {} }),
    ])
    expect(deps.asked).not.toContain('upcoming race')
    for (const cover of covers ?? []) expect([CYCLISTS, HORSES]).not.toContain(idOf(cover?.src))
  })
})

describe('Holeshot Moto Repair (AGL-4065, 2026-10-25)', () => {
  const terms = aiStockSourceTerms(HOLESHOT)
  const hero = judged(terms, { subject: '', category: terms.core, first: true })
  const source = (deps: ReturnType<typeof fakes>) =>
    aiLayoutStockPhotoSource(
      { hostId: 'holeshot', uid: 'member-1', seed: 'D1URtIw28C:home', ...HOLESHOT, sectionNames: ['Hero with book a repair button'], jobId: 'D1URtIw28C' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )

  it('never opens on a street cruiser, a Honda scooter or a moped', () => {
    for (const id of [INDIAN_CRUISER, HONDA_SCOOTER, MOPED]) expect([id, aiStockRelevance(byId(id), hero)]).toEqual([id, 0])
    expect(aiStockRelevance(byId('459594'), hero)).toBeGreaterThan(0)
  })

  it('searches its hero as a dirt bike repair shop, then the motocross world, never "motorcycle" alone first', async () => {
    const deps = fakes()
    const [photo] = (await source(deps)?.([slot('Back on the gate by race day', 4 / 5, 'hero', { standIn: true })])) ?? []
    expect(deps.asked[0]).toBe('dirt bike repair shop')
    const placed = byId(idOf(photo?.src))
    expect([INDIAN_CRUISER, HONDA_SCOOTER, MOPED]).not.toContain(placed?.id)
    expect(placed?.tags.slice(0, 3).join(', ')).toMatch(MOTO_LEAD)
  })
})

describe('Berm & Bolt Moto Parts (AGL-4065, 2026-10-25)', () => {
  const terms = aiStockSourceTerms(BERM_AND_BOLT)
  const source = (deps: ReturnType<typeof fakes>, sectionNames: string[]) =>
    aiLayoutStockPhotoSource(
      { hostId: 'berm-and-bolt', uid: 'member-1', seed: 'H0R2Uc38JG:home', ...BERM_AND_BOLT, sectionNames, jobId: 'H0R2Uc38JG' },
      { provider: () => deps.provider, ingest: () => deps.ingest },
    )

  it('never tiles its parts with a canoe, its tires with a highway or its gear with a bicycle’s', async () => {
    const deps = fakes()
    const tiles = await source(deps, ['Hero: the right part before the weekend', 'Shop by collection'])?.([
      slot('Parts for the bike', 4 / 3, 'gallery'),
      slot('Parts for the ranch', 4 / 5, 'gallery'),
      slot('Tires for every track and trail', 4 / 5, 'gallery'),
      slot('Gear for ride day', 4 / 3, 'gallery'),
    ])
    const ids = (tiles ?? []).map((tile) => idOf(tile?.src))
    for (const id of [CANOE, BICYCLE_GEARS]) expect(ids).not.toContain(id)
    expect(deps.asked).not.toContain('parts')
    expect(deps.asked).not.toContain('gear')
    // A tile's photo is OF the shop's world among its first tags, or there is none.
    for (const id of ids.filter(Boolean)) expect(byId(id).tags.slice(0, 3).join(', ')).toMatch(MOTO_LEAD)
  })

  /** Whether a recorded photo passes any of a slot's own searches, as the source judges each. */
  const takes = (id: string, picture: AiLayoutPictureSlot, sectionName: string) =>
    aiAgl4065Searches(terms, picture, sectionName).some(({ judgement }) => aiStockRelevance(byId(id), judgement) > 0)

  it('turns down every off-trade photo its pictures took, under every search of the slot that took it', () => {
    const steps = 'How a special order works'
    expect(takes(CANOE, slot('Parts for the ranch', 4 / 5, 'gallery'), 'Shop by collection')).toBe(false)
    expect(takes(BICYCLE_GEARS, slot('Gear for ride day', 4 / 3, 'gallery'), 'Shop by collection')).toBe(false)
    expect(takes('4891682', slot('Tires for every track and trail', 4 / 5, 'gallery'), 'Shop by collection')).toBe(false)
    expect(takes('5309140', slot('Tell us your machine', 4 / 3, 'gallery', { standIn: true }), steps)).toBe(false)
    expect(takes('443674', slot('Describe the part', 4 / 3, 'gallery', { standIn: true }), steps)).toBe(false)
    expect(takes('4369056', slot('We source it', 4 / 3, 'gallery', { standIn: true }), steps)).toBe(false)
    expect(takes(CYCLISTS_RACING, slot('Pick it up in store', 4 / 3, 'gallery', { standIn: true }), steps)).toBe(false)
    expect(takes(CYCLIST_HELMET, slot('Not sure it will fit?', 16 / 9, 'gallery', { standIn: true }), 'Fitment questions and contact button')).toBe(false)
    expect(takes(SCOOTER_STORE, slot('Visit the shop', 16 / 9, 'gallery', { standIn: true }), 'Visit the shop button')).toBe(false)
  })

  it('never puts a car tire under "ATV Tire", a gear wheel under riding gear, trees or a delivery under a parts order', () => {
    const product = (name: string) => slot(name, 4 / 5, 'gallery', { product: { subjects: [name] } })
    for (const [id, name] of [
      [CAR_TIRE, 'ATV Tire'],
      [GEAR_WHEEL, 'Riding Gear Item'],
      [TREES, 'OEM ATV Parts Order'],
      [DELIVERY_MAN, 'OEM Dirt Bike Parts Order'],
      [AUTO_PARTS, 'Aftermarket Dirt Bike Part'],
    ] as const)
      expect([name, id, takes(id, product(name), 'Bestsellers')]).toEqual([name, id, false])
    // A motocross helmet is searched for as one, never as a gear wheel.
    expect(aiStockProductSearches(product('Motocross helmet'), terms.craft, terms.domain, terms)[0]?.query).toBe('motocross helmet')
    // The dirt bike tire production placed is the shop's own.
    expect(takes('7284019', product('Dirt Bike Tire'), 'Bestsellers')).toBe(true)
  })

  it('closes "Not sure it will fit?" on a dirt bike, never a cyclist', async () => {
    const deps = fakes()
    const [band] = (await source(deps, ['Hero', 'Fitment questions and contact button'])?.([slot('Tell us the bike and we will say if it will fit', 16 / 9, 'gallery')])) ?? []
    expect(deps.asked[0]).toBe('dirt bike')
    expect(deps.asked).not.toContain('bike it will fit')
    expect(idOf(band?.src)).not.toBe(CYCLIST_HELMET)
    if (band?.src) expect(byId(idOf(band.src)).tags.slice(0, 3).join(', ')).toMatch(MOTO_LEAD)
  })
})
