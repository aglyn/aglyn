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
import * as Aglyn from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The staff end of the marketplace report button (AGL-2310).
 *
 * `libs/plugins/marketplace/src/lib/server/report.ts` has written
 * `marketplaceReports` since the button shipped — `reason`, `reporterUid`,
 * `listingName`, `publisherOrgId`, `targetType`, and `status: 'open'` — and
 * NOTHING read it. No `collectionGroup`, no admin surface, no cron. The
 * Firestore rules grant staff read, but rules are not a reader: every report a
 * user filed was stored, acknowledged, and unreachable, and nothing ever moved
 * one off `open` because no queue displayed it.
 *
 * The contrast that made it an omission rather than a design decision:
 * `abuseReports` has the identical shape AND a real staff queue. This mirrors
 * that queue's contract deliberately — list, transition, an `adminAudit` row
 * per transition — rather than inventing a second vocabulary for the same act.
 *
 * ## The reporter's identity is a super-tier fact
 *
 * `reporterUid` follows the same rule the abuse queue applies to a reporter's
 * email: `support` triages without it. A uid is pseudonymous rather than
 * personal, but it joins to a real account in one hop, and the read-only tier
 * has no reason to make that hop. `reporterKnown` stays visible to everyone,
 * because the useful distinction for triage is a report with somebody behind
 * it versus one without — not who.
 */

const REPORT_ID = /^[a-f0-9]{40}$/

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

const asMillis = (value: unknown): number | null => {
  const candidate = value as { toMillis?: () => number }
  if (typeof candidate?.toMillis === 'function') {
    const millis = candidate.toMillis()
    return Number.isFinite(millis) ? millis : null
  }
  return null
}

/**
 * Staff below `super` triage without the reporter's account (AGL-1964's rule,
 * applied here for the same reason).
 *
 * A MISSING claim resolves to `support`, never to `super`. Failing open would
 * hand identity to any staff token minted before the RBAC claim existed.
 */
const identityVisible = (decoded: Record<string, unknown>): boolean =>
  String(decoded['staffRole'] ?? 'support') === 'super'

async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const collection = firestore.collection('marketplaceReports')
    const showIdentity = identityVisible(decoded as Record<string, unknown>)

    if (method === 'GET') {
      /**
       * Ordered by `updatedAt`, filtered by status in JS.
       *
       * A `where('status','==',…)` beside this ordering is a composite index,
       * and a composite deploys by hand outside the git pipeline — the queue
       * would have shipped ahead of its index and thrown FAILED_PRECONDITION
       * on the one surface that exists to be read. The window is small enough
       * that filtering it here costs nothing.
       */
      const requested = String(query?.['status'] ?? '')
      const snapshot = await collection
        .orderBy('updatedAt', 'desc')
        .limit(200)
        .get()
        // Reports written before `updatedAt` existed still have to appear —
        // an ordering that silently drops rows is how a queue reads as empty.
        .catch(() => collection.limit(200).get())

      const reports = snapshot.docs
        .map((doc) => {
          const data = doc.data() as Record<string, unknown>
          return {
            id: doc.id,
            status: asString(data['status']) ?? 'open',
            targetType: asString(data['targetType']) ?? 'listing',
            listingId: asString(data['listingId']),
            listingName: asString(data['listingName']),
            publisherOrgId: asString(data['publisherOrgId']),
            reviewUid: showIdentity ? asString(data['reviewUid']) : null,
            // The report IS the reason. Everything else on the row is context
            // for it, which is why it is never redacted by tier.
            reason: asString(data['reason']),
            // Told apart from a redacted one, so `support` can still see that
            // there IS somebody to follow up with (AGL-1964's distinction).
            reporterKnown: Boolean(asString(data['reporterUid'])),
            reporterUid: showIdentity ? asString(data['reporterUid']) : null,
            resolution: asString(data['resolution']),
            resolvedByEmail: asString(data['resolvedByEmail']),
            createdAtMs: asMillis(data['createdAt']),
            updatedAtMs: asMillis(data['updatedAt']),
          }
        })
        .filter((report) => !requested || report.status === requested)

      return Response.json(
        {
          reports,
          actorRole: showIdentity ? 'super' : 'support',
          identityVisible: showIdentity,
          statuses: Aglyn.ABUSE_REPORT_STATUSES,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const id = String((body as any)?.['id'] ?? '').trim()
    if (!REPORT_ID.test(id)) {
      return Response.json({ error: 'id is missing or malformed' }, { status: 400 })
    }
    const status = String((body as any)?.['status'] ?? '')
    if (!Aglyn.isAbuseReportStatus(status)) {
      return Response.json(
        {
          error: `status must be one of ${Aglyn.ABUSE_REPORT_STATUSES.join(', ')}`,
        },
        { status: 400 },
      )
    }
    // Required to CLOSE, optional otherwise — the abuse queue's rule, for the
    // abuse queue's reason: "actioned" with no note is the row that, months
    // later, nobody can act on or defend.
    const resolution = String((body as any)?.['resolution'] ?? '')
      .trim()
      .slice(0, 2000)
    const closing = status === 'actioned' || status === 'dismissed'
    if (closing && !resolution) {
      return Response.json(
        {
          error:
            'Say what you did — a closed report with no note is unreadable ' +
            'later',
        },
        { status: 400 },
      )
    }

    const ref = collection.doc(id)
    const before = await ref.get()
    if (!before.exists) {
      return Response.json({ error: 'No such report' }, { status: 404 })
    }
    const beforeStatus = asString(before.get('status')) ?? 'open'
    const FieldValue = firebaseAdmin.firestore.FieldValue

    await ref.set(
      {
        status,
        resolution: resolution || null,
        resolvedByUid: closing ? decoded.uid : null,
        resolvedByEmail: closing && decoded.email ? String(decoded.email) : null,
        resolvedAt: closing ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    /**
     * The audit row carries BOTH statuses.
     *
     * A row saying only "someone set this to dismissed" cannot answer the
     * question anyone actually asks later — what was it before, and who
     * decided. `before`/`after` here match the abuse queue's shape so the two
     * queues read the same way in one audit log.
     */
    await firestore.collection('adminAudit').add({
      action: 'marketplace-report-status',
      actorUid: decoded.uid,
      actorEmail: decoded.email ? String(decoded.email) : null,
      targetType: 'marketplaceReport',
      targetId: id,
      listingId: asString(before.get('listingId')),
      before: { status: beforeStatus },
      after: { status, resolution: resolution || null },
      at: FieldValue.serverTimestamp(),
    })

    return Response.json(
      { ok: true, id, status, previousStatus: beforeStatus },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Marketplace reports failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
