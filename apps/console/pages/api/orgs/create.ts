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

import { generateOrgSlug, isValidOrgSlug } from '@aglyn/aglyn'
import {
  createOrganization,
  firebaseAdmin,
  OrgSlugTakenError,
} from '@aglyn/tenant-data-admin'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Creates an organization for the signed-in user (AGL-233). Like Slack,
 * any account can create workspaces; the creator becomes the org owner.
 * Server-side because slug reservation and membership docs are
 * Admin-SDK-only (rules deny client writes).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const name = String(req.body?.name ?? '')
    .trim()
    .slice(0, 80)
  if (!name) return res.status(400).json({ error: 'Missing organization name' })
  const slug = (String(req.body?.slug ?? '').trim().toLowerCase() ||
    generateOrgSlug(name)) as string
  if (!isValidOrgSlug(slug)) {
    return res.status(400).json({
      error:
        'Workspace URL must be 3–30 lowercase letters, digits, or dashes ' +
        'and not a reserved name',
    })
  }

  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const orgId = await createOrganization({
      name,
      slug,
      ownerUid: decoded.uid,
      ownerEmail: decoded.email ?? null,
      ownerDisplayName: (decoded['name'] as string | undefined) ?? null,
    })
    return res.status(200).json({ orgId, slug })
  } catch (error) {
    if (error instanceof OrgSlugTakenError) {
      return res.status(409).json({ error: 'That workspace URL is taken' })
    }
    console.error(error)
    return res.status(500).json({ error: 'Organization creation failed' })
  }
}
