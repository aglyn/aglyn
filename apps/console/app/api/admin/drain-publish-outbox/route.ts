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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  isPublishOutboxDue,
  isPublishOutboxStalled,
  PUBLISH_OUTBOX_COLLECTION,
  PUBLISH_OUTBOX_DRAIN_LIMIT,
  PUBLISH_OUTBOX_DRAIN_TAG,
  PUBLISH_OUTBOX_MAX_PATHS,
  PUBLISH_OUTBOX_STALE_MS,
  sanitizePublishOutboxPaths,
} from '../../../../constants/publish-outbox'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { postTenantRevalidate } from '../../../../utils/server/tenant-revalidate'

/**
 * DRAIN THE PUBLISH OUTBOX (AGL-2575).
 *
 * Publishing a screen is a client Firestore write, so the cache-drop announce
 * has nothing server-side to hang off and AGL-2573 left it as a `fetch` from
 * the publishing tab. That fetch retries a refusing tenant under an 8s
 * budget — but a budget only runs while the tab does. A tab closed, slept or
 * disconnected right after the write leaves the durable half of the publish
 * landed and the announce landed nowhere, and the live page then serves its
 * old HTML until `PUBLISHED_SITE_DATA_TTL_SECONDS` (3600) lapses.
 *
 * The publish seam now writes that announce down, in the same batch as the
 * routing-map write. This is the other end: it fires the pending ones
 * server-side, across process boundaries, for as long as it takes.
 *
 * ## It cannot publish anything, and that is deliberate
 *
 * Everything here is a CACHE DROP. It never moves a version pointer, never
 * touches the routing map, and never writes a `screens` document — the
 * publish it is finishing already happened, atomically, in the browser. So
 * draining the same entry twice drops the same tag twice, which is a no-op,
 * and there is no ordering between two runs that can produce a state a single
 * run could not. Idempotence here is a property of what the route is allowed
 * to touch rather than of a claim it takes out.
 *
 * ## What it does with an entry it cannot drain
 *
 * It KEEPS it. AGL-2573's finding was that a successful announce logged
 * nothing, so an empty log read identically to a working platform for eleven
 * days; deleting an entry whose announce never landed would rebuild that
 * exact shape one level up. A failed entry keeps its attempt count and its
 * last reason, stops being retried once it has spent its attempts, and is
 * counted as stalled in the telemetry line and in the response body.
 *
 * A GET reports and writes nothing; the cron POSTs.
 */
