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
  createResourceUid,
  ORG_PERMISSION_KEYS,
  type OrgPermission,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgDoc,
  isImpersonationSession,
  lockdownRefusal,
  logOrgActivity,
  memberHasOrgPermission,
  resolveOrgMembership,
  syncOrgAuthProjections,
} from '@aglyn/tenant-data-admin'
import { FieldPath } from 'firebase-admin/firestore'

/**
 * Custom roles returned per request (AGL-2334).
 *
 * This was a bare `.limit(50)` with no cursor and no count — an undocumented
 * hard cap that applied to Enterprise too, where the plan grid says
 * "unlimited". Role 51 was not merely on a second page, it was invisible:
 * the console lists roles to assign them, so a role nobody can see is a role
 * nobody can use. Same shape as AGL-2336's membership window, same fix — a
 * page with a cursor, and a caller that follows it.
 */
const ROLE_PAGE = 100

/**
 * Firestore commits at most 500 writes per batch. Deleting a role clears the
 * dangling `roleId` from every member carrying it, and that query is
 * unbounded — so an org past 500 such members threw, leaving the role
 * deleted and the members still pointing at it (AGL-2334).
 */
const MEMBER_WRITE_CHUNK = 400

function sanitizePermissions(
  raw: unknown,
): Partial<Record<OrgPermission, boolean>> {
  if (!raw || typeof raw !== 'object') return {}
  const permissions: Partial<Record<OrgPermission, boolean>> = {}
  for (const key of ORG_PERMISSION_KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'boolean') permissions[key] = value
  }
  return permissions
}

/**
 * Custom org roles (AGL-243) at `orgs/{orgId}/roles`. GET lists (any
 * member); POST saves/deletes (members.manage permission, or staff).
 * Deleting a role clears it from members that carry it so nobody keeps a
 * dangling roleId.
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const orgId = String(
    (method === 'GET' ? query.orgId : body?.orgId) ?? '',
  )
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    if (!actor && !isStaff) {
      return Response.json({ error: 'You are not a member of that organization' }, { status: 403 })
    }
    // Lockdown verdict (AGL-1506): platform/org/user scopes — this route
    // has no org read of its own, so the org scope rides on the
    // request-deduped `getOrgDoc` read; distinct 423 body; staff bypass
    // is the un-panic invariant.
    const locked = await lockdownRefusal({
      request,
      staff: isStaff,
      uid: decoded.uid,
      org: (await getOrgDoc(orgId)) ?? undefined,
    })
    if (locked) return locked
    const firestore = firebaseAdmin.app().firestore()
    const rolesRef = firestore.collection('orgs').doc(orgId).collection('roles')

    if (method === 'GET') {
      // Ordered by document id so the cursor is total and stable — an
      // unordered limit has no defined order to page THROUGH, which is how a
      // window becomes a sample rather than a prefix.
      let listing = rolesRef.orderBy(FieldPath.documentId()).limit(ROLE_PAGE)
      const cursor = String(query['cursor'] ?? '')
      if (cursor) listing = listing.startAfter(cursor)
      const snapshot = await listing.get()
      const roles = snapshot.docs.map((doc) => ({ $id: doc.id, ...doc.data() }))
      return Response.json({
        roles,
        // Present only when there may be more. A caller that ignores it gets
        // the old behaviour with a bigger number; one that follows it gets
        // every role. What neither gets any more is silence.
        nextCursor:
          roles.length === ROLE_PAGE ? roles[roles.length - 1].$id : null,
      }, { status: 200 })
    }

    if (
      !isStaff &&
      !(await memberHasOrgPermission(orgId, actor?.member, 'members.manage'))
    ) {
      return Response.json({ error: 'Managing roles requires the members.manage permission' }, { status: 403 })
    }

    const action = String(body?.action ?? '')
    if (action === 'save') {
      const name = String(body?.name ?? '').trim()
      if (!name) return Response.json({ error: 'Name the role' }, { status: 400 })
      const roleId = String(body?.roleId ?? '') || createResourceUid()
      await rolesRef.doc(roleId).set(
        {
          name,
          description: String(body?.description ?? '').trim(),
          permissions: sanitizePermissions(body?.permissions),
        },
        { merge: true },
      )
      /*
       * Re-project the roster, because this document is an INPUT to the
       * member docs' `resolvedPermissions` and the rules read only that.
       *
       * Editing a role is the one authorization change in the console that
       * touches no membership, so it reached none of the six mutations that
       * already call this — which would leave a revoked key still granted in
       * the rules, indefinitely and silently, while every server route
       * refused it. Staleness is bounded to this request: the map is
       * recomputed before the response, so a member's next read is decided
       * by the role as saved.
       *
       * AWAITED, not fired and forgotten. A permission narrowing that
       * returns 200 before it is in force is a window in which the console
       * says the change is live and the rules still grant.
       */
      await syncOrgAuthProjections(orgId)
      await logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        body?.roleId ? 'Updated role' : 'Created role',
        { type: 'member', id: roleId, name },
      )
      return Response.json({ ok: true, roleId }, { status: 200 })
    }

    if (action === 'delete') {
      const roleId = String(body?.roleId ?? '')
      if (!roleId) return Response.json({ error: 'Missing roleId' }, { status: 400 })
      const roleSnapshot = await rolesRef.doc(roleId).get()
      await rolesRef.doc(roleId).delete()
      // Clear dangling references so members fall back to role defaults.
      const carriers = await firestore
        .collection('orgs')
        .doc(orgId)
        .collection('members')
        .where('roleId', '==', roleId)
        .get()
      // Chunked: one batch caps at 500 writes, and this query is unbounded.
      // A 600-member org used to throw here AFTER the role doc was already
      // deleted, so the failure left every carrier pointing at a role that
      // no longer existed — the exact dangling reference this cleanup is for.
      for (let start = 0; start < carriers.docs.length; start += MEMBER_WRITE_CHUNK) {
        const batch = firestore.batch()
        for (const member of carriers.docs.slice(start, start + MEMBER_WRITE_CHUNK)) {
          batch.set(member.ref, { roleId: null }, { merge: true })
        }
        await batch.commit()
      }
      // The carriers just fell back to their role defaults, which is a
      // different permission set from the one their `resolvedPermissions`
      // still holds. Same reason as the save path: clearing `roleId` without
      // re-projecting leaves the deleted role's verdict in force for the
      // rules alone.
      await syncOrgAuthProjections(orgId)
      await logOrgActivity(
        orgId,
        { uid: decoded.uid, email: decoded.email },
        'Deleted role',
        {
          type: 'member',
          id: roleId,
          name: String(roleSnapshot.get('name') ?? roleId),
        },
      )
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Role management failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }
