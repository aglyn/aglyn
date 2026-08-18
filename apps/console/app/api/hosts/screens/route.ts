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
  ERROR_SCREEN_MAX_PER_HOST,
  HOST_ERROR_SCREEN_SLOTS,
  pluginRequestFromWeb,
  resolveOrgEntitlements,
  SCREEN_KIND_EMAIL,
  SCREEN_KIND_ERROR,
  SCREEN_KIND_TEMPLATE,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  billableScreenIds,
  type BillableScreenSource,
} from '../resources/count-billable-screens'

/** Roles allowed to write host content — mirrors canWriteHostContent(). */
const HOST_WRITER_ROLES = new Set(['admin', 'editor'])

/** What an ordinary page carries. Explicit, so a promotion is a WRITE and not
 * a field deletion the rules would have to reason about separately. */
const SCREEN_KIND_PAGE = 'page'

/** Visitor-facing names for the four slots, for the refusals below. */
const ERROR_SLOT_LABELS: Record<string, string> = {
  notFound: '404 (not found)',
  unauthorized: '401 (members only)',
  forbidden: '403 (forbidden)',
  unavailable: '503 (maintenance)',
}

/** Which error slot, if any, currently points at this screen. */
function errorSlotBoundTo(
  errorScreens: unknown,
  screenId: string,
): string | undefined {
  const bindings = (errorScreens ?? {}) as Record<string, unknown>
  return HOST_ERROR_SCREEN_SLOTS.find((slot) => bindings[slot] === screenId)
}

/**
 * Assigning (or clearing) one of the host's four error slots (AGL-2092).
 *
 * The route exists because the ASSIGNMENT is what stamps `kind: 'error'`, and
 * the stamp is what takes the screen off `screensPerHost`. AGL-1383's bypass
 * was exactly one client `updateDoc` away from being repeated here, so the
 * write that carries a billing consequence is server-side and the field it
 * writes is rules-frozen; the POINTER stays an ordinary client-writable host
 * field, which is AGL-1400's settlement — a pointer excuses nothing, only the
 * stamp does, so there is nothing to defend by locking it.
 *
 * The asymmetry mirrors AGL-1400's:
 *
 *  - **Assigning always succeeds** (it lowers the count) except against the
 *    BOUND, which is the one thing that is not free: four slots, so at most
 *    four exempt screens, evaluated against the post-state.
 *  - **Clearing always succeeds and changes no count.** The screen stays
 *    `kind: 'error'` — unbilled, unrouted, one deliberate click from being a
 *    page again through `convert`, which is checked exactly like a create.
 *    Refusing a clear is AGL-1390's bug: it tells a site at its cap that it may
 *    not stop using a screen as its 404.
 *
 * Nothing here touches the routing map. A screen that is still published at an
 * address of its own keeps that address AND keeps counting (the map outranks
 * the document), so assigning one of the error screens that already exist on
 * the platform breaks no link and no bookmark — the discount arrives when the
 * site unpublishes the address, which is the act that makes the exclusion true.
 */
export async function assignErrorScreen(options: {
  firestore: FirebaseFirestore.Firestore
  hostRef: FirebaseFirestore.DocumentReference
  slot: string
  /** `null` clears the slot. */
  screenId: string | null
}): Promise<Response> {
  const { firestore, hostRef, slot, screenId } = options
  const batch = firestore.batch()

  // Back-compat (AGL-87): older tenant builds read the flat field, and
  // `load-page-data` still falls back to it.
  const legacy = slot === 'notFound'

  if (!screenId) {
    batch.update(hostRef, {
      [`errorScreens.${slot}`]: FieldValue.delete(),
      ...(legacy ? { notFoundScreenId: FieldValue.delete() } : {}),
    })
    await batch.commit()
    return Response.json({ ok: true, slot, id: null }, { status: 200 })
  }

  const screenRef = hostRef.collection('screens').doc(screenId)
  const [screensSnapshot, target] = await Promise.all([
    hostRef.collection('screens').select('kind', 'deletedAt', 'displayName').get(),
    screenRef.get(),
  ])
  if (!target.exists || target.get('deletedAt') != null) {
    return Response.json({ error: 'Unknown screen' }, { status: 404 })
  }
  // Same refusal as the conversion route's, for the same reason: overwriting
  // either kind is a destructive edit dressed as a billing one — it would move
  // an email document off the Emails page, or take a collection's entry
  // template out of the compose pipeline.
  const currentKind = target.get('kind')
  if (currentKind === SCREEN_KIND_EMAIL) {
    return Response.json({
      error: 'An email document is not a page of this site',
    }, { status: 400 })
  }
  if (currentKind === SCREEN_KIND_TEMPLATE) {
    return Response.json({
      error: 'A collection entry template cannot also be an error screen',
    }, { status: 400 })
  }

  // THE BOUND (AGL-2092), against the POST-state — the AGL-1390 rule, because a
  // create-time count that asks about the present can always be walked around
  // by lowering the count first. Live `kind: 'error'` screens other than this
  // one, plus the one this call would stamp, may not exceed the slot count.
  //
  // Deleted error screens are excluded, exactly as `nonPageScreenIds` excludes
  // them: a cap that counted tombstones would be AGL-1173's bug one cap over,
  // where deleting an error screen never frees the slot it used.
  if (currentKind !== SCREEN_KIND_ERROR) {
    const liveErrorScreens = screensSnapshot.docs.filter(
      (screen) =>
        screen.id !== screenId &&
        screen.get('kind') === SCREEN_KIND_ERROR &&
        screen.get('deletedAt') == null,
    )
    if (liveErrorScreens.length + 1 > ERROR_SCREEN_MAX_PER_HOST) {
      return Response.json({
        error:
          `This site already has ${liveErrorScreens.length} error screens, ` +
          `one for each status. Turn one back into a page, or delete it, ` +
          `before assigning another.`,
      }, { status: 403 })
    }
  }

  batch.update(screenRef, { kind: SCREEN_KIND_ERROR, updatedAt: Timestamp.now() })
  batch.update(hostRef, {
    [`errorScreens.${slot}`]: screenId,
    ...(legacy ? { notFoundScreenId: screenId } : {}),
  })
  await batch.commit()
  return Response.json({ ok: true, slot, id: screenId }, { status: 200 })
}

