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
  firebaseAdmin,
  getRealmPluginInstalls,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'

/**
 * Lists the org's trusted-realm plugin installs for the console's realm
 * loader (AGL-420). Server-side because the trust grant lives on the
 * staff-only version docs — the client can read its install pins but not
 * whether the platform signed them. Any org member may read: the response
 * is exactly what the member's own console is about to load.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const orgId = url.searchParams.get('orgId') ?? ''
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (decoded['staff'] !== true && !membership) {
      return Response.json({ error: 'Not an org member' }, { status: 403 })
    }
    const installs = await getRealmPluginInstalls({ orgId })
    return Response.json({ installs }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Realm plugin lookup failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
