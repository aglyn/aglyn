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

import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * The zone the campaigns list hosts beside Create campaign (AGL-3603).
 *
 * Another way to start a campaign, from a plugin this one may not import. A
 * widget here is handed where a campaign would be placed and writes nothing
 * through the list: whatever it starts makes its own drafts through the
 * campaign draft writer this plugin registers (`server/campaign-manage.ts`),
 * which writes a campaign aimed at nobody and an email that is never sent
 * until a member sends it.
 */

/** One site a campaign could be placed on, as the organization hub lists it. */
export interface MarketingCampaignSite {
  id: string
  name: string
}

/** What {@link HOST_CAMPAIGNS_ZONE} hands each widget. */
export interface MarketingHostCampaignsZoneProps {
  /** The site the list is for; `null` on the organization's hub. */
  hostId: string | null
  /** The organization the campaigns belong to, once it is known. */
  orgId: string | null
  /**
   * On the organization's hub, the sites a new campaign may be placed on, for
   * the widget to ask which; empty under a site, where the site is `hostId`.
   */
  sites: readonly MarketingCampaignSite[]
}

export const HOST_CAMPAIGNS_ZONE =
  definePluginZone<MarketingHostCampaignsZoneProps>('hostCampaigns')

/** The list's zone, drawn through the shell's renderer, or nothing outside the shell. */
export function HostCampaignsZone(props: MarketingHostCampaignsZoneProps) {
  const Slot = useConsoleWidgetSlot()
  return Slot ? <Slot slot={HOST_CAMPAIGNS_ZONE.id} {...props} /> : null
}
HostCampaignsZone.displayName = 'HostCampaignsZone'
