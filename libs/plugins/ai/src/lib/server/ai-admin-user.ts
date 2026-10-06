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
import { readUserAiUsageMonths } from '../usage/ai-usage-by-user'
import { freeAccountUsageRef } from '../usage/assist-free-taste'
import { assistUsageMonth } from '../usage/assist-usage'
import { composeStaffAiAccountAllowance } from '../usage/staff-org-ai'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'

/**
 * ONE ACCOUNT'S AI USAGE ACROSS ORGANIZATIONS (AGL-2928) — the staff user
 * page's card, beside `admin/users/detail`.
 *
 * Walks the account's reverse index of memberships, the same read the detail
 * route makes, and lists each workspace's months for this uid newest first.
 * A membership walk rather than a collection-group query, so the card works
 * the moment it ships and needs no index deployed first; a workspace the
 * person has left is not listed, and its months expire on the retention
 * window.
 *
 * Read only, and not audited: the card loads with every open of the staff
 * user page, the same reason the org card writes no row.
 */

/** The most workspaces one account is walked across. */
const MAX_ORGS = 50

export interface StaffUserAiUsageRow {
  orgId: string
  orgName: string | null
  slug: string | null
  month: string
  credits: number
  requests: number
  refusals: number
}

async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const uid = String(query.uid ?? '').trim()
  if (!uid) return Response.json({ error: 'Missing uid' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const firestore = firebaseAdmin.app().firestore()
    const reverse = await firestore
      .collection('users')
      .doc(uid)
      .collection('orgs')
      .limit(MAX_ORGS)
      .get()

    const rows: StaffUserAiUsageRow[] = []
    for (const entry of reverse.docs) {
      const months = await readUserAiUsageMonths(firestore, entry.id, uid)
      for (const month of months) {
        rows.push({
          orgId: entry.id,
          orgName: typeof entry.get('orgName') === 'string' ? String(entry.get('orgName')) : null,
          slug: typeof entry.get('slug') === 'string' ? String(entry.get('slug')) : null,
          month: month.month,
          credits: month.credits,
          requests: month.requests,
          refusals: month.refusals,
        })
      }
    }
    // Newest month first, dearest workspace first within it.
    rows.sort(
      (a, b) => b.month.localeCompare(a.month) || b.credits - a.credits,
    )
    // The account's own Free allowance this month (AGL-2925), which every
    // free workspace this person owns draws on and which staff can give
    // credits back to from this page (AGL-3595).
    const month = assistUsageMonth()
    const allowanceSnap = await freeAccountUsageRef(firestore, uid, month).get()
    const allowance = composeStaffAiAccountAllowance(
      uid,
      month,
      allowanceSnap.exists ? (allowanceSnap.data() ?? null) : null,
    )
    return Response.json(
      { uid, rows, truncated: reverse.size >= MAX_ORGS, allowance },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/admin/user]', error)
    return Response.json({ error: 'AI usage lookup failed' }, { status: 500 })
  }
}

export { handler as GET }
