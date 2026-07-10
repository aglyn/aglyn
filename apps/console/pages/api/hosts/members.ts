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

import { checkSeatQuota, createResourceUid } from '@aglyn/aglyn'
import {
  firebaseAdmin,
  getOrgForHost,
  grantHostAccess,
  revokeHostAccess,
} from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveOrgPermissions } from '../../../utils/server/org-permissions'

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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const hostId = String(
    (req.method === 'POST' ? req.body?.hostId : req.query.hostId) ??
      req.body?.hostId ??
      '',
  )
  if (!hostId) return res.status(400).json({ error: 'Missing hostId' })

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
      return res.status(403).json({ error: 'Not a site admin' })
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      return res
        .status(409)
        .json({ error: 'This site has no organization yet' })
    }
    const { orgId, org } = resolved
    const membersRef = hostRef.collection('members')

    if (req.method === 'POST') {
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase()
      const role = String(req.body?.role ?? 'editor')
      if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Enter a valid email' })
      }
      if (!ROLES.has(role)) {
        return res.status(400).json({ error: 'Unknown role' })
      }

      const existing = await membersRef
        .where('email', '==', email)
        .limit(1)
        .get()
      if (!existing.empty) {
        return res.status(409).json({ error: 'Already a member' })
      }

      // Seat quota (AGL-112): enforced once the org has a plan; addons
      // raise the limit up to the hard max, beyond which upgrading is the
      // only path.
      if (org['plan']) {
        const memberCount = (await membersRef.count().get()).data().count
        const quota = checkSeatQuota(org as any, 'members', memberCount)
        if (!quota.allowed) {
          return res.status(403).json({
            error: quota.upgradeRequired
              ? `Member limit reached (${quota.limit}) — upgrade your plan ` +
                'to add more members'
              : `Member seats full (${quota.limit}) — add seats for ` +
                `$${quota.addonPriceUsd}/mo each from Billing`,
          })
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
      return res.status(200).json({
        memberId,
        status: authUser ? 'active' : 'invited',
      })
    }

    if (req.method === 'PATCH') {
      const memberId = String(req.body?.memberId ?? '')
      const role = String(req.body?.role ?? '')
      if (!memberId || !ROLES.has(role)) {
        return res.status(400).json({ error: 'Missing member or role' })
      }
      const memberSnapshot = await membersRef.doc(memberId).get()
      const member = memberSnapshot.data()
      if (!member) return res.status(404).json({ error: 'Member not found' })
      await membersRef.doc(memberId).update({ role })
      if (member['uid']) {
        await grantHostAccess({
          orgId,
          uid: String(member['uid']),
          hostId,
          role: role as 'viewer' | 'editor' | 'admin',
        })
      }
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const memberId = String(req.body?.memberId ?? '')
      if (!memberId) return res.status(400).json({ error: 'Missing member' })
      const memberSnapshot = await membersRef.doc(memberId).get()
      const member = memberSnapshot.data()
      if (!member) return res.status(404).json({ error: 'Member not found' })
      // The org owner can never be removed from their own site.
      if (member['uid'] && member['uid'] === org['ownerUid']) {
        return res.status(400).json({ error: 'The owner cannot be removed' })
      }
      await membersRef.doc(memberId).delete()
      if (member['uid']) {
        await revokeHostAccess(orgId, String(member['uid']), hostId)
      }
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Member operation failed' })
  }
}