export async function convertScreenKind(options: {
  hostRef: FirebaseFirestore.DocumentReference
  routingMap: unknown
  /** The host's error-slot bindings, so a BOUND screen cannot be converted. */
  errorScreens: unknown
  orgData: Record<string, unknown> | null
  screenId: string
  kind: typeof SCREEN_KIND_PAGE | typeof SCREEN_KIND_TEMPLATE
  /** Staff bypass the cap: the gate exists against the party being metered. */
  isStaff: boolean
}): Promise<Response> {
  const { hostRef, routingMap, errorScreens, orgData, screenId, kind, isStaff } =
    options
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
  // A screen still bound to an error slot is refused in BOTH directions
  // (AGL-2092). Promoting it to a page would leave `errorScreens.{slot}`
  // pointing at a billable page, and demoting it to a template would leave the
  // slot pointing at a document `getScreen` refuses on the error-render path —
  // the site's own 404 would silently stop rendering. Refusing here costs
  // nobody anything, because the escape is the unassign, and an unassign is
  // NEVER refused (see `assignErrorScreen`).
  const boundSlot = errorSlotBoundTo(errorScreens, screenId)
  if (boundSlot) {
    return Response.json({
      error:
        `This screen is assigned as this site's ${ERROR_SLOT_LABELS[boundSlot]} ` +
        `screen. Unassign it in Error pages first.`,
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
 * The two writes that decide what a screen IS: converting it between a page and
 * a collection ENTRY template (AGL-1400), and binding it to one of the host's
 * four error slots (AGL-2092). Both stamp `kind`, which is frozen against the
 * client in the rules and is what `screensPerHost` subtracts on.
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
  const slot = String(body?.slot ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  if (action !== 'convert' && action !== 'error-screen') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }
  // Narrowed inside the branch that validates it, so the call below cannot be
  // reached with a `kind` this route never checked.
  let convertKind: typeof SCREEN_KIND_PAGE | typeof SCREEN_KIND_TEMPLATE
  if (action === 'convert') {
    if (!screenId) return Response.json({ error: 'Missing id' }, { status: 400 })
    // `kind: 'error'` is deliberately NOT convertible-to here (AGL-2092). The
    // stamp is bounded by the four error slots, and it is bounded BECAUSE it
    // only ever happens as part of binding one — a general "make this an error
    // screen" verb would be the free-screen generator the bound exists to
    // prevent, four slots or not.
    if (kind !== SCREEN_KIND_PAGE && kind !== SCREEN_KIND_TEMPLATE) {
      return Response.json({
        error: `Screen kind must be '${SCREEN_KIND_PAGE}' or '${SCREEN_KIND_TEMPLATE}'`,
      }, { status: 400 })
    }
    convertKind = kind
  } else if (!(HOST_ERROR_SCREEN_SLOTS as readonly string[]).includes(slot)) {
    return Response.json({
      error: `Error slot must be one of ${HOST_ERROR_SCREEN_SLOTS.join(', ')}`,
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
      //
      // Audited for read-only (AGL-1625) and left deriving from the method.
      // The body carries an `action`, and BOTH of them — `convert` and
      // `error-screen`, the only two values accepted above — are writes on
      // every leg (promotion, demotion, assign and clear). Nothing here lists
      // or previews, so the verdict running ahead of the branch costs no read.
      const lockdown = await getLockdownVerdict({
        request,
        uid: decoded.uid,
        org: orgData ?? undefined,
        host: hostSnapshot.data(),
      })
      if (lockdown) return lockdownJsonResponse(lockdown)
    }

    if (action === 'error-screen') {
      return await assignErrorScreen({
        firestore,
        hostRef,
        slot,
        // An absent/empty id is the CLEAR, which is always allowed.
        screenId: screenId || null,
      })
    }

    return await convertScreenKind({
      hostRef,
      routingMap: hostSnapshot.get('screens'),
      errorScreens: hostSnapshot.get('errorScreens'),
      orgData,
      screenId,
      kind: convertKind,
      isStaff,
    })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Screen conversion failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
