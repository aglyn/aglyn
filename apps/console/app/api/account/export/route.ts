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
  exportFilename,
  exportUserData,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Download everything we hold about YOU (AGL-1974).
 *
 * Privacy Policy §7 grants access and portability, and until this existed a
 * request was answered by a staff member reading the console by hand — which
 * does not scale, is unauditable, and is the step most likely to be done
 * incompletely, because a walk of `users/{uid}` misses every collection keyed
 * by a field rather than by a path.
 *
 * **Self-serve is the STRONGEST verification available**, not a convenience.
 * `docs/PRIVACY_REQUESTS.md` §3 puts it first for that reason: a request made
 * from the account's own signed-in session cannot act on the wrong account,
 * where an emailed request has to be verified by a human who might get it
 * wrong. So this route takes the uid from the verified token and has no
 * subject parameter at all.
 *
 * The response is a JSON attachment. Machine-readable is the Art. 20 wording,
 * and it is also what makes the file checkable: a customer or a regulator can
 * see the `coverage` block listing every source and what was done with it.
 */

// lockdown-423: exempt — not org-scoped: returns the CALLER's own data
// (the statutory access and portability rights). It is read-only, and a
// workspace's billing or suspension standing must not gate a person's
// access to their own personal data any more than it may gate erasure —
// the same reasoning as /api/account/close.

/**
 * How fresh the sign-in behind the token has to be.
 *
 * Lighter than the erasure's five minutes and for a different reason: this
 * discloses rather than destroys, so the risk is a borrowed session reading
 * the file, not an irreversible delete. An hour is the ID token's own lifetime
 * — anything longer would be asserting freshness the token cannot support.
 */
const REAUTH_WINDOW_MS = 60 * 60 * 1000

async function handler(request: Request): Promise<Response> {
  const { method, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const auth = firebaseAdmin.app().auth()
    // Peek, then re-verify against the tenant when there is one — an SSO
    // account's record lives in a per-org pool (AGL-1122).
    const peek = await auth.verifyIdToken(idToken)
    const tenantId = peek.firebase?.tenant
    const decoded = tenantId
      ? await auth.tenantManager().authForTenant(tenantId).verifyIdToken(idToken)
      : peek

    // Staff impersonating a customer must not be able to download their
    // personal data. The session looks exactly like the customer's — that is
    // what impersonation is — so this is refused first, before the
    // email-verified gate that elsewhere EXEMPTS impersonation (AGL-480).
    // Staff who genuinely need this run the subject-access script, which
    // leaves a named actor in the audit trail instead of the customer's own
    // uid.
    if (isImpersonationSession(decoded)) {
      return Response.json(
        {
          error:
            'An impersonated session cannot export the data of the account it is borrowing.',
        },
        { status: 403 },
      )
    }
    if (!decoded.email_verified && !tenantId) {
      return emailUnverifiedResponse()
    }

    const authTime = Number(decoded.auth_time ?? 0) * 1000
    if (!authTime || Date.now() - authTime > REAUTH_WINDOW_MS) {
      return Response.json(
        {
          error: 'reauth-required',
          message: 'Sign in again before downloading your data.',
        },
        { status: 401 },
      )
    }

    const exported = await exportUserData(decoded.uid)

    // An access request is a thing that HAPPENED and the record of it is the
    // point (§7 of the runbook: when it arrived, what was asked, what was
    // done). Ids and a count — never the content, which is the AGL-1443 rule
    // that removed the erasure's own dump.
    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'account.exported.self',
        target: `users/${decoded.uid}`,
        before: null,
        after: {
          sources: Object.keys(exported.data),
          documents: Object.values(exported.data).reduce(
            (total, rows) => total + rows.length,
            0,
          ),
        },
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return new Response(JSON.stringify(exported, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(exported)}"`,
        // Never cached anywhere: this is the most personal payload the
        // console produces, and a shared cache holding it is a disclosure.
        'Cache-Control': 'no-store, private',
      },
    })
  } catch (error) {
    console.error('[account/export] failed', error)
    return Response.json({ error: 'Preparing the export failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
