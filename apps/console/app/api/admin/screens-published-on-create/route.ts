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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * AGL-3021 — which live pages were published by the act of creating them?
 *
 * `GET /api/admin/screens-published-on-create`. Staff-gated exactly like
 * `/api/admin/member-state-exposure` and `/api/admin/overview`: the `staff`
 * custom claim, the same trust anchor as the Firestore rules.
 *
 * ## It reports; it does not act
 *
 * Creating a screen used to publish it in the same second, so every site
 * built through `CREATE NEW SCREEN` has pages whose publication nobody ever
 * chose. Unpublishing them by sweep is the one thing that must not happen:
 * the overwhelming majority were built out afterwards and are load-bearing
 * pages people want public, and taking them down would be a self-inflicted
 * outage in the name of fixing an accident. So this answers the question and
 * stops, and a person decides what, if anything, to do with each row.
 *
 * ## What "published by creating it" looks like in the data
 *
 * The old chain was three calls: `/api/hosts/resources` stamps `createdAt`
 * and `updatedAt` server-side, `/api/hosts/versions` mints the first version,
 * and then `publishScreenRoute` merge-sets `publishedAt` on the screen. So
 * the signature is `publishedAt` arriving within a round trip or two of
 * `createdAt` — measured at one second on 2026-09-03, and given
 * {@link CREATED_PUBLISHED_WINDOW_MS} of room here because three sequential
 * network calls on a slow connection are not always one second.
 *
 * That alone is not enough to act on, so each row carries the evidence for
 * the SECOND half of the question — has anything happened to it since:
 *
 * - `screenTouched` — the screen document's own `updatedAt` moved after it
 *   was published. Screen Properties, SEO, a rename.
 * - `contentTouched` — the current version's `updatedAt` moved after it was
 *   published. This is the besigner save, i.e. somebody actually built the
 *   page.
 * - `blankCanvas` — the current version still holds nothing but the empty
 *   canvas root the create drawer writes. The strongest evidence of all, and
 *   the actual harm the issue names: a blank page, live, on the public
 *   internet.
 *
 * A reader wanting the shortest list should read `blankCanvas` rows first.
 * Nothing here is a verdict: a page can be blank for a day because somebody
 * is coming back to it tomorrow.
 *
 * ## Bounded, and it says when it was
 *
 * Bounded like every other staff aggregate. `truncated: true` means the list
 * is a LOWER BOUND — raise the cap rather than reading it as complete.
 */

/**
 * How close `publishedAt` has to sit to `createdAt` to read as "the create
 * did it". The measured gap was ONE second; three sequential API calls can
 * take longer than that, and a deliberate publish essentially never happens
 * within seconds of a create because somebody has to build the page first.
 */
const CREATED_PUBLISHED_WINDOW_MS = 30_000
/**
 * Slack the other way, for the two comparisons against `publishedAt`. A
 * publish is a merge-set on the screen and the tenant's revalidate can follow
 * it, so a stamp a beat later is still "nothing happened since".
 */
const TOUCHED_TOLERANCE_MS = 5_000

const HOST_CAP = 2000
const SCREENS_PER_HOST_CAP = 400
/** How many hosts are swept at once. Bounded, not unlimited — see `sweepHost`. */
const HOST_CONCURRENCY = 8
/** Version reads are one per candidate, so the candidates are capped too. */
const VERSION_READ_CAP = 1500

