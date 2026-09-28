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
 * Staff read-back for the platform's mail gateway ledger (AGL-3328).
 *
 * `mailGatewayLedger` counts what each mail gateway — Barracuda, Proofpoint,
 * Mimecast, Google, Microsoft — did with mail from each sending domain the
 * Resend path sends from: refusals, deliveries, the last refusal's
 * diagnostic. Two refusals of a sending domain in thirty days with no
 * delivery beside them hold that domain's bulk mail to everyone behind the
 * gateway. On the platform's own domain or a pooled one that hold reaches
 * every tenant, which is why staff read it here.
 *
 * Server-written and not client-readable, so the page reads it through this
 * route with the Admin SDK. Staff-claim gated, the same shape as
 * `/api/admin/email-health` beside it.
 *
 * Query params:
 *   `view`  absent: the HOLDS — every ledger with a refusal inside the hold's
 *           window (`lastBlockedAtMs >=` its first instant), most recent
 *           refusal first, each with its standing and whether it holds. One
 *           range on one field, served by the automatic index, and complete
 *           up to its stated cap: a hold needs refusals in that window, so
 *           no held ledger can sit outside the read.
 *           `rows`: the table, one page of it, on the staff list wire —
 *           every Filters clause on the Firestore query, ordered by document
 *           id (`utils/mail-gateway-ledger-list-query.ts`).
 */

import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  listRecentlyRefusedMailGatewayLedgers,
  MAIL_GATEWAY_LEDGER_COLLECTION,
  mailGatewayLedgerRow,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../../_lib/invalid-id-token-response'
import { MAIL_GATEWAY_LEDGER_LIST_QUERY } from '../../../../../utils/mail-gateway-ledger-list-query'
import { readStaffListQuery, runStaffListQuery } from '../../../../../utils/server/staff-list-query'

export const dynamic = 'force-dynamic'

/**
 * A ledger as the page reads it: the counts and the standing, without the
 * per-day map the standing was computed from.
 */
function ledgerView(row: NonNullable<ReturnType<typeof mailGatewayLedgerRow>>) {
  return {
    id: row.id,
    sendingDomain: row.sendingDomain,
    gateway: row.gateway,
    shared: row.shared,
    holds: row.holds,
    blocked30: row.standing.blocked30,
    delivered30: row.standing.delivered30,
    blocked: row.blocked,
    delivered: row.delivered,
    lastBlockedAtMs: row.lastBlockedAtMs,
    lastBlockedDetail: row.lastBlockedDetail,
    updatedAtMs: row.updatedAtMs,
  }
}

export type MailGatewayLedgerView = ReturnType<typeof ledgerView>

async function handler(request: Request): Promise<Response> {
  const authorization = request.headers.get('authorization') ?? ''
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

    const url = new URL(request.url)
    const nowMs = Date.now()
    const firestore = firebaseAdmin.app().firestore()

    if (url.searchParams.get('view') === 'rows') {
      const listRequest = readStaffListQuery(Object.fromEntries(url.searchParams))
      if (!listRequest) {
        return Response.json({ error: 'Unreadable filters' }, { status: 400 })
      }
      const page = await runStaffListQuery({
        firestore,
        collection: firestore.collection(MAIL_GATEWAY_LEDGER_COLLECTION),
        declaration: MAIL_GATEWAY_LEDGER_LIST_QUERY,
        request: listRequest,
        row: (doc) => {
          const row = mailGatewayLedgerRow(doc.id, doc.data() as Record<string, unknown>, nowMs)
          // An unreadable document still takes its place in the page, so the
          // cursor walk and the count agree; it reads as an empty row.
          return row
            ? ledgerView(row)
            : { id: doc.id, sendingDomain: doc.id, gateway: null, shared: false, holds: false }
        },
      })
      return Response.json(page, { status: 200 })
    }

    const refused = await listRecentlyRefusedMailGatewayLedgers({}, { firestore, nowMs })
    const rows = refused.rows.map(ledgerView)
    return Response.json(
      {
        generatedAtMs: nowMs,
        sinceMs: refused.sinceMs,
        /** Every ledger with a refusal in the window, most recent first. */
        refused: rows,
        /** The ones holding bulk mail now. */
        held: rows.filter((row) => row.holds),
        /** The read hit its cap; the oldest refusals are the ones missing. */
        truncated: refused.truncated,
      },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Gateway ledger read failed' }, { status: 500 })
  }
}

export { handler as GET }
