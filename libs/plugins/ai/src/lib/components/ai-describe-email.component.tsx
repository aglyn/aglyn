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
 * page's, a form's or a template's, beside New template on the email
 * plugin's `hostEmailTemplates` zone (the `hostScreens` contract: the site
 * and its org). The Campaigns section's door is a widget of its own
 * (`ai-campaign-create.component`), on the marketing plugin's `hostCampaigns`.
 */

/**
 * An email design from a brief, on a site's email templates
 * (`hostEmailTemplates`). Its dialog also offers to draft the campaign that
 * would send it.
 */
export function AiDescribeEmailButton(props: ConsoleHostScreensZoneProps) {
  return <AiDescribeButton {...props} kind="email" />
}

export default AiDescribeEmailButton