async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders, query, body } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'The publish outbox drain is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // AGL-1955 — the mark `/api/health/crons` reads to notice this job going
  // AWAY. Stamped on the invocation, not on the work, so a run that finds
  // nothing to do still proves the schedule is alive; POST only, because a
  // human's GET is not the scheduler and must not stand in for it.
  if (method === 'POST') await recordCronBeat('drain-publish-outbox')

  const dryRun = isCronDryRun({ method, query, body })
  const startedAt = Date.now()
  const firestore = firebaseAdmin.app().firestore()

  try {
    /*
     * Ordered oldest-first, and filtered on NOTHING.
     *
     * A drained entry is deleted, so the collection holds pending entries
     * only and there is no state to select on. That is what keeps this to a
     * bare `orderBy` — Firestore's automatic single-field indexes serve it,
     * where any `where` + `orderBy` pair would need a declared composite one
     * and index deployment is a separately-credentialed step this must not
     * depend on.
     */
    const snapshot = await firestore
      .collection(PUBLISH_OUTBOX_COLLECTION)
      .orderBy('createdAt')
      .limit(PUBLISH_OUTBOX_DRAIN_LIMIT)
      .get()

    /*
     * ONE ANNOUNCE PER HOST, not per entry.
     *
     * A tenant that refused for an hour leaves one entry per publish behind
     * it, and firing them one at a time would answer an outage with a burst
     * against the deployment that just came back. Merging is safe because the
     * payload is a set of addresses: dropping `/a` and `/b` together is the
     * same act as dropping each alone, in either order.
     */
    interface HostWork {
      paths: Set<string>
      refs: FirebaseFirestore.DocumentReference[]
    }
    const work = new Map<string, HostWork>()
    let stalled = 0
    let settling = 0
    let malformed = 0
    let oldestPendingAgeMs = 0
    let stalePending = 0

    for (const entry of snapshot.docs) {
      const createdAt = entry.get('createdAt') as
        | FirebaseFirestore.Timestamp
        | undefined
      const ageMs = createdAt?.toMillis
        ? startedAt - createdAt.toMillis()
        : Number.POSITIVE_INFINITY
      if (Number.isFinite(ageMs)) {
        oldestPendingAgeMs = Math.max(oldestPendingAgeMs, ageMs)
        if (ageMs >= PUBLISH_OUTBOX_STALE_MS) stalePending += 1
      }
      if (isPublishOutboxStalled(Number(entry.get('attempts') ?? 0))) {
        stalled += 1
        continue
      }
      if (!isPublishOutboxDue(ageMs)) {
        // The publishing tab's own announce is still plausibly in flight, and
        // it deletes this entry when it lands. Racing it would double the
        // tenant traffic of every ordinary publish to buy nothing.
        settling += 1
        continue
      }
      const hostId = String(entry.get('hostId') ?? '').trim()
      // A path out of an outbox entry is a client-written value, trusted no
      // further than one posted to `/api/screens/revalidate` — which
      // validates the same three things.
      const paths = sanitizePublishOutboxPaths(
        Array.isArray(entry.get('paths')) ? (entry.get('paths') as unknown[]) : [],
      )
      if (!hostId || !paths.length) {
        // Nothing to drop and nothing that will become droppable later. Left
        // in place rather than deleted: an entry the rules should have
        // refused is worth being able to find.
        malformed += 1
        continue
      }
      const existing = work.get(hostId)
      if (existing) {
        for (const path of paths) existing.paths.add(path)
        existing.refs.push(entry.ref)
      } else {
        work.set(hostId, { paths: new Set(paths), refs: [entry.ref] })
      }
    }

    let drained = 0
    let failed = 0
    const hosts: string[] = []

    for (const [hostId, hostWork] of work) {
      hosts.push(hostId)
      if (dryRun) continue
      const hostSnapshot = await firestore
        .collection('hosts')
        .doc(hostId)
        .get()
      const subdomain = String(hostSnapshot.get('subdomain') ?? '').trim()
      if (!hostSnapshot.exists || !subdomain) {
        // The site is gone. There is no cache left to drop and no run that
        // will ever succeed, so this is the one case where releasing the
        // entries loses no evidence anybody could act on.
        for (const ref of hostWork.refs) await ref.delete().catch(() => undefined)
        drained += hostWork.refs.length
        continue
      }
      const result = await postTenantRevalidate({
        subdomain,
        hostId,
        paths: [...hostWork.paths].slice(0, PUBLISH_OUTBOX_MAX_PATHS),
        // The custom domain is a SECOND cache key for the same page
        // (AGL-1152) and it is the one visitors actually use.
        cname: String(hostSnapshot.get('cname') ?? '') || undefined,
      })
      if (result.reason === 'ok') {
        for (const ref of hostWork.refs) await ref.delete().catch(() => undefined)
        drained += hostWork.refs.length
        continue
      }
      failed += hostWork.refs.length
      for (const ref of hostWork.refs) {
        await ref
          .set(
            {
              attempts: firebaseAdmin.firestore.FieldValue.increment(1),
              lastAttemptAtMs: Date.now(),
              lastReason: result.reason,
            },
            { merge: true },
          )
          .catch(() => undefined)
      }
    }

    /*
     * ONE TELEMETRY LINE PER RUN, including a run that found nothing.
     *
     * The AGL-2573 lesson stated as a rule: a signal that is only written on
     * failure cannot distinguish a healthy platform from a job that stopped
     * being called, and that ambiguity is what let an eleven-day outage pass
     * for calm. `stalePending` is the number worth alerting on — entries old
     * enough that no tab and no earlier sweep managed to drop them.
     */
    console.log(
      JSON.stringify({
        tag: PUBLISH_OUTBOX_DRAIN_TAG,
        dryRun,
        examined: snapshot.size,
        hosts: hosts.length,
        drained,
        failed,
        stalled,
        settling,
        malformed,
        stalePending,
        oldestPendingAgeMs,
        durationMs: Date.now() - startedAt,
      }),
    )

    return Response.json(
      {
        ok: true,
        dryRun,
        examined: snapshot.size,
        hosts,
        drained,
        failed,
        stalled,
        settling,
        malformed,
        stalePending,
        oldestPendingAgeMs,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error('[publish-outbox] drain failed', error)
    return Response.json(
      { error: 'Publish outbox drain failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
