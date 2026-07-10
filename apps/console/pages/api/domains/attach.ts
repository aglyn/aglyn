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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Attaches a verified custom domain to the tenant Vercel project so SSL
 * provisions automatically (Custom Domain Self-Service). Degrades to 501
 * without `VERCEL_TOKEN`/`VERCEL_TENANT_PROJECT_ID` — the wizard treats
 * that as "DNS connected, platform attachment pending". Auth: Firebase ID
 * token; the caller must be an admin of the host.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_TENANT_PROJECT_ID
  const teamId = process.env.VERCEL_TEAM_ID
  const domain = String(req.body?.domain ?? '')
    .trim()
    .toLowerCase()
  const hostId = String(req.body?.hostId ?? '')
  if (!domain || !hostId) {
    return res.status(400).json({ error: 'Missing domain or hostId' })
  }

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const hostSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostId)
      .get()
    if (!hostSnapshot.exists) {
      return res.status(404).json({ error: 'Unknown site' })
    }
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (memberRole !== 'admin') {
      return res.status(403).json({ error: 'Not a site admin' })
    }

    // Cname uniqueness (AGL-166): middleware resolution maps hostname ->
    // host 1:1; a duplicate would make it ambiguous.
    const firestore = firebaseAdmin.app().firestore()
    const duplicates = await firestore
      .collection('hosts')
      .where('cname', '==', domain)
      .limit(2)
      .get()
    if (duplicates.docs.some((docSnapshot) => docSnapshot.id !== hostId)) {
      return res
        .status(409)
        .json({ error: 'That domain is already connected to another site' })
    }

    if (!token || !projectId) {
      // Backfill path (AGL-166): remember the attachment never happened
      // so the wizard can show it honestly and offer a retry.
      await hostSnapshot.ref
        .set({ cnameAttachmentPending: true }, { merge: true })
        .catch(() => undefined)
      return res.status(501).json({
        error:
          'Domain attachment is not configured (missing VERCEL_TOKEN / ' +
          'VERCEL_TENANT_PROJECT_ID).',
      })
    }

    const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
    const response = await fetch(
      `https://api.vercel.com/v10/projects/${projectId}/domains${query}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      },
    )
    const payload = await response.json()
    if (!response.ok && payload?.error?.code !== 'domain_already_in_use') {
      console.error(payload)
      await hostSnapshot.ref
        .set({ cnameAttachmentPending: true }, { merge: true })
        .catch(() => undefined)
      return res
        .status(502)
        .json({ error: payload?.error?.message ?? 'Vercel attach failed' })
    }
    await hostSnapshot.ref
      .set(
        {
          cnameAttachmentPending:
            firebaseAdmin.firestore.FieldValue.delete(),
        },
        { merge: true },
      )
      .catch(() => undefined)
    return res.status(200).json({ attached: true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Attach failed' })
  }
}
