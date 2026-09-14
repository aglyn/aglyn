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
import {
  checkEntitlement,
  type LockdownFeatureKey,
  type ReleaseFlagKey,
} from '@aglyn/aglyn/server'
import {
  assistHardCapRefusalText,
  assistRefusedByHardCap,
} from '@aglyn/aglyn/app-utils/assist-credits'
import type { AglynOrganization } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type { OrgFeatureFlags } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  checkRateLimit,
  rateLimitHeaders,
  type RateLimitResult,
} from './api-http'
import {
  publicAssistQuota,
  reserveAssistMessage,
  type AssistReservation,
} from './assist-usage'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from './firebase-admin'
import { isRefusedIdToken } from './id-token-refusal'
import { featureLockdownRefusal, lockdownRefusal } from './lockdown'
import {
  aiPermissionRefusal,
  getOrgForUser,
  memberHasAiPermission,
} from './organizations'
import { isServerReleaseFlagOnForOrg } from './release-flags'

/**
 * The gate ladder every AI door climbs before it spends a token (AGL-2903).
 *
 * The rungs, in order — each one a refusal the door sends as is, and each
 * composed from the helper the existing doors already call rather than a
 * second implementation of it:
 *
 *   405  not POST
 *   401  no bearer token, or a token the verifier refused
 *   403  email unverified (an impersonation session is exempt)
 *   400  the body did not NAME the org it is metered against (AGL-1934)
 *   403  the caller is not a member of that org
 *   403  the member's role lacks the door's AI permission (AGL-2927) — only
 *        when the door names one; a verified staff claim passes, as it does
 *        at every other org route
 *   404  the release flag is off — a released-off feature does not exist;
 *        a verified staff claim previews through it
 *   403  the org's plan lacks the entitlement — a plan-less org resolves as
 *        free, which is a real answer, never a loading default
 *   423  lockdown: the scope verdict (platform/org/user) and then the
 *        feature kill switch, with its per-feature staff bypass
 *   429  the per-uid rate limit, which fails SOFT: it is a per-instance
 *        window that smooths bursts and is not the spend bound
 *   ---  the reservation, which fails CLOSED: it is the only global, atomic
 *        bound on provider spend, so a reservation that cannot be taken
 *        refuses with 503 rather than calling the provider uncapped
 *
 * A door that gets a context back has a reservation in hand and owes the
 * meter a record — or `releaseAssistMessage` if the provider was never
 * reached. What differs between doors is parameters: which entitlement,
 * which flag, which lockdown key, which rate window.
 *
 * The console chat route keeps its own copy of these rungs rather than
 * calling this: its retrieval-first design (AGL-2486) answers from the
 * docs BETWEEN the rate limit and the reservation, so its ladder is not a
 * prefix of this one, and it resolves the entitlement after the rate limit
 * because a free workspace is admitted in limited mode rather than refused.
 * The copy assistant differs the same way at the entitlement and carries no
 * flag by design. Both are documented at the route.
 */
export interface AiGateConfig {
  /** The plan entitlement the door sells under (`checkEntitlement`). */
  feature: keyof OrgFeatureFlags
  /** The release flag that makes the door exist. */
  releaseFlag: ReleaseFlagKey
  /** The feature kill switch on the staff lockdown page. */
  lockdownFeature: LockdownFeatureKey
  /**
   * The org permission the door sells under (AGL-2927): `ai.use` for the
   * assistants, `ai.generate` for a generation job. Resolved by
   * `memberHasAiPermission` on the org axis or, for a site collaborator, on
   * the host the body named (`AiGateInput.hostId`). Omitted, the rung is
   * skipped — which is the right reading for a door that has not decided
   * which key it sells under, and the wrong one for any door a customer
   * can reach, so every shipped door names one.
   */
  permission?: 'ai.use' | 'ai.generate'
  rateLimit: {
    /** Prefix of the per-uid key, so two doors do not share one window. */
    key: string
    limit: number
    windowMs: number
  }
}

export interface AiGateInput {
  request: Request
  /** The org the parsed body named; empty when it named none. */
  orgId: string
  /**
   * The site the parsed body named, when it named one. A collaborator's
   * permission is decided on this site; an org-wide member's is the same
   * everywhere, so a door on an org-level surface may leave it empty.
   */
  hostId?: string | null
  now?: Date
}

/** Everything a door needs after the ladder admitted the request. */
export interface AiGateContext {
  uid: string
  decoded: DecodedIdToken
  staff: boolean
  orgId: string
  org: Partial<AglynOrganization>
  firestore: FirebaseFirestore.Firestore
  rate: RateLimitResult
  reservation: AssistReservation
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
}

