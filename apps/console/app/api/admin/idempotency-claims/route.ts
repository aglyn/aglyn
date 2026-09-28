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
  CLAIM_LIST_QUERY,
  CLAIM_LIST_SORT,
  CLAIM_PENDING_BASE,
  IDEMPOTENCY_CLAIMS_COLLECTION,
  STRANDED_AFTER_MS,
  splitClaimTimeClauses,
} from '../../../../utils/idempotency-claims-list-query'
import {
  readStaffListQuery,
  runStaffListQuery,
} from '../../../../utils/server/staff-list-query'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * STRANDED IDEMPOTENCY CLAIMS (AGL-2329, item 3).
 *
 * `api-idempotency.ts` writes `status: 'pending'` at claim and `'done'` at
 * settlement, and its own docblock describes the failure the field exists
 * for: *"A process killed between the claim and the record leaves a key stuck
 * here"* — the second caller then gets a 409 for as long as the document
 * lives, which is up to `API_IDEMPOTENCY_RETENTION_DAYS`. `status` is
 * precisely the field an operator would query to find those, and nothing
 * queried it. Only `response`, `responseStatus` and `expiresAt` were ever
 * read, and `expiresAt` is a TTL policy rather than code.
 *
 * A stuck key is not an outage and it is not nothing: the customer's retry
 * with a fresh key succeeds, so the symptom is one refused attempt and a
 * support ticket that reads as "it said it was busy". Finding those needs
 * the query this route is.
 *
 * ## The list, and the two numbers
 *
 * `GET` answers the card's list: every Filters-panel clause on one query
 * over `status == 'pending'`, oldest claim first, paged by a cursor in that
 * order (`utils/idempotency-claims-list-query.ts`). Age and State are ranges
 * over `createdAtMs`, the field the list is ordered by, so they stand beside
 * any other clause; the equalities merge with that order through composites
 * the index file carries. Nothing is matched over rows already read.
 *
 * `GET ?view=summary` answers the two figures above it — pending, and
 * stranded — as COUNT aggregations over the same base, so they are totals
 * rather than counts of a window. It also counts pending claims that carry
 * no `createdAtMs`: those have no age, so the claim-time order cannot list
 * them, and the card says how many there are rather than letting them
 * vanish.
 *
 * ⚠️ Read-only, deliberately. Deleting a claim is releasing an idempotency
 * key, and a key released while its request is genuinely in flight is a
 * duplicate charge — the exact failure the whole module fails closed to
 * avoid. An operator who needs one gone can reason about it with what this
 * returns; the route will not do it for them.
 */

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

    const firestore = firebaseAdmin.app().firestore()
    const claims = firestore.collection(IDEMPOTENCY_CLAIMS_COLLECTION)
    const pending = claims.where('status', '==', 'pending')
    const now = Date.now()
    const asked = (query ?? {}) as Record<string, unknown>

    if (asked['view'] === 'summary') {
      // Totals, not a window: COUNT aggregations over the list's own base.
      const [all, timed, stranded] = await Promise.all([
        pending.count().get(),
        pending.where(CLAIM_LIST_SORT.path, '>=', 0).count().get(),
        pending.where(CLAIM_LIST_SORT.path, '<=', now - STRANDED_AFTER_MS).count().get(),
      ])
      const pendingCount = Number(all.data().count ?? 0)
      return Response.json(
        {
          // Reported as separate numbers because they mean different things:
          // a pending claim is normal traffic, a stranded one is a stuck key.
          pending: pendingCount,
          stranded: Number(stranded.data().count ?? 0),
          untimed: Math.max(0, pendingCount - Number(timed.data().count ?? 0)),
          strandedAfterMs: STRANDED_AFTER_MS,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const listed = readStaffListQuery(asked)
    if (!listed) {
      return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    }
    // Age and State are ranges over the claim time, read now.
    const split = splitClaimTimeClauses(listed.clauses, now)
    const page = await runStaffListQuery({
      firestore,
      collection: claims,
      declaration: CLAIM_LIST_QUERY,
      request: { ...listed, clauses: split.rest },
      base: [...CLAIM_PENDING_BASE, ...split.base],
      row: (doc) => {
        const createdAtMs = Number(doc.get('createdAtMs') ?? 0)
        const ageMs = createdAtMs > 0 ? now - createdAtMs : null
        return {
          id: doc.id,
          // `kind` and `scopeId` say WHICH operation is stuck and for whom —
          // "a checkout for org X" rather than "a hex digest". Both were
          // written by the claim and read by nothing.
          kind: doc.get('kind') ?? null,
          scopeId: doc.get('scopeId') ?? null,
          orgId: doc.get('orgId') ?? null,
          createdAtMs: createdAtMs || null,
          ageMs,
          stranded: ageMs != null && ageMs >= STRANDED_AFTER_MS,
        }
      },
    })
    return Response.json(
      { ...page, refused: [...split.refused, ...page.refused] },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/idempotency-claims]', error)
    return Response.json(
      { error: 'Idempotency claim lookup failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
