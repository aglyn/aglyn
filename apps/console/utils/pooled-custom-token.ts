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
'use client'

import { signInWithCustomToken, type Auth, type UserCredential } from 'firebase/auth'

/**
 * Exchange a custom token on the auth instance placed in the pool the token
 * was MINTED in (AGL-1993).
 *
 * A custom token carries the pool it was minted for, and a uid is unique only
 * WITHIN a pool. Every server route that mints one already scopes the mint —
 * `/api/auth/session` re-mints through `authForTenant(...)` for an SSO
 * session, `/api/admin/impersonate` and `/api/presence/token` mint through
 * `authForPool(...)`. The client half was the part nobody did: the shared
 * `Auth` instance carries `tenantId` as MUTABLE state, and a tenant-minted
 * token exchanged on an instance still pointing at the project pool is a
 * cross-pool exchange.
 *
 * That is the whole of AGL-1993. `zach@aglyn.com` lives in GCIP tenant
 * `aglyn-org-y5v14` and its record carries `staff: true` / `staffRole: super`
 * — verified against both pools on 2026-08-19. The claim was never missing.
 * The silent cross-subdomain restore in `useSessionCookie` dropped the
 * `tenantId` the exchange response hands it, so the session that reached
 * `useIsStaff` was not the tenant session that holds the claim, and
 * `StaffGuard` 404'd a real staff member. The server even documented the
 * client contract it was relying on ("the client sets `auth.tenantId` from
 * the same sidecar") — a comment asserting behaviour that never existed.
 *
 * Assigned UNCONDITIONALLY, never `if (tenantId)`. `tenantId` is sticky
 * instance state: the SSO sign-in page sets it and nothing clears it, so a
 * conditional assignment leaves a stale tenant pointed at the project-pool
 * account that signs in next — the same cross-pool exchange with the pools
 * swapped. `null` is a meaningful value here, not "no opinion".
 *
 * `useIsStaff` reads `staff` off the ID token this exchange produces, so this
 * is the seam between "the claim is minted" and "the claim is read".
 */
export function signInWithPooledCustomToken(
  auth: Auth,
  token: string,
  tenantId: string | null | undefined,
): Promise<UserCredential> {
  auth.tenantId = tenantId ?? null
  return signInWithCustomToken(auth, token)
}

export default signInWithPooledCustomToken
