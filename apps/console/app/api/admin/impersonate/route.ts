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
  authForPool,
  emailUnverifiedResponse,
  findUserByUidAcrossPools,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Staff impersonation (AGL-246): mints a short-lived custom token for the
 * target account with an `impersonatedBy` claim, audited to adminAudit.
 * Signing in with it REPLACES the staff session in this browser — the
 * console shows a persistent banner (claims.impersonatedBy) with an exit
 * that signs out. Staff accounts and other staff cannot be impersonated.
 *
 * ## The reason is REQUIRED (AGL-2125)
 *
 * Signing in as a customer is the most invasive thing staff can do, and until
 * this the audit row recorded an actor, an action and a target — and nothing
 * about why. Every neighbouring destructive surface takes a reason
 * (`org-override`, `lockdown`, `media-quarantine`, `abuse-reports`,
 * `org-discount`); impersonation was the outlier, and it is the one most
 * likely to be asked about months later.
 *
 * Free text rather than a code set, unlike `org-override`'s fixed vocabulary:
 * the useful answer here is what is being reproduced or which ticket it
 * serves, which no enumeration anticipates. `MIN_REASON_LENGTH` exists so the
 * field cannot be satisfied by a keystroke — a required field that accepts
 * `"x"` records that someone was made to type something, not why they acted.
 */

/**
 * Long enough to be a sentence fragment, short enough not to obstruct. Chosen
 * against the shortest genuinely useful reasons staff actually write
 * ("ticket 481", "repro billing"), both of which clear it.
 */
const MIN_REASON_LENGTH = 8

/** Bounds the stored row; an audit entry is evidence, not a scratchpad. */
const MAX_REASON_LENGTH = 500
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const uid = String(body?.uid ?? '')
  if (!uid) return Response.json({ error: 'Missing uid' }, { status: 400 })
  // BEFORE the token is minted, and before any Stripe/Firebase work: a
  // session that was opened and only then found to be unexplained is a
  // session that happened. Refusing costs a round trip; recording nothing
  // costs the audit trail.
  const reason = String(body?.reason ?? '').trim().slice(0, MAX_REASON_LENGTH)
  if (reason.length < MIN_REASON_LENGTH) {
    return Response.json(
      {
        error:
          'Impersonation needs a reason of at least ' +
          `${MIN_REASON_LENGTH} characters — it is recorded on the audit ` +
          'entry and is the only record of why this session happened.',
      },
      { status: 400 },
    )
  }

  try {
    const auth = firebaseAdmin.app().auth()
    const decoded = await auth.verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    // Across pools (AGL-1122). Project-level `getUser` THROWS for an SSO
    // account — its record lives in the org's GCIP tenant — so this route
    // 500'd for every enterprise customer, and staff could not open a support
    // session for the tier most likely to be asking for one.
    const found = await findUserByUidAcrossPools(uid)
    if (!found) {
      return Response.json({ error: 'No such user' }, { status: 404 })
    }
    const { record: target, tenantId } = found
    if (target.customClaims?.['staff']) {
      return Response.json({ error: 'Staff accounts cannot be impersonated' }, { status: 400 })
    }
    // Minted by the pool the user actually lives in. A custom token signed by
    // the project auth is not accepted for a tenant account, so getting the
    // lookup right and the mint wrong would swap a 500 for a token that fails
    // at sign-in — the same outage, one step later and harder to read.
    const token = await authForPool(tenantId).createCustomToken(uid, {
      impersonatedBy: decoded.uid,
      impersonatedByEmail: decoded.email ?? null,
    })
    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'user.impersonate',
        target: `users/${uid}`,
        // Top-level, matching `org-override` and `lockdown`, so the audit
        // page renders it without knowing this action's payload shape.
        reason,
        before: null,
        after: { email: target.email ?? null, tenantId: tenantId ?? null },
        at: FieldValue.serverTimestamp(),
      })
    return Response.json({ token }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Impersonation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
