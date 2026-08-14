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
} from '@aglyn/tenant-data-admin'

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
      const snapshot = await rolesRef.limit(50).get()
      return Response.json({
        roles: snapshot.docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
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
      const batch = firestore.batch()
      for (const member of carriers.docs) {
        batch.set(member.ref, { roleId: null }, { merge: true })
      }
      await batch.commit()
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
