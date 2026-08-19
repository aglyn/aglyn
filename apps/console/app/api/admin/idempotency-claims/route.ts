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
 * ## Why the query is an equality and nothing else
 *
 * `where('status','==','pending')` alone. Adding `where('createdAtMs','<',x)`
 * — the obvious way to say "stranded" — is an equality plus a range on a
 * DIFFERENT field, which needs a composite index that does not exist and
 * would throw in production. The age cut is therefore applied here, over a
 * result set that is naturally tiny: a pending row is either in flight right
 * now or stuck, and there are never many of either.
 *
 * ⚠️ Read-only, deliberately. Deleting a claim is releasing an idempotency
 * key, and a key released while its request is genuinely in flight is a
 * duplicate charge — the exact failure the whole module fails closed to
 * avoid. An operator who needs one gone can reason about it with what this
 * returns; the route will not do it for them.
 */

const COLLECTION = 'apiIdempotency'

/**
 * How old a `pending` claim must be before it is called stranded.
 *
 * Comfortably longer than any checkout round trip, including a slow Stripe
 * call behind a cold start. Under this, "pending" means "working"; over it,
 * the process that made the claim is not coming back.
 */
const STRANDED_AFTER_MS = 10 * 60 * 1000

/** A ceiling, not a page. Reported when hit rather than silently applied. */
const SCAN_CEILING = 500

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
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

    const snapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection(COLLECTION)
      .where('status', '==', 'pending')
      // Ceiling PLUS ONE, so truncation is detectable rather than assumed.
      .limit(SCAN_CEILING + 1)
      .get()

    const truncated = snapshot.size > SCAN_CEILING
    const docs = truncated ? snapshot.docs.slice(0, SCAN_CEILING) : snapshot.docs
    const now = Date.now()

    const claims = docs
      .map((doc: any) => {
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
      })
      // Oldest first: the longest-stuck key is the one holding up a customer
      // who has been retrying, and it belongs at the top rather than wherever
      // Firestore's document order happens to put it.
      .sort((a, b) => (b.ageMs ?? -1) - (a.ageMs ?? -1))

    return Response.json(
      {
        claims,
        // Reported as separate numbers because they mean different things: a
        // pending claim is normal traffic, a stranded one is a stuck key.
        pending: claims.length,
        stranded: claims.filter((claim) => claim.stranded).length,
        strandedAfterMs: STRANDED_AFTER_MS,
        truncated,
        ceiling: SCAN_CEILING,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[admin/idempotency-claims]', error)
    return Response.json(
      { error: 'Idempotency claim lookup failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
