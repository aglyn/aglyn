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

import EmailComposeCard from './email-compose-card'
import EmailDetail from './email-detail'
import EmailsListCard from './emails-list-card'

/** What the Emails page's Messages zone hands a widget. */
export interface EmailMessagesWidgetProps {
  hostId: string
  /** The Emails page's own base path; every link a message draws is under it. */
  basePath: string
  /** The segments under `messages`. */
  detail: readonly string[]
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
 */
export function EmailMessagesWidget(props: EmailMessagesWidgetProps) {
  const { hostId, basePath, detail } = props
  return detail[0] ? (
    detail[1] === 'edit' ? (
      <EmailComposeCard hostId={hostId} emailId={detail[0]} basePath={basePath} />
    ) : (
      <EmailDetail hostId={hostId} emailId={detail[0]} basePath={basePath} />
    )
  ) : (
    <EmailsListCard hostId={hostId} basePath={basePath} />
  )
}

export default EmailMessagesWidget
