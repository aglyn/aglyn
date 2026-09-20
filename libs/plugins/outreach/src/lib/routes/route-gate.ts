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

import { checkEntitlement } from '@aglyn/aglyn/server'
import {
  isEmailVerified,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { OUTREACH_USE_PERMISSION } from '../constants/bundle-common'
import { outreachRefusal, readOutreachDocumentId } from './route-http'

/**
 * THE GATE EVERY SETTINGS, SEQUENCE AND ENROLLMENT ROUTE CLIMBS (AGL-2980).
 *
 * The console dispatcher has already refused a request while
 * `release_outreach` is off for it, an unverified account's token, a
 * lockdown with no org in scope, and a caller over the console rate limit —
 * every route here is registered under the `outreach/` prefix, which is what
 * puts it behind those. What the dispatcher cannot know is anything about
 * the member, so each rung below is this plugin's:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  the account's address is unverified (an impersonation session is exempt)
 *   400  the request did not name an organization
 *   403  not a member of it, a site collaborator without org-wide reach, or
 *        without `outreach.use` — or without a permission the route adds
 *   403  the organization does not hold the `outreach` entitlement
 *   423  lockdown, now with the organization and the account in scope
 *
 * The reach is org-wide for the reason the rules give: a sequence enrolls
 * people from every site of the organization, so none of it is a fact
 * about the one site a collaborator was invited to.
 *
 * `resolveOrgPermissions` is always given the concrete org id. Called
 * without one it resolves a caller with no org at all as that future org's
 * owner, which is right for a fresh signup and wrong for every question
 * asked here.
 */

export interface OutreachRouteGateDeps {
  verifyIdToken(idToken: string): Promise<DecodedIdToken>
  resolveOrgPermissions(
    uid: string,
    context: { orgId: string },
  ): Promise<{
    orgId: string | null
    /** `null` when the account is not on the organization's roster. */
    role: string | null
    isOwner: boolean
    orgWide: boolean
    permissions: Partial<Record<string, boolean | undefined>>
  }>
  /**
   * Whether the member holds a CATALOG permission (`data.manage`) as the
   * org's roles resolve it. Asked separately because the map
   * `resolveOrgPermissions` answers carries the legacy keys and the plugins'
   * own, never a catalog key: read there, a catalog key refuses everyone.
   */
  holdsOrgCatalogPermission(uid: string, orgId: string, key: string): Promise<boolean>
  readOrg(orgId: string): Promise<Record<string, unknown> | null>
  lockdownRefusal(options: {
    request: Request
    staff: boolean
    uid: string
    org: Record<string, unknown>
  }): Promise<Response | null>
}

/** Who is asking, once the gate let them through. */
export interface OutreachRouteCaller {
  uid: string
  /** The account's sign-in address, lower-cased, when the token carries one. */
  email: string | null
  staff: boolean
  orgId: string
  /** The organization document the entitlement was read from. */
  org: Record<string, unknown>
  /** An owner or admin of the organization, who may send from any member's mailbox. */
  isOrgAdmin: boolean
}

/**
 * A catalog permission a route asks for beyond `outreach.use`, with its
 * refusal — `data.manage` for a route that reads the CRM's people, which
 * the contacts' own rules gate on.
 */
export interface OutreachRouteExtraPermission {
  key: string
  /** Why the route needs it, as the refusal says it. */
  refusal: string
}

function bearer(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
}

export async function outreachRouteGate(
  request: Request,
  rawOrgId: unknown,
  deps: OutreachRouteGateDeps,
  extra: readonly OutreachRouteExtraPermission[] = [],
): Promise<Response | OutreachRouteCaller> {
  const token = bearer(request)
  if (!token) return outreachRefusal(401, 'unauthenticated', 'Sign in to use Outreach.')
  let decoded: DecodedIdToken
  try {
    decoded = await deps.verifyIdToken(token)
  } catch (error) {
    // A refused credential is the caller's; an Auth outage is ours and
    // propagates, so it answers 500 instead of "sign in again".
    if (invalidIdTokenResponse(error)) {
      return outreachRefusal(401, 'unauthenticated', 'Your sign-in could not be confirmed. Sign in again.')
    }
    throw error
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return outreachRefusal(403, 'email-unverified', 'Verify your email address before using Outreach.')
  }

  const orgId = readOutreachDocumentId(rawOrgId)
  if (!orgId) return outreachRefusal(400, 'org-required', 'Open an organization before using Outreach.')

  const membership = await deps.resolveOrgPermissions(decoded.uid, { orgId })
  // A targeted org the account is not on answers with that org's id and no
  // role — as does a lookup that failed closed — so the role is the test.
  if (!membership.role || membership.orgId !== orgId) {
    return outreachRefusal(403, 'not-a-member', 'You are not a member of that organization.')
  }
  if (!membership.orgWide) {
    return outreachRefusal(
      403,
      'not-org-wide',
      'Outreach covers the whole organization, and your access is to particular sites.',
    )
  }
  if (membership.permissions[OUTREACH_USE_PERMISSION] !== true) {
    return outreachRefusal(403, 'permission', 'Your role does not include Use Outreach.')
  }
  for (const permission of extra) {
    if (!(await deps.holdsOrgCatalogPermission(decoded.uid, orgId, permission.key))) {
      return outreachRefusal(403, 'permission', permission.refusal)
    }
  }

  const org = (await deps.readOrg(orgId)) ?? {}
  if (!checkEntitlement(org, 'outreach')) {
    return outreachRefusal(403, 'entitlement', "Outreach isn't available to this workspace yet.")
  }
  const staff = decoded['staff'] === true
  const locked = await deps.lockdownRefusal({ request, staff, uid: decoded.uid, org })
  if (locked) return locked

  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : null,
    staff,
    orgId,
    org,
    isOrgAdmin: membership.isOwner,
  }
}
