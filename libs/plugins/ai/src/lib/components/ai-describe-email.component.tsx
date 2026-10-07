'use client'

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
import { AiDescribeButton } from './ai-describe-button.component'

/**
 * "Create with AI" for email (AGL-3596): the same button and dialog as a
 * page's, a form's or a template's, beside the create actions of the lists
 * an email job and a campaign job fill.
 *
 * Both zones are hosted by the plugins that own the lists, on the
 * `hostScreens` contract (the site and its org), and this plugin restates
 * nothing else about them: `hostEmailTemplates` is the email plugin's list of
 * email designs, `hostCampaigns` the marketing plugin's list of campaigns.
 */

/**
 * An email design from a brief, on a site's email templates
 * (`hostEmailTemplates`). Its dialog also offers to draft the campaign that
 * would send it.
 */
export function AiDescribeEmailButton(props: ConsoleHostScreensZoneProps) {
  return <AiDescribeButton {...props} kind="email" />
}

/** An email and the draft campaign that sends it, on a site's Campaigns (`hostCampaigns`). */
export function AiDescribeCampaignButton(props: ConsoleHostScreensZoneProps) {
  return <AiDescribeButton {...props} kind="campaign" />
}

export default AiDescribeEmailButton
