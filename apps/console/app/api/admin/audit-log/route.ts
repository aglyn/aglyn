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
import { ADMIN_AUDIT_LIST_QUERY } from '../../../../utils/admin-audit-list-query'
import {
  AUDIT_EXPORT_CEILING,
  auditLogCsv,
  auditLogRow,
  type AuditLogRow,
} from '../../../../utils/admin-audit-view'
import { readStaffListQuery, runStaffListQuery } from '../../../../utils/server/staff-list-query'

/**
 * The staff audit log for the apps (AGL-3667): `adminAudit`, newest first, with
 * the page's own filters (action, action group, who, target, target type, site,
 * scope, a date range), search and paging, each row worded the way the page
 * words it. `view=csv` is the compliance export, from the newest entries the
 * same filters reach.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const listRequest = readStaffListQuery(query)
    if (!listRequest) return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    const firestore = firebaseAdmin.app().firestore()
    const collection = firestore.collection('adminAudit')

    if (String(query['view'] ?? '') === 'csv') {
      const page = await runStaffListQuery({
        firestore,
        collection,
        declaration: ADMIN_AUDIT_LIST_QUERY,
        request: { ...listRequest, cursor: null, pageSize: AUDIT_EXPORT_CEILING },
        row: (doc) => doc.data() as Record<string, unknown>,
      })
      return Response.json({
        csv: auditLogCsv(page.rows),
        filename: 'admin-audit.csv',
        rows: page.rows.length,
        capped: page.hasMore,
        note: page.hasMore
          ? `Exported from the newest ${AUDIT_EXPORT_CEILING.toLocaleString('en-US')} entries these filters reach; there are more. Narrow the dates to export the rest.`
          : `Exported ${page.rows.length.toLocaleString('en-US')} entries.`,
        refused: page.refused,
      })
    }

    const page = await runStaffListQuery<AuditLogRow>({
      firestore,
      collection,
      declaration: ADMIN_AUDIT_LIST_QUERY,
      request: listRequest,
      row: (doc) => auditLogRow(doc.id, doc.data() as Record<string, unknown>),
    })
    return Response.json(page, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/audit-log] failed', error)
    return Response.json({ error: 'The audit log could not be read' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
