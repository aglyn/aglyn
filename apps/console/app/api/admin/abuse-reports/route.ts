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
 * THE STAFF SIDE OF THE ABUSE QUEUE (AGL-1964).
 *
 * `GET` lists reports for `/admin/abuse-reports`; `POST` moves one between
 * statuses. Staff-gated end to end, same shape as
 * `/api/admin/media-quarantine` — this is the surface those two levers
 * finally have an input for.
 *
 * ## Why a route rather than a client Firestore listener
 *
 * `abuseReports` is `allow write: if false` for every client including a
 * staff browser, so a status change cannot be an `updateDoc`. That is
 * deliberate and it is not only about forgery (see the rules comment): moving
 * a report to `actioned` is the moment a lockdown or a quarantine gets its
 * justification, so it has to write the `adminAudit` row in the same act. A
 * bare client write would be a decision with no record of who made it.
 *
 * Reads could have been a listener — the rules allow a staff read — but going
 * through the route keeps one obligation in one place: **redaction**. See
 * below.
 *
 * ## Redaction, and why `support` staff see less than `super`
 *
 * A report carries the reporter's email and, on a DMCA notice, their real
 * legal name — the statute requires a signature, so we hold identity we did
 * not choose to collect. `support` is the read-only tier and the larger one;
 * it can triage every report without knowing who filed it, so it does not get
 * the identity. `super` sees it, because answering a counter-notice means
 * putting the two parties in contact and somebody has to be able to.
 *
 * This is a narrowing rather than a rule the product needed before: nothing
 * in the queue's workflow reads `reporterEmail`, so denying it to the tier
 * that only triages costs nothing.
 *
 * ## What this route deliberately does NOT do
 *
 * It does not delete reports and it does not offer an edit. A queue whose
 * rows can be removed is a queue that cannot answer "did we know, and when" —
 * which is the question that matters if a `*.aglyn.app` block ever gets
 * argued about. `dismissed` is a status, not a deletion.
 */

import * as Aglyn from '@aglyn/aglyn/server'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

/** Rows returned by one listing. The queue is triaged, not browsed. */
const PAGE_SIZE = 100

/** Doc ids are hex from the intake's sha256 — nothing else is addressable. */
const REPORT_ID = /^[a-f0-9]{8,64}$/

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const asMillis = (value: unknown): number | null => {
  if (value && typeof (value as any).toMillis === 'function') {
    try {
      return (value as any).toMillis()
    } catch {
      return null
    }
  }
  return typeof value === 'number' ? value : null
}

/**
 * One row, shaped for the page.
 *
 * `identityVisible` is returned explicitly rather than letting the page infer
 * "no email" from an absent field: a support-tier operator has to be able to
 * tell "this reporter was anonymous" from "you are not allowed to see who
 * this was", because only the first one means there is nobody to reply to.
 */
function rowPayload(
  id: string,
  data: Record<string, unknown>,
  canSeeIdentity: boolean,
) {
  const category = Aglyn.abuseReportCategory(data['category'])
  const dmca = (data['dmca'] ?? null) as Record<string, unknown> | null
  return {
    id,
    reference: asString(data['reference']),
    status: asString(data['status']) ?? 'open',
    category: category?.id ?? asString(data['category']),
    categoryLabel: category?.label ?? null,
    severity: category?.severity ?? asString(data['severity']),
    url: asString(data['url']),
    reportedHostname: asString(data['reportedHostname']),
    hostId: asString(data['hostId']),
    orgId: asString(data['orgId']),
    details: asString(data['details']),
    reportCount: Number(data['reportCount'] ?? 1),
    createdAtMs: asMillis(data['createdAt']),
    updatedAtMs: asMillis(data['updatedAt']),
    identityVisible: canSeeIdentity,
    reporterEmail: canSeeIdentity ? asString(data['reporterEmail']) : null,
    reporterName: canSeeIdentity ? asString(data['reporterName']) : null,
    // Whether a report HAS a contactable reporter is triage information at
    // every tier — it decides whether a follow-up question is even possible —
    // so the boolean is not redacted even when the address is.
    hasReporterContact: Boolean(data['reporterEmail']),
    dmca: dmca
      ? {
          work: asString(dmca['work']),
          // The signature is the reporter's real legal name, so it follows
          // the identity rule rather than the notice rule.
          signature: canSeeIdentity ? asString(dmca['signature']) : null,
          goodFaith: dmca['goodFaith'] === true,
          underPenalty: dmca['underPenalty'] === true,
        }
      : null,
    resolution: asString(data['resolution']),
    resolvedBy: asString(data['resolvedByEmail']),
    resolvedAtMs: asMillis(data['resolvedAt']),
  }
}

