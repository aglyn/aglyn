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
 * THE FREE-WORKSPACE CEILING, on the staff console (AGL-2265).
 *
 * the decision was two things, and this is the second one: **three, with a
 * control in the staff console.** A number in a constant would have been the
 * first half only, and the half that matters least — the population this
 * refuses (a script minting free workspaces) and the population it must never
 * refuse (a consultant, an agency, a customer who asked) are told apart by a
 * human, and a human must not need a deploy to say yes.
 *
 * GET (any staff) returns the live ceiling and, optionally, one account's
 * current count — which is the question support actually arrives with: not
 * "what is the limit" but "why was this person refused, and are they right
 * that it's wrong".
 *
 * PUT is SUPER-STAFF ONLY and audited with a before, an after and a typed
 * reason, the same bar as release flags and the send-rate ramp: this value
 * decides who can sign up at all, and setting it to 1 is indistinguishable
 * from a signup outage.
 *
 * The route is the ONLY writer. `rateLimits` is deny-all to every client
 * including staff, so a console session cannot set the ceiling directly — and
 * the write must be accompanied by the audit row and the cache invalidation,
 * which a bare client write would skip.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  countFreeWorkspacesForOwner,
  emailUnverifiedResponse,
  firebaseAdmin,
  FREE_WORKSPACE_CAP_CONFIG_DOC,
  FREE_WORKSPACE_CAP_MAX,
  FREE_WORKSPACE_CAP_MIN,
  FREE_WORKSPACE_CAP_NOTE_MAX,
  freeWorkspaceCapConfigWrite,
  invalidateFreeWorkspaceCapConfigCache,
  isImpersonationSession,
  normalizeFreeWorkspaceCapConfig,
  RATE_LIMIT_COLLECTION,
  readFreeWorkspaceCapConfig,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { FieldValue } from 'firebase-admin/firestore'

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'PUT') {
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
    const actorRole = String(decoded['staffRole'] ?? 'support')

    if (method === 'GET') {
      const config = await readFreeWorkspaceCapConfig()
      // The support lookup. `uid` only — an email would need a second auth
      // read and this is a diagnostic, not a directory.
      const lookupUid = String(
        new URL(request.url).searchParams.get('uid') ?? '',
      ).trim()
      const holder = lookupUid
        ? await countFreeWorkspacesForOwner({ uid: lookupUid })
        : null
      return Response.json(
        {
          role: actorRole,
          config,
          bounds: { min: FREE_WORKSPACE_CAP_MIN, max: FREE_WORKSPACE_CAP_MAX },
          ...(holder
            ? { holder: { uid: lookupUid, held: holder.held, orgIds: holder.orgIds } }
            : {}),
        },
        { status: 200 },
      )
    }

    if (actorRole !== 'super') {
      return Response.json(
        { error: 'Requires the super staff role' },
        { status: 403 },
      )
    }
    const requestedLimit = Number(body?.limit)
    if (!Number.isFinite(requestedLimit)) {
      return Response.json({ error: 'limit must be a number' }, { status: 400 })
    }
    // Out of bounds is REFUSED, not clamped. `normalizeFreeWorkspaceCapConfig`
    // clamps on the READ path, where a bad stored value must still produce a
    // working ceiling; here an operator typed something, and silently storing
    // a different number than they typed is how a limit gets believed and is
    // not real.
    if (
      requestedLimit < FREE_WORKSPACE_CAP_MIN ||
      requestedLimit > FREE_WORKSPACE_CAP_MAX
    ) {
      return Response.json(
        {
          error:
            `limit must be between ${FREE_WORKSPACE_CAP_MIN} and ` +
            `${FREE_WORKSPACE_CAP_MAX}`,
        },
        { status: 400 },
      )
    }
    const note = String(body?.note ?? '').slice(0, FREE_WORKSPACE_CAP_NOTE_MAX)
    const before = await readFreeWorkspaceCapConfig()
    const write = freeWorkspaceCapConfigWrite({
      limit: requestedLimit,
      enabled: body?.enabled !== false,
      actorEmail: decoded.email ?? null,
      note,
    })

    await firebaseAdmin
      .app()
      .firestore()
      .collection(RATE_LIMIT_COLLECTION)
      .doc(FREE_WORKSPACE_CAP_CONFIG_DOC)
      .set(write, { merge: true })
    // The process that took the action serves the new ceiling immediately;
    // others converge within the config TTL. No deploy anywhere in this.
    invalidateFreeWorkspaceCapConfigCache()

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'freeWorkspaceCap.update',
        target: `${RATE_LIMIT_COLLECTION}/${FREE_WORKSPACE_CAP_CONFIG_DOC}`,
        before: { limit: before.limit, enabled: before.enabled },
        after: { limit: write.limit, enabled: write.enabled },
        ...(note ? { note } : {}),
        at: FieldValue.serverTimestamp(),
      })

    return Response.json(
      { ok: true, config: normalizeFreeWorkspaceCapConfig(write, { ready: true }) },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json(
      { error: 'Free workspace cap operation failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PUT }
