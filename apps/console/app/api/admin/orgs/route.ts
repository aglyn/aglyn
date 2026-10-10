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
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  readStaffListQuery,
  runStaffListQuery,
} from '../../../../utils/server/staff-list-query'
import { ORG_LIST_QUERY } from '../../../../utils/org-list-query'
import {
  LAPSED_SUSPENSIONS_NOTICE,
  asksAboutSuspension,
  settleLapsedSuspensions,
  suspensionInForce,
} from '../../../../utils/server/suspended-flag'

/**
 * Staff organization list (AGL-878). The page used to read `collection('orgs')`
 * from the client, but that list is gated by the `isStaff() || isOrgMember()`
 * rule and rides App Check — and in practice returned a non-deterministic
 * subset (orgs flickered in and out). Reading it here via the Admin SDK
 * bypasses both, so staff reliably see EVERY org.
 *
 * The staff list wire (`utils/server/staff-list-query.ts`):
 * `?filters=<JSON>&search=<words>&cursor=<path>&pageSize=<n>` →
 * `{ orgs, nextCursor, hasMore, refused, notices }`.
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
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const db = app.firestore()
    /*
     * EVERY CLAUSE AND THE SEARCH ON THE QUERY (AGL-3321).
     *
     * The staff list is paged, so a filter or a search applied to the rows a
     * read already fetched answers "no such organization" for everything past
     * them — the one answer this list must never give wrongly. So the Filters
     * panel's clauses and the search word are planned onto ONE Firestore
     * query by `planListQuery` against `ORG_LIST_QUERY`, the declaration the
     * page's panel is built from too, and nothing is matched afterwards. A
     * clause the plan cannot hold comes back in `refused` and is not applied
     * at all; the page names it.
     *
     * The search is `array-contains` over `nameTokens` — every prefix of every
     * word of the name — so "coffee" finds "Acme Coffee". It cannot match
     * mid-word, and a multi-word search narrows by its first word (one array
     * clause per query); the plan says so in `notices`.
     *
     * The order is the document id — an `orderBy` on a field some
     * organizations lack would silently hide them — unless Created is ranged
     * over, which then leads the order. The cursor is the full path of the
     * last document read, resolved to a snapshot, so it is exact in either
     * order. `after` is the same cursor under the name the staff pickers'
     * page walk (`fetchAllPages`) sends it by.
     */
    const listRequest = readStaffListQuery({
      ...query,
      cursor: query['cursor'] ?? query['after'],
    })
    if (!listRequest) {
      return Response.json({ error: 'Unreadable filters' }, { status: 400 })
    }
    /*
     * Suspended is an equality on the stored flag, and a timed suspension
     * lapses with no write — so before a query asks about the flag, every
     * lapsed one is cleared, and the answer is the one for this moment
     * (`utils/server/suspended-flag.ts`).
     */
    const settled = asksAboutSuspension(listRequest.clauses)
      ? await settleLapsedSuspensions(db.collection('orgs'))
      : null
    const page = await runStaffListQuery({
      firestore: db,
      collection: db.collection('orgs'),
      declaration: ORG_LIST_QUERY,
      request: listRequest,
      row: (docSnap) => docSnap,
    })
    const pageDocs = page.rows
    // Serialize timestamps to the `{ seconds }` shape the page reads.
    const ts = (value: unknown) =>
      value && typeof (value as { seconds?: unknown }).seconds === 'number'
        ? { seconds: (value as { seconds: number }).seconds }
        : null
    // `subscription` moved to `orgs/{orgId}/billing/stripe` (AGL-1028). One
    // `getAll` for the page rather than a get per row — the list is paginated,
    // so this is a single bounded round trip. Missing docs come back as
    // non-existent snapshots, which is exactly the pre-backfill case; the org
    // doc's own inline `subscription` is the fallback below.
    const billingSnaps = pageDocs.length
      ? await db.getAll(
          ...pageDocs.map((docSnap) =>
            docSnap.ref.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID),
          ),
        )
      : []
    const billingByOrgId = new Map<string, any>()
    billingSnaps.forEach((snap, index) => {
      if (snap.exists) billingByOrgId.set(pageDocs[index].id, snap.data())
    })
    const orgs = pageDocs.map((docSnap) => {
      const data = docSnap.data()
      const subscription =
        billingByOrgId.get(docSnap.id)?.subscription ?? data['subscription']
      return {
        $id: docSnap.id,
        name: data['name'] ?? null,
        slug: data['slug'] ?? null,
        // The Owner UID column, which Manage columns can show.
        ownerUid: data['ownerUid'] ?? null,
        plan: data['plan'] ?? null,
        // Carries the staff plan comp (AGL-3034), which the row resolves.
        entitlements: data['entitlements'] ?? null,
        // The status mirror the resolver reads FIRST — without it the row's
        // effective plan leaned on the billing doc alone.
        billingStatus: data['billingStatus'] ?? null,
        // The two fields that make an org read as Enterprise off a lower base
        // plan (AGL-1110). They were projected away, so `isEnterpriseOrg` on
        // the staff list could only ever see the base plan and the table said
        // "agency" for an org whose own Billing page said "Enterprise".
        enterprise: data['enterprise'] === true,
        subscription: subscription
          ? {
              status: subscription?.status ?? null,
              customMonthlyUsd: subscription?.customMonthlyUsd ?? null,
            }
          : null,
        createdAt: ts(data['createdAt']),
        // In force NOW — the chip and the Suspended filter give one answer.
        suspended: suspensionInForce(data['suspendedAt'], data['suspendedUntilMs']),
        suspendedAt: ts(data['suspendedAt']),
        suspendedReason: data['suspendedReason'] ?? null,
        // Lockdown-core fields (AGL-1501/1505): the suspend dialog prefills
        // its reason code and notice from these — projecting them away would
        // silently reset every re-suspend to `manual` with no message.
        suspendedReasonCode: data['suspendedReasonCode'] ?? null,
        suspendedMessage: data['suspendedMessage'] ?? null,
        erasureRequestedAt: ts(data['erasureRequestedAt']),
      }
    })
    return Response.json(
      {
        orgs,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        refused: page.refused,
        notices: settled?.bounded
          ? [...page.notices, LAPSED_SUSPENSIONS_NOTICE]
          : page.notices,
      },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Organization list failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
