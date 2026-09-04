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

import { writeCronBeat, type PluginApiHandler } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  materializeDynamicList,
  type DynamicListCursor,
} from '@aglyn/tenant-data-admin'

/**
 * The scheduled sweep that keeps dynamic lists fresh
 * (`docs/specs/email-overhaul.md` §3e).
 *
 * A dynamic list stores a rule and materializes into its `members`
 * subcollection; without something re-running the rule, "dynamic" means
 * "evaluated once at creation". This is that something: it rides the existing
 * fifteen-minute Cloud Scheduler fast-cron beside the scheduled-campaign
 * processor, so a dynamic list is never more than about fifteen minutes stale
 * and no new scheduler job is provisioned.
 *
 * ## It chunks, because `sweepConsoleCron` will follow a cursor
 *
 * The caller in `cloud/functions` drives a route to completion by following
 * `nextCursor`, so this answers `{ done, nextCursor }` rather than trying to
 * sweep every list in one invocation. Two cursors are in play and they are
 * different things: `nextCursor` here is a position in the LIST of lists, and
 * the `evaluationCursor` stored on each list document is a position inside
 * one list's own scan. Both resume; neither is allowed to shorten a
 * membership.
 *
 * ## A failing list must not stop the sweep
 *
 * Each list is evaluated in its own try. One org's malformed rule, deleted
 * segment or missing host would otherwise stop every list after it in
 * document order from ever being evaluated — the failure would be invisible
 * and would land on whichever customers sort last.
 */

/** Dynamic lists evaluated per invocation. */
const LISTS_PER_CHUNK = 20

export const listsMaterializeHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res
      .status(501)
      .json({ error: 'Dynamic lists are not configured (CRON_SECRET).' })
  }
  if (req.headers['x-cron-secret'] !== cronSecret) {
    return res.status(401).json({ error: 'Unauthenticated' })
  }

  const firestore = firebaseAdmin.app().firestore()
  /*
   * The mark `/api/health/crons` reads to notice this job going away
   * (AGL-1955). Nothing downstream ages when a dynamic list stops being
   * re-evaluated — a stale membership looks exactly like a fresh one whose
   * population happens not to have changed — so the invocation itself is the
   * only honest thing to watch.
   */
  await writeCronBeat(firestore, 'lists-materialize')

  const cursor = String((req.body as Record<string, unknown>)?.['cursor'] ?? '')
  let query = firestore
    .collectionGroup('lists')
    .where('kind', '==', 'dynamic')
    .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
    .limit(LISTS_PER_CHUNK)
  /*
   * A DocumentReference, not the raw string. A collection-group cursor on
   * `documentId()` is compared against the FULL resource path, and a bare id
   * would either be rejected or silently compared against the wrong thing —
   * so the cursor travels as a path and is turned back into a reference here.
   */
  if (cursor) query = query.startAfter(firestore.doc(cursor))

  const lists = await query.get()
  const results: Array<Record<string, unknown>> = []
  let lastPath = ''
  for (const listDoc of lists.docs) {
    lastPath = listDoc.ref.path
    const hostId = String(listDoc.get('hostId') ?? '')
    if (!hostId) {
      // A dynamic list with no host has no silos to draw from. Reported
      // rather than thrown: it is a data problem on one list, and the sweep
      // has other lists to get to.
      results.push({ list: listDoc.ref.path, error: 'no hostId' })
      continue
    }
    try {
      const outcome = await materializeDynamicList({
        listRef: listDoc.ref,
        hostId,
        rule: listDoc.get('rule'),
        resume: (listDoc.get('evaluationCursor') as DynamicListCursor) ?? null,
      })
      results.push({ list: listDoc.ref.path, ...outcome })
    } catch (error) {
      console.error('dynamic list materialize failed', listDoc.ref.path, error)
      results.push({ list: listDoc.ref.path, error: 'evaluation failed' })
    }
  }

  const done = lists.size < LISTS_PER_CHUNK
  return res.status(200).json({
    ok: true,
    evaluated: results.length,
    results,
    done,
    // The caller refuses to loop on `done:false` with no cursor, which is the
    // one shape that would re-read the same chunk for ever.
    nextCursor: done ? null : lastPath,
  })
}
