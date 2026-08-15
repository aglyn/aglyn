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
  resolveUidsToPeople,
} from '@aglyn/tenant-data-admin'

/**
 * Serializes Firestore values for JSON, preserving the `{ seconds }` shape the
 * staff page already reads timestamps as.
 *
 * Recursive on purpose: `subscription`, `discount` and `contact` are nested
 * maps that carry timestamps of their own, and a top-level-only pass would ship
 * them as `{}` — a field that renders blank rather than absent, which is the
 * exact class of lie this endpoint exists to remove.
 */
function serialize(value: unknown): unknown {
  if (value == null) return value ?? null
  if (typeof value !== 'object') return value
  if (typeof (value as { seconds?: unknown }).seconds === 'number') {
    return { seconds: (value as { seconds: number }).seconds }
  }
  if (Array.isArray(value)) return value.map(serialize)
  // A DocumentReference or other non-plain Firestore object has no meaning to
  // the page; a path string is at least readable and never a broken render.
  if ((value as { path?: unknown }).path && (value as { id?: unknown }).id) {
    return String((value as { path: unknown }).path)
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = serialize(entry)
  }
  return out
}

/**
 * Staff organization detail, served from the Admin SDK (AGL-937).
 *
 * The page used to read `orgs/{orgId}` from the client through the
 * `isStaff() || isOrgMember()` rule. Two things are wrong with that on a staff
 * surface, and only one of them was mitigated:
 *
 * * **The cache.** A `noDocument` tombstone made every org-derived field render
 *   absent — plan, slug, owner, Stripe customer, created date, entitlements and
 *   the whole edit form — indistinguishable from a real empty org. Reproduced
 *   locally, where the tombstone survived reloads. `useConfirmedDoc` (AGL-928)
 *   made that state honest rather than silent; it did not remove it.
 * * **The rule.** A staff page must not depend on a rule the staff user's own
 *   membership can flip. Reading here bypasses both the rule and App Check, so
 *   staff see the org whether or not they belong to it.
 *
 * Returns the org document WHOLE rather than a projection. The detail page
 * reads eighteen distinct fields and renders an edit form over more; a
 * projection here would starve one of them, and the failure would look like a
 * blank field rather than a missing key — precisely how these bugs hide.
 *
 * A genuine 404 now means the org really is absent, which is the property the
 * client read could never offer.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const orgId = String(query['orgId'] ?? '')
  if (!orgId) {
    return Response.json({ error: 'Missing orgId' }, { status: 400 })
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
    const orgRef = db.collection('orgs').doc(orgId)
    // One round trip for both. The billing doc is new (AGL-1028), so an org
    // predating it legitimately has none — `getAll` returns a non-existent
    // snapshot for that, which is what the org doc's inline `subscription`
    // below is the fallback for.
    const [orgSnap, billingSnap] = await db.getAll(
      orgRef,
      orgRef.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID),
    )
    if (!orgSnap.exists) {
      return Response.json({ error: 'Unknown organization' }, { status: 404 })
    }
    const org = serialize(orgSnap.data() ?? {}) as Record<string, unknown>
    const billing = billingSnap.exists
      ? (serialize(billingSnap.data() ?? {}) as Record<string, unknown>)
      : null

    // The audit slice, read here rather than by the page's rule-gated
    // `adminAudit` listener (AGL-938). Two reasons: a staff surface should
    // not lean on a client rule at all (the AGL-929 argument), and the actor
    // uids have to be known server-side to be resolved to people. Same shape
    // the page computed: the latest 200 entries, filtered to this org,
    // top 20. Fail-soft to null — a failed read must present as a failed
    // read, never as an empty history.
    //
    // `reason`/`note` ARE part of that shape (AGL-1652). A projection that
    // dropped them would be the whole issue over again one layer down: the
    // override dialog would demand a reason, the row would carry it, and
    // the org's own page — the surface where the override is actually
    // looked at — would still show who and never why.
    let audit:
      | Array<{
          $id: string
          action: string | null
          target: string | null
          actorUid: string | null
          reason: string | null
          note: string | null
          at: unknown
        }>
      | null = null
    try {
      const auditSnap = await db
        .collection('adminAudit')
        .orderBy('at', 'desc')
        .limit(200)
        .get()
      audit = auditSnap.docs
        .filter((doc) => String(doc.get('target') ?? '').includes(orgId))
        .slice(0, 20)
        .map((doc) => ({
          $id: doc.id,
          action: doc.get('action') ?? null,
          target: doc.get('target') ?? null,
          actorUid: doc.get('actorUid') ?? null,
          reason: doc.get('reason') ?? null,
          note: doc.get('note') ?? null,
          at: serialize(doc.get('at') ?? null),
        }))
    } catch (error) {
      console.error('org-detail audit slice failed', error)
    }

    // Owner + audit actors resolved to people across all three identity
    // stores — auth pools, then this org's member roster (AGL-938). The
    // helper fails soft per uid, so an unresolvable actor (`system:cron`,
    // an erased account) arrives marked unresolved rather than absent.
    const people = await resolveUidsToPeople(
      [
        typeof org['ownerUid'] === 'string' ? (org['ownerUid'] as string) : null,
        ...(audit ?? []).map((entry) => entry.actorUid),
      ],
      { orgId },
    )

    return Response.json(
      {
        // Merged the way the page already merged the two reads, so the shape
        // it consumes is unchanged and `subscription`/`stripeCustomerId` keep
        // resolving from billing first.
        org: { ...org, ...(billing ?? {}), $id: orgSnap.id },
        hasBilling: billingSnap.exists,
        audit,
        people,
      },
      { status: 200 },
    )
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Org detail failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
