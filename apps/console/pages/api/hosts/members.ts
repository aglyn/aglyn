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
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveTenantPermissions } from '../../../utils/server/tenant-permissions'

const ROLES = new Set(['viewer', 'editor', 'admin'])
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Host user manager (AGL-107): add/update/remove host members. Server-side
 * because email → auth-uid lookup and the `admins` rules map need the Admin
 * SDK, and member seats are quota-enforced (AGL-112, plan-gated per the
 * dark-launch rule). Members with an existing account get console access
 * via the `admins` map; unknown emails are stored as `invited` and linked
 * when they sign up. Role granularity beyond admin/non-admin is recorded
 * now and enforced with the granular-rules follow-up (AGL-108).
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
    // Manager permission gate (AGL-108).
    const membership = await resolveTenantPermissions(decoded.uid)
    if (!membership.permissions.manageMembers) {
      return res
        .status(403)
        .json({ error: 'Your team role does not allow managing members' })
    }
    const firestore = app.firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    const host = hostSnapshot.data()
    if (!host || host['admins']?.[decoded.uid] !== true) {
      return res.status(403).json({ error: 'Not a site admin' })
    }
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

      const [existing, tenantSnapshot] = await Promise.all([
        membersRef.where('email', '==', email).limit(1).get(),
        firestore
          .collection('tenants')
          .doc(String(host['tenantId'] ?? ''))
          .get(),
      ])
      if (!existing.empty) {
        return res.status(409).json({ error: 'Already a member' })
      }

      // Seat quota (AGL-112): enforced once the tenant has a plan; addons
      // raise the limit up to the hard max, beyond which upgrading is the
      // only path.
      const tenant = tenantSnapshot.data()
      if (tenant?.['plan']) {
        const memberCount = (await membersRef.count().get()).data().count
        const quota = checkSeatQuota(tenant as any, 'members', memberCount)
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

      // Known account → active member keyed by uid (and console access for
      // admins via the rules map); unknown → invited record linked later.
      const authUser = await app
        .auth()
        .getUserByEmail(email)
        .catch(() => null)
      const memberId = authUser?.uid ?? createResourceUid()
      await membersRef.doc(memberId).set({
        email,
        role,
        status: authUser ? 'active' : 'invited',
        ...(authUser ? { uid: authUser.uid } : {}),
        addedBy: decoded.uid,
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      if (authUser && role === 'admin') {
        await hostRef.update({ [`admins.${authUser.uid}`]: true })
      }
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
        await hostRef.update(
          role === 'admin'
            ? { [`admins.${member['uid']}`]: true }
            : {
                [`admins.${member['uid']}`]:
                  firebaseAdmin.firestore.FieldValue.delete(),
              },
        )
      }
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const memberId = String(req.body?.memberId ?? '')
      if (!memberId) return res.status(400).json({ error: 'Missing member' })
      const memberSnapshot = await membersRef.doc(memberId).get()
      const member = memberSnapshot.data()
      if (!member) return res.status(404).json({ error: 'Member not found' })
      // The owning tenant account can never be removed from its own host.
      if (member['uid'] && member['uid'] === host['tenantId']) {
        return res.status(400).json({ error: 'The owner cannot be removed' })
      }
      await membersRef.doc(memberId).delete()
      if (member['uid']) {
        await hostRef.update({
          [`admins.${member['uid']}`]:
            firebaseAdmin.firestore.FieldValue.delete(),
        })
      }
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Member operation failed' })
  }
}
