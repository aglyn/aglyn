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

import { mdiOpenInNew } from '@aglyn/shared-data-mdi'
import { ListRowActions } from '@aglyn/shared-ui-jsx/components/list-table.component'
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
  } | null
  owner: { uid: string; email: string | null; displayName: string | null } | null
  publishedPages: number
  homeScreenId: string | null
  suspended: boolean
  maintenance: boolean
  createdAt: { seconds: number } | null
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
 * The row's ways out: the live site and the preview in a new tab, and the
 * staff pages for the site, its organization and its owner. Shared with the
 * organization page's Sites card so both lists offer the same menu.
 */
export function StaffSiteRowActions(props: {
  site: Pick<
    StaffSiteRow,
    '$id' | 'displayName' | 'subdomain' | 'cname' | 'cnameAttachmentPending' | 'orgId' | 'homeScreenId'
  > & { ownerUid?: string | null }
}) {
  const { site } = props
  const liveUrl = staffSiteLiveUrl(site)
  return (
    <ListRowActions
      label={site.displayName ?? site.subdomain ?? site.$id}
      quick={{
        icon: mdiOpenInNew.path,
        label: 'Visit live site',
        href: liveUrl,
        unavailableReason: liveUrl ? undefined : 'This site has no address yet',
      }}
      items={[
        {
          key: 'open',
          label: 'Open site',
          href: buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: site.$id }),
        },
        {
          key: 'preview',
          label: 'Open preview',
          href: site.homeScreenId
            ? staffSitePreviewHref(site.$id, 'screen', site.homeScreenId)
            : undefined,
          external: true,
          disabled: !site.homeScreenId,
          disabledReason: site.homeScreenId
            ? undefined
            : 'No home page is published — open the site to preview another page',
        },
        {
          key: 'org',
          label: 'Open organization',
          href: site.orgId
            ? buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: site.orgId })
            : undefined,
          disabled: !site.orgId,
          disabledReason: site.orgId ? undefined : 'This site belongs to no organization',
        },
        {
          key: 'owner',
          label: 'Open owner',
          href: site.ownerUid
            ? buildRoute(Route.ADMIN_USER_DETAIL, { uid: site.ownerUid })
            : undefined,
          disabled: !site.ownerUid,
          disabledReason: site.ownerUid ? undefined : 'The organization records no owner',
        },
      ]}
    />
  )
}

