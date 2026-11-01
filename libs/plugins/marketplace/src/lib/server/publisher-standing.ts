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
import type { PluginApiHandler } from '@aglyn/aglyn/server'
import { resolveOrgPermissions } from '@aglyn/tenant-runtime/org-permissions'
import { resolvePublisherProfile } from './publisher-profile'

/**
 * What only the server knows about a workspace as a publisher (AGL-4049):
 * whether it sells as the platform, which is why it needs no payout account.
 *
 * The marker is a server-side env, so a publish form cannot read it, and a form
 * that told the platform's own org to set up payouts would refuse a publish the
 * door allows. Members of the workspace only; it answers nothing else.
 */
export const publisherStandingHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const orgId = String(req.query?.['orgId'] ?? '').trim()
  if (!orgId) return res.status(400).json({ error: 'Missing orgId' })
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgPermissions(decoded.uid, { orgId, hostId: null })
    if (membership.orgId !== orgId) {
      return res.status(403).json({ error: 'Not a member of that organization' })
    }
    const publisher = await resolvePublisherProfile(firebaseAdmin.app().firestore(), orgId)
    return res.status(200).json({ sellsAsPlatform: publisher?.sellsAsPlatform === true })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Could not read the publisher' })
  }
}
