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

import { FieldValue } from 'firebase-admin/firestore'
import {
  permissionRefusal,
  checkRateLimit,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForUser,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  lockdownRefusal,
  memberHasPermissionOnHost,
  rateLimitHeaders,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { logAiEditApplied } from '../activity/ai-activity'
import {
  ASSIST_EDIT_DOCUMENT_KINDS,
  ASSIST_EDIT_OP_COUNT_WORDS,
  assistEditDocumentOf,
  type AssistEditAppliedReport,
  type AssistEditDocumentKind,
} from '../model/assist-edit'
import { sanitiseId } from './assist-view-context'

/**
 * The applied-edit record (AGL-2906, AGL-2929): the panel reports that the
 * author applied a proposal in their editor, and this door writes the
 * `ai.edit.applied` row to the site's activity log, attributed to them.
 *
 * The edits were applied in the author's own editor, as unsaved changes;
 * nothing here can see them or repeat them, and nothing here writes a
 * document. What this door checks is that the report stands on a proposal
 * the server issued: the exchange exists under the named org, the same
 * member asked it about the same site, and its signal records edit
 * operations proposed from the besigner route of the same document. A
 * report that fails any of those writes nothing. The counts are held to the
 * operation words and to what that turn proposed, and a second report for
 * one exchange writes no second row.
 *
 * The ladder: 405 → 401 → 400 → 403 email unverified → 403 not a member →
 * 403 the role lacks `ai.generate` (staff pass) → 404 `release_ai_generative`
 * off (staff preview) → 423 lockdown → 429 rate → 404 no such exchange of
 * the caller's → 409 the exchange proposed no such edit. No reservation and
 * no provider: a record of an act costs no credits.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The report, held to its own alphabets; null when anything is missing or malformed. */
export function parseEditAppliedReport(payload: unknown): AssistEditAppliedReport | null {
  const body = isRecord(payload) ? payload : {}
  // Ids are document path segments here, so a slash is refused rather than
  // followed into a subcollection.
  const orgId = sanitiseId(String(body['orgId'] ?? ''))
  const hostId = sanitiseId(String(body['hostId'] ?? ''))
  const exchangeId = sanitiseId(String(body['exchangeId'] ?? ''))
  const documentId = sanitiseId(String(body['documentId'] ?? ''))
  const versionId = sanitiseId(String(body['versionId'] ?? ''))
  const documentKind = body['documentKind'] as AssistEditDocumentKind
  if (!orgId || !hostId || !exchangeId || !documentId || !versionId) return null
  if (!ASSIST_EDIT_DOCUMENT_KINDS.includes(documentKind)) return null
  const opCounts: Record<string, number> = {}
  for (const [word, count] of Object.entries(isRecord(body['opCounts']) ? body['opCounts'] : {})) {
    if (!ASSIST_EDIT_OP_COUNT_WORDS.includes(word)) continue
    const parsed = Number(count)
    if (Number.isInteger(parsed) && parsed > 0) opCounts[word] = parsed
  }
  if (!Object.keys(opCounts).length) return null
  return { orgId, hostId, exchangeId, documentKind, documentId, versionId, opCounts }
}

type RecordVerdict = 'recorded' | 'duplicate' | 'unknown' | 'no-proposal' | 'too-many'

async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    payload = null
  }
  const report = parseEditAppliedReport(payload)
  if (!report) {
    return Response.json({ error: 'Missing or malformed report' }, { status: 400 })
  }

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const resolved = await getOrgForUser(decoded.uid, report.orgId)
    if (!resolved || resolved.orgId !== report.orgId) {
      return Response.json(
        { error: 'You are not a member of that organization' },
        { status: 403 },
      )
    }
    if (
      !staff &&
      !(await memberHasPermissionOnHost(report.orgId, report.hostId, resolved.member, 'ai.generate'))
    ) {
      return permissionRefusal('ai.generate')
    }
    if (!staff && !(await isServerReleaseFlagOnForOrg('release_ai_generative', report.orgId))) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: (resolved.org ?? {}) as Record<string, unknown>,
    })
    if (locked) return locked
    const rate = checkRateLimit(`assist-edit-applied:${decoded.uid}`, {
      limit: 30,
      windowMs: 60_000,
    })
    if (!rate.allowed) {
      return Response.json(
        { error: 'Too many requests — slow down a moment', reason: 'rate' },
        { status: 429, headers: rateLimitHeaders(rate) },
      )
    }

    const firestore = app.firestore()
    const orgRef = firestore.collection('orgs').doc(report.orgId)
    const exchange = await orgRef.collection('assistExchanges').doc(report.exchangeId).get()
    const asked = exchange.exists ? (exchange.data() as Record<string, unknown> | undefined) : undefined
    if (!asked || asked['uid'] !== decoded.uid || (asked['hostId'] ?? null) !== report.hostId) {
      return Response.json({ error: 'Unknown exchange' }, { status: 404 })
    }

    const signalRef = orgRef.collection('assistSignals').doc(report.exchangeId)
    const verdict = await firestore.runTransaction(async (tx): Promise<RecordVerdict> => {
      const signal = await tx.get(signalRef)
      const data = signal.exists ? (signal.data() as Record<string, unknown> | undefined) : undefined
      if (!data) return 'unknown'
      const proposed = Number(data['editOps'] ?? 0)
      const document = assistEditDocumentOf(String(data['route'] ?? ''))
      if (
        !(proposed > 0) ||
        !document ||
        document.kind !== report.documentKind ||
        document.documentId !== report.documentId
      ) {
        return 'no-proposal'
      }
      const applied = Object.values(report.opCounts).reduce((sum, count) => sum + count, 0)
      if (applied > proposed) return 'too-many'
      if (data['editAppliedAt']) return 'duplicate'
      tx.update(signalRef, { editAppliedAt: FieldValue.serverTimestamp() })
      return 'recorded'
    })

    switch (verdict) {
      case 'unknown':
        return Response.json({ error: 'Unknown exchange' }, { status: 404 })
      case 'no-proposal':
        return Response.json(
          { error: 'That exchange proposed no edit to this document' },
          { status: 409 },
        )
      case 'too-many':
        return Response.json(
          { error: 'More edits reported than that exchange proposed' },
          { status: 409 },
        )
      case 'duplicate':
        return Response.json({ ok: true, duplicate: true }, { status: 200 })
      case 'recorded':
        await logAiEditApplied(
          report.hostId,
          { uid: decoded.uid, email: decoded.email ?? null },
          {
            type: report.documentKind,
            id: report.documentId,
            versionId: report.versionId,
            opCounts: report.opCounts,
          },
        )
        return Response.json({ ok: true }, { status: 200 })
    }
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The edit could not be recorded' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
