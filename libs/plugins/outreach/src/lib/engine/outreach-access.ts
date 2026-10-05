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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { OUTREACH_USE_PERMISSION } from '../constants/bundle-common'

/**
 * WHO MAY WORK SEQUENCES IN AN ORGANIZATION, as plain verdicts.
 *
 * The route gate (`routes/route-gate.ts`) answers an HTTP request with them;
 * the do-not-contact transfer resource answers an import or an export with
 * the same ones, so a member the Compliance page would refuse cannot reach
 * the list through a file either. Nothing here reads a request or a token:
 * the caller has already resolved the membership and read the organization.
 */

/** Why a member may not work Sequences in an organization. */
export interface OutreachAccessRefusal {
  status: 403
  code: 'not-a-member' | 'not-org-wide' | 'permission' | 'entitlement'
  message: string
}

/** The membership as the platform resolves it for one organization. */
export interface OutreachMembership {
  orgId: string | null
  /** `null` when the account is not on the organization's roster. */
  role: string | null
  orgWide: boolean
  permissions: Partial<Record<string, boolean | undefined>>
}

/**
 * The member's refusal, or `null`: on the roster of THIS organization, with
 * reach over all of it (Sequences covers the whole organization, so access to
 * particular sites is not enough), and holding `outreach.use`.
 */
export function outreachMembershipRefusal(
  membership: OutreachMembership,
  orgId: string,
): OutreachAccessRefusal | null {
  // A targeted org the account is not on answers with that org's id and no
  // role — as does a lookup that failed closed — so the role is the test.
  if (!membership.role || membership.orgId !== orgId) {
    return { status: 403, code: 'not-a-member', message: 'You are not a member of that organization.' }
  }
  if (!membership.orgWide) {
    return {
      status: 403,
      code: 'not-org-wide',
      message: 'Sequences covers the whole organization, and your access is to particular sites.',
    }
  }
  if (membership.permissions[OUTREACH_USE_PERMISSION] !== true) {
    return { status: 403, code: 'permission', message: 'Your role does not include Use Sequences.' }
  }
  return null
}

/** The organization's refusal, or `null` when its plan or override includes Sequences. */
export function outreachEntitlementRefusal(
  org: Record<string, unknown> | null | undefined,
): OutreachAccessRefusal | null {
  return checkEntitlement(org ?? {}, 'outreach')
    ? null
    : { status: 403, code: 'entitlement', message: "Sequences isn't available to this workspace yet." }
}
