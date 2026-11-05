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

import { resolveSiteRolePresetPermissions } from '@aglyn/aglyn/app-utils/host-permissions'
import type { AglynOrgCustomRole } from '@aglyn/aglyn/app-utils/org-permissions'
import { isOrgWideMember } from '@aglyn/aglyn/app-utils/organizations'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import { campaignPlacedOnlyOn, type EmailCampaign } from '../model/campaign-container'
import { MARKETING_SITE_PERMISSIONS } from '../model/marketing-permissions'

/** What the rule reads off a membership document. */
export interface CampaignContainerMember {
  role?: unknown
  resolvedPermissions?: Readonly<Record<string, unknown>>
  permissions?: Readonly<Record<string, unknown>>
}

const CAMPAIGNS_KEY = 'marketing.campaigns'

/**
 * The workspace's verdict on writing a campaign container (AGL-4047), the rule's
 * `canWriteCampaignContainers`: "Run email campaigns" as written on
 * `resolvedPermissions`, or, for a member the projection never stamped, on their
 * own `permissions`; else their workspace role's default. It answers for every
 * campaign, wherever it is placed.
 */
export function holdsCampaignContainers(member: CampaignContainerMember): boolean {
  const stamped = (member.resolvedPermissions ?? member.permissions)?.[CAMPAIGNS_KEY]
  if (typeof stamped === 'boolean') return stamped
  const defaults: Readonly<Record<string, boolean>> | undefined = MARKETING_SITE_PERMISSIONS[0]?.roleDefaults
  return defaults?.[String(member.role ?? '')] === true
}

/**
 * The site's verdict: what the rule's `canWriteOneSiteCampaign` and the campaign
 * routes read off the host's `memberPermissions`, resolved here by the function
 * that stamp is written from. So it costs no read of the host: the membership
 * document on the page already holds the site role, the site's toggle and the
 * member's overrides. A member with no access to the site does not hold it.
 */
export function siteHoldsCampaignContainers(
  member: CampaignContainerMember | null | undefined,
  hostId: string,
  customRole?: Pick<AglynOrgCustomRole, 'permissions'> | null,
): boolean {
  return resolveSiteRolePresetPermissions(member as Partial<AglynOrgMember>, hostId, customRole)[CAMPAIGNS_KEY] === true
}

/**
 * The workspace door of the campaign manage route (`deleteCampaign`, with no site
 * named): a member of the whole workspace holding the key.
 */
export function workspaceManagesCampaigns(member: CampaignContainerMember): boolean {
  return isOrgWideMember(member as Partial<AglynOrgMember>) && holdsCampaignContainers(member)
}

/** The reader's membership: `null` until one has landed, and for a reader with none, who is staff. */
function useContainerMember(orgId: string | null | undefined): CampaignContainerMember | null {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? ''
  const { data, status } = useFirestoreDoc<CampaignContainerMember>(
    () => (orgId && uid ? doc(firestore, 'orgs', orgId, 'members', uid) : null),
    [firestore, orgId, uid],
  )
  return status === 'success' ? (data ?? null) : null
}

/**
 * The site's verdict for this member, once it is known. A member of the whole
 * workspace on a custom role is the one case the membership cannot answer alone,
 * and it pays one read, of that role. With no site named, no read at all.
 */
function useSiteVerdict(
  orgId: string | null | undefined,
  hostId: string | null | undefined,
  member: CampaignContainerMember | null,
): { held: boolean; known: boolean } {
  const firestore = useFirestore()
  const carried = (member as { roleId?: unknown } | null)?.roleId
  const roleId =
    hostId && member && typeof carried === 'string' && isOrgWideMember(member as Partial<AglynOrgMember>) ? carried : ''
  const role = useFirestoreDoc<AglynOrgCustomRole>(
    () => (orgId && roleId ? doc(firestore, 'orgs', orgId, 'roles', roleId) : null),
    [firestore, orgId, roleId],
  )
  if (!hostId || !member || (roleId && role.status === 'loading')) return { held: false, known: false }
  const customRole = roleId && role.status === 'success' ? (role.data ?? null) : null
  return { held: siteHoldsCampaignContainers(member, hostId, customRole), known: true }
}

/**
 * The campaigns list: whether Create campaign and a row's Delete campaign switch
 * off with the permission named instead of failing on save.
 *
 * A campaign created under a site is placed on that one site, so the site's
 * verdict counts for Create there; with no site named, the workspace's alone.
 * Delete answers the manage route, whose door goes by where the request is made
 * from and not by the campaign, so one verdict covers every row and no row pays
 * a read: under a site the site's verdict, on the workspace's page the workspace's.
 *
 * `false` until the reads land, and for a reader with no membership, who is staff.
 */
export function useCampaignListAccess(
  orgId: string | null | undefined,
  hostId: string | null | undefined,
): { createBlocked: boolean; deleteBlocked: boolean } {
  const member = useContainerMember(orgId)
  const site = useSiteVerdict(orgId, hostId, member)
  const refused = Boolean(member) && !holdsCampaignContainers(member as CampaignContainerMember)
  return {
    createBlocked: refused && (!hostId || (site.known && !site.held)),
    deleteBlocked: hostId
      ? site.known && !site.held
      : Boolean(member) && !workspaceManagesCampaigns(member as CampaignContainerMember),
  }
}

/**
 * The same for one campaign's own page, where Edit answers the rule and Delete
 * answers the manage route, and the two can differ on purpose: a site that turns
 * the key off stops its delete, and the workspace's verdict still edits it.
 *
 * Edit counts the site's verdict only under the site the campaign is placed on
 * and nowhere else, so a campaign on every site or on several, and every campaign
 * on the workspace's own page, answers to the workspace's verdict alone.
 *
 * Nothing but the membership is read until `campaign` is in hand: a send's report,
 * which holds no container, offers neither control.
 */
export function useCampaignContainerAccess(
  orgId: string | null | undefined,
  hostId: string | null | undefined,
  campaign: Pick<EmailCampaign, 'visibleTo'> | null | undefined,
): { editBlocked: boolean; deleteBlocked: boolean } {
  const member = useContainerMember(orgId)
  const site = useSiteVerdict(orgId, campaign ? hostId : null, member)
  const refused = Boolean(member) && !holdsCampaignContainers(member as CampaignContainerMember)
  const siteCounts = Boolean(hostId) && campaignPlacedOnlyOn(campaign, String(hostId))
  return {
    editBlocked: refused && (!siteCounts || (site.known && !site.held)),
    deleteBlocked: hostId
      ? site.known && !site.held
      : Boolean(member) && !workspaceManagesCampaigns(member as CampaignContainerMember),
  }
}
