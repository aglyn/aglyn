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
import type { OutreachApiRefusalReason } from './mailbox-api'

/**
 * THE GATE EVERY AUTHENTICATED MAILBOX ROUTE CLIMBS (AGL-2978).
 *
 * The console dispatcher has already refused a request while
 * `release_outreach` is off for the organization it names, an unverified
 * account's token, a lockdown with no org in scope, and a caller over the
 * console rate limit. What it cannot know is anything about the member, so
 * each rung below is this plugin's:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  the account's address is unverified (an impersonation session is exempt)
 *   400  the request did not name an organization
 *   403  not a member of it, a site collaborator without org-wide reach, or
 *        without `outreach.use`
 *   403  the organization does not hold the `outreach` entitlement
 *   423  lockdown, now with the organization and the account in scope
 *
 * `resolveOrgPermissions` is always given the concrete org id. Called without
 * one it resolves a caller with no org at all as that future org's owner,
 * which is right for a fresh signup and wrong for every question asked here.
 */

export interface OutreachGateDeps {
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
  readOrg(orgId: string): Promise<Record<string, unknown> | null>
  lockdownRefusal(options: {
    request: Request
    staff: boolean
    uid: string
    org: Record<string, unknown>
  }): Promise<Response | null>
}

export interface OutreachGateContext {
  uid: string
  /** The account's sign-in address, lower-cased, when the token carries one. */
  email: string | null
  /** The account's name, when the token carries one. */
  name: string | null
  staff: boolean
  orgId: string
  org: Record<string, unknown>
  /** An owner or admin of the organization, who may manage every mailbox. */
  isOrgAdmin: boolean
}

/** A refusal in the one shape every mailbox route answers with. */
export function refusal(status: number, reason: OutreachApiRefusalReason, error: string): Response {
  return Response.json({ error, reason }, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** An organization id as a request may name one: a plain document id. */
const ORG_ID = /^[A-Za-z0-9_-]{1,128}$/

export function readOrgId(value: unknown): string | null {
  const orgId = typeof value === 'string' ? value.trim() : ''
  return ORG_ID.test(orgId) ? orgId : null
}

function bearer(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
}

export async function outreachMemberGate(
  request: Request,
  rawOrgId: unknown,
  deps: OutreachGateDeps,
): Promise<Response | OutreachGateContext> {
  const token = bearer(request)
  if (!token) return refusal(401, 'unauthenticated', 'Sign in to manage your connected mailboxes.')
  let decoded: DecodedIdToken
  try {
    decoded = await deps.verifyIdToken(token)
  } catch (error) {
    // A refused credential is the caller's; an Auth outage is ours and
    // propagates, so it answers 500 instead of "sign in again".
    if (invalidIdTokenResponse(error)) {
      return refusal(401, 'unauthenticated', 'Your sign-in could not be confirmed. Sign in again.')
    }
    throw error
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return refusal(403, 'email-unverified', 'Verify your email address before connecting a mailbox.')
  }

  const orgId = readOrgId(rawOrgId)
  if (!orgId) return refusal(400, 'org-required', 'Open an organization before managing its mailboxes.')

  const membership = await deps.resolveOrgPermissions(decoded.uid, { orgId })
  // A targeted org the account is not on answers with that org's id and no
  // role — as does a lookup that failed closed — so the role is the test.
  if (!membership.role || membership.orgId !== orgId) {
    return refusal(403, 'not-a-member', 'You are not a member of that organization.')
  }
  if (!membership.orgWide) {
    return refusal(403, 'not-org-wide', 'Sequences covers the whole organization, and your access is to particular sites.')
  }
  if (membership.permissions[OUTREACH_USE_PERMISSION] !== true) {
    return refusal(403, 'permission', 'Your role does not include Use Sequences.')
  }

  const org = (await deps.readOrg(orgId)) ?? {}
  if (!checkEntitlement(org, 'outreach')) {
    return refusal(403, 'entitlement', "Sequences isn't available to this workspace yet.")
  }
  const staff = decoded['staff'] === true
  const locked = await deps.lockdownRefusal({ request, staff, uid: decoded.uid, org })
  if (locked) return locked

  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : null,
    name: typeof decoded['name'] === 'string' ? String(decoded['name']) : null,
    staff,
    orgId,
    org,
    isOrgAdmin: membership.isOwner,
  }
}
