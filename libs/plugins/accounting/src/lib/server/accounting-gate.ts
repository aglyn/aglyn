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
 * THE GATE EVERY AUTHENTICATED ACCOUNTING ROUTE CLIMBS (AGL-3614).
 *
 * The console dispatcher has already refused a request while
 * `release_accounting` is off for the organization it names. Each rung below
 * is this plugin's:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  the account's address is unverified (an impersonation session is exempt)
 *   400  the request did not name an organization
 *   403  not a member of it, a site collaborator without org-wide reach, or
 *        without `accounting.manage`
 *   403  the organization's plan does not include commerce
 *   423  lockdown, with the organization and the account in scope
 *
 * The books are the whole business's, so a site collaborator — however much
 * they may do on their sites — never reaches them.
 */

import { checkEntitlement } from '@aglyn/aglyn/server'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { ACCOUNTING_ENTITLEMENT, ACCOUNTING_MANAGE_PERMISSION } from '../constants/bundle-common'
import type { AccountingRefusalReason } from '../model/accounting.types'

export interface AccountingGateDeps {
  verifyIdToken(idToken: string): Promise<DecodedIdToken>
  resolveOrgPermissions(
    uid: string,
    context: { orgId: string },
  ): Promise<{
    orgId: string | null
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

export interface AccountingGateContext {
  uid: string
  email: string | null
  staff: boolean
  orgId: string
  org: Record<string, unknown>
}

const noStore = { 'Cache-Control': 'no-store' }

/** A refusal in the one shape every accounting route answers with. */
export function refusal(status: number, reason: AccountingRefusalReason, error: string): Response {
  return Response.json({ error, reason }, { status, headers: noStore })
}

const ORG_ID = /^[A-Za-z0-9_-]{1,128}$/

export function readOrgId(value: unknown): string | null {
  const orgId = typeof value === 'string' ? value.trim() : ''
  return ORG_ID.test(orgId) ? orgId : null
}

function bearer(request: Request): string | null {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
}

export async function accountingMemberGate(
  request: Request,
  rawOrgId: unknown,
  deps: AccountingGateDeps,
): Promise<Response | AccountingGateContext> {
  const token = bearer(request)
  if (!token) return refusal(401, 'unauthenticated', 'Sign in to manage accounting.')
  let decoded: DecodedIdToken
  try {
    decoded = await deps.verifyIdToken(token)
  } catch (error) {
    if (isRefusedIdToken(error)) {
      return refusal(401, 'unauthenticated', 'Your sign-in could not be confirmed. Sign in again.')
    }
    throw error
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return refusal(403, 'email-unverified', 'Verify your email address before connecting your books.')
  }
  const orgId = readOrgId(rawOrgId)
  if (!orgId) return refusal(400, 'org-required', 'Open an organization first.')

  const membership = await deps.resolveOrgPermissions(decoded.uid, { orgId })
  if (!membership.role || membership.orgId !== orgId) {
    return refusal(403, 'not-a-member', 'You are not a member of that organization.')
  }
  if (!membership.orgWide) {
    return refusal(403, 'not-org-wide', 'Accounting covers the whole organization, and your access is to particular sites.')
  }
  if (membership.permissions[ACCOUNTING_MANAGE_PERMISSION] !== true) {
    return refusal(403, 'permission', 'Your role does not include Manage accounting.')
  }
  const org = (await deps.readOrg(orgId)) ?? {}
  if (!checkEntitlement(org, ACCOUNTING_ENTITLEMENT)) {
    return refusal(403, 'entitlement', 'Accounting comes with the plans that include selling online.')
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
  }
}
