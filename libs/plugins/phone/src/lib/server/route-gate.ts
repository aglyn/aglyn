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
  PHONE_FEATURE,
  PHONE_MANAGE_PERMISSION,
  PHONE_USE_PERMISSION,
} from '../constants/bundle-common'

/**
 * THE GATE EVERY PHONE MEMBER ROUTE CLIMBS (AGL-4251).
 *
 * The console dispatcher has already refused a request while `release_phone`
 * is off for the organization it names, an unverified token, and a caller over
 * the console rate limit. What it cannot know is the member:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  the account's address is unverified (an impersonation session is exempt)
 *   400  the request named no organization
 *   403  not a member, a site collaborator without org-wide reach, or without
 *        `phone.use` (or `phone.manage` for a setup route)
 *   403  the organization does not hold the `phone` entitlement (the add-on)
 *   423  lockdown, with the organization and the account in scope
 *
 * Org-wide, because the number belongs to the workspace and its inbox holds
 * every site's customers.
 */

export interface PhoneGateDeps {
  verifyIdToken(idToken: string): Promise<DecodedIdToken>
  isInvalidToken(error: unknown): boolean
  isEmailVerified(decoded: DecodedIdToken): boolean
  resolveOrgPermissions(
    uid: string,
    context: { orgId: string },
  ): Promise<{
    orgId: string | null
    role: string | null
    orgWide: boolean
    permissions: Partial<Record<string, boolean | undefined>>
  }>
  readOrg(orgId: string): Promise<Record<string, unknown> | null>
  /** Whether the org's plan, add-ons or override hold an entitlement feature. */
  hasFeature(org: Record<string, unknown>, feature: string): boolean
  lockdownRefusal(options: {
    request: Request
    staff: boolean
    uid: string
    org: Record<string, unknown>
  }): Promise<Response | null>
}

export interface PhoneCaller {
  uid: string
  email: string | null
  name: string | null
  staff: boolean
  orgId: string
  org: Record<string, unknown>
  canManage: boolean
}

const NO_STORE = { 'Cache-Control': 'no-store' }

export function phoneOk(body: unknown): Response {
  return Response.json(body, { status: 200, headers: NO_STORE })
}

export function phoneRefusal(status: number, reason: string, error: string): Response {
  return Response.json({ error, reason }, { status, headers: NO_STORE })
}

export function phoneMethodNotAllowed(allow: string): Response {
  return Response.json(
    { error: 'Method not allowed', reason: 'method-not-allowed' },
    { status: 405, headers: { ...NO_STORE, Allow: allow } },
  )
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

export function readPhoneId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return DOCUMENT_ID.test(id) ? id : null
}

export async function readPhoneJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request
    .clone()
    .json()
    .catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

function bearer(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
}

export async function phoneRouteGate(
  request: Request,
  rawOrgId: unknown,
  deps: PhoneGateDeps,
  options: { manage?: boolean } = {},
): Promise<Response | PhoneCaller> {
  const token = bearer(request)
  if (!token) return phoneRefusal(401, 'unauthenticated', 'Sign in to use Phone.')
  let decoded: DecodedIdToken
  try {
    decoded = await deps.verifyIdToken(token)
  } catch (error) {
    if (deps.isInvalidToken(error)) {
      return phoneRefusal(401, 'unauthenticated', 'Your sign-in could not be confirmed. Sign in again.')
    }
    throw error
  }
  if (!deps.isEmailVerified(decoded)) {
    return phoneRefusal(403, 'email-unverified', 'Verify your email address before using Phone.')
  }
  const orgId = readPhoneId(rawOrgId)
  if (!orgId) return phoneRefusal(400, 'org-required', 'Open a workspace before using Phone.')
  const membership = await deps.resolveOrgPermissions(decoded.uid, { orgId })
  if (!membership.role || membership.orgId !== orgId) {
    return phoneRefusal(403, 'not-a-member', 'You are not a member of that workspace.')
  }
  if (!membership.orgWide) {
    return phoneRefusal(403, 'not-org-wide', 'Phone covers the whole workspace, and your access is to particular sites.')
  }
  if (membership.permissions[PHONE_USE_PERMISSION] !== true) {
    return phoneRefusal(403, 'permission', 'Your role does not include Use Phone.')
  }
  const canManage = membership.permissions[PHONE_MANAGE_PERMISSION] === true
  if (options.manage && !canManage) {
    return phoneRefusal(403, 'permission', 'Your role does not include Set up Phone.')
  }
  const org = (await deps.readOrg(orgId)) ?? {}
  if (!deps.hasFeature(org, PHONE_FEATURE)) {
    return phoneRefusal(403, 'entitlement', 'Add Phone to your plan on Billing to get a business number.')
  }
  const staff = decoded['staff'] === true
  const locked = await deps.lockdownRefusal({ request, staff, uid: decoded.uid, org })
  if (locked) return locked
  return {
    uid: decoded.uid,
    email: typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : null,
    name: typeof decoded['name'] === 'string' ? (decoded['name'] as string) : null,
    staff,
    orgId,
    org,
    canManage,
  }
}
