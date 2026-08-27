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
  nameSearchKey,
  nameSearchReversed,
  nameSearchToken,
} from '@aglyn/aglyn/app-utils/name-search'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_PAGE_SIZE_OPTIONS,
} from '@aglyn/shared-ui-jsx/const/table-pagination'

/**
 * The staff list's page, when the request does not name one.
 *
 * It named nothing before, so the size menu on the console side had no
 * request to travel in. Clamped to the shared options rather than trusted:
 * a page nobody reads is still a page somebody pays for.
 */
const PAGE_SIZE = TABLE_PAGE_SIZE_DEFAULT

const resolvePageSize = (raw: unknown): number => {
  const asked = Math.floor(Number(raw))
  if (!Number.isFinite(asked)) return PAGE_SIZE
  return TABLE_PAGE_SIZE_OPTIONS.includes(asked) ? asked : PAGE_SIZE
}

/**
 * Staff organization list (AGL-878). The page used to read `collection('orgs')`
 * from the client, but that list is gated by the `isStaff() || isOrgMember()`
 * rule and rides App Check — and in practice returned a non-deterministic
 * subset (orgs flickered in and out). Reading it here via the Admin SDK
 * bypasses both, so staff reliably see EVERY org. Ordered by document id — a
 * stable ordering that drops no doc (an `orderBy` on a field some org docs lack
 * would silently hide them). Cursor pagination: `?after=<lastDocId>`.
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
    const after = String(query['after'] ?? '')
    const byId = firebaseAdmin.firestore.FieldPath.documentId()
    // One extra row tells us whether a next page exists.
    const pageSize = resolvePageSize(query['pageSize'])
    /*
     * SEARCH RUNS ON THE SERVER, or it is not a search (AGL-693).
     *
     * The staff list is paged, so a filter applied in the browser sees the
     * rows on screen and nothing else — ten of them by default. That reads
     * as "no such organization" for every organization past the first page,
     * which is the answer a search must never give wrongly.
     *
     * `array-contains` over `nameTokens` — the word-prefix tokens the write
     * path prepared — so a reader finds "Acme Coffee" by typing "coffee" and
     * not only by typing "acme". A prefix range over `nameLower` was the
     * first shape here and it was anchored at the START of the whole name,
     * which is the wrong end for a search box: the word somebody remembers is
     * rarely the first one.
     *
     * What it still cannot do is match MID-word — "offee" is a prefix of no
     * word — and a multi-word query narrows by its first word only, because
     * Firestore permits one `array-contains` per query. Both are the honest
     * edge of doing this without a search service; see `nameSearchTokens`.
     *
     * ⚠️ Ordering by `nameLower` DROPS documents that lack it, and the
     * `array-contains` drops any that lack `nameTokens`. Both fields are
     * written by every `name` writer and backfilled by
     * `tools/scripts/backfill-name-lower.mjs` — an organization missing
     * either would be invisible to search while still listing normally.
     */
    const search = nameSearchToken(String(query['search'] ?? ''))
    const orgsRef = db.collection('orgs')
    /*
     * The cursor stays a DOCUMENT ID in both modes, and is resolved to a
     * snapshot before it is used.
     *
     * A search page is ordered by `nameLower`, so a raw string cursor would
     * be compared against that field rather than the id — and `nameLower` is
     * not unique. Two organizations sharing a name would make
     * `startAfter('acme')` skip whichever of them came second, silently, on
     * a staff list whose whole job is that nobody is missing.
     *
     * `startAfter(snapshot)` compares every ordering field INCLUDING the
     * `__name__` Firestore appends to all of them, so it is exact whatever
     * the ordering is. An unresolvable cursor restarts at the top rather
     * than throwing.
     */
    const afterDoc = after
      ? await orgsRef
          .doc(after)
          .get()
          .catch(() => null)
      : null
    /*
     * The column filter panel, answered by the QUERY (AGL-693).
     *
     * The panel was switched off for a while because `filterMode="server"`
     * stops the grid applying anything itself, and the handler read only the
     * quick search — so the funnel set filters nobody honoured. The fix is
     * not to hide it but to answer it, for the operators Firestore can
     * actually serve:
     *
     *   contains    → `array-contains` over the word-prefix tokens
     *   equals      → equality on `nameLower`
     *   startsWith  → a range over `nameLower`
     *   endsWith    → a range over `nameReversed`, the same query read
     *                 backwards
     *   isAnyOf     → `in`, which Firestore caps at 30 values
     *
     * The operators NOT offered are the ones no index can answer: a
     * mid-string `contains`, and anything negated over a text field. The
     * console lists exactly what it can do rather than offering a menu where
     * some entries silently return nothing.
     *
     * Ordering is chosen so no new composite index is needed: a range orders
     * by the field it ranges over, and an equality orders by document id,
     * both of which the automatic single-field indexes serve. Only
     * `array-contains` + `orderBy(nameLower)` needs a composite, and it has
     * one.
     */
    const filterField = String(query['filterField'] ?? '')
    const filterOp = String(query['filterOp'] ?? '')
    const filterValue = String(query['filterValue'] ?? '')

    const rangeOver = (field: string, prefix: string) =>
      orgsRef.orderBy(field).startAt(prefix).endAt(`${prefix}\uf8ff`)

    const filtered = (): FirebaseFirestore.Query | null => {
      if (!filterField || !filterOp || !filterValue.trim()) return null
      if (filterField === 'name') {
        if (filterOp === 'contains') {
          const token = nameSearchToken(filterValue)
          return token
            ? orgsRef
                .where('nameTokens', 'array-contains', token)
                .orderBy('nameLower')
            : null
        }
        if (filterOp === 'equals') {
          return orgsRef
            .where('nameLower', '==', nameSearchKey(filterValue))
            .orderBy(byId)
        }
        if (filterOp === 'startsWith') {
          return rangeOver('nameLower', nameSearchKey(filterValue))
        }
        if (filterOp === 'endsWith') {
          return rangeOver('nameReversed', nameSearchReversed(filterValue))
        }
        return null
      }
      const path = filterField === 'subscription' ? 'subscription.status' : filterField
      if (filterField !== 'plan' && filterField !== 'subscription') return null
      if (filterOp === 'equals') {
        return orgsRef.where(path, '==', filterValue.trim()).orderBy(byId)
      }
      if (filterOp === 'isAnyOf') {
        // Firestore caps `in` at 30. Truncating silently would drop values a
        // reader picked, so the extras are refused by the client's own menu
        // rather than lost here.
        const values = filterValue
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .slice(0, 30)
        return values.length ? orgsRef.where(path, 'in', values).orderBy(byId) : null
      }
      return null
    }

    const base =
      filtered() ??
      (search
        ? orgsRef.where('nameTokens', 'array-contains', search).orderBy('nameLower')
        : orgsRef.orderBy(byId))
    const ref = (
      afterDoc?.exists ? base.startAfter(afterDoc) : base
    ).limit(pageSize + 1)
    const snapshot = await ref.get()
    const docs = snapshot.docs
    const more = docs.length > pageSize
    const pageDocs = more ? docs.slice(0, pageSize) : docs
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
        plan: data['plan'] ?? null,
        entitlements: data['entitlements'] ?? null,
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
        hasMore: more,
        nextCursor: more ? pageDocs[pageDocs.length - 1].id : null,
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
