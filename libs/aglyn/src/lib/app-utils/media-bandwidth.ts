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
 * Video and file delivery counted against the bandwidth band (AGL-3474).
 *
 * ## What it counts
 *
 * Every byte the media CDN sends of a type the edge must never hold — video,
 * audio, PDFs, documents, anything that is not an image (`mediaCdnEdgeCacheable`,
 * AGL-1515). Those responses are `private`, so each one is served from origin:
 * Vercel's transfer, its origin transfer and the Storage read are paid on every
 * request, and before this nothing put them in front of the band, the meter,
 * the invoice or the Free cap. A video the delivery provider serves (AGL-2824)
 * counts the bytes its redirect hands over, so moving a film off origin never
 * moves it off the meter.
 *
 * Images are NOT counted here. They are edge-cached, and a page's images are
 * already inside the weight one page view is converted at
 * (`ESTIMATED_PAGE_TRANSFER_BYTES` is measured on a settled page, pictures
 * included), so counting their bytes again would bill them twice.
 *
 * ## How it is carried
 *
 * As BYTES, on the analytics day document the CDN already writes for each
 * served asset — `hosts/{id}/analytics/{day}` for a site's library and
 * `orgs/{id}/analytics/{day}` for the org library — in the same write that
 * records the asset's serves, so counting adds no write to any request.
 *
 * And as PAGE VIEWS wherever bandwidth is measured, because the band is a
 * page-view band: `bandwidthGb` is converted to views through
 * `ESTIMATED_PAGE_TRANSFER_BYTES`, the meter counts views, and the invoice
 * prices views. Media bytes are converted through the same constant, and
 * every reader — the invoice, the Free cap, the abuse ceiling, the usage
 * alerts and the Billing meter — sums one figure through
 * {@link analyticsBandwidthReading} rather than each deciding for itself.
 *
 * ## At a weight
 *
 * A gigabyte served from origin costs more than a gigabyte of pages, so it
 * counts as {@link ORIGIN_MEDIA_BANDWIDTH_WEIGHT} gigabytes of the band —
 * derived beside the cost basis in `plan-entitlements.ts`, as the smallest
 * weight at which both the overage and the band earn cost + 30% after card
 * fees. It is applied in {@link pageViewsFromMediaBytes} and nowhere else, so
 * the wall, the meter and the bill cannot count a film differently.
 */

import {
  ESTIMATED_PAGE_TRANSFER_BYTES,
  ORIGIN_MEDIA_BANDWIDTH_WEIGHT,
} from './plan-entitlements'

/**
 * The analytics day-document field the media CDN adds its counted bytes to.
 *
 * Top level, beside `total`, rather than inside the per-asset `media` map:
 * the meter needs one number per day, and summing a map keyed by every asset
 * in a library would make each reader walk the whole library to find it.
 */
export const MEDIA_BANDWIDTH_DAY_FIELD = 'mediaBandwidthBytes'

/**
 * Counted media bytes as the page views the bandwidth band is kept in, at
 * {@link ORIGIN_MEDIA_BANDWIDTH_WEIGHT} — the one place the weight is applied.
 */
export function pageViewsFromMediaBytes(bytes: unknown): number {
  const value = Number(bytes)
  return Number.isFinite(value) && value > 0
    ? (value * ORIGIN_MEDIA_BANDWIDTH_WEIGHT) / ESTIMATED_PAGE_TRANSFER_BYTES
    : 0
}

/** One stretch of analytics day documents, as bandwidth. */
export interface AnalyticsBandwidthReading {
  /** Page views the analytics beacon counted. */
  pageViews: number
  /** Video and file bytes the media CDN counted, as served — unweighted. */
  mediaBytes: number
  /**
   * Both, in page views, the media at its weight — the figure the band, the
   * cap, the ceiling and the invoice are measured in. Fractional once media
   * is in it; round only for display.
   */
  meteredPageViews: number
}

/**
 * Sum analytics day documents into the bandwidth they record.
 *
 * Takes anything with `get(field)`, which is what an Admin SDK snapshot and a
 * client SDK snapshot both are, so the routes and the Billing card read the
 * same documents through the same function.
 */
export function analyticsBandwidthReading(
  days: Iterable<{ get(field: string): unknown }>,
): AnalyticsBandwidthReading {
  let pageViews = 0
  let mediaBytes = 0
  for (const day of days) {
    pageViews += Math.max(0, Number(day.get('total') ?? 0) || 0)
    mediaBytes += Math.max(0, Number(day.get(MEDIA_BANDWIDTH_DAY_FIELD) ?? 0) || 0)
  }
  return {
    pageViews,
    mediaBytes,
    meteredPageViews: pageViews + pageViewsFromMediaBytes(mediaBytes),
  }
}
