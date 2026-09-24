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

import { OUTREACH_ENGAGEMENT_LINKS_MAX, type OutreachEnrollmentEngagement } from './outreach.types'

/**
 * WHAT ONE PERSON DID WITH THE LINKS THEY WERE SENT (AGL-3239), read back
 * from the stored map.
 *
 * Client-safe, and here rather than beside the writer for that reason: the
 * enrollments table renders this in the browser and the click route writes
 * it on the server, and both must agree on what an absent field means.
 *
 * Read defensively, a field at a time. `readOutreachEngagement(undefined)`
 * is what an enrollment that has never been clicked reads as — which is
 * every enrollment of every sequence that does not track clicks, so it is
 * the common case rather than the edge one.
 */
export function readOutreachEngagement(raw: unknown): Required<OutreachEnrollmentEngagement> {
  const data = (raw ?? {}) as Record<string, unknown>
  const count = (value: unknown): number => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
  }
  const ms = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  const clicks = count(data['clicks'])
  const machineClicks = count(data['machineClicks'])
  const links = Array.isArray(data['links'])
    ? [...new Set(data['links'].filter((entry): entry is string => typeof entry === 'string' && entry !== ''))]
    : []
  return {
    clicks,
    firstClickAtMs: ms(data['firstClickAtMs']),
    lastClickAtMs: ms(data['lastClickAtMs']),
    lastClickUrl: typeof data['lastClickUrl'] === 'string' ? data['lastClickUrl'] : null,
    machineClicks,
    links: links.slice(0, OUTREACH_ENGAGEMENT_LINKS_MAX),
    // Never more than the totals they are part of: a history row is written
    // in the same transaction as the count it itemizes.
    loggedClicks: Math.min(count(data['loggedClicks']), clicks),
    loggedMachineClicks: Math.min(count(data['loggedMachineClicks']), machineClicks),
  }
}

/**
 * What the enrollments table and the detail view say about one person's
 * clicks (AGL-3332), from the engagement alone.
 *
 * `linkCount` is the number of distinct destinations they followed when that
 * number is KNOWN, and `null` when it is not: a click from before the
 * per-click history kept only the last destination, so a person with two
 * such clicks followed one link or two, and neither is claimed.
 * `linksCapped` says the list stopped at {@link OUTREACH_ENGAGEMENT_LINKS_MAX}.
 */
export interface OutreachClickSummary {
  clicks: number
  machineClicks: number
  /** Every destination known to have been followed: the history's, and the last one. */
  followed: string[]
  linkCount: number | null
  linksCapped: boolean
  /** Human clicks counted as totals only, with no row of their own. */
  unloggedClicks: number
  unloggedMachineClicks: number
}

export function outreachClickSummary(raw: unknown): OutreachClickSummary {
  const engagement = readOutreachEngagement(raw)
  const followed = [...engagement.links]
  if (engagement.lastClickUrl && !followed.includes(engagement.lastClickUrl)) followed.push(engagement.lastClickUrl)
  const unloggedClicks = engagement.clicks - engagement.loggedClicks
  const linksCapped = engagement.links.length >= OUTREACH_ENGAGEMENT_LINKS_MAX
  // Exact when every human click has a row, or when there was only one.
  const exact = unloggedClicks === 0 || (engagement.clicks === 1 && engagement.lastClickUrl !== null)
  return {
    clicks: engagement.clicks,
    machineClicks: engagement.machineClicks,
    followed,
    linkCount: engagement.clicks === 0 ? 0 : exact ? followed.length : null,
    linksCapped,
    unloggedClicks,
    unloggedMachineClicks: engagement.machineClicks - engagement.loggedMachineClicks,
  }
}

/** The Clicks cell: "2 · 1 link", or the count alone when the links are not known. */
export function outreachClickCountLabel(summary: OutreachClickSummary): string {
  if (!summary.clicks) return '—'
  if (summary.linkCount === null) return String(summary.clicks)
  const links = `${summary.linkCount}${summary.linksCapped ? '+' : ''}`
  return `${summary.clicks} · ${links} ${summary.linkCount === 1 && !summary.linksCapped ? 'link' : 'links'}`
}
