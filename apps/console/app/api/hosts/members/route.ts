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
import { checkSeatQuota, createResourceUid } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  grantHostAccess,
  revokeHostAccess,
} from '@aglyn/tenant-data-admin'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'

const ROLES = new Set(['viewer', 'editor', 'admin'])
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Host user manager (AGL-107, re-keyed to orgs with AGL-238): add/update/
 * remove per-site collaborators. Under the hood this manages org
 * membership `hostAccess` — the grant lands in the `memberRoles` rules
 * projection, which is the security boundary. The host's `members`
 * subcollection stays as the display roster the card renders (email,
 * role, invited/active status); member seats stay quota-enforced
 * (AGL-112, plan-gated per the dark-launch rule, plan from the org doc).
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  const hostId = String(
    (method === 'POST' ? body?.hostId : query.hostId) ??
      body?.hostId ??
      '',
  )
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    const firestore = app.firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    const host = hostSnapshot.data()
    // Caller must be a site admin (memberRoles projection) or an org
    // owner/admin with the manage-members permission.
    const memberRole = (host?.['memberRoles'] ?? {})[decoded.uid]
    const orgPermissions = await resolveOrgPermissions(decoded.uid, { hostId })
    if (
      !host ||
      (memberRole !== 'admin' && !orgPermissions.permissions.manageMembers)
    ) {
      return Response.json({ error: 'Not a site admin' }, { status: 403 })
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      return Response.json({ error: 'This site has no organization yet' }, { status: 409 })
    }
    const { orgId, org } = resolved
    const membersRef = hostRef.collection('members')

    if (method === 'POST') {
      const email = String(body?.email ?? '')
        .trim()
        .toLowerCase()
      const role = String(body?.role ?? 'editor')
      if (!EMAIL_PATTERN.test(email)) {
        return Response.json({ error: 'Enter a valid email' }, { status: 400 })
      }
      if (!ROLES.has(role)) {
        return Response.json({ error: 'Unknown role' }, { status: 400 })
      }

      const existing = await membersRef
        .where('email', '==', email)
        .limit(1)
        .get()
      if (!existing.empty) {
        return Response.json({ error: 'Already a member' }, { status: 409 })
      }

      // Seat quota (AGL-112): enforced for every org — a plan-less org
      // resolves as `free`, not unmetered. Addons raise the limit up to the
      // hard max, beyond which upgrading is the only path.
      {
        const memberCount = (await membersRef.count().get()).data().count
        const quota = checkSeatQuota(org as any, 'members', memberCount)
        if (!quota.allowed) {
          return Response.json({
            error: quota.upgradeRequired
              ? `Member limit reached (${quota.limit}) — upgrade your plan ` +
                'to add more members'
              : `Member seats full (${quota.limit}) — add seats for ` +
                `$${quota.addonPriceUsd}/mo each from Billing`,
          }, { status: 403 })
        }
      }

      // Known account → org membership scoped to this host (projected
      // into memberRoles for console access); unknown → invited roster
      // record, linked through the org-invite acceptance flow.
      const authUser = await app
        .auth()
        .getUserByEmail(email)
        .catch(() => null)
      const memberId = authUser?.uid ?? createResourceUid()
      if (authUser) {
        await grantHostAccess({
          orgId,
          uid: authUser.uid,
          hostId,
          role: role as 'viewer' | 'editor' | 'admin',
          email,
          displayName: authUser.displayName ?? null,
          invitedBy: decoded.uid,
        })
      } else {
        // No account yet: an org invite carries the pending host grant;
        // acceptance applies it and the roster doc flips on next edit.
        await firestore
          .collection('orgs')
          .doc(orgId)
          .collection('invites')
          .add({
            email,
            role: 'viewer',
            allHosts: false,
            hostAccess: { [hostId]: role },
            invitedBy: decoded.uid,
            createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
            acceptedAt: null,
          })
      }
      await membersRef.doc(memberId).set({
        email,
        role,
        status: authUser ? 'active' : 'invited',
        ...(authUser ? { uid: authUser.uid } : {}),
        addedBy: decoded.uid,
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return Response.json({
        memberId,
        status: authUser ? 'active' : 'invited',
      }, { status: 200 })
    }

    if (method === 'PATCH') {
      const memberId = String(body?.memberId ?? '')
      const role = String(body?.role ?? '')
      if (!memberId || !ROLES.has(role)) {
        return Response.json({ error: 'Missing member or role' }, { status: 400 })
      }
      const memberSnapshot = await membersRef.doc(memberId).get()
      const member = memberSnapshot.data()
      if (!member) return Response.json({ error: 'Member not found' }, { status: 404 })
      await membersRef.doc(memberId).update({ role })
      if (member['uid']) {
        await grantHostAccess({
          orgId,
          uid: String(member['uid']),
          hostId,
          role: role as 'viewer' | 'editor' | 'admin',
        })
      }
      return Response.json({ ok: true }, { status: 200 })
    }

    if (method === 'DELETE') {
      const memberId = String(body?.memberId ?? '')
      if (!memberId) return Response.json({ error: 'Missing member' }, { status: 400 })
      const memberSnapshot = await membersRef.doc(memberId).get()
      const member = memberSnapshot.data()
      if (!member) return Response.json({ error: 'Member not found' }, { status: 404 })
      // The org owner can never be removed from their own site.
      if (member['uid'] && member['uid'] === org['ownerUid']) {
        return Response.json({ error: 'The owner cannot be removed' }, { status: 400 })
      }
      await membersRef.doc(memberId).delete()
      if (member['uid']) {
        await revokeHostAccess(orgId, String(member['uid']), hostId)
      }
      return Response.json({ ok: true }, { status: 200 })
    }

    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Member operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST, handler as PATCH, handler as DELETE }