/** Epoch millis out of a Timestamp, Date, ISO string or number. */
function millis(value: unknown): number | null {
  if (!value) return null
  const stamp = value as { toMillis?: () => number }
  if (typeof stamp.toMillis === 'function') return stamp.toMillis()
  const parsed = new Date(value as string | number).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

const iso = (value: unknown): string | null => {
  const ms = millis(value)
  return ms === null ? null : new Date(ms).toISOString()
}

/**
 * Is this version still the empty canvas the create drawer writes?
 *
 * Answers `null` rather than `false` when it cannot tell. Node maps are
 * msgpack `Bytes` once they have been through the compressor, and a reader
 * that cannot decode one must not report the page as built — "not known" and
 * "built" are different answers and only one of them is honest here.
 */
function blankCanvas(nodes: unknown): boolean | null {
  if (nodes === undefined || nodes === null) return null
  if (typeof nodes !== 'object') return null
  // A `Bytes`/Buffer, i.e. a compressed map. Decoding it would pull the
  // codec into a staff route to answer a hint; the timestamps already carry
  // the weight, and compression itself means the map has been written by the
  // besigner at least once.
  if (ArrayBuffer.isView(nodes) || Buffer.isBuffer(nodes)) return false
  const map = nodes as Record<string, unknown>
  const ids = Object.keys(map)
  if (ids.length !== 1) return false
  const root = map[ids[0]] as { nodes?: unknown } | undefined
  return Array.isArray(root?.nodes) && root.nodes.length === 0
}

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const firestore = firebaseAdmin.app().firestore()
    const hostSnap = await firestore.collection('hosts').limit(HOST_CAP).get()

    const rows: Array<Record<string, unknown>> = []
    let screensTruncated = false
    let versionsTruncated = false
    let versionReads = 0

    const sweepHost = async (host: (typeof hostSnap.docs)[number]) => {
      // A screen the map does not name is not live whatever its
      // `publishedAt` says, and only a live page is a decision anybody has
      // to make.
      const routingMap = (host.get('screens') ?? {}) as Record<string, string>

      const screenSnap = await host.ref
        .collection('screens')
        .limit(SCREENS_PER_HOST_CAP)
        .get()
      if (screenSnap.size >= SCREENS_PER_HOST_CAP) screensTruncated = true

      for (const screen of screenSnap.docs) {
        if (screen.get('deletedAt')) continue
        const path = routingMap[screen.id]
        if (path === undefined || path === null) continue

        const createdAt = millis(screen.get('createdAt'))
        const publishedAt = millis(screen.get('publishedAt'))
        if (createdAt === null || publishedAt === null) continue
        const gapMs = publishedAt - createdAt
        if (gapMs < 0 || gapMs > CREATED_PUBLISHED_WINDOW_MS) continue

        const screenUpdatedAt = millis(screen.get('updatedAt'))
        const versionId = screen.get('versionId')

        let contentUpdatedAt: number | null = null
        let isBlank: boolean | null = null
        if (typeof versionId === 'string' && versionId) {
          if (versionReads >= VERSION_READ_CAP) {
            versionsTruncated = true
          } else {
            versionReads += 1
            const version = await screen.ref
              .collection('versions')
              .doc(versionId)
              .get()
            if (version.exists) {
              contentUpdatedAt = millis(version.get('updatedAt'))
              isBlank = blankCanvas(version.get('nodes'))
            }
          }
        }

        rows.push({
          orgId: host.get('orgId') ?? null,
          hostId: host.id,
          hostName: host.get('displayName') ?? host.get('subdomain') ?? null,
          screenId: screen.id,
          displayName: screen.get('displayName') ?? null,
          kind: screen.get('kind') ?? null,
          routePath: path,
          createdAt: iso(screen.get('createdAt')),
          publishedAt: iso(screen.get('publishedAt')),
          /** How long after the create the publish landed. One second, mostly. */
          gapMs,
          createdBy: screen.get('createdBy') ?? null,
          screenUpdatedAt: iso(screen.get('updatedAt')),
          contentUpdatedAt:
            contentUpdatedAt === null
              ? null
              : new Date(contentUpdatedAt).toISOString(),
          screenTouched:
            screenUpdatedAt === null
              ? null
              : screenUpdatedAt > publishedAt + TOUCHED_TOLERANCE_MS,
          contentTouched:
            contentUpdatedAt === null
              ? null
              : contentUpdatedAt > publishedAt + TOUCHED_TOLERANCE_MS,
          blankCanvas: isBlank,
        })
      }
    }

    /**
     * Hosts in parallel, a few at a time.
     *
     * One `screens` page per host and one version read per candidate is a
     * fan-out that a sequential loop turns into a 504 at any real platform
     * size — the failure this route's own `maxDuration` note warns about,
     * and a report that times out is indistinguishable from "we cannot say".
     * Batched rather than unbounded: a `Promise.all` over every host at once
     * would open thousands of concurrent Firestore streams and fail a
     * different way.
     *
     * A host whose routing map names nothing has no live page, so it is
     * dropped before the reads rather than read and discarded.
     */
    const live = hostSnap.docs.filter(
      (host) => Object.keys((host.get('screens') ?? {}) as object).length > 0,
    )
    for (let index = 0; index < live.length; index += HOST_CONCURRENCY) {
      await Promise.all(live.slice(index, index + HOST_CONCURRENCY).map(sweepHost))
    }

    // Blank first, then untouched, then most recent — the order somebody
    // reading this to decide something would put them in themselves.
    rows.sort((a, b) => {
      const rank = (row: Record<string, unknown>) =>
        row['blankCanvas'] === true ? 0 : row['contentTouched'] === false ? 1 : 2
      const byRank = rank(a) - rank(b)
      if (byRank !== 0) return byRank
      return String(b['publishedAt'] ?? '').localeCompare(
        String(a['publishedAt'] ?? ''),
      )
    })

    return Response.json({
      rows,
      total: rows.length,
      blankAndUntouched: rows.filter(
        (row) => row['blankCanvas'] === true && row['contentTouched'] !== true,
      ).length,
      untouchedSincePublish: rows.filter((row) => row['contentTouched'] === false)
        .length,
      truncated:
        hostSnap.size >= HOST_CAP || screensTruncated || versionsTruncated,
      window: { createdPublishedMs: CREATED_PUBLISHED_WINDOW_MS },
      generatedAt: new Date().toISOString(),
      // Stated in the payload, not only in the docs: whoever reads this as
      // JSON must not have to come back here for the caveat.
      scope:
        'Screens that are LIVE (named by their host routing map) and whose ' +
        'publishedAt landed within the window of their createdAt — the ' +
        'signature of the create path that published before AGL-3021.',
      caveat:
        'A row is not a verdict. Most of these were built out afterwards and ' +
        'are pages people want public; unpublishing by sweep would be an ' +
        'outage. Read blankCanvas rows first, and decide one at a time.',
    })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    // Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/screens-published-on-create]', error)
    return Response.json(
      { error: 'Screens published on create report failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
/**
 * The fan-out is real: one `hosts` page, a `screens` page per host, and one
 * version read per candidate. Worst case at the caps above is a few thousand
 * round trips, which is the same window every other bulk staff route asks for
 * (`run-erasures`, `backfill-scope`, `audit-archive`, `member-state-exposure`,
 * all 60). A report that 504s is indistinguishable from "we cannot say".
 */
export const maxDuration = 60
export { handler as GET }
