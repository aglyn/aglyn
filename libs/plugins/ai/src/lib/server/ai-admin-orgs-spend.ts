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
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { assistUsageMonth } from '../usage/assist-usage'
import {
  parseStaffOrgIds,
  type StaffOrgsAiSpendWire,
} from '../usage/staff-orgs-ai-spend'

/**
 * THE STAFF ORGANIZATIONS LIST'S AI SPEND (AGL-2984).
 *
 * `GET /api/ai/admin/orgs-spend?orgIds=a,b,…` answers this month's provider
 * spend for each org the list's page shows — the figures its AI spend column
 * draws and sorts by. Staff-gated exactly as `/api/ai/admin/org` is, and
 * read-only.
 *
 * ## The read
 *
 * ONE `getAll` over each named org's usage document for the current UTC
 * month, the key the usage writer files spend under — a single bounded
 * round trip for the page, never a read per row, and at most
 * `STAFF_ORGS_AI_SPEND_MAX_IDS` ids per request.
 *
 * An org with no document for the month answers `null`, never `0`, and a
 * read that FAILS answers `null` for every id: the list renders with the
 * column blank rather than failing because this read did.
 *
 * No `adminAudit` row: the answer is one dollar figure per workspace, with
 * nothing in it about a person.
 */
async function handler(request: Request): Promise<Response> {
  const {
    method,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken)
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const asked = parseStaffOrgIds(query['orgIds'])
  if (asked.error) {
    return Response.json({ error: asked.error }, { status: 400 })
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

    const month = assistUsageMonth()
    const db = app.firestore()
    const orgs = db.collection('orgs')
    const snapshots = await db
      .getAll(
        ...asked.orgIds.map((orgId) =>
          orgs.doc(orgId).collection('assistUsage').doc(month),
        ),
      )
      .catch((error: unknown) => {
        console.error('[ai/admin/orgs-spend] read failed', error)
        return null
      })
    const body: StaffOrgsAiSpendWire = {
      month,
      // `fromEntries`, so an id is always an own key of the answer.
      spendUsd: Object.fromEntries(
        asked.orgIds.map((orgId, index) => [
          orgId,
          spendOf(snapshots?.[index]),
        ]),
      ),
    }
    return Response.json(body, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/admin/orgs-spend]', error)
    return Response.json({ error: 'AI spend lookup failed' }, { status: 500 })
  }
}

/** A month document's spend, or `null` when there is no document to read. */
function spendOf(
  snapshot: FirebaseFirestore.DocumentSnapshot | undefined,
): number | null {
  if (!snapshot?.exists) return null
  const cost = Number(snapshot.get('estCostUsd') ?? 0)
  return Number.isFinite(cost) ? cost : null
}

export { handler as GET }
