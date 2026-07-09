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
  canManageOrg,
  createResourceUid,
  type HostAccessRole,
  isOrgRole,
} from '@aglyn/aglyn'
import {
  firebaseAdmin,
  resolveOrgMembership,
  upsertOrgMember,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'

const HOST_ROLES = new Set<HostAccessRole>(['admin', 'editor', 'viewer'])

/**
 * Org invites (AGL-234) for people without Aglyn accounts yet. Admins
 * create/revoke; anyone signed in with a matching verified email accepts,
 * which materializes the membership via the same Admin-SDK path as direct
 * adds (reverse index + host projections included). Email delivery is a
 * follow-up — invites surface in the console for now.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  const orgId = String(
    (req.method === 'GET' ? req.query.orgId : req.body?.orgId) ?? '',
  )
  if (!orgId) return res.status(400).json({ error: 'Missing orgId' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const isStaff = decoded['staff'] === true
    const actor = await resolveOrgMembership(decoded.uid, orgId)
    const firestore = firebaseAdmin.app().firestore()
    const invitesRef = firestore
      .collection('orgs')
      .doc(orgId)
      .collection('invites')

    const actorManages = isStaff || canManageOrg(actor?.member.role)

    if (req.method === 'GET') {
      if (!actorManages) {
        return res
          .status(403)
          .json({ error: 'Listing invites requires the admin role' })
      }
      const snapshot = await invitesRef
        .where('acceptedAt', '==', null)
        .limit(100)
        .get()
      return res.status(200).json({
        invites: snapshot.docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
      })
    }

    const action = String(req.body?.action ?? '')

    if (action === 'create') {
      if (!actorManages) {
        return res
          .status(403)
          .json({ error: 'Inviting members requires the admin role' })
      }
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email' })
      }
      const role = req.body?.role
      if (!isOrgRole(role) || role === 'owner') {
        return res
          .status(400)
          .json({ error: 'Role must be admin, editor, or viewer' })
      }
      const hostAccess: Record<string, HostAccessRole> = {}
      for (const [hostId, hostRole] of Object.entries(
        (req.body?.hostAccess ?? {}) as Record<string, unknown>,
      )) {
        if (
          typeof hostRole === 'string' &&
          HOST_ROLES.has(hostRole as HostAccessRole)
        ) {
          hostAccess[hostId] = hostRole as HostAccessRole
        }
      }
      const inviteId = createResourceUid()
      await invitesRef.doc(inviteId).set({
        email,
        role,
        allHosts: req.body?.allHosts === true,
        hostAccess,
        invitedBy: decoded.uid,
        createdAt: FieldValue.serverTimestamp(),
        acceptedAt: null,
      })
      return res.status(200).json({ ok: true, inviteId })
    }

    if (action === 'revoke') {
      if (!actorManages) {
        return res
          .status(403)
          .json({ error: 'Revoking invites requires the admin role' })
      }
      const inviteId = String(req.body?.inviteId ?? '')
      if (!inviteId) return res.status(400).json({ error: 'Missing inviteId' })
      await invitesRef.doc(inviteId).delete()
      return res.status(200).json({ ok: true })
    }

    if (action === 'accept') {
      const inviteId = String(req.body?.inviteId ?? '')
      if (!inviteId) return res.status(400).json({ error: 'Missing inviteId' })
      const snapshot = await invitesRef.doc(inviteId).get()
      const invite = snapshot.data()
      if (!snapshot.exists || !invite) {
        return res.status(404).json({ error: 'Invite not found' })
      }
      if (invite['acceptedAt']) {
        return res.status(409).json({ error: 'Invite already accepted' })
      }
      const email = String(decoded.email ?? '').toLowerCase()
      if (!email || email !== invite['email'] || !decoded.email_verified) {
        return res.status(403).json({
          error: 'This invite is for a different (or unverified) email',
        })
      }
      await upsertOrgMember({
        orgId,
        uid: decoded.uid,
        role: invite['role'],
        allHosts: invite['allHosts'] === true,
        hostAccess: invite['hostAccess'] ?? {},
        email,
        displayName: (decoded['name'] as string | undefined) ?? null,
        invitedBy: invite['invitedBy'] ?? null,
      })
      await invitesRef.doc(inviteId).set(
        {
          acceptedAt: FieldValue.serverTimestamp(),
          acceptedBy: decoded.uid,
        },
        { merge: true },
      )
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Invite operation failed' })
  }
}