async function handler(request: Request): Promise<Response> {
  const {
    method,
    body,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
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
    // Fails CLOSED to `support` on a missing claim, the AGL-495 posture: a
    // token without a role is the least-privileged reader, never the most.
    const actorRole = String(decoded['staffRole'] ?? 'support')
    const canSeeIdentity = actorRole === 'super'
    const firestore = firebaseAdmin.app().firestore()
    const collection = firestore.collection(Aglyn.ABUSE_REPORT_COLLECTION)

    if (method === 'GET') {
      const status = asString(query?.['status'])
      let listing = collection.orderBy('updatedAt', 'desc').limit(PAGE_SIZE)
      if (status && Aglyn.isAbuseReportStatus(status)) {
        listing = collection
          .where('status', '==', status)
          .orderBy('updatedAt', 'desc')
          .limit(PAGE_SIZE)
      }
      const snapshot = await listing.get()
      const reports = snapshot.docs.map((entry) =>
        rowPayload(entry.id, entry.data() as Record<string, unknown>, canSeeIdentity),
      )
      // Counted from the returned page, and SAID so. An operator reading "3
      // urgent" has to know whether that is the whole truth or the first
      // hundred rows' worth of it — a count that silently means the latter is
      // how a queue gets trusted while it is behind.
      const openUrgent = reports.filter(
        (report) => report.status === 'open' && report.severity === 'urgent',
      ).length
      return Response.json(
        {
          reports,
          count: reports.length,
          pageSize: PAGE_SIZE,
          truncated: reports.length === PAGE_SIZE,
          openUrgent,
          identityVisible: canSeeIdentity,
          actorRole,
          statuses: Aglyn.ABUSE_REPORT_STATUSES,
          readAtMs: Date.now(),
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const id = String(body?.['id'] ?? '').trim()
    if (!REPORT_ID.test(id)) {
      return Response.json({ error: 'id is missing or malformed' }, { status: 400 })
    }
    const status = String(body?.['status'] ?? '')
    if (!Aglyn.isAbuseReportStatus(status)) {
      return Response.json(
        {
          error: `status must be one of ${Aglyn.ABUSE_REPORT_STATUSES.join(', ')}`,
        },
        { status: 400 },
      )
    }
    // Free text saying what was done — which lever, which notice number.
    // Required to CLOSE a report and optional otherwise: "actioned" with no
    // note is the row that, months later, nobody can act on.
    const resolution = String(body?.['resolution'] ?? '').trim().slice(0, 2000)
    if ((status === 'actioned' || status === 'dismissed') && !resolution) {
      return Response.json(
        { error: 'Say what you did — a closed report with no note is unreadable later' },
        { status: 400 },
      )
    }

    const ref = collection.doc(id)
    const before = await ref.get()
    if (!before.exists) {
      return Response.json({ error: 'No such report' }, { status: 404 })
    }
    const beforeStatus = asString(before.get('status')) ?? 'open'

    const closing = status === 'actioned' || status === 'dismissed'
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

    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      actorEmail: decoded.email ? String(decoded.email) : null,
      action: `abuseReport.${status}`,
      scope: 'abuseReport',
      target: `${Aglyn.ABUSE_REPORT_COLLECTION}/${id}`,
      before: { status: beforeStatus },
      after: { status },
      // The audit row carries the reported URL, deliberately: it is the fact
      // that makes the row mean anything a year later, and it is not the
      // reporter's data.
      reason: asString(before.get('url')),
      note: resolution || null,
      at: FieldValue.serverTimestamp(),
    })

    // Read back what was written rather than reporting the intent: a
    // `confirmed: false` is an alarm, not a quiet success.
    const after = await ref.get()
    return Response.json(
      {
        report: rowPayload(
          id,
          after.data() as Record<string, unknown>,
          canSeeIdentity,
        ),
        confirmed: asString(after.get('status')) === status,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('abuse report admin route failed', error)
    return Response.json({ error: 'Request failed' }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
