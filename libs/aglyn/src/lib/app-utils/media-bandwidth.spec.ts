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
 * Video and file delivery in the band's units (AGL-3474).
 *
 * The property everything else rests on: a gigabyte of counted media moves
 * the bandwidth meter by exactly what a gigabyte of the band is worth, so the
 * band, the cap and the invoice cannot disagree about what a film cost.
 */

import { bandwidthCapApplies } from './bandwidth-cap'
import {
  analyticsBandwidthReading,
  MEDIA_BANDWIDTH_DAY_FIELD,
  pageViewsFromMediaBytes,
} from './media-bandwidth'
import {
  bandwidthGbFromPageViews,
  ESTIMATED_PAGE_TRANSFER_BYTES,
  pageViewsFromBandwidthGb,
} from './plan-entitlements'

const GIB = 1024 * 1024 * 1024
const day = (data: Record<string, unknown>) => ({
  get: (field: string) => data[field],
})

describe('pageViewsFromMediaBytes', () => {
  it('converts at the page weight, so a GB of media is a GB of the band', () => {
    expect(pageViewsFromMediaBytes(ESTIMATED_PAGE_TRANSFER_BYTES)).toBe(1)
    expect(pageViewsFromMediaBytes(GIB)).toBeCloseTo(pageViewsFromBandwidthGb(1), 9)
    expect(bandwidthGbFromPageViews(pageViewsFromMediaBytes(7 * GIB))).toBeCloseTo(7, 9)
  })

  it('reads nothing it cannot read as a positive count', () => {
    for (const value of [undefined, null, 'x', -5, Number.NaN, Infinity]) {
      expect(pageViewsFromMediaBytes(value)).toBe(0)
    }
  })
})

describe('analyticsBandwidthReading', () => {
  it('sums page views and counted media across days, in views', () => {
    const reading = analyticsBandwidthReading([
      day({ total: 100 }),
      day({ total: 20, [MEDIA_BANDWIDTH_DAY_FIELD]: GIB }),
      day({ [MEDIA_BANDWIDTH_DAY_FIELD]: GIB }),
    ])
    expect(reading.pageViews).toBe(120)
    expect(reading.mediaBytes).toBe(2 * GIB)
    expect(reading.meteredPageViews).toBeCloseTo(120 + pageViewsFromBandwidthGb(2), 6)
  })

  it('a month with no media reads exactly the page views it always did', () => {
    const reading = analyticsBandwidthReading([day({ total: 1_000 }), day({ total: 5 })])
    expect(reading.meteredPageViews).toBe(1_005)
    expect(reading.mediaBytes).toBe(0)
  })

  it('the per-asset `media` map is not the band — only the day total is', () => {
    // The CDN writes every asset's bytes into `media.{id}.bytes`, images
    // included. Reading that map would bill the images the page weight
    // already prices.
    const reading = analyticsBandwidthReading([
      day({ total: 3, media: { logo: { serves: 9, bytes: GIB } } }),
    ])
    expect(reading.meteredPageViews).toBe(3)
  })

  it('folds junk to zero instead of poisoning the sum', () => {
    const reading = analyticsBandwidthReading([
      day({ total: 'many', [MEDIA_BANDWIDTH_DAY_FIELD]: -1 }),
      day({ total: 4 }),
    ])
    expect(reading).toEqual({ pageViews: 4, mediaBytes: 0, meteredPageViews: 4 })
  })
})

describe('bandwidthCapApplies', () => {
  it('is true for the plans the cap stops, and only those', () => {
    expect(bandwidthCapApplies({ plan: 'free' } as never)).toBe(true)
    // No plan at all is Free — the never-subscribed org (AGL-2413).
    expect(bandwidthCapApplies({} as never)).toBe(true)
    expect(
      bandwidthCapApplies({
        plan: 'starter',
        subscription: { status: 'active' },
      } as never),
    ).toBe(false)
    expect(bandwidthCapApplies({ plan: 'enterprise' } as never)).toBe(false)
  })
})
