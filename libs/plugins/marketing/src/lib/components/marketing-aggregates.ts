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

import {
  collection,
  getAggregateFromServer,
  getCountFromServer,
  query,
  sum,
  where,
  type Firestore,
  type Query,
} from 'firebase/firestore'

/**
 * THE MARKETING FIGURES, as server aggregates.
 *
 * Every figure the Overview sections print is a count or a sum, and a count
 * is not the length of a capped read: three listeners at `limit(50)` summed
 * whatever fifty documents the server happened to return first, so a site
 * past fifty sends reported the totals of an arbitrary fifty and nothing on
 * screen said so. An aggregation is billed per thousand index entries rather
 * than per document, so the exact figure costs about what one row did.
 *
 * ## One aggregation per field
 *
 * Firestore can compute several aggregations in one query, and it then
 * counts only the documents that hold EVERY field the query aggregates. A
 * send the webhook has not yet stamped with `stats.clicks` would drop out of
 * the `stats.sent` total beside it, and a count asked alongside a sum would
 * count only the documents carrying the summed field. So each figure is its
 * own query, and a query of one field is served by that field's automatic
 * index wherever the query carries no filter.
 *
 * ## `null` is not zero
 *
 * A figure the server refused or failed to answer is `null`, and the card
 * draws a dash for it. Zero is a measurement; a dash is the absence of one,
 * and a tile that printed 0 for a denied read would be read as "nothing
 * happened".
 */

/** A server count, or `null` when the server refused or failed it. */
export function countOf(target: Query): Promise<number | null> {
  return getCountFromServer(target).then(
    (snapshot) => Number(snapshot.data().count ?? 0),
    () => null,
  )
}

/**
 * A server sum of one numeric field, or `null` when the server refused or
 * failed it. Documents without the field, or with a value that is not a
 * number, add nothing.
 */
export function sumOf(target: Query, field: string): Promise<number | null> {
  return getAggregateFromServer(target, { total: sum(field) }).then(
    (snapshot) => Number(snapshot.data().total ?? 0),
    () => null,
  )
}

/** What a set of campaign sends did, summed. */
export interface SendFigures {
  sent: number | null
  opens: number | null
  clicks: number | null
  /** Sends still waiting on their scheduled time. */
  scheduled: number | null
}

/**
 * The email figures over `sends` — every send of the org, or the ones sent
 * as one site (`campaignSendsQuery` builds both).
 *
 * The site form filters on `visibleTo`, so each of its four figures is
 * served by a composite index that pairs that clause with the summed or
 * compared field; they are declared in `cloud/firebase-firestore.indexes.json`
 * and pinned by `marketing-summary-indexes.spec.ts`. The org form carries no
 * filter and needs nothing but the automatic ones.
 */
export function readSendFigures(sends: Query): Promise<SendFigures> {
  return Promise.all([
    sumOf(sends, 'stats.sent'),
    sumOf(sends, 'stats.opens'),
    sumOf(sends, 'stats.clicks'),
    countOf(query(sends, where('status', '==', 'scheduled'))),
  ]).then(([sent, opens, clicks, scheduled]) => ({
    sent,
    opens,
    clicks,
    scheduled,
  }))
}

/** One site's overlays' lifetime engagement, summed. */
export interface SiteOverlayFigures {
  views: number | null
  clicks: number | null
}

/**
 * The lifetime counters the beacon increments on every overlay of one site
 * (AGL-271), summed across all of them — not across a window of them.
 */
export function readSiteOverlayFigures(
  firestore: Firestore,
  hostId: string,
): Promise<SiteOverlayFigures> {
  const overlays = collection(firestore, 'hosts', hostId, 'overlays')
  return Promise.all([
    sumOf(overlays, 'stats.impressions'),
    sumOf(overlays, 'stats.clicks'),
  ]).then(([views, clicks]) => ({ views, clicks }))
}

/** How many of one site's A/B tests are running, and how many are decided. */
export interface SiteExperimentFigures {
  running: number | null
  decided: number | null
}

/**
 * One site's A/B tests, counted by state.
 *
 * "Decided" is a test with a winner, which is what `winnerVariantId` records
 * whether a person picked it or the auto-winner did. `!= null` is the query
 * for a field that is PRESENT: Firestore leaves out documents that lack the
 * field, and no writer stores the id as an explicit null.
 */
export function readSiteExperimentFigures(
  firestore: Firestore,
  hostId: string,
): Promise<SiteExperimentFigures> {
  const experiments = collection(firestore, 'hosts', hostId, 'experiments')
  return Promise.all([
    countOf(query(experiments, where('status', '==', 'running'))),
    countOf(query(experiments, where('winnerVariantId', '!=', null))),
  ]).then(([running, decided]) => ({ running, decided }))
}
