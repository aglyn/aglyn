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
 * The Marketing plugin's mobile surface (AGL-3622): email sends as a native
 * list and report, with a test and a real send through the console's own
 * route behind the console's confirmations. Reached only through the
 * generated mobile manifest — never re-exported from `src/index.ts`.
 *
 * Messages are this plugin's: the console's Emails page hosts them in a zone
 * the Email plugin owns, at `/emails/messages`, and a campaign's page is this
 * plugin's `/marketing/campaigns`. Both open natively.
 */

import {
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
} from '@aglyn/mobile-plugin-host'
import { MARKETING_CAMPAIGN_SCREEN, MARKETING_CAMPAIGNS_SCREEN } from './screen-ids'

export { MARKETING_CAMPAIGN_SCREEN, MARKETING_CAMPAIGNS_SCREEN }

const PLUGIN = 'marketing'

export function registerMarketingMobile(): void {
  registerMobileScreen({
    pluginId: PLUGIN,
    id: MARKETING_CAMPAIGNS_SCREEN,
    title: 'Email campaigns',
    load: () => import('./campaigns-list-screen'),
  })
  registerMobileScreen({
    pluginId: PLUGIN,
    id: MARKETING_CAMPAIGN_SCREEN,
    title: 'Email',
    load: () => import('./campaign-detail-screen'),
  })
  registerMobileQuickAction({
    pluginId: PLUGIN,
    id: 'marketing.open',
    title: 'Email campaigns',
    icon: 'mail-outline',
    order: 400,
    screen: MARKETING_CAMPAIGNS_SCREEN,
  })
  // The Emails page's Messages section, under a site or the workspace.
  registerMobileDeepLink({ pluginId: PLUGIN, id: 'marketing.messages', path: '/emails/messages', screen: MARKETING_CAMPAIGNS_SCREEN })
  registerMobileDeepLink({
    pluginId: PLUGIN,
    id: 'marketing.message',
    path: '/emails/messages/:emailId',
    screen: MARKETING_CAMPAIGN_SCREEN,
  })
  // The Marketing hub's Campaigns section and one campaign: a single send's
  // id is its report here; a container's id offers its console page.
  registerMobileDeepLink({ pluginId: PLUGIN, id: 'marketing.campaignsPage', path: '/marketing/campaigns', screen: MARKETING_CAMPAIGNS_SCREEN })
  registerMobileDeepLink({
    pluginId: PLUGIN,
    id: 'marketing.campaignPage',
    path: '/marketing/campaigns/:campaignId',
    screen: MARKETING_CAMPAIGN_SCREEN,
  })
}
