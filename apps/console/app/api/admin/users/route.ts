/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  findUserByEmailAcrossPools,
  firebaseAdmin,
  isImpersonationSession,
  listUsersAcrossPools,
  type PooledUserRecord,
} from '@aglyn/tenant-data-admin'

/**
 * Staff user listing (AGL-204). Replaces the pre-AGL-42 handler that
 * listed every account WITHOUT a staff check — this one requires the
 * `staff` claim like the other admin APIs and returns trimmed records
 * only (no provider tokens, no raw claim payloads).
 */
async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    // Both paths go through the cross-pool helpers (AGL-1122). An SSO user
    // lives in their org's GCIP tenant pool, which project-level `listUsers`
    // and `getUserByEmail` do not see — so the owner of an enterprise org was
    // absent from this page AND unfindable by exact email, leaving staff no
    // way to reach the account at all. `tenantId` rides each row so the UI can
    // say which pool a user is in; it is also what a mutation needs, since
    // custom claims are per-pool.
    const serialize = ({
      record,
      tenantId,
      uidAlsoInPools,
    }: PooledUserRecord) => ({
      uid: record.uid,
      email: record.email ?? null,
      displayName: record.displayName ?? null,
      disabled: record.disabled,
      staff: Boolean(record.customClaims?.['staff']),
      staffRole: record.customClaims?.['staffRole'] ?? null,
      createdAt: record.metadata.creationTime ?? null,
      lastSignInAt: record.metadata.lastSignInTime ?? null,
      providers: record.providerData.map((provider) => provider.providerId),
      /** GCIP tenant id, or null for a project-pool (non-SSO) account. */
      tenantId,
      /**
       * Other pools holding this same uid (AGL-1962) — present only when
       * something minted a custom token across pools and Firebase created an
       * empty shadow account rather than refusing. Sent through so the row
       * can say so: both records are real, neither is deduplicated, and the
       * shadow is the one that wins every uid lookup.
       */
      uidAlsoInPools: uidAlsoInPools ?? null,
    })
    // Exact-email lookup (AGL-270): listUsers can't search, this can.
    const email = typeof query.email === 'string' ? query.email : ''
    if (email) {
      const found = await findUserByEmailAcrossPools(email)
      return Response.json({
        users: found ? [serialize(found)] : [],
        nextPageToken: null,
      }, { status: 200 })
    }
    const pageToken =
      typeof query.nextPageToken === 'string'
        ? query.nextPageToken
        : undefined
    const page = await listUsersAcrossPools(200, pageToken)
    return Response.json({
      users: page.users.map(serialize),
      nextPageToken: page.nextPageToken,
      tenantsIncluded: page.tenantsIncluded,
      // Never silently truncate: a tenant whose pool outgrew the cap is named
      // so the page can say so rather than quietly dropping the tail.
      tenantTruncated: page.tenantTruncated,
    }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Listing failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET }
