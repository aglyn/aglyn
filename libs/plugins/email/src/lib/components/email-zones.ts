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
import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'

/**
 * The Messages section of the Emails page.
 *
 * A message is one email that was or will be sent. Writing one, scheduling
 * it, sending it and reporting what came of it are a campaign's work — the
 * routes that do all of it are served by whichever plugin owns campaigns — so
 * this plugin hosts the section and that plugin draws it. What is handed over
 * is what the shell handed this page: the site, this page's own base path,
 * and the segments under `messages` (`[]` the list, `[id]` one message,
 * `[id, 'edit']` its composer).
 *
 * The same zone serves the ORGANIZATION's Emails page, `/[orgSlug]/emails`,
 * where there is no site: `hostId` is `null` and `orgMount` names the org and
 * its sites, so the widget can list every site's messages and ask which site
 * a new one is sent as. Every message link a widget draws hangs beneath
 * `basePath` at both levels — `${basePath}/messages/{id}`.
 */
export interface EmailMessagesZoneProps {
  /** The site, or `null` on the organization's Emails page. */
  hostId: string | null
  /** The Emails page's own path, under the site or the organization. */
  basePath: string
  detail: readonly string[]
  /** The organization and its sites — present only when `hostId` is `null`. */
  orgMount?: ConsolePluginOrgMount
}

export const EMAIL_MESSAGES_ZONE =
  definePluginZone<EmailMessagesZoneProps>('emailMessages')

/**
 * Who received the messages built from one template, under its report.
 *
 * The template is this plugin's; the recipients of a send are read through
 * the campaign owner's route, so the table is that plugin's to draw.
 */
export interface EmailTemplateRecipientsZoneProps {
  hostId: string
  screenId: string
}

export const EMAIL_TEMPLATE_RECIPIENTS_ZONE =
  definePluginZone<EmailTemplateRecipientsZoneProps>('emailTemplateRecipients')
