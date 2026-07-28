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
import {
  addPlan,
  emptyTotals,
  planMemberScopeTokens,
  planScopeStamp,
  SCOPED_COLLECTIONS,
} from '../../../../utils/server/backfill-scope'

/** Orgs per invocation; resume with `?afterOrg=<lastOrgId>`. */
const ORGS_PER_RUN = 25
/** Firestore's hard cap on writes in one batched commit. */
const BATCH_LIMIT = 500
/** Ceiling on the legacy-dataset scan; a hit is reported, never swallowed. */
const LEGACY_SCAN_LIMIT = 5000

/**
 * One-shot scope backfill (AGL-1040) — staff-only, resumable, idempotent.
 *
 * Stamps `visibleTo: ['org']` on every existing dataset, media asset and
 * media folder, and recomputes `scopeTokens` on every member doc
 * (AGL-1038). Org-wide is exactly today's behavior, so the run is a no-op
 * semantically: nobody loses access, nobody gains it. Narrowing is then an
 * explicit act by an org admin in AGL-1044/AGL-1045.
 *
 * THIS MUST FINISH BEFORE AGL-1039/1041/1042 DEPLOY. Both the rules'
 * `visibleTo.hasAny(...)` and the client's `array-contains-any` fail closed
 * on a missing field, so enforcement shipped first would make every dataset
 * and image in the product vanish at once.
 *
 * `dryRun` is the default — GET, or POST without `dryRun: false`, reports
 * the plan and writes nothing. Deliberately the safe direction: the totals
 * are meant to be read by a human before any bytes move.
 *
 * Dataset records are NOT stamped: a record inherits its dataset's scope
 * (AGL-1041). Legacy host-scoped datasets — `hosts/{hostId}/datasets`, the
 * pre-AGL-237 fallback — are counted and left alone; see
 * `ScopeBackfillTotals.legacyHostDatasets`.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
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
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    // Writing requires an explicit opt-out of the dry run, on a POST.
    const requested = (body as { dryRun?: unknown } | undefined)?.dryRun ??
      query['dryRun']
    const dryRun =
      method === 'GET' ||
      requested === undefined ||
      !(requested === false || requested === '0' || requested === 'false')

    const db = app.firestore()
    const byId = firebaseAdmin.firestore.FieldPath.documentId()
    const afterOrg = String(query['afterOrg'] ?? '')
    let orgsQuery = db.collection('orgs').orderBy(byId).limit(ORGS_PER_RUN + 1)
    if (afterOrg) {
      orgsQuery = db
        .collection('orgs')
        .orderBy(byId)
        .startAfter(afterOrg)
        .limit(ORGS_PER_RUN + 1)
    }
    const orgSnapshot = await orgsQuery.get()
    const more = orgSnapshot.docs.length > ORGS_PER_RUN
    const orgDocs = more
      ? orgSnapshot.docs.slice(0, ORGS_PER_RUN)
      : orgSnapshot.docs

    const totals = emptyTotals()
    const pending: Array<[FirebaseFirestore.DocumentReference, object]> = []

    for (const orgDoc of orgDocs) {
      totals.orgs += 1
      const orgRef = orgDoc.ref

      const memberSnapshot = await orgRef.collection('members').get()
      const memberPlan = planMemberScopeTokens(
        memberSnapshot.docs.map((doc) => ({
          $id: doc.id,
          ...(doc.data() as Record<string, unknown>),
        })),
      )
      addPlan(totals, 'members', memberPlan)
      for (const write of memberPlan.writes) {
        pending.push([orgRef.collection('members').doc(write.id), write.data])
      }

      for (const collection of SCOPED_COLLECTIONS) {
        const snapshot = await orgRef.collection(collection).get()
        const plan = planScopeStamp(
          snapshot.docs.map((doc) => ({
            id: doc.id,
            data: doc.data() as { visibleTo?: unknown },
          })),
        )
        addPlan(totals, collection, plan)
        for (const write of plan.writes) {
          pending.push([orgRef.collection(collection).doc(write.id), write.data])
        }
      }
    }

    // Only on the first page: the count is org-independent, so repeating
    // it per page would scan every dataset in the product N times.
    const legacy = afterOrg ? null : await countLegacyHostDatasets(db)
    if (legacy) totals.legacyHostDatasets = legacy.count

    if (!dryRun) {
      for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
        const batch = db.batch()
        for (const [ref, data] of pending.slice(i, i + BATCH_LIMIT)) {
          batch.set(ref, data, { merge: true })
        }
        await batch.commit()
      }
    }

    return Response.json({
      dryRun,
      totals,
      planned: pending.length,
      // Surfaced rather than swallowed: a truncated scan means the legacy
      // count is a floor, not the answer, and the migrate-or-delete call
      // in AGL-1040 needs to know which it is reading.
      legacyScanTruncated: legacy?.truncated ?? null,
      // Null when this page finished the collection; feed it back as
      // `?afterOrg=` otherwise. A run that plans nothing and returns a null
      // cursor is the acceptance criterion.
      nextAfterOrg: more ? orgDocs[orgDocs.length - 1].id : null,
    })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Scope backfill failed' }, { status: 500 })
  }
}

/**
 * Counts docs still living under the pre-AGL-237 `hosts/{hostId}/datasets`
 * fallback. Reported so the migrate-or-delete call in AGL-1040 is made with
 * the number in front of it; if this is 0 the host branch of
 * `orgDataCollectionForHost` is dead code, not a migration.
 */
async function countLegacyHostDatasets(
  db: FirebaseFirestore.Firestore,
): Promise<{ count: number; truncated: boolean }> {
  // `select()` with no fields fetches document refs only — the parent path
  // is all this needs, and it keeps a whole-product scan cheap.
  const snapshot = await db
    .collectionGroup('datasets')
    .select()
    .limit(LEGACY_SCAN_LIMIT + 1)
    .get()
  const truncated = snapshot.docs.length > LEGACY_SCAN_LIMIT
  const count = snapshot.docs
    .slice(0, LEGACY_SCAN_LIMIT)
    .filter((doc) => doc.ref.parent.parent?.parent.id === 'hosts').length
  return { count, truncated }
}

export const GET = handler
export const POST = handler
