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

import type { ConsolePluginOrgMount } from '@aglyn/aglyn'
import { useMemo } from 'react'
import EmailComposeCard from './email-compose-card'
import EmailDetail from './email-detail'
import EmailsListCard from './emails-list-card'
import {
  MarketingOrgMountProvider,
  type MarketingOrgMount,
} from './marketing-org-mount'
import { orgMarketingHubPath } from './use-emails-hub-path'

/** What the Emails page's Messages zone hands a widget. */
export interface EmailMessagesWidgetProps {
  /** The site, or `null` on the organization's Emails page. */
  hostId: string | null
  /**
   * The Emails page's own base path, under the site or the organization.
   * Every link a message draws to another message page is beneath it.
   */
  basePath: string
  /** The segments under `messages`. */
  detail: readonly string[]
  /** The org and its sites, when the page is the organization's. */
  orgMount?: ConsolePluginOrgMount
}

/**
 * The Messages section of the Emails page, drawn by the plugin that sends.
 *
 * `/emails/messages` lists them, `…/{emailId}` reports on one and
 * `…/{emailId}/edit` writes it. A message is one send of a campaign — every
 * action on all three pages is a call to this plugin's own routes — so the
 * pages live here and the page that owns the URL hosts them in a zone.
 *
 * Ternaries rather than a lookup: only the branch taken is CONSTRUCTED, and
 * each card opens its listens on mount. Somebody reading a report does not
 * pay for the composer's.
 *
 * ## On the organization's Emails page
 *
 * Handed no site, the same three cards read the org's sends unfiltered — a
 * Site column on the list, and every action naming the site a message is sent
 * as. They learn the org and its sites from the Marketing org mount, which
 * this widget publishes from the shell's own; its `basePath` is the
 * organization's Marketing page, which is where a campaign's own page is.
 */
export function EmailMessagesWidget(props: EmailMessagesWidgetProps) {
  const { hostId, basePath, detail, orgMount } = props
  /*
   * Memoized because every card below reads it through context, and a fresh
   * object each render would re-render all of them for nothing.
   */
  const mount = useMemo<MarketingOrgMount | null>(
    () =>
      hostId == null && orgMount
        ? {
            orgId: orgMount.orgId,
            orgSlug: orgMount.orgSlug,
            hosts: orgMount.hosts,
            hostsReady: orgMount.hostsReady,
            hostsPath: orgMount.hostsPath,
            basePath: orgMarketingHubPath(orgMount.orgSlug),
          }
        : null,
    [hostId, orgMount],
  )
  // No site and no org to stand in for it: nothing these cards can scope.
  if (hostId == null && !mount) return null

  const body = detail[0] ? (
    detail[1] === 'edit' ? (
      <EmailComposeCard hostId={hostId} emailId={detail[0]} basePath={basePath} />
    ) : (
      <EmailDetail hostId={hostId} emailId={detail[0]} basePath={basePath} />
    )
  ) : (
    <EmailsListCard hostId={hostId} basePath={basePath} />
  )
  return mount ? (
    <MarketingOrgMountProvider value={mount}>{body}</MarketingOrgMountProvider>
  ) : (
    body
  )
}

export default EmailMessagesWidget
