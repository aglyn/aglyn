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
 * WHO A CAMPAIGN REACHED ON THE SITE (AGL-3461) — first visits and views of
 * the pages filed under it.
 *
 * ## One document per campaign, keyed by the campaign's id
 *
 * `orgs/{orgId}/campaignVisitReports/{campaignId}`, beside the sequence
 * rollup and on the same footing: counts, never a person, written only on the
 * Admin SDK by the site collector's `campaignVisit` beacon, readable by
 * whoever may open the campaign. Keyed by the campaign DOCUMENT, so the
 * collection is bounded by the campaigns that exist — never by a label or a
 * path a visitor's URL could mint.
 *
 * ## What each figure counts
 *
 *  - **Page views** — views of the pages filed under the campaign, one per
 *    pageview, whoever the visitor is. It needs nothing from the visitor's
 *    device, so every view counts.
 *  - **First visits** — visitors reaching the campaign for the first time in
 *    the attribution window, by a page filed under it or a link carrying a
 *    `utm_campaign` label it declares. The device remembers which campaigns
 *    it has been counted for (`claimCampaignFirstVisits` in `utm-touch.ts`),
 *    so a visitor is counted once per campaign per window — and a visitor
 *    whose consent posture keeps nothing on their device cannot be told from
 *    the next one and is not counted at all. The figure is therefore a floor,
 *    and the page says so.
 *
 * Both are also kept per month, under `byMonth`, so a campaign with dates can
 * be read for its own window. Twelve keys a year is the bound.
 */

/** The org collection the rollups live in. */
export const CAMPAIGN_VISIT_REPORTS_COLLECTION = 'campaignVisitReports'

/** One month's figures, under `byMonth['YYYY-MM']`. */
export interface CampaignVisitMonth {
  views?: number
  firstVisits?: number
}

/** The stored shape of `orgs/{orgId}/campaignVisitReports/{campaignId}`. */
export interface CampaignVisitRollup {
  views?: number
  firstVisits?: number
  byMonth?: Record<string, CampaignVisitMonth>
}

/** What the campaign's page draws. */
export interface CampaignVisitsReport {
  /** Whether anything has been counted at all. */
  recorded: boolean
  views: number
  firstVisits: number
  /** The first month anything was counted, `YYYY-MM`, or `''`. */
  since: string
}

function count(raw: unknown): number {
  const value = Math.floor(Number(raw ?? 0))
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The rollup as the page reads it. `since` is the earliest month on record,
 * so the figures say how far back they reach: they start when counting
 * started, not when the campaign did.
 */
export function campaignVisitsReport(
  rollup: CampaignVisitRollup | null | undefined,
): CampaignVisitsReport {
  const months = Object.keys(rollup?.byMonth ?? {})
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .sort()
  return {
    recorded: Boolean(rollup),
    views: count(rollup?.views),
    firstVisits: count(rollup?.firstVisits),
    since: months[0] ?? '',
  }
}
