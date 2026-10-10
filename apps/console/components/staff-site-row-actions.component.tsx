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

import { ListRowActions } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { buildRoute, Route } from '../constants/route-links'
import { buildSiteLiveUrl } from '../constants/tenant-links'
import { staffSitePreviewHref } from '../utils/staff-site-links'

/** One row of `/api/admin/sites`. */
export interface StaffSiteRow {
  $id: string
  displayName: string | null
  subdomain: string | null
  cname: string | null
  cnameAttachmentPending: boolean
  orgId: string | null
  org: {
    $id: string
    name: string | null
    slug: string | null
    plan: string | null
    ownerUid: string | null
    /**
     * When the workspace's sites stop sending outside links through the
     * leaving notice (epoch ms), or null when they do not (AGL-3452).
     */
    leavingNoticeUntil?: number | null
    /**
     * The plan staff asked the workspace to buy, and its subscription
     * status, for the site page's "Ask to upgrade" (AGL-3466).
     */
    upgradeProposal?: {
      plan: string
      proposedBy: string
      proposedAt: number
      note?: string
    } | null
    billingStatus?: string | null
  } | null
  owner: {
    uid: string
    email: string | null
    displayName: string | null
  } | null
  publishedPages: number
  homeScreenId: string | null
  suspended: boolean
  maintenance: boolean
  createdAt: { seconds: number } | null
  /** The host document's `updatedAt`: the Sites list's Last updated column. */
  updatedAt?: { seconds: number } | null
}

/**
 * The site's live address: its custom domain once it serves, else its
 * platform subdomain. A domain still attaching does not serve yet, so it is
 * not where "Visit live site" goes.
 */
export const staffSiteLiveUrl = (
  site: Pick<StaffSiteRow, 'subdomain' | 'cname' | 'cnameAttachmentPending'>,
): string | undefined =>
  buildSiteLiveUrl({
    subdomain: site.subdomain ?? undefined,
    cname: site.cname && !site.cnameAttachmentPending ? site.cname : undefined,
  })

/**
 * The menu under the row's ⋮. "Visit live site" is its first entry and lives
 * ONLY here: it used to be a ↗ icon beside the menu as well, and
 * `ListRowActions` restated that icon as the menu's first item, so the one
 * action showed twice (Zach, 2026-10-10). Each label names where it goes —
 * a staff page, or a new tab — rather than "Open …" four times over (Zach,
 * 2026-10-09: "confusing menu items"). An item a row cannot use says why on
 * a second line, not only in a tooltip nobody hovers: the preview of a site
 * with no published home page, a site with no organization, an organization
 * with no owner.
 */
export function staffSiteMenuItems(
  site: Pick<StaffSiteRow, '$id' | 'orgId' | 'homeScreenId'> &
    Partial<
      Pick<StaffSiteRow, 'subdomain' | 'cname' | 'cnameAttachmentPending'>
    > & {
      ownerUid?: string | null
    },
): RowActionsMenuItem[] {
  const liveUrl = staffSiteLiveUrl({
    subdomain: site.subdomain ?? null,
    cname: site.cname ?? null,
    cnameAttachmentPending: site.cnameAttachmentPending ?? false,
  })
  const unavailable = (reason: string) => ({
    disabled: true,
    disabledReason: reason,
    description: reason,
  })
  return [
    liveUrl
      ? { key: 'live', label: 'Visit live site', href: liveUrl, external: true }
      : {
          key: 'live',
          label: 'Visit live site',
          external: true,
          ...unavailable('This site has no address yet'),
        },
    {
      key: 'open',
      label: 'Site details',
      href: buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: site.$id }),
    },
    site.homeScreenId
      ? {
          key: 'preview',
          label: 'Preview home page',
          href: staffSitePreviewHref(site.$id, 'screen', site.homeScreenId),
          external: true,
        }
      : {
          key: 'preview',
          label: 'Preview home page',
          external: true,
          ...unavailable('No home page published yet'),
        },
    site.orgId
      ? {
          key: 'org',
          label: 'Organization details',
          href: buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: site.orgId }),
        }
      : {
          key: 'org',
          label: 'Organization details',
          ...unavailable('Belongs to no organization'),
        },
    site.ownerUid
      ? {
          key: 'owner',
          label: 'Owner details',
          href: buildRoute(Route.ADMIN_USER_DETAIL, { uid: site.ownerUid }),
        }
      : {
          key: 'owner',
          label: 'Owner details',
          ...unavailable('The organization records no owner'),
        },
  ]
}

/**
 * The row's ways out, all in the ⋮ menu (no quick icon): the live site and
 * the preview in a new tab, and the staff pages for the site, its organization and its owner. Shared with the
 * organization page's Sites card so both lists offer the same menu.
 */
export function StaffSiteRowActions(props: {
  site: Pick<
    StaffSiteRow,
    | '$id'
    | 'displayName'
    | 'subdomain'
    | 'cname'
    | 'cnameAttachmentPending'
    | 'orgId'
    | 'homeScreenId'
  > & { ownerUid?: string | null }
}) {
  const { site } = props
  return (
    <ListRowActions
      label={site.displayName ?? site.subdomain ?? site.$id}
      items={staffSiteMenuItems(site)}
    />
  )
}
