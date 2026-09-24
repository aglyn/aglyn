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
  advanceConsentGroupChange,
  cancelConsentGroupChange,
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
  memberHasOrgPermission,
  previewConsentGroupChange,
  readConsentGroupChangeStatus,
  resolveOrgMembership,
  startConsentGroupChange,
} from '@aglyn/tenant-data-admin'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * THE CONSENT GROUP EDITOR'S ONE DOOR (AGL-3320): `POST /api/orgs/consent-groups`.
 *
 * Wiring only. What a change means is `consent-group-change.ts` in
 * `app-utils`, and running one is the executor of the same name in the data
 * library; this checks who is asking and hands the body over.
 *
 * A sibling of `/api/orgs/settings` rather than one of its actions, because a
 * change is a job that outlives the request — carried, flipped, re-homed and
 * swept across as many invocations as it takes — and the gate is that
 * route's, exactly: a verified caller (or an impersonation), `org.settings`,
 * the lockdown verdict, an organization that exists, and then `data.manage`
 * for every action, as the Emails console's own permission. Staff bypass
 * both permissions.
 *
 * ## The actions
 *
 *  - `preview` — what `{ expected, groups }` would do, counted and worded.
 *    Writes nothing.
 *  - `apply` — starts the change, then works it for what is left of this
 *    request. The progress panel's `continue` calls and the cron backstop
 *    finish it.
 *  - `continue`, `cancel`, `status` — `{ changeId }`.
 *
 * `groups` is always the COMPLETE next declaration, and `expected` the value
 * the editor rendered, so a change made in another tab is a 409 carrying the
 * current value rather than a silent overwrite.
 */

/** How long `apply` and `continue` work a change before answering. */
const INLINE_BUDGET_MS = 50_000

/** The executor's refusal as the response it names, or `null` for a success. */
function refused(result: { ok: boolean }): Response | null {
  if (result.ok) return null
  const { status, body } = result as unknown as { status: number; body: unknown }
  return Response.json(body, { status })
}

/** A job's status as the 200 every change action answers. */
const answer = (result: unknown) =>
  Response.json({ ok: true, ...(result as { status: object }).status }, { status: 200 })

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const orgId = String(body?.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const startedAt = Date.now()
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (!staff && !(await memberHasOrgPermission(orgId, membership?.member, 'org.settings'))) {
      return Response.json({ error: 'Org settings require the admin role' }, { status: 403 })
    }

    const org = await getOrgDoc(orgId)
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: org ?? undefined,
    })
    if (locked) return locked
    if (!org) return Response.json({ error: 'No such workspace' }, { status: 404 })

    if (!staff && !(await memberHasOrgPermission(orgId, membership?.member, 'data.manage'))) {
      return Response.json({ error: 'data.manage required' }, { status: 403 })
    }

    /*
     * The participants are registered by the plugins' declarations. A change
     * that started without one would flip without its share of the carry, so
     * a process whose declarations failed refuses to start or to work one;
     * reading and previewing go on without them.
     */
    const action = String(body?.action ?? '')
    const declared = await registerPluginServerDeclarations().then(
      () => true,
      (error: unknown) => {
        console.error('[orgs/consent-groups] plugin declarations failed', error)
        return false
      },
    )
    if (!declared && (action === 'apply' || action === 'continue')) {
      return Response.json(
        { error: 'Consent groups cannot be changed right now. Try again in a minute.' },
        { status: 503 },
      )
    }
    const changeId = String(body?.changeId ?? '')
    const actor = { uid: decoded.uid, email: decoded.email ?? null }

    if (action === 'preview') {
      const result = await previewConsentGroupChange({
        orgId,
        org: org as unknown as Record<string, unknown>,
        expected: body?.expected ?? null,
        groups: body?.groups,
      })
      return (
        refused(result) ??
        Response.json({ ok: true, preview: (result as { preview: object }).preview }, { status: 200 })
      )
    }

    if (action === 'apply') {
      const started = await startConsentGroupChange({
        orgId,
        actor,
        expected: body?.expected ?? null,
        groups: body?.groups,
      })
      const refusal = refused(started)
      if (refusal) return refusal
      const advanced = await advanceConsentGroupChange({
        orgId,
        changeId: (started as { changeId: string }).changeId,
        deadlineMs: startedAt + INLINE_BUDGET_MS,
      })
      return refused(advanced) ?? answer(advanced)
    }

    if (action === 'continue' || action === 'cancel' || action === 'status') {
      if (!changeId) return Response.json({ error: 'Missing changeId' }, { status: 400 })
      if (action === 'status') {
        const status = await readConsentGroupChangeStatus({ orgId, changeId })
        if (!status) {
          return Response.json({ error: 'No such consent group change' }, { status: 404 })
        }
        return Response.json({ ok: true, ...status }, { status: 200 })
      }
      const result =
        action === 'cancel'
          ? await cancelConsentGroupChange({ orgId, changeId, actor })
          : await advanceConsentGroupChange({
              orgId,
              changeId,
              deadlineMs: startedAt + INLINE_BUDGET_MS,
            })
      return refused(result) ?? answer(result)
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'Consent group operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

/** `apply` and `continue` stop at `INLINE_BUDGET_MS`; this is the ceiling past it. */
export const maxDuration = 60

export { handler as POST }
