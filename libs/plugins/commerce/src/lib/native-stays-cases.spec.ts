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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  computeReservationQuote,
  isRangeAvailable,
  resourceUnits,
  unitsLeftByNight,
} from './model/commerce-reservations'

/**
 * The native apps book the front desk's walk-in themselves, pricing and checking the dates with ports of the console's
 * reservation functions, units included (a resource with several identical units, AGL-4044). Both ports replay
 * `stays-cases.json`; this holds that file to the TypeScript it was made from, so a
 * change to the console's pricing or availability fails here until the file, and with it both ports, is brought along.
 */
const FILE = join(__dirname, '../../../../native/screens/stays-cases.json')
const cases = JSON.parse(readFileSync(FILE, 'utf8')) as {
  nowMs: number
  blocks: Array<{ fromDayMs: number; toDayMs: number }>
  stays: Array<any>
  quotes: Array<{ resource: string; spec: any; checkIn: string; checkOut: string; quote: any }>
  availability: Array<{ checkIn: string; checkOut: string; available: boolean }>
  units: Array<{ raw?: unknown; units: number }>
  multiUnit: Array<{
    name: string
    units?: unknown
    blocks: Array<{ fromDayMs: number; toDayMs: number }>
    stays: Array<any>
    availability: Array<{ checkIn: string; checkOut: string; available: boolean }>
    nightsFrom: string
    nights: Array<{ day: string; unitsLeft: number; units: number }>
  }>
}
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const iso = (dayMs: number) => new Date(dayMs).toISOString().slice(0, 10)

describe('native stays', () => {
  it('price a stay the way the console does', () => {
    expect(cases.quotes.length).toBeGreaterThan(20)
    for (const item of cases.quotes) {
      const quote = computeReservationQuote(item.spec, day(item.checkIn), day(item.checkOut))
      expect([item.resource, item.checkIn, item.checkOut, {
        nights: quote.nights,
        subtotalCents: quote.subtotalCents,
        depositCents: quote.depositCents,
        totalCents: quote.totalCents,
        nightlyCents: quote.nightlyCents,
        problem: quote.problem ?? null,
      }]).toEqual([item.resource, item.checkIn, item.checkOut, item.quote])
    }
  })

  it('say when a range of dates is free the way the console does', () => {
    for (const item of cases.availability) {
      expect([
        item.checkIn,
        item.checkOut,
        isRangeAvailable({ blocks: cases.blocks } as never, cases.stays, day(item.checkIn), day(item.checkOut), cases.nowMs),
      ]).toEqual([item.checkIn, item.checkOut, item.available])
    }
  })

  it('read a resource\'s units the way the console does', () => {
    expect(cases.units.length).toBeGreaterThan(10)
    for (const item of cases.units) {
      const resource = 'raw' in item ? { units: item.raw } : {}
      expect([item.raw, resourceUnits(resource as never)]).toEqual([item.raw, item.units])
    }
  })

  it('count the units left on each night of a several-unit resource the way the console does', () => {
    expect(cases.multiUnit.some((scenario) => Number(scenario.units) > 1)).toBe(true)
    for (const scenario of cases.multiUnit) {
      // The resource as stored: `units` passed through exactly as the case holds it, absent when it has none.
      const resource = {
        blocks: scenario.blocks,
        ...('units' in scenario ? { units: scenario.units } : {}),
      } as never
      for (const item of scenario.availability) {
        expect([
          scenario.name,
          item.checkIn,
          item.checkOut,
          isRangeAvailable(resource, scenario.stays, day(item.checkIn), day(item.checkOut), cases.nowMs),
        ]).toEqual([scenario.name, item.checkIn, item.checkOut, item.available])
      }
      const nights = unitsLeftByNight(
        resource,
        scenario.stays,
        day(scenario.nightsFrom),
        scenario.nights.length,
        cases.nowMs,
      ).map((night) => ({ day: iso(night.dayMs), unitsLeft: night.unitsLeft, units: night.units }))
      expect([scenario.name, nights]).toEqual([scenario.name, scenario.nights])
    }
  })
})
