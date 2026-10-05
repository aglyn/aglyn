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

/*==========================================
 * THE DAILY LINK RE-CHECK (AGL-3451).
 *
 * The page review (`hosted-page-review.ts`), the redirect review and the send
 * seam look up every foreign host a page, a redirect or a message points at
 * as it goes out. What is already live is not re-reviewed until somebody
 * publishes it again — and a harvester is often listed only after the page
 * linking to it went up.
 *
 * So {@link recheckLivePageLinks} walks every live page's foreign hosts, as
 * the review noted them beside the version it served
 * (`pageReviews/{screenId}.foreignHosts`), looks them up again — and, in
 * `'url'` mode (AGL-3459), the addresses on them noted beside the hosts
 * (`foreignLinks`, never a query string) — and sends each page with a newly
 * listed host or address back through `reviewHostedPage` with the listing as
 * an extra signal — the same path, so it is held or flagged, its row filed,
 * and a young workspace's security hold requested (AGL-3450), exactly as at
 * render. The console's `/api/admin/web-risk-recheck` runs it a chunk of
 * sites at a time; its first chunk of a walk also deletes the addresses'
 * stored answers that expired a day ago.
 *=========================================*/

import {
  type HostReputationHit,
  MAX_REPUTATION_HOSTS_PER_LOOKUP,
  MAX_REPUTATION_URLS_PER_LOOKUP,
  normalizeReputationLink,
  webRiskSignals,
} from '@aglyn/shared-util-email/link-reputation'
import { FieldPath } from 'firebase-admin/firestore'
import firebaseAdmin from './firebase-admin'
import { PAGE_REVIEW_SUBCOLLECTION, reviewHostedPage } from './hosted-page-review'
import { lookupLinkReputation, reapExpiredWebRiskUrlVerdicts, webRiskLookupMode } from './web-risk'

/** One live page whose foreign hosts the review noted. */
interface LivePageLinks {
  hostId: string
  screenId: string
  versionId: string
  hosts: string[]
  /** The addresses on those hosts the review noted (AGL-3459); empty before it did. */
  links: string[]
}

/** What one chunk of the re-check did. */
export interface LivePageLinkRecheck {
  /** Sites this chunk walked. */
  sites: number
  /** Live pages with foreign links among them. */
  pages: number
  /** Distinct foreign hosts looked up. */
  hosts: number
  /** Distinct addresses looked up on them — none unless the lookup is in `'url'` mode. */
  addresses: number
  /** Of the hosts and addresses, how many Web Risk lists. */
  listed: number
  /** Hosts and addresses nobody could answer for: not evidence, looked up again next time. */
  unknown: number
  /** Pages sent back through the review with a listed host. */
  reviewed: number
  /** Of those, how many the review held (or found already rejected). */
  held: number
  /** The sites a hold was placed on, whose cached pages need dropping. */
  heldHostIds: string[]
  /** Addresses' stored answers deleted a day after they expired (first chunk of a walk only). */
  reapedAddressVerdicts: number
  nextCursor: string | null
  done: boolean
}

/** Sites walked per chunk. */
export const LINK_RECHECK_SITES_PER_CHUNK = 200
/** Sites whose page notes are read at once. */
const SITE_READ_CONCURRENCY = 20
/** The budget of each group of hosts looked up within a chunk. */
const RECHECK_DEADLINE_MS = 15_000

/**
 * Re-check the foreign hosts of every live page, a chunk of sites at a time
 * (`cursor` resumes after the last site of the previous chunk). A site that
 * is locked is skipped: nothing of it serves. A page with a newly listed host
 * goes back through {@link reviewHostedPage} with that listing as an extra
 * signal, so what a hold does is decided in one place.
 */
