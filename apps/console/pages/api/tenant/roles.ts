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
  createResourceUid,
  isBuiltInRole,
  TENANT_PERMISSION_KEYS,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveTenantPermissions } from '../../../utils/server/tenant-permissions'

const MAX_CUSTOM_ROLES = 20

function sanitizePermissions(input: unknown) {
  const permissions: Record<string, boolean> = {}
  for (const key of TENANT_PERMISSION_KEYS) {
    const value = (input as any)?.[key]
    if (typeof value === 'boolean') permissions[key] = value
  }
  return permissions
}

/**
 * Custom roles CRUD (AGL-133) at `tenants/{ownerUid}/roles`. Server-side
 * for the same reason as /api/tenant/members: tenant-doc rules are
 * staff-only. Deleting a role members still hold is allowed — those
 * members resolve as viewer (least privilege) until reassigned.
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
    const membership = await resolveTenantPermissions(decoded.uid)
    if (!membership.isOwner && !membership.permissions.manageMembers) {
      return res
        .status(403)
        .json({ error: 'Your team role does not allow managing roles' })
    }
    const firestore = app.firestore()
    const rolesRef = firestore
      .collection('tenants')
      .doc(decoded.uid)
      .collection('roles')

    if (req.method === 'GET') {
      const snapshot = await rolesRef.limit(MAX_CUSTOM_ROLES).get()
      return res.status(200).json({
        roles: snapshot.docs.map((docSnapshot) => ({
          $id: docSnapshot.id,
          ...docSnapshot.data(),
        })),
      })
    }

    if (req.method === 'POST') {
      const name = String(req.body?.name ?? '')
        .trim()
        .slice(0, 40)
      if (!name) return res.status(400).json({ error: 'Missing role name' })
      const roleId = String(req.body?.roleId ?? '') || createResourceUid()
      if (isBuiltInRole(roleId)) {
        return res.status(400).json({ error: 'That role id is reserved' })
      }
      if (!req.body?.roleId) {
        const count = (await rolesRef.count().get()).data().count
        if (count >= MAX_CUSTOM_ROLES) {
          return res
            .status(403)
            .json({ error: `Custom roles are capped at ${MAX_CUSTOM_ROLES}` })
        }
      }
      await rolesRef.doc(roleId).set(
        {
          name,
          permissions: sanitizePermissions(req.body?.permissions),
          updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      )
      return res.status(200).json({ roleId })
    }

    if (req.method === 'DELETE') {
      const roleId = String(req.body?.roleId ?? '')
      if (!roleId) return res.status(400).json({ error: 'Missing role' })
      await rolesRef.doc(roleId).delete()
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Role operation failed' })
  }
}
