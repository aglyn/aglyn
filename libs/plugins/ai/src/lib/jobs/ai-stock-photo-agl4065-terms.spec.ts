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

import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import {
  aiStockSearchesFor,
  aiStockSiteTerms,
  aiStockSlotPart,
  aiStockSourceTerms,
  aiStockSubjectWords,
  aiStockWiderTerms,
  aiStockWorldIsUnlisted,
} from './ai-layout-stock-photos'

/*
 * What six booth-kit starts of 2026-10-25 were searched by (AGL-4065), read
 * by the module's pure builders from the business types the person typed.
 * Each site's photos were off its trade because of how its words were read:
 * "Motorcycle and dirt bike repair shop" as the business "motorcycle", "Dirt
 * bike and ATV parts shop" as "dirt bike" with the craft "bike", "Amateur
 * motocross race team" with the craft "team", a taco trailer as a caterer, and
 * a landscaper and a handyman as worlds the module did not list, which widened
 * to the business kind's office people. No network, no model.
 */

const SITES = {
  bluebonnet: {
    business: 'Landscaping company: lawn care, native plant beds, xeriscape, sod, irrigation repair, seasonal cleanups; free estimates',
    audience: 'Busy homeowners and HOAs around New Braunfels who want a tidy, water-wise yard without the weekend work',
    kind: 'business',
  },
  rutRunners: {
    business: 'Amateur motocross race team: rider profiles, race schedule and results, sponsors, and sponsor inquiries',
    audience: 'Local businesses that sponsor riders, race fans and families following the team, and young riders who want to join',
    kind: 'fitness',
  },
  holeshot: {
    business: 'Motorcycle and dirt bike repair shop: engine rebuilds, suspension, tires, race prep, service; books repair appointments',
    audience: 'Dirt bike and street riders, motocross racers and youth-racer parents around San Marcos who want fast, honest repairs',
    kind: 'trades',
  },
  bermAndBolt: {
    business: 'Dirt bike and ATV parts shop: OEM and aftermarket parts, tires, riding gear, special orders; in-store pickup',
    audience: 'Weekend riders, motocross racers and ranch ATV owners around Kyle who need parts fast and real advice',
    kind: 'store',
  },
  twoOaks: {
    business: 'Handyman business: home repairs, drywall, fences and decks, doors and trim, small remodels; takes quote requests',
    audience: 'Homeowners and landlords around Seguin who need repairs done right without hiring three different trades',
    kind: 'trades',
  },
  pitRow: {
    business: 'Taco food trailer: street and breakfast tacos at motocross races, events and around town; takes catering requests',
    audience: 'Hungry riders, families and fans at Texas motocross races, plus locals and event planners around Buda',
    kind: 'restaurant',
  },
} as const

const termsOf = (site: keyof typeof SITES) => aiStockSourceTerms({ ...SITES[site], language: 'en' })

const slot = (alt: string, role: AiLayoutPictureSlot['role'], extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: 'img',
  frameId: 'frame',
  iconId: null,
  alt,
  aspect: role === 'hero' ? 16 / 9 : 4 / 3,
  sectionIndex: role === 'hero' ? 0 : 1,
  role,
  ...extra,
})

/** The office rungs the business kind widened a landscaper's pictures to on 2026-10-25. */
const OFFICE_SEARCHES = ['small business owner', 'team meeting office', 'office workspace', 'business meeting', 'workspace desk laptop']

/** Words that say what a business does with a customer, never what its photos show. */
const TRANSACTION_STEMS = ['take', 'book', 'appointment', 'order', 'request', 'quote', 'estimate', 'free', 'inquiry', 'pickup', 'special', 'around', 'town']

describe('a business named by two vehicles is both, never the first alone (AGL-4065)', () => {
  it('reads Holeshot Moto Repair as a dirt bike repair shop of the motorcycle world', () => {
    const terms = termsOf('holeshot')
    expect(terms.business).toBe('dirt bike repair shop')
    expect(terms.craft).toBe('motorcycle')
    expect(terms.core).toEqual(expect.arrayContaining(['motorcycle', 'motocross', 'dirt bike', 'enduro']))
    expect(terms.lead).toEqual(expect.arrayContaining(['motorcycle', 'dirt bike']))
    expect(aiStockWorldIsUnlisted(terms)).toBe(false)
  })

  it('reads Berm & Bolt Moto Parts as a parts shop of the dirt bike and ATV world', () => {
    const terms = termsOf('bermAndBolt')
    expect(terms.craft).toBe('part')
    expect(terms.leadWord).toBe('dirt bike')
    expect(terms.lead).toEqual(expect.arrayContaining(['dirt bike', 'atv', 'motocross']))
    // A part names no world on its own, and "bike" alone is a bicycle's as often as a dirt bike's.
    expect(terms.lead).not.toContain('part')
    expect(terms.lead).not.toContain('bike')
    expect(terms.core).not.toContain('bike')
    expect(terms.broad).toEqual(expect.arrayContaining(['dirt bike parts', 'motocross gear']))
    expect(terms.rivals.some((rival) => rival.words.includes('bicycle'))).toBe(true)
  })

  it('reads Rut Runners Racing as motocross, never as a team or a race', () => {
    const terms = termsOf('rutRunners')
    expect(terms.craft).toBe('motocross')
    expect(terms.core).not.toEqual(['team'])
    expect(terms.core).toContain('motocross')
    expect(terms.lead).toContain('motocross')
    // A race car and an office team are of neither.
    expect(terms.lead).not.toContain('race')
    expect(terms.lead).not.toContain('team')
    expect(terms.broad[0]).toBe('motocross')
  })
})

describe('the six trades are listed worlds (AGL-4065)', () => {
  it('lists the landscaper, with its lawn and garden kin and its own broad searches', () => {
    const terms = termsOf('bluebonnet')
    expect(aiStockWorldIsUnlisted(terms)).toBe(false)
    expect(terms.craft).toBe('landscaping')
    expect(terms.domain).toEqual(expect.arrayContaining(['lawn', 'garden', 'mower', 'sprinkler']))
    expect(terms.broad).toEqual(expect.arrayContaining(['lawn care', 'landscaping garden']))
    expect(terms.shunLead).toEqual(expect.arrayContaining(['zen', 'sand', 'office', 'desk']))
  })

  it('lists the handyman, whose photos are never an architect’s, a family’s or a job application', () => {
    const terms = termsOf('twoOaks')
    expect(aiStockWorldIsUnlisted(terms)).toBe(false)
    expect(terms.craft).toBe('handyman')
    expect(terms.domain).toEqual(expect.arrayContaining(['tool', 'drill', 'hammer', 'drywall']))
    expect(terms.shunLead).toEqual(expect.arrayContaining(['architecture', 'family', 'application', 'job']))
  })

  it('reads the taco trailer as tacos: the craft named first wins, never the catering it also takes', () => {
    const terms = termsOf('pitRow')
    expect(terms.craft).toBe('taco')
    expect(terms.broad[0]).toBe('tacos')
    expect(terms.broad).not.toContain('caterer')
    expect(terms.making[0]).toBe('taco truck cooking')
    expect(terms.making).not.toContain('chef cooking')
    expect(terms.shunLead).toEqual(expect.arrayContaining(['buffet', 'chef', 'potato']))
  })

  it('keeps every word a customer is asked to do out of each world', () => {
    for (const site of Object.keys(SITES) as Array<keyof typeof SITES>) {
      const terms = termsOf(site)
      for (const stem of TRANSACTION_STEMS) expect([site, terms.domain.includes(stem)]).toEqual([site, false])
    }
  })
})