/**
 * Climb the ladder. Resolves to the `Response` to send when a rung
 * refuses, or to the resolved context when every rung admitted the request.
 */
export async function aiGateLadder(
  input: AiGateInput,
  config: AiGateConfig,
): Promise<Response | AiGateContext> {
  const { request } = input
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
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
    // — the verifier's own key endpoint unreachable — is ours, and it
    // propagates so the door answers 500 rather than telling every user
    // their credential is bad during an outage (AGL-1993).
    if (isRefusedIdToken(error)) {
      return Response.json({ error: 'Unauthenticated' }, { status: 401 })
    }
    throw error
  }
  if (!decoded.email_verified && !isImpersonationSession(decoded)) {
    return emailUnverifiedResponse()
  }
  const staff = decoded['staff'] === true

  const orgId = input.orgId.trim()
  if (!orgId) {
    return Response.json(
      { error: 'Open a workspace before using this feature' },
      { status: 400 },
    )
  }

  // Scoped to the NAMED org: membership of some other paid org is not a key
  // to this one, and the org this returns is the one every later rung and
  // the meter read.
  const resolved = await getOrgForUser(decoded.uid, orgId)
  if (!resolved || resolved.orgId !== orgId) {
    return Response.json(
      { error: 'You are not a member of that organization' },
      { status: 403 },
    )
  }
  const org = resolved.org ?? {}

  // Permission (AGL-2927), directly after membership: it is a fact about
  // the CALLER, so it is answered before anything about the workspace —
  // the plan, the lockdown state, the quota — is disclosed. Staff pass, as
  // they do at every other org route.
  if (
    config.permission &&
    !staff &&
    !(await memberHasAiPermission(
      orgId,
      input.hostId,
      resolved.member,
      config.permission,
    ))
  ) {
    return aiPermissionRefusal(config.permission)
  }

  // The flag closes the ROUTE, not just the UI (AGL-1653): a released-off
  // feature does not exist, so nothing below this line — not the plan, not
  // the lockdown state — is disclosed while it is off.
  if (!staff && !(await isServerReleaseFlagOnForOrg(config.releaseFlag, orgId))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  if (!checkEntitlement(org, config.feature)) {
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
  const featureLocked = await featureLockdownRefusal({
    feature: config.lockdownFeature,
    staff,
    // The workspace-scoped pause on the same key (AGL-2927): the staff org
    // page's spend stop, which leaves the entitlement in place.
    orgId,
  })
  if (featureLocked) return featureLocked

  const rate = checkRateLimit(`${config.rateLimit.key}:${decoded.uid}`, {
    limit: config.rateLimit.limit,
    windowMs: config.rateLimit.windowMs,
  })
  if (!rate.allowed) {
    return Response.json(
      { error: 'Too many requests — slow down a moment', reason: 'rate' },
      { status: 429, headers: rateLimitHeaders(rate) },
    )
  }

  // RESERVED, not merely checked (AGL-2057/2073): read-and-increment in one
  // transaction BEFORE a token is spent, so N concurrent requests cannot all
  // read "under the cap", and a caller that hangs up has been counted. The
  // org document is passed so the plan's own band binds, not only the
  // operator backstop.
  const firestore = app.firestore()
  let reservation: AssistReservation
  try {
    reservation = await reserveAssistMessage(
      firestore,
      orgId,
      true,
      input.now ?? new Date(),
      org,
    )
  } catch (error) {
    console.error('ai reservation failed', error)
    return Response.json(
      { error: 'This feature is temporarily unavailable' },
      { status: 503 },
    )
  }
  if (!reservation.allowed) {
    // The org's own wall is a 402 (AGL-2653): credits past the band are for
    // sale and this workspace switched the sale off, so the sentence names
    // the switch. A spend ceiling and a message cap keep the 429, and are
    // told apart in words because one resets on a clock and one does not.
    const hardCapped = assistRefusedByHardCap(org, reservation.refusedBy)
    return Response.json(
      {
        error: hardCapped
          ? assistHardCapRefusalText(org)
          : reservation.refusedBy === 'budget' || reservation.refusedBy === 'band'
            ? reservation.budgetUsd === null
              ? 'This workspace reached its AI spending limit for the month'
              : 'This workspace used its AI credits for the month'
            : 'This workspace reached its AI limit for the month',
        reason: 'quota',
        // CREDITS, never the reservation itself — its figures are our
        // provider bill and do not leave the server.
        quota: publicAssistQuota(reservation),
      },
      { status: hardCapped ? 402 : 429 },
    )
  }

  return {
    uid: decoded.uid,
    decoded,
    staff,
    orgId,
    org,
    firestore,
    rate,
    reservation,
  }
}
