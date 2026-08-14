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
  eraseUser,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Close your own account (AGL-1140).
 *
 * The staff route erases someone else's account on a written request; this is
 * the same erasure, asked for by its owner. It shares `eraseUser`, so the
 * owner-blocker rules, the storage cleanup and the audit entry cannot drift
 * between the two paths.
 *
 * The uid is taken from the verified token and NEVER from the body. There is
 * no target parameter at all — a route whose only possible victim is its
 * caller cannot be turned into a way to delete someone else.
 */

// lockdown-423: exempt — not org-scoped: closes the CALLER's account (erasure right). A
// user-locked account cannot reach it anyway — the lock disables the
// account and revokes tokens — and org standing must not gate erasure.

/**
 * How fresh the sign-in behind the token has to be.
 *
 * Reauthentication is enforced here, on `auth_time`, rather than by trusting
 * the client to have called `reauthenticateWithCredential` first. The client
 * still has to do that — it is what makes `auth_time` move — but a claim in a
 * token Firebase signed is evidence, and "I promise I asked for the password"
 * is not. It also works for every provider without this route knowing which
 * one was used: a Google popup, a SAML redirect and a password prompt all
 * refresh `auth_time` the same way.
 */
const REAUTH_WINDOW_MS = 5 * 60 * 1000

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

  try {
    const auth = firebaseAdmin.app().auth()
    // Peek first, then re-verify against the tenant when there is one — an SSO
    // account's record lives in a per-org pool and the default verifier is not
    // the authority on it (AGL-1122).
    const peek = await auth.verifyIdToken(idToken)
    const tenantId = peek.firebase?.tenant
    const decoded = tenantId
      ? await auth.tenantManager().authForTenant(tenantId).verifyIdToken(idToken)
      : peek

    // Staff impersonating a customer must not be able to delete them. The
    // session looks exactly like the customer's — that is the point of
    // impersonation, and precisely why this is refused first, before the
    // email-verified gate that elsewhere EXEMPTS impersonation (AGL-480).
    // Taking that exemption here would have let a support session through.
    if (isImpersonationSession(decoded)) {
      return Response.json(
        { error: 'An impersonated session cannot close the account it is borrowing.' },
        { status: 403 },
      )
    }
    if (!decoded.email_verified) {
      return emailUnverifiedResponse()
    }

    const authTime = Number(decoded.auth_time ?? 0) * 1000
    if (!authTime || Date.now() - authTime > REAUTH_WINDOW_MS) {
      return Response.json(
        {
          error: 'reauth-required',
          message: 'Confirm it is you before closing the account.',
        },
        { status: 401 },
      )
    }

    // Typed confirmation. Not decoration: this is the one request in the
    // console that no later action can undo, and an accidental POST — a
    // double-submit, a retried fetch, a curl from someone else's shell with a
    // borrowed token — should not be able to satisfy it.
    if (String(body?.confirm ?? '').trim().toUpperCase() !== 'DELETE') {
      return Response.json(
        { error: 'Type DELETE to confirm.' },
        { status: 400 },
      )
    }

    const result = await eraseUser(decoded.uid)
    if (!result.ok) {
      if (result.skippedReason === 'owns-orgs') {
        // 409, not 403: nothing is wrong with their authorization, the account
        // is in a state that has to change first. The blockers ride along so
        // the UI can name the workspaces instead of saying "you own some".
        return Response.json(
          { error: 'owns-orgs', blockers: result.blockers ?? [] },
          { status: 409 },
        )
      }
      // Nothing to erase. Reported as success: the caller asked for the
      // account to be gone and it is, and an error here would send someone
      // to support over an outcome they already have.
      return Response.json({ ok: true, alreadyGone: true }, { status: 200 })
    }

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'account.closed.self',
        target: `users/${decoded.uid}`,
        before: { email: decoded.email ?? null, tenantId: tenantId ?? null },
        after: result.deleted,
        at: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    return Response.json({ ok: true, deleted: result.deleted }, { status: 200 })
  } catch (error) {
    console.error('[account/close] failed', error)
    return Response.json({ error: 'Closing the account failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
