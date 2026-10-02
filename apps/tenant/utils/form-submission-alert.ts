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

import type { PluginConversionDescription } from '@aglyn/aglyn/plugin-manager/plugin-conversion-credit'

/**
 * WHAT A FORM SUBMISSION'S ALERT SAYS, AND WHERE IT OPENS (AGL-3461).
 *
 * One alert per submission to the site's managers, in the bell and — for a
 * manager who switched it on — by email. Both read the same payload, so the
 * email says what the bell says and opens the same page.
 *
 * ## It opens the submission, not the list
 *
 * The submission's reader carries what the alert cannot: the fields, the
 * form, the page, the lead or contact it filed and the campaigns, each as a
 * link. A notification holds one link, so that one link is the reader, and
 * "open the lead" and "open the campaign" are a click inside it.
 *
 * The link is stored in the host-link shape every host notification uses
 * (`/{hostDocId}/…`), which the console and the email both rewrite onto the
 * site's current address when it is followed (`normalizeNotificationLink`).
 * The rest of it is the address the Inbox publishes for one submission in
 * the record-route registry — `inbox/submissions?submission={id}` — and a
 * spec holds the two together, because the registry itself lives in the
 * console and this is written by the site.
 *
 * ## It names the form, the page and the campaign
 *
 * A manager of several sites reads the body without the subject, so the body
 * says on its own which form took it and on which page. When the plugin that
 * credits campaigns can name them, it also says which campaign the visitor
 * arrived through ("credited to") and which the form and page are filed
 * under — two different facts, kept in two sentences: a submission can be
 * filed under one campaign and credited to another, or to none.
 */

/** The longest page path the body prints. */
const MAX_PATH = 500

/** How many campaigns "filed under" names before it summarizes the rest. */
const MAX_FILED_NAMES = 3

/** The Inbox's path for one submission, under a site's console address. */
export function formSubmissionAlertLink(hostId: string, submissionId: string): string {
  const query = new URLSearchParams({ submission: submissionId }).toString()
  return `/${hostId}/inbox/submissions?${query}`
}

/** `“A”`, `“A” and “B”`, `“A”, “B” and 2 more`. */
function quotedList(labels: readonly string[]): string {
  const quoted = labels.map((label) => `“${label}”`)
  if (quoted.length <= 1) return quoted.join('')
  if (quoted.length <= MAX_FILED_NAMES) {
    return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
  }
  const shown = quoted.slice(0, MAX_FILED_NAMES - 1)
  return `${shown.join(', ')} and ${quoted.length - shown.length} more`
}

/**
 * The alert's body. `{site}` is left for `notifyHostManagers`, which fills
 * it from the host document it already reads.
 */
export function formSubmissionAlertBody(options: {
  formName: string
  path?: unknown
  description?: PluginConversionDescription | null
}): string {
  const { formName, description } = options
  const path = typeof options.path === 'string' ? options.path.slice(0, MAX_PATH) : ''
  const sentences = [
    `Someone submitted “${formName}” on {site}` + (path ? ` (page ${path}).` : '.'),
  ]
  const credited = description?.credited
  if (credited?.label) {
    sentences.push(`Credited to “${credited.label}”: the visitor ${credited.how}.`)
  }
  const filed = (description?.filedUnder ?? [])
    .map((entry) => String(entry?.label ?? '').trim())
    .filter(Boolean)
  if (filed.length) {
    sentences.push(`The form and page are filed under ${quotedList(filed)}.`)
  }
  return sentences.join(' ')
}
