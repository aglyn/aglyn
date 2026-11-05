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

import { memberHasOrgPermission, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import {
  MARKETPLACE_MANAGE_LISTINGS_PERMISSION,
  marketplacePublisherPermissionRefusal,
  type MarketplacePublisherPermission,
} from '../model/marketplace-publisher-permissions'

/**
 * Where a member stands on one of the publisher keys of the workspace that
 * publishes (AGL-4047):
 *
 *   - `granted`: a member who holds it, by their role's default (owners and
 *     admins), their custom role or their own permissions;
 *   - `refused`: a member who does not;
 *   - `not-a-member`: someone with no membership in that workspace at all,
 *     for whom the listing or the profile is simply not theirs.
 *
 * The same answer `publisherManager()` and `listingManager()` give in the
 * Firestore rules, read off the member's stamped permissions there, so the
 * route and the client-direct write cannot disagree. Payouts, the Verified
 * badge ask and the publisher's version history have no client-direct door to
 * agree with: the rules freeze the payout fields and `verificationRequest`,
 * and keep `pluginVersions` to staff, so their routes are the only way in.
 *
 * Whether someone belongs to the publishing workspace at all, with no key
 * asked, is `isPublisherMember` (no self-purchase, no self-review, and, with
 * the install landing in that workspace, free own installs: `ownsListingHere`).
 */
export type PublisherPermissionVerdict = 'granted' | 'refused' | 'not-a-member'

export async function publisherPermissionVerdict(
  uid: string | null | undefined,
  publisherOrgId: string | null | undefined,
  permission: MarketplacePublisherPermission,
): Promise<PublisherPermissionVerdict> {
  if (!uid || !publisherOrgId) return 'not-a-member'
  const membership = await resolveOrgMembership(uid, publisherOrgId)
  if (!membership) return 'not-a-member'
  return (await memberHasOrgPermission(publisherOrgId, membership.member, permission as never)) ? 'granted' : 'refused'
}

/** A door's refusal, shaped for `res.status(status).json(body)`. */
export interface PublisherDoorRefusal {
  status: 403
  body: { error: string; reason?: 'permission'; permission?: MarketplacePublisherPermission }
}

/**
 * The listing doors' gate (AGL-4047): editing a published listing, its
 * picture, its visibility, and unpublishing or republishing it ask "Manage
 * published listings" of a member of the workspace that published it. They
 * asked for the owner or admin role, which is the key's default. Staff moderate any listing, as before. Someone outside the
 * workspace hears the listing is not theirs, as before; a member without the
 * key hears which permission they are missing.
 */
export async function manageListingsRefusal(
  caller: { uid: string; staff?: unknown },
  publisherOrgId: unknown,
  options: { staffMayModerate: boolean },
): Promise<PublisherDoorRefusal | null> {
  if (options.staffMayModerate && caller.staff === true) return null
  const verdict = await publisherPermissionVerdict(
    caller.uid,
    typeof publisherOrgId === 'string' ? publisherOrgId : null,
    MARKETPLACE_MANAGE_LISTINGS_PERMISSION,
  )
  if (verdict === 'granted') return null
  if (verdict === 'not-a-member') return { status: 403, body: { error: 'Not your listing' } }
  return {
    status: 403,
    body: {
      error: marketplacePublisherPermissionRefusal(MARKETPLACE_MANAGE_LISTINGS_PERMISSION),
      reason: 'permission',
      permission: MARKETPLACE_MANAGE_LISTINGS_PERMISSION,
    },
  }
}
