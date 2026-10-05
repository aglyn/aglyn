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
 * The properties everything else rests on: a gigabyte of counted media moves
 * the bandwidth meter by exactly the weight's gigabytes of the band, so the
 * band, the cap and the invoice cannot disagree about what a film cost; and
 * that weight is the smallest one at which serving a film earns cost + 30%
 * after card fees, both past the band and inside it.
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
  METERED_MARKUP,
  ORG_COGS_UNIT_RATES_USD,
  ORIGIN_MEDIA_BANDWIDTH_WEIGHT,
  ORIGIN_MEDIA_COST_USD_PER_GB,
  ORIGIN_MEDIA_SERVE_COST_USD_PER_GB,
  PAGE_VIEW_CDN_REQUEST_COST_USD,
  PAGE_VIEW_PUBLISHED_PRICE_USD,
  STRIPE_PROCESSOR_FEE_PCT,
  originMediaBandHolds,
  originMediaOverageHolds,
  pageViewsFromBandwidthGb,
} from './plan-entitlements'

const GIB = 1024 * 1024 * 1024
const WEIGHT = ORIGIN_MEDIA_BANDWIDTH_WEIGHT
const day = (data: Record<string, unknown>) => ({
  get: (field: string) => data[field],
})

describe('the origin-media weight (AGL-3474)', () => {
  it('is 1.6 — pinned, so a basis that moves it is a decision, not a drift', () => {
    expect(WEIGHT).toBe(1.6)
  })

  it('costs a decimal GB term by term, storage not among them', () => {
    expect(Object.keys(ORIGIN_MEDIA_SERVE_COST_USD_PER_GB).sort()).toEqual([
      'fastDataTransfer',
      'fastOriginTransfer',
      'requests',
      'storageEgress',
      'streamingCpu',
      'streamingMemory',
    ])
    expect(ORIGIN_MEDIA_SERVE_COST_USD_PER_GB.fastDataTransfer).toBe(0.35)
    expect(ORIGIN_MEDIA_SERVE_COST_USD_PER_GB.fastOriginTransfer).toBe(0.43)
    expect(ORIGIN_MEDIA_SERVE_COST_USD_PER_GB.storageEgress).toBeCloseTo(0.111759, 6)
    expect(ORIGIN_MEDIA_SERVE_COST_USD_PER_GB.streamingMemory).toBeCloseTo(0.016267, 6)
    expect(ORIGIN_MEDIA_SERVE_COST_USD_PER_GB.streamingCpu).toBeCloseTo(0.003683, 6)
    expect(ORIGIN_MEDIA_SERVE_COST_USD_PER_GB.requests).toBeCloseTo(0.007, 9)
    expect(ORIGIN_MEDIA_COST_USD_PER_GB).toBeCloseTo(0.918709, 6)
  })

  it('bills from the published page-view price, $0.83 per 1,000', () => {
    expect(PAGE_VIEW_PUBLISHED_PRICE_USD * 1000).toBeCloseTo(0.83, 9)
  })

  // The two conditions, written out from the constants rather than through
  // the functions under test, so a predicate that drifted from the rule
  // cannot agree with itself.
  const overageKeptPerGb = (weight: number) =>
    weight *
    PAGE_VIEW_PUBLISHED_PRICE_USD *
    (1e9 / ESTIMATED_PAGE_TRANSFER_BYTES) *
    (1 - STRIPE_PROCESSOR_FEE_PCT)
  const bandCostPerGib =
    (ORG_COGS_UNIT_RATES_USD.perPageView + PAGE_VIEW_CDN_REQUEST_COST_USD) *
    pageViewsFromBandwidthGb(1)
  const originCostPerGib = (ORIGIN_MEDIA_COST_USD_PER_GB * GIB) / 1e9

  it('(a) the overage keeps cost + 30% after card fees at the weight', () => {
    expect(overageKeptPerGb(WEIGHT)).toBeGreaterThanOrEqual(
      METERED_MARKUP * ORIGIN_MEDIA_COST_USD_PER_GB,
    )
    expect(originMediaOverageHolds(WEIGHT)).toBe(true)
  })

  it('(a) …and a tenth lower it does not — counted 1:1 it is under cost', () => {
    expect(overageKeptPerGb(WEIGHT - 0.1)).toBeLessThan(
      METERED_MARKUP * ORIGIN_MEDIA_COST_USD_PER_GB,
    )
    expect(originMediaOverageHolds(WEIGHT - 0.1)).toBe(false)
    expect(overageKeptPerGb(1)).toBeLessThan(ORIGIN_MEDIA_COST_USD_PER_GB)
  })

  it('(b) a band spent wholly on films costs no more than the band was sized on', () => {
    expect(bandCostPerGib).toBeCloseTo(0.63712, 5)
    expect(WEIGHT * bandCostPerGib).toBeGreaterThanOrEqual(originCostPerGib)
    expect(originMediaBandHolds(WEIGHT)).toBe(true)
  })

  it('(b) …and a tenth lower it costs more', () => {
    expect((WEIGHT - 0.1) * bandCostPerGib).toBeLessThan(originCostPerGib)
    expect(originMediaBandHolds(WEIGHT - 0.1)).toBe(false)
  })
})

describe('pageViewsFromMediaBytes', () => {
  it('converts at the page weight and the media weight together', () => {
    expect(pageViewsFromMediaBytes(ESTIMATED_PAGE_TRANSFER_BYTES)).toBeCloseTo(WEIGHT, 12)
    expect(pageViewsFromMediaBytes(GIB)).toBeCloseTo(WEIGHT * pageViewsFromBandwidthGb(1), 6)
    // A GB of film spends WEIGHT GB of the band.
    expect(bandwidthGbFromPageViews(pageViewsFromMediaBytes(7 * GIB))).toBeCloseTo(
      7 * WEIGHT,
      9,
    )
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
    expect(reading.meteredPageViews).toBeCloseTo(
      120 + pageViewsFromBandwidthGb(2 * WEIGHT),
      6,
    )
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
