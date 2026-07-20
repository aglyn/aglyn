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

/**
 * Auth + gating for the customer REST API (`/api/v1`, AGL-617). Resolves a
 * Bearer API key to its org, enforces the `apiAccess` entitlement and a
 * per-key rate limit, and hands resource handlers a ready `ApiV1Context`.
 * This path is deliberately separate from the console session chokepoint
 * (verifyConsoleIdToken / email-verify) — API keys, not Firebase sessions.
 */
import type { AglynOrganization } from '@aglyn/aglyn'
import { checkEntitlement } from '@aglyn/aglyn/server'
import {
  ApiErrors,
  type ApiScope,
  checkRateLimit,
  firebaseAdmin,
  getOrgDoc,
  rateLimitHeaders,
  verifyApiKey,
} from '@aglyn/tenant-data-admin'

export interface ApiV1Context {
  orgId: string
  keyId: string
  scopes: ApiScope[]
  org: Partial<AglynOrganization>
  firestore: FirebaseFirestore.Firestore
  /** Rate-limit headers to echo on every response for this request. */
  headers: Record<string, string>
}

/** `Authorization: Bearer <key>` (preferred) or `X-Api-Key: <key>`. */
function extractToken(request: Request): string {
  const authorization = request.headers.get('authorization') ?? ''
  if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim()
  return (request.headers.get('x-api-key') ?? '').trim()
}

/**
 * Authenticate a v1 request. Returns an `ApiV1Context` on success, or an
 * error `Response` (401 unknown key, 403 plan required, 429 rate limited)
 * to return as-is.
 */
export async function authenticateApiV1(
  request: Request,
): Promise<{ context: ApiV1Context } | Response> {
  const token = extractToken(request)
  if (!token) return ApiErrors.unauthorized()

  const verified = await verifyApiKey(token)
  if (!verified) return ApiErrors.unauthorized()

  const org = await getOrgDoc(verified.orgId)
  if (!org) return ApiErrors.unauthorized()
  if (!checkEntitlement(org, 'apiAccess')) return ApiErrors.planRequired()

  const rate = checkRateLimit(verified.keyId)
  const headers = rateLimitHeaders(rate)
  if (!rate.allowed) {
    return ApiErrors.rateLimited(
      Math.ceil((rate.resetMs - Date.now()) / 1000),
      headers,
    )
  }

  return {
    context: {
      orgId: verified.orgId,
      keyId: verified.keyId,
      scopes: verified.scopes,
      org,
      firestore: firebaseAdmin.app().firestore(),
      headers,
    },
  }
}

/** Return a 403 unless the key carries `scope`; otherwise `null` (proceed). */
export function requireScope(
  context: ApiV1Context,
  scope: ApiScope,
): Response | null {
  return context.scopes.includes(scope)
    ? null
    : ApiErrors.insufficientScope(scope, context.headers)
}
