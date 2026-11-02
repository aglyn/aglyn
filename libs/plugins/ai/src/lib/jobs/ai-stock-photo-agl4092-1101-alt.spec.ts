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

import type { StockPhoto } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { aiStockPhotoAlt, aiStockTagsAlt } from './ai-layout-stock-photos'
import { AGL4092_1029_HITS } from './fixtures/ai-stock-photo-agl4092-1029-recordings'
import { AGL4092_1101_HITS } from './fixtures/ai-stock-photo-agl4092-1101-recordings'
import { AGL4092_ANSWERS } from './fixtures/ai-stock-photo-agl4092-recordings'

/*
 * What the 2026-11-01 live check's two fresh sites (AGL-4092) said of their
 * photos, a taco trailer's and a motocross team's: the words a screen reader
 * reads out, joined from Pixabay's tags. Each list below is the photo's own, as
 * Pixabay gives it, with what production said of it and what it says now. "Tacos
 * and a mexican" reads as a person. Where tags make no good sentence, the alt
 * says less, never a guess. Through core's seams only, no network, no model.
 */

const tagsOf = (list: string) => list.split(', ')

const SAID: ReadonlyArray<[id: string, tags: string, before: string, after: string]> = [
  ['245241', 'tacos, mexican, carne asada, food, plate, meal, cuisine, delicious, cooking, dining', 'Tacos and a mexican', 'Tacos'],
  ['4540402', 'tacos, mexican, food, lunch, delicious, tasty, tacos, tacos, tacos, tacos', 'Tacos and a mexican', 'Tacos'],
  ['1018962', 'taco, mexican, beef, food, taco, taco, taco, taco, taco', 'A taco and a mexican', 'A taco'],
  ['4709325', 'taco, mexican, tortilla, food, taco, taco, taco, taco, taco', 'A taco and a mexican', 'A taco'],
  ['7759107', 'tacos, beef, corn, tortillas, lime, spicy, mexican, food, salt, pepper', 'Tacos and a beef', 'Tacos'],
  ['4505032', 'tacos pastor, tacos, tacos mexico, mexican food, tortillas, food, mexico, taco, tortilla, delicious', 'A tacos pastor', 'Tacos'],
  ['4321561', 'tofu, tofu tacos, tacos, avocado, fresh, happy, food, cheese, vegetarian, tortilla', 'A tofu', 'Tofu'],
  ['1670402', 'salsa, fiesta, fresh food, mexican, salsa, salsa, salsa, salsa, salsa', 'A salsa and a fiesta', 'Salsa'],
  ['3487725', 'tacos, mexican food, meat, food, tacos, tacos, tacos, tacos, tacos, mexican food', 'Tacos and mexican food', 'Tacos'],
  ['58709', 'tortilla chip, cornmeal salty biscuits, savory biscuits, potato chips, tortilla, triangular, fried, dip, sauce, food', 'A tortilla chip and cornmeal salty biscuits', 'A tortilla chip'],
  ['7926839', 'motocross, dirtbike, jump, whip, ramp, arrow raceway, outdoors, sport, motocross, motocross', 'A motocross and a dirtbike', 'Motocross'],
  ['2361881', 'motocross, dirtbike, motorcycle, enduro, run, motocross riding, motorcyclist, dirt bike, athletes, cross', 'A motocross and a dirtbike', 'Motocross'],
  ['4948269', 'motocross, race, sport, speed, extreme, action, pilot, motor, jump, helmet', 'A motocross and a race', 'Motocross'],
  ['5546581', 'motocross, race, sports, racing, off road racing, motorcycle, motor, competition, tournament', 'A motocross and a race', 'Motocross'],
  ['6752486', 'race, action, racer, adventure, track, motocross, competition, motion, motorbike', 'A race', 'Motocross'],
  ['4500339', 'bike, racing, motocross, motorsport, motorcycle, sports, extreme, dirt, competition, mud', 'A bike', 'Motocross'],
  ['1854040', 'action, bike, biker, competition, fast, helmet, man, motion, motocross, motorbike', 'A bike', 'Motocross'],
]

