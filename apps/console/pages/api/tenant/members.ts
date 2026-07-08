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
  checkSeatQuota,
  createResourceUid,
  TENANT_PERMISSION_KEYS,
  TENANT_ROLE_PERMISSIONS,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveTenantPermissions } from '../../../utils/server/tenant-permissions'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Role + per-key overrides (AGL-120): built-ins pass through; custom role
 * ids (AGL-133) are accepted when the owner's roles collection has them.
 */
async function sanitizeRole(
  input: unknown,
  rolesRef: FirebaseFirestore.CollectionReference,
): Promise<string> {
  const role = String(input ?? '')
  if (role in TENANT_ROLE_PERMISSIONS) return role
  if (role && (await rolesRef.doc(role).get()).exists) return role
  return 'viewer'
}

function sanitizePermissions(input: unknown) {
  const permissions: Record<string, boolean> = {}
  for (const key of TENANT_PERMISSION_KEYS) {
    const value = (input as any)?.[key]
    if (typeof value === 'boolean') permissions[key] = value
  }
  return permissions
}

/**
 * Tenant team manager (AGL-108): the account owner adds/updates/removes
 * manager seats at `tenants/{ownerUid}/members`. Server-side because
 * tenant-doc rules are staff-only (clients cannot write subcollections)
 * and manager seats are quota-enforced (AGL-112, dark-launch rule).
 * GET lists members (client rules cannot read them either).
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

  try {
    const app = firebaseAdmin.app()
    const decoded = await app.auth().verifyIdToken(idToken)
    // Manager permission gate (AGL-108); memberships are owner-scoped so
    // this only bites a manager probing another account's roster.
    const membership = await resolveTenantPermissions(decoded.uid)
    if (!membership.isOwner && !membership.permissions.manageMembers) {
      return res
        .status(403)
        .json({ error: 'Your team role does not allow managing the team' })
    }
    const firestore = app.firestore()
    // Tenants are keyed by the owner's uid; only the owner manages seats.
    const tenantRef = firestore.collection('tenants').doc(decoded.uid)
    const membersRef = tenantRef.collection('members')
    const rolesRef = tenantRef.collection('roles')

    if (req.method === 'GET') {
      const snapshot = await membersRef.limit(200).get()
      return res.status(200).json({
        members: snapshot.docs.map((docSnapshot) => ({
          $id: docSnapshot.id,
          ...docSnapshot.data(),
          createdAt: undefined,
        })),
      })
    }

    if (req.method === 'POST') {
      const email = String(req.body?.email ?? '')
        .trim()
        .toLowerCase()
      if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Enter a valid email' })
      }
      const [existing, tenantSnapshot] = await Promise.all([
        membersRef.where('email', '==', email).limit(1).get(),
        tenantRef.get(),
      ])
      if (!existing.empty) {
        return res.status(409).json({ error: 'Already a team member' })
      }
      const tenant = tenantSnapshot.data()
      if (tenant?.['plan']) {
        // Owner occupies the first included seat.
        const memberCount = (await membersRef.count().get()).data().count + 1
        const quota = checkSeatQuota(tenant as any, 'managers', memberCount)
        if (!quota.allowed) {
          return res.status(403).json({
            error: quota.upgradeRequired
              ? `Team seat limit reached (${quota.limit}) — upgrade your ` +
                'plan to add more seats'
              : `Team seats full (${quota.limit}) — add seats for ` +
                `$${quota.addonPriceUsd}/mo each from Billing`,
          })
        }
      }
      const authUser = await app
        .auth()
        .getUserByEmail(email)
        .catch(() => null)
      const memberId = authUser?.uid ?? createResourceUid()
      await membersRef.doc(memberId).set({
        email,
        status: authUser ? 'active' : 'invited',
        ...(authUser ? { uid: authUser.uid } : {}),
        role: await sanitizeRole(req.body?.role, rolesRef),
        permissions: sanitizePermissions(req.body?.permissions),
        createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return res.status(200).json({
        memberId,
        status: authUser ? 'active' : 'invited',
      })
    }

    if (req.method === 'PATCH') {
      const memberId = String(req.body?.memberId ?? '')
      if (!memberId) return res.status(400).json({ error: 'Missing member' })
      const memberSnapshot = await membersRef.doc(memberId).get()
      if (!memberSnapshot.exists) {
        return res.status(404).json({ error: 'Member not found' })
      }
      await membersRef.doc(memberId).update({
        ...(req.body?.role != null
          ? { role: await sanitizeRole(req.body.role, rolesRef) }
          : {}),
        ...(req.body?.permissions != null
          ? { permissions: sanitizePermissions(req.body.permissions) }
          : {}),
      })
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const memberId = String(req.body?.memberId ?? '')
      if (!memberId) return res.status(400).json({ error: 'Missing member' })
      await membersRef.doc(memberId).delete()
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Team operation failed' })
  }
}
