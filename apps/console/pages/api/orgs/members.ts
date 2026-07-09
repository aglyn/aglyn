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

import { canManageOrg, type HostAccessRole, isOrgRole } from '@aglyn/aglyn'
import {
  firebaseAdmin,
  listOrgMembers,
  removeOrgMember,
  resolveOrgMembership,
  upsertOrgMember,
} from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

const HOST_ROLES = new Set<HostAccessRole>(['admin', 'editor', 'viewer'])

function sanitizeHostAccess(
  raw: unknown,
): Record<string, HostAccessRole> {
  if (!raw || typeof raw !== 'object') return {}
  const access: Record<string, HostAccessRole> = {}
  for (const [hostId, role] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof role === 'string' && HOST_ROLES.has(role as HostAccessRole)) {
      access[hostId] = role as HostAccessRole
    }
  }
  return access
}

/**
 * Org membership management (AGL-234). GET lists members (any member of
 * the org, or staff); POST upserts/removes (org admin+, or staff).
 * Owner-safety guards: the owner's membership can't be edited or removed
 * here — ownership transfer is a deliberate future flow. Every mutation
 * runs through the Admin SDK so the reverse index and the hosts'
 * memberRoles projections stay in sync.
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
    if (!actor && !isStaff) {
      return res
        .status(403)
        .json({ error: 'You are not a member of that organization' })
    }

    if (req.method === 'GET') {
      const members = await listOrgMembers(orgId)
      return res.status(200).json({ members })
    }

    if (!isStaff && !canManageOrg(actor?.member.role)) {
      return res
        .status(403)
        .json({ error: 'Managing members requires the admin role' })
    }
    const firestore = firebaseAdmin.app().firestore()
    const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
    if (!orgSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown organization' })
    }
    const ownerUid = orgSnapshot.data()?.['ownerUid']

    const action = String(req.body?.action ?? '')
    if (action === 'upsert') {
      const role = req.body?.role
      if (!isOrgRole(role) || role === 'owner') {
        return res
          .status(400)
          .json({ error: 'Role must be admin, editor, or viewer' })
      }
      // Resolve the target account by uid or email.
      let targetUid = String(req.body?.uid ?? '')
      let email: string | null = null
      let displayName: string | null = null
      const auth = firebaseAdmin.app().auth()
      try {
        const record = targetUid
          ? await auth.getUser(targetUid)
          : await auth.getUserByEmail(
              String(req.body?.email ?? '').toLowerCase(),
            )
        targetUid = record.uid
        email = record.email ?? null
        displayName = record.displayName ?? null
      } catch {
        return res.status(404).json({
          error: 'No account with that identity — send an invite instead',
        })
      }
      if (targetUid === ownerUid) {
        return res
          .status(400)
          .json({ error: "The owner's membership can't be changed here" })
      }
      await upsertOrgMember({
        orgId,
        uid: targetUid,
        role,
        allHosts: req.body?.allHosts === true,
        hostAccess: sanitizeHostAccess(req.body?.hostAccess),
        email,
        displayName,
        invitedBy: decoded.uid,
      })
      return res.status(200).json({ ok: true, uid: targetUid })
    }

    if (action === 'remove') {
      const targetUid = String(req.body?.uid ?? '')
      if (!targetUid) return res.status(400).json({ error: 'Missing uid' })
      if (targetUid === ownerUid) {
        return res
          .status(400)
          .json({ error: 'The organization owner cannot be removed' })
      }
      await removeOrgMember(orgId, targetUid)
      return res.status(200).json({ ok: true })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Membership operation failed' })
  }
}