/** What production said, and says still, of a photo a sentence can be made of. */
const KEPT: ReadonlyArray<[tags: string, said: string]> = [
  ['kitesurfer, young, rider, nature, kitesurfing, sea, grandparents, watching, water, line, beach', 'A kitesurfer by the sea'],
  ['motorbike, motorcycle, enduro, meadow, countryside, biker, race, transportation, sport, motocross', 'A motorbike in a meadow'],
  ['motocross, motorcycle, road, riding, adventure, travel, nature, desert, sand, dawn', 'A motocross at dawn'],
]

describe('a stock photo described plainly, never a guess from two tags (AGL-4092, 2026-11-01)', () => {
  it.each(SAID)('describes %s (%s), once "%s", as "%s"', (_id, tags, before, after) => {
    const alt = aiStockTagsAlt(tagsOf(tags))
    expect(alt).toBe(after)
    expect(alt).not.toBe(before)
  })

  it.each(KEPT)('keeps %s as "%s"', (tags, said) => {
    expect(aiStockTagsAlt(tagsOf(tags))).toBe(said)
  })

  it('says a demonym only before its thing, with its capital, and never of a person', () => {
    expect(aiStockTagsAlt(['mexican'])).toBeNull()
    expect(aiStockTagsAlt(['mexican', 'italian'])).toBeNull()
    expect(aiStockTagsAlt(['mexican food', 'tacos'])).toBe('Mexican food')
    expect(aiStockTagsAlt(['french fries', 'potato'])).toBe('French fries')
    expect(aiStockTagsAlt(['german shepherd', 'dog'])).toBe('A German shepherd')
    expect(aiStockTagsAlt(['italian restaurant'])).toBe('An Italian restaurant')
    expect(aiStockTagsAlt(['eurasian wren'])).toBe('A Eurasian wren')
    // A person is never told by where their people are from, here as a woman of any people is not.
    expect(aiStockTagsAlt(['mexican man', 'hat'])).toBe('A man with a hat')
    expect(aiStockTagsAlt(['asian woman'])).toBe('A woman')
  })

  it('treats an adjective as an adjective wherever it stands, and a place as no thing', () => {
    expect(aiStockTagsAlt(['mechanical', 'part', 'axis'])).toBe('A part')
    expect(aiStockTagsAlt(['extreme', 'motocross'])).toBe('Motocross')
    expect(aiStockTagsAlt(['extreme', 'motorcross'])).toBe('Motocross')
    expect(aiStockTagsAlt(['legal', 'hammer'])).toBe('A hammer')
    expect(aiStockTagsAlt(['spicy', 'crispy', 'salty'])).toBeNull()
    expect(aiStockTagsAlt(['portugal', 'iran'])).toBeNull()
    expect(aiStockTagsAlt(['turkey', 'roast'])).toBe('A turkey')
    // The site's own place is its own name.
    expect(aiStockTagsAlt(['portugal'], new Set(['portugal']))).toBe('Portugal')
  })

  it('never pluralizes a thing wrongly: a plural leading a tag is no one thing', () => {
    expect(aiStockTagsAlt(['tacos pastor'])).toBeNull()
    expect(aiStockTagsAlt(['tacos al pastor', 'tacos'])).toBe('Tacos')
    expect(aiStockTagsAlt(['sports car'])).toBe('A sports car')
    expect(aiStockTagsAlt(['farmers market'])).toBe('A farmers market')
    expect(aiStockTagsAlt(['grass track'])).toBe('A grass track')
    expect(aiStockTagsAlt(['bass guitar'])).toBe('A bass guitar')
    // Many of many are said as they are.
    expect(aiStockTagsAlt(['bars of soap'])).toBe('Bars of soap')
    expect(aiStockTagsAlt(['tacos de carnitas'])).toBe('Tacos de carnitas')
  })

  it('says what takes no article without one', () => {
    for (const [tags, said] of [
      [['tofu'], 'Tofu'],
      [['salsa'], 'Salsa'],
      [['beef'], 'Beef'],
      [['meat'], 'Meat'],
      [['guacamole'], 'Guacamole'],
      [['yoga'], 'Yoga'],
      [['karate'], 'Karate'],
      [['sand'], 'Sand'],
    ] as const)
      expect(aiStockTagsAlt([...tags])).toBe(said)
  })

  it('says a sport alone by its name, and never as something held', () => {
    expect(aiStockTagsAlt(['motocross'])).toBe('Motocross')
    expect(aiStockTagsAlt(['motocross', 'rider'])).toBe('Motocross')
    expect(aiStockTagsAlt(['man', 'motocross'])).toBe('A man')
    // A thing of its own stands: a rider, a dirt bike.
    expect(aiStockTagsAlt(['motocross rider', 'jump'])).toBe('A motocross rider')
    expect(aiStockTagsAlt(['dirt bike', 'motocross'])).toBe('A dirt bike')
  })

  it('keeps a word too general to say much where nothing says more', () => {
    expect(aiStockTagsAlt(['bike', 'helmet'])).toBe('A bike')
    expect(aiStockTagsAlt(['race', 'horse'])).toBe('A race')
    expect(aiStockTagsAlt(['bike', 'dirt bike'])).toBe('A dirt bike')
  })

  it('still says who holds what, and two people of one tag', () => {
    expect(aiStockTagsAlt(['woman', 'book', 'library'])).toBe('A woman with a book in a library')
    expect(aiStockTagsAlt(['bride', 'dress'])).toBe('A bride in a dress')
    expect(aiStockTagsAlt(['bride groom', 'car'])).toBe('A bride and groom with a car')
    expect(aiStockTagsAlt(['man', 'tacos'])).toBe('A man with tacos')
    // What no one holds is left out, and nothing further down stands in for it.
    expect(aiStockTagsAlt(['woman', 'yoga', 'pose'])).toBe('A woman')
    expect(aiStockTagsAlt(['man', 'agriculture', 'farmer'])).toBe('A man')
  })

  it("falls back to the slot's own words where tags make no sentence at all, never a guess and never empty", () => {
    const slot: AiLayoutPictureSlot = { imageId: 'img', frameId: 'frame', iconId: null, alt: 'A tray of street tacos', aspect: 16 / 9, sectionIndex: 1, role: 'gallery', standIn: true }
    const photo = { tags: ['mexican', 'spicy', 'delicious'], pageUrl: 'https://pixabay.com/photos/mexican-spicy-delicious-1/' }
    expect(aiStockPhotoAlt(photo, slot)).toBe('A tray of street tacos')
    expect(aiStockPhotoAlt(photo, { ...slot, alt: '' }, { sectionName: 'Our menu' })).toBe('Our menu')
    expect(aiStockPhotoAlt(photo, { ...slot, alt: '' })).toBe('Illustrative photo')
  })

  it('joins no two tags into a sentence and says no demonym or sport with an article, across every photo the live checks read', () => {
    const photos: StockPhoto[] = [...AGL4092_1029_HITS.values(), ...AGL4092_1101_HITS.values(), ...Object.values(AGL4092_ANSWERS).flat()]
    expect(photos.length).toBeGreaterThan(500)
    for (const photo of photos) {
      const alt = aiStockTagsAlt(photo.tags ?? []) ?? ''
      expect(alt).not.toMatch(/^An? (?:mexican|italian|french|greek|spanish|german|motocross)$/i)
      // One thing a photo is of: "A bride and groom" says one tag, "Tacos and a beef" two.
      const [, left, right] = /(\S+) and (\S+)/.exec(alt.toLowerCase()) ?? []
      if (left && right) expect((photo.tags ?? []).some((tag) => tag.includes(left) && tag.includes(right))).toBe(true)
    }
  })
})
