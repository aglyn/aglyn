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
  pluginRequestFromWeb,
  resolveOrgEntitlements,
  SCREEN_KIND_EMAIL,
  SCREEN_KIND_TEMPLATE,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import { Timestamp } from 'firebase-admin/firestore'
import {
  billableScreenIds,
  type BillableScreenSource,
} from '../resources/count-billable-screens'

/** Roles allowed to write host content — mirrors canWriteHostContent(). */
const HOST_WRITER_ROLES = new Set(['admin', 'editor'])

/** What an ordinary page carries. Explicit, so a promotion is a WRITE and not
 * a field deletion the rules would have to reason about separately. */
const SCREEN_KIND_PAGE = 'page'

export async function convertScreenKind(options: {
  hostRef: FirebaseFirestore.DocumentReference
  routingMap: unknown
  orgData: Record<string, unknown> | null
  screenId: string
  kind: typeof SCREEN_KIND_PAGE | typeof SCREEN_KIND_TEMPLATE
  /** Staff bypass the cap: the gate exists against the party being metered. */
  isStaff: boolean
}): Promise<Response> {
  const { hostRef, routingMap, orgData, screenId, kind, isStaff } = options
  const screenRef = hostRef.collection('screens').doc(screenId)
  const [screensSnapshot, target] = await Promise.all([
    hostRef.collection('screens').select('kind', 'deletedAt', 'displayName').get(),
    screenRef.get(),
  ])
  if (!target.exists) {
    return Response.json({ error: 'Unknown screen' }, { status: 404 })
  }
  // An email document is not a page and never was, so neither direction of
  // this conversion means anything for it — and overwriting `kind` would move
  // it off the Emails page, which is a destructive edit dressed as a quota one.
  if (target.get('kind') === SCREEN_KIND_EMAIL) {
    return Response.json({
      error: 'An email document is not a page of this site',
    }, { status: 400 })
  }
  if (target.get('kind') === kind) {
    return Response.json({ ok: true, id: screenId, kind }, { status: 200 })
  }

  const screens: BillableScreenSource[] = screensSnapshot.docs.map((screen) => ({
    id: screen.id,
    kind: screen.get('kind'),
    deletedAt: screen.get('deletedAt'),
  }))
  const next = billableScreenIds(
    screens.map((screen) => (screen.id === screenId ? { ...screen, kind } : screen)),
    routingMap as never,
  )
  const limit = resolveOrgEntitlements(orgData as never).screensPerHost
  if (!isStaff && kind === SCREEN_KIND_PAGE && next.size > limit) {
    const name = String(target.get('displayName') ?? screenId)
    return Response.json({
      error:
        `Making “${name}” a page again puts this site at ${next.size} of ` +
        `${limit} screens. Delete a page first, or upgrade in Billing.`,
    }, { status: 403 })
  }

  await screenRef.update({ kind, updatedAt: Timestamp.now() })
  return Response.json({ ok: true, id: screenId, kind }, { status: 200 })
}

/**
 * Converting a screen between a page and a collection ENTRY template
 * (AGL-1400).
 *
 * "Is this screen a page?" used to be a join against a collection's template
 * pointers, and the join's other side was editable — four issues in one arc
 * (AGL-1173, AGL-1383, AGL-1387, AGL-1390), each a new way to edit it. The fact
 * lives on the screen now, `kind` is frozen against the client in the rules
 * exactly as `kind: 'email'` has been since AGL-1383, and this route is the
 * only thing that writes it.
 *
 * The asymmetry is the whole design:
 *
 *  - **Demotion (page → template) always succeeds.** It lowers the count, so
 *    there is nothing to enforce, and refusing it would be telling someone they
 *    may not stop using a screen as a page — which is what AGL-1390's
 *    refuse-the-clear did (it could tell a site it was not allowed to stop
 *    using a template until it deleted a page).
 *  - **Promotion (template → page) is checked exactly like a create**, because
 *    it raises the count by exactly one, and `screensPerHost` is a create-time
 *    gate. This is where the laundering loop is met: demote freely, create into
 *    the freed slot, and the only way back is a gate that sees the same
 *    arithmetic a create would.
 *
 * Clearing a collection's template pointer deliberately does NOT promote. The
 * screen stays a template — not billable, not served, and one deliberate click
 * from being a page again — so nobody is ever refused a pointer edit.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '')
  const screenId = String(body?.id ?? '')
  const kind = String(body?.kind ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  if (action !== 'convert') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }
  if (!screenId) return Response.json({ error: 'Missing id' }, { status: 400 })
  if (kind !== SCREEN_KIND_PAGE && kind !== SCREEN_KIND_TEMPLATE) {
    return Response.json({
      error: `Screen kind must be '${SCREEN_KIND_PAGE}' or '${SCREEN_KIND_TEMPLATE}'`,
    }, { status: 400 })
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)

    const isStaff = decoded['staff'] === true
    const hostSnapshot = await hostRef.get()
    let orgData: Record<string, unknown> | null = null
    if (!isStaff) {
      if (!hostSnapshot.exists) {
        return Response.json({ error: 'Unknown site' }, { status: 404 })
      }
      const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
      if (!HOST_WRITER_ROLES.has(String(memberRole))) {
        return Response.json({
          error: 'Editing screens requires the editor role',
        }, { status: 403 })
      }
      const orgId = hostSnapshot.get('orgId') as string | undefined
      if (orgId) {
        const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
        orgData = (orgSnapshot.data() ?? null) as Record<string, unknown> | null
      }
      // Lockdown verdict (AGL-1501): subsumes the old bare `suspendedAt`
      // check — same reads, plus platform/host/user scopes and the distinct
      // 423 body. This branch is non-staff only, so no bypass flag needed.
      const lockdown = await getLockdownVerdict({
        uid: decoded.uid,
        org: orgData ?? undefined,
        host: hostSnapshot.data(),
      })
      if (lockdown) return lockdownJsonResponse(lockdown)
    }

    return await convertScreenKind({
      hostRef,
      routingMap: hostSnapshot.get('screens'),
      orgData,
      screenId,
      kind,
      isStaff,
    })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Screen conversion failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
