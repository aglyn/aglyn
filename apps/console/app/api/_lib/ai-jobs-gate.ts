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

import type { DecodedIdToken } from 'firebase-admin/auth'
import { checkEntitlement } from '@aglyn/aglyn/server'
import type { AglynOrganization } from '@aglyn/aglyn/foundation/definitions/organization.types'
// By their own entry points rather than the barrel, for the reason the chat
// route gives for the runtime: the route specs replace the barrel with a
// closed-world factory, and a leaf that is mocked at its own seam is one
// the spec can drive rung by rung.
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { getOrgForUser } from '@aglyn/tenant-data-admin/server/organizations'
import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { invalidIdTokenResponse } from './invalid-id-token-response'

/**
 * The gate the READ and CANCEL doors of AI jobs climb (AGL-2904).
 *
 * `aiGateLadder` is the ladder a door that SPENDS climbs: it is POST-only
 * and ends by taking a reservation, because its whole purpose is to bound
 * provider spend. Listing a workspace's jobs, watching one, or canceling
 * one spends nothing and answers a GET, so those doors climb the same
 * rungs up to the lockdown verdict and stop there — no rate window and no
 * reservation. The rungs are in the ladder's order, for the ladder's
 * reason: each one refused discloses nothing a lower rung would.
 *
 *   401  no bearer token, or a token the verifier refused
 *   403  email unverified (an impersonation session is exempt)
 *   400  the request did not NAME the org (AGL-1934)
 *   403  the caller is not a member of that org
 *   404  the release flag is off — a released-off feature does not exist;
 *        a verified staff claim previews through it
 *   403  the org's plan lacks `aiGenerative`
 *   423  lockdown: the scope verdict (platform/org/user)
 */
export interface AiJobsGateContext {
  uid: string
  decoded: DecodedIdToken
  staff: boolean
  orgId: string
  org: Partial<AglynOrganization>
  firestore: FirebaseFirestore.Firestore
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
}

export async function aiJobsGate(
  request: Request,
  rawOrgId: string,
): Promise<Response | AiJobsGateContext> {
  const idToken = bearerToken(request)
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  const app = firebaseAdmin.app()
  let decoded: DecodedIdToken
  try {
    decoded = await app.auth().verifyIdToken(idToken)
  } catch (error) {
    // A refused credential is the caller's fault and a 401; anything else
    // is ours and propagates so the door answers 500 rather than telling
    // every user their credential is bad during an outage (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    throw error
  }
  if (!decoded.email_verified && !isImpersonationSession(decoded)) {
    return emailUnverifiedResponse()
  }
  const staff = decoded['staff'] === true

  const orgId = rawOrgId.trim()
  if (!orgId) {
    return Response.json(
      { error: 'Open a workspace before using this feature' },
      { status: 400 },
    )
  }
  const resolved = await getOrgForUser(decoded.uid, orgId)
  if (!resolved || resolved.orgId !== orgId) {
    return Response.json(
      { error: 'You are not a member of that organization' },
      { status: 403 },
    )
  }
  const org = resolved.org ?? {}

  if (!staff && !(await isServerReleaseFlagOnForOrg('release_ai_generative', orgId))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  if (!checkEntitlement(org, 'aiGenerative')) {
    return Response.json(
      {
        error: "This workspace's plan does not include that feature",
        reason: 'entitlement',
      },
      { status: 403 },
    )
  }
  const locked = await lockdownRefusal({
    request,
    staff,
    uid: decoded.uid,
    org: org as Record<string, unknown>,
  })
  if (locked) return locked

  return {
    uid: decoded.uid,
    decoded,
    staff,
    orgId,
    org,
    firestore: app.firestore(),
  }
}
