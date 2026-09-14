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
  aiUsageMonthKeys,
  aiUsageMonthWithinRetention,
  aiUsageShare,
  csvCell,
  pluginRequestFromWeb,
  type AiUsageByUserMonth,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import {
  readOrgAiUsageByUser,
  readUserAiUsageMonths,
} from '@aglyn/tenant-data-admin/server/ai-usage-by-user'
import { FieldValue } from 'firebase-admin/firestore'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  AI_USAGE_CSV_HEADER,
  AI_USAGE_EXPORT_ROWS_HEADER,
  aiUsageCsvLine,
  toAiUsageWireRow,
  type OrgAiUsageTableWire,
  type UserAiUsageWire,
} from '../usage/ai-usage-wire'

// lockdown-423: exempt — a READ-ONLY usage report that writes nothing to the
// workspace, the posture of ai/billing/credits beside it: a billing-locked
// owner working out who spent the credits needs this table more, not less.

/**
 * WHO IS GENERATING WHAT, PER SITE (AGL-2928) — the customer's read of the
 * per-user AI usage rollup.
 *
 * ## Three questions, one route
 *
 * - **The month's table** (`orgId`, `month`): every current member with a
 *   month document, dearest first, with each person's share of the
 *   workspace's spend. Gated on `billing.view`, the Usage page's gate, and
 *   served as JSON or — `format=csv` — as a streamed file.
 * - **One person** (`uid`): that person's months, newest first, for the
 *   member detail card. The subject reads their own; anyone else needs
 *   `billing.view` or `org.auditLog`, which is the team page's gate and the
 *   pair the security rules admit for the same documents.
 * - **One site** (`hostId`): the table with each row's credits ON THAT SITE
 *   beside it, for the site's collaborators card — the agency question,
 *   "which client site's collaborators spend".
 *
 * ## No dollar figure crosses this boundary
 *
 * The month document carries `estCostUsd`, our provider bill. The rows here
 * carry credits and a SHARE, and the share is computed on the dollars
 * server-side (`aiUsageShare`) so it is exact — a roster's credits each round
 * up, the org's round once — without the dollars ever being serialized.
 *
 * ## The month bound
 *
 * `month` must be inside the retention window (`aiUsageMonthKeys`): a
 * request for an older month is refused rather than answered empty, because
 * "nothing for that month" and "that month has been reaped" must not read
 * the same on a report somebody exports.
 */

/** The most months one person's card is handed. */
const MAX_USER_MONTHS = 13

const json = (body: unknown, status: number) => Response.json(body, { status })

async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405)

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  const params = (query ?? {}) as Record<string, unknown>
  const orgId = String(params['orgId'] ?? '').trim()
  if (!orgId) return json({ error: 'Missing orgId' }, 400)
  const now = new Date()
  const months = aiUsageMonthKeys(now)
  const month = String(params['month'] ?? months[0]).trim()
  if (!aiUsageMonthWithinRetention(month, now)) {
    return json(
      {
        error:
          `AI usage is kept for ${months.length} months; ` +
          `ask for one of ${months[months.length - 1]} through ${months[0]}.`,
      },
      400,
    )
  }
  const subjectUid = String(params['uid'] ?? '').trim()
  const hostId = String(params['hostId'] ?? '').trim()
  const format = String(params['format'] ?? 'json').trim()

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const member = membership?.member
    if (!member && !staff) return json({ error: 'Not found' }, 404)

    const firestore = firebaseAdmin.app().firestore()

    if (subjectUid) {
      // One person. Their own months are theirs to read; anyone else's need
      // the Usage page's permission or the team page's.
      const own = subjectUid === decoded.uid && Boolean(member)
      if (!own && !staff) {
        const allowed =
          (await memberHasOrgPermission(orgId, member, 'billing.view')) ||
          (await memberHasOrgPermission(orgId, member, 'org.auditLog'))
        if (!allowed) return json({ error: 'billing.view required' }, 403)
      }
      const limit = Math.min(
        MAX_USER_MONTHS,
        Math.max(1, Math.floor(Number(params['limit'] ?? 2) || 2)),
      )
      const rows = await readUserAiUsageMonths(firestore, orgId, subjectUid, limit)
      const orgRef = firestore.collection('orgs').doc(orgId)
      const rollups = rows.length
        ? await firestore.getAll(
            ...rows.map((row) => orgRef.collection('assistUsage').doc(row.month)),
          )
        : []
      const wire: UserAiUsageWire = {
        uid: subjectUid,
        months: rows.map((row: AiUsageByUserMonth, index) => ({
          month: row.month,
          credits: row.credits,
          share: aiUsageShare(
            row.estCostUsd,
            Number(rollups[index]?.get('estCostUsd') ?? 0),
          ),
          requests: row.requests,
          refusals: row.refusals,
          byKind: row.byKind,
          byHost: row.byHost,
        })),
      }
      return json(wire, 200)
    }

    // The table, which is about everyone: the Usage page's permission.
    if (!staff && !(await memberHasOrgPermission(orgId, member, 'billing.view'))) {
      return json({ error: 'billing.view required' }, 403)
    }
    const usage = await readOrgAiUsageByUser(firestore, orgId, month)
    const rows = usage.rows.map((row) => toAiUsageWireRow(row, hostId))
    if (hostId) {
      rows.sort(
        (a, b) =>
          (b.hostCredits ?? 0) - (a.hostCredits ?? 0) || b.credits - a.credits,
      )
    }

    if (format !== 'csv') {
      const table: OrgAiUsageTableWire = {
        month,
        months,
        orgCredits: usage.orgCredits,
        rows,
      }
      return json(table, 200)
    }

    /*
     * The file, streamed: the header first, then the rows in pages, so a
     * roster of any size arrives without being held whole. The row count
     * travels in a header the client checks the body against — a stream
     * that dies halfway yields a well-formed shorter file, and nothing about
     * the bytes says it is short.
     */
    const encoder = new TextEncoder()
    const PAGE = 200
    let cursor = 0
    let headed = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!headed) {
          headed = true
          controller.enqueue(encoder.encode(AI_USAGE_CSV_HEADER.map(csvCell).join(',')))
          return
        }
        if (cursor < rows.length) {
          const page = rows.slice(cursor, cursor + PAGE)
          cursor += page.length
          controller.enqueue(
            encoder.encode(`\n${page.map(aiUsageCsvLine).join('\n')}`),
          )
          return
        }
        controller.enqueue(encoder.encode('\n'))
        controller.close()
      },
    })

    // Ids and counts only, never content: a report about people leaving
    // the platform is worth a row; who was in it is the workspace's own.
    void firestore
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'ai-usage.exported',
        target: `orgs/${orgId}/aiUsageByUser`,
        before: null,
        after: { month, rows: rows.length, hostId: hostId || null },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="ai-usage-${month}.csv"`,
        [AI_USAGE_EXPORT_ROWS_HEADER]: String(rows.length),
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993). Null
    // for anything else, so a real failure keeps the answer below.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/usage] read failed', orgId, error)
    return json({ error: 'AI usage unavailable' }, 500)
  }
}

export { handler as GET }
