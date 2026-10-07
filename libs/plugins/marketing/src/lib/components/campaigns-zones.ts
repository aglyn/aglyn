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

import type { ConsoleHostScreensZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * A site's Campaigns, beside Create campaign and in the empty list
 * (AGL-3596): another way to start a campaign. A widget here is handed the
 * site and its org — the `hostScreens` contract a site's pages, forms and
 * email templates hand too — and opens its own way to a new campaign; it
 * writes nothing through the page. Drawn only under a site: the org hub's
 * list has no one site a widget could start a campaign on.
 */
export type HostCampaignsZoneProps = ConsoleHostScreensZoneProps

export const HOST_CAMPAIGNS_ZONE = definePluginZone<HostCampaignsZoneProps>('hostCampaigns')
