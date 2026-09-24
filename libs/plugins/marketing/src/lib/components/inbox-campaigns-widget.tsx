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

import { buildRoute, Route, type ConsolePluginOrgMount } from '@aglyn/aglyn'
import { useMemo } from 'react'
import HostCampaignsCard from './campaigns-card'
import {
  MarketingOrgMountProvider,
  type MarketingOrgMount,
} from './marketing-org-mount'

/** What the Inbox's Campaigns zone hands this widget. */
export interface InboxCampaignsWidgetProps {
  /** The site, or `null` on the organization's Inbox. */
  hostId: string | null
  /** The organization and its sites — present exactly when `hostId` is `null`. */
  orgMount?: ConsolePluginOrgMount
}

/**
 * The campaigns list, as the Inbox's Campaigns section draws it.
 *
 * Under a site it is the site's card, unchanged. On the organization's Inbox
 * (AGL-3303) the zone hands no site and the shell's org mount instead, and
 * the card reads its org — which campaigns, which sites each is placed on —
 * through the Marketing org mount, so this puts the provider where the org
 * Marketing hub puts it: around the card. A row then opens on the org
 * Marketing hub, where a campaign placed on several sites is edited once.
 */
export function InboxCampaignsWidget(props: InboxCampaignsWidgetProps) {
  const { hostId, orgMount } = props
  const mount = useMemo<MarketingOrgMount | null>(
    () =>
      hostId == null && orgMount
        ? {
            orgId: orgMount.orgId,
            orgSlug: orgMount.orgSlug,
            hosts: orgMount.hosts,
            hostsReady: orgMount.hostsReady,
            hostsPath: orgMount.hostsPath,
            basePath: buildRoute(Route.ORG_PLUGIN, {
              orgSlug: orgMount.orgSlug,
              pluginSlug: 'marketing',
            }),
          }
        : null,
    [hostId, orgMount],
  )
  if (hostId != null) return <HostCampaignsCard hostId={hostId} />
  // No site and no org to stand in for it: nothing to list.
  if (!mount) return null
  return (
    <MarketingOrgMountProvider value={mount}>
      <HostCampaignsCard hostId={null} basePath={mount.basePath} />
    </MarketingOrgMountProvider>
  )
}
InboxCampaignsWidget.displayName = 'InboxCampaignsWidget'

export default InboxCampaignsWidget