export async function recheckLivePageLinks(
  options: {
    cursor?: string | null
    sitesPerChunk?: number
    nowMs?: number
    firestore?: FirebaseFirestore.Firestore
    /** Walk and count only: no lookup, no review. */
    dryRun?: boolean
  } = {},
): Promise<LivePageLinkRecheck> {
  const firestore = options.firestore ?? firebaseAdmin.app().firestore()
  const nowMs = options.nowMs ?? Date.now()
  const limit = options.sitesPerChunk ?? LINK_RECHECK_SITES_PER_CHUNK
  let query = firestore
    .collection('hosts')
    .orderBy(FieldPath.documentId())
    .select('suspendedAt')
    .limit(limit)
  if (options.cursor) query = query.startAfter(options.cursor)
  const sites = await query.get()

  const pages: LivePageLinks[] = []
  const live = sites.docs.filter((site) => site.get('suspendedAt') == null)
  for (let at = 0; at < live.length; at += SITE_READ_CONCURRENCY) {
    const batch = live.slice(at, at + SITE_READ_CONCURRENCY)
    const notes = await Promise.all(
      batch.map((site) =>
        site.ref
          .collection(PAGE_REVIEW_SUBCOLLECTION)
          .where('foreignHostCount', '>', 0)
          .limit(500)
          .get()
          .then((reviews) => ({ site, reviews })),
      ),
    )
    for (const { site, reviews } of notes) {
      for (const review of reviews.docs) {
        const versionId = review.get('servedVersionId')
        const hosts = review.get('foreignHosts')
        const links = review.get('foreignLinks')
        if (typeof versionId !== 'string' || !versionId || !Array.isArray(hosts)) continue
        pages.push({
          hostId: site.id,
          screenId: review.id,
          versionId,
          hosts: hosts.filter((host): host is string => typeof host === 'string'),
          links: Array.isArray(links) ? links.filter((link): link is string => typeof link === 'string') : [],
        })
      }
    }
  }

  const distinct = [...new Set(pages.flatMap((page) => page.hosts))]
  const last = sites.docs[sites.docs.length - 1]
  const chunk = {
    sites: sites.size,
    pages: pages.length,
    hosts: distinct.length,
    nextCursor: sites.size < limit ? null : (last?.id ?? null),
    done: sites.size < limit,
  }
  if (options.dryRun) {
    return {
      ...chunk,
      addresses: 0,
      listed: 0,
      unknown: 0,
      reviewed: 0,
      held: 0,
      heldHostIds: [],
      reapedAddressVerdicts: 0,
    }
  }
  // Once a walk, before its first chunk: addresses' answers long expired.
  const reapedAddressVerdicts = options.cursor
    ? 0
    : await reapExpiredWebRiskUrlVerdicts({ nowMs, firestore })

  // The addresses go with their hosts, and only in 'url' mode.
  const mode = await webRiskLookupMode(nowMs)
  const addressHost = new Map<string, string>()
  if (mode === 'url') {
    for (const link of new Set(pages.flatMap((page) => page.links))) {
      const host = normalizeReputationLink(link)?.host
      if (host) addressHost.set(link, host)
    }
  }
  // Keyed by host for a host's listing, by address for an address's: an
  // address always holds `://`, a host never does.
  const listed = new Map<string, HostReputationHit>()
  const unknown = new Set<string>()
  for (let at = 0; at < distinct.length; at += MAX_REPUTATION_HOSTS_PER_LOOKUP) {
    const group = distinct.slice(at, at + MAX_REPUTATION_HOSTS_PER_LOOKUP)
    const inGroup = new Set(group)
    const urls = [...addressHost].filter(([, host]) => inGroup.has(host)).map(([url]) => url)
    // A later slice of addresses finds the group's answered hosts in memory.
    let offset = 0
    do {
      const answer = await lookupLinkReputation(group, {
        urls: urls.slice(offset, offset + MAX_REPUTATION_URLS_PER_LOOKUP),
        deadlineMs: RECHECK_DEADLINE_MS,
        nowMs,
      })
      for (const hit of answer.hits) listed.set(hit.url ?? hit.host, hit)
      for (const key of answer.unknown) unknown.add(key)
      offset += MAX_REPUTATION_URLS_PER_LOOKUP
    } while (offset < urls.length)
  }

  let reviewed = 0
  let held = 0
  const heldHostIds = new Set<string>()
  for (const page of pages) {
    const hits = [...page.hosts, ...page.links]
      .map((key) => listed.get(key))
      .filter(Boolean) as HostReputationHit[]
    if (!hits.length) continue
    reviewed += 1
    try {
      const outcome = await reviewHostedPage({
        hostId: page.hostId,
        screenId: page.screenId,
        versionId: page.versionId,
        // The page itself is not composed here: the listing is the finding.
        nodes: {},
        extraSignals: webRiskSignals(hits),
        nowMs,
      })
      if (outcome.outcome !== 'serve') {
        held += 1
        heldHostIds.add(page.hostId)
      }
    } catch (error) {
      console.error('[link-reputation] a live page could not be re-reviewed', page.hostId, page.screenId, error)
    }
  }

  return {
    ...chunk,
    addresses: addressHost.size,
    listed: listed.size,
    unknown: unknown.size,
    reviewed,
    held,
    heldHostIds: [...heldHostIds],
    reapedAddressVerdicts,
  }
}