describe('a picture’s subject is a thing, never a sentence to the reader (AGL-4065)', () => {
  it('reads the six sentences the starts searched by', () => {
    expect(aiStockSubjectWords('Tell us the bike and we will say if it will fit', '')).toBe('bike')
    expect(aiStockSubjectWords('Parts for the ranch', '')).toBe('parts')
    expect(aiStockSubjectWords('Describe the part you need', '')).toBe('part')
    expect(aiStockSubjectWords('Upcoming race 1 (details to be added)', '')).toBe('race')
    expect(aiStockSubjectWords('Drywall patches and repairs', '')).toBe('drywall patches')
    expect(aiStockSubjectWords('Potato and egg breakfast taco', '')).toBe('egg breakfast taco')
  })

  it('searches a part of a parts shop by its world, never "parts" alone', () => {
    const terms = termsOf('bermAndBolt')
    const tile = slot('Parts for the ranch', 'gallery')
    const part = aiStockSlotPart(tile, 'Shop by collection')
    const queries = aiStockSearchesFor(tile, terms, aiStockSubjectWords(tile.alt, 'Shop by collection'), part, 'Shop by collection').map(
      (search) => search.query,
    )
    expect(queries[0]).toBe('dirt bike parts')
    expect(queries).not.toContain('parts')
    expect(queries).not.toContain('part')
  })

  it('searches "the bike" of a dirt bike shop as a dirt bike, never as a bicycle', () => {
    const terms = termsOf('bermAndBolt')
    const fit = slot('Tell us the bike and we will say if it will fit', 'gallery')
    const queries = aiStockSearchesFor(fit, terms, aiStockSubjectWords(fit.alt, 'Fitment questions')).map((search) => search.query)
    expect(queries[0]).toBe('dirt bike')
    expect(queries).not.toContain('bike')
    expect(queries.some((query) => /\bit\b|\bwill\b|\btell\b/.test(query))).toBe(false)
  })

  it('gives "Describe the job" nothing of its own to search, and the craft’s own searches instead', () => {
    const terms = termsOf('twoOaks')
    const band = slot('Describe the job', 'gallery')
    const subject = aiStockSubjectWords(band.alt, 'Call to action: describe your job')
    const queries = aiStockSearchesFor(band, terms, subject).map((search) => search.query)
    expect(queries).not.toContain('handyman describe job')
    expect(queries.some((query) => /\bjob\b|\bdescribe\b/.test(query))).toBe(false)
    expect(queries).toEqual(expect.arrayContaining(['handyman tools', 'home repair']))
  })

  it('searches a record’s cover by its world first', () => {
    const terms = termsOf('twoOaks')
    const cover = slot('Drywall patches and repairs', 'gallery', { record: {} })
    const searches = aiStockSearchesFor(cover, terms, aiStockSubjectWords(cover.alt, 'All services'))
    expect(searches[0]?.query).toBe('handyman drywall patches')
    // What the cover is OF: the thing among the photo's first tags.
    expect(searches[0]?.lead).toBe(true)
  })
})

describe('a trade or an outdoor world never widens to an office (AGL-4065)', () => {
  it('gives the landscaper, the handyman and the repair shop no office rung', () => {
    for (const site of ['bluebonnet', 'twoOaks', 'holeshot'] as const) {
      const terms = termsOf(site)
      const rungs = aiStockWiderTerms(terms, SITES[site].kind).flatMap((rung) => rung.terms.broad)
      for (const office of OFFICE_SEARCHES) expect([site, rungs.includes(office)]).toEqual([site, false])
    }
  })

  it('gives an unlisted outdoor trade picked as Business & services no office rung either', () => {
    const terms = aiStockSourceTerms({ business: 'Roofing company: roof repairs and replacements', kind: 'business', language: 'en' })
    expect(aiStockWorldIsUnlisted(terms)).toBe(true)
    const rungs = aiStockWiderTerms(terms, 'business').flatMap((rung) => rung.terms.broad)
    for (const office of OFFICE_SEARCHES) expect(rungs).not.toContain(office)
  })

  it('still widens a world of its own words that names no trade (AGL-3923)', () => {
    const terms = aiStockSourceTerms({ business: 'Freelencing site offer services', kind: 'business', language: 'en' })
    const rungs = aiStockWiderTerms(terms, 'business').flatMap((rung) => rung.terms.broad)
    expect(rungs).toEqual(expect.arrayContaining(['small business owner']))
  })
})

describe('a business type read as before where none of this applies (AGL-4065)', () => {
  it('keeps "IT" of an IT support business, and the books of a shop that opens with them', () => {
    expect(aiStockSiteTerms('IT support for small businesses').business).toBe('it support')
    expect(aiStockSiteTerms('Books and coffee shop').domain).toContain('book')
  })

  it('keeps a bakery and café a bakery, and a wedding and portrait photographer a photographer', () => {
    expect(aiStockSiteTerms('Bakery and cafe').business).toBe('bakery')
    expect(aiStockSiteTerms('A wedding and portrait photographer in Asheville').craft).toBe('photographer')
  })
})
