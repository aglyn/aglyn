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

import { normalizeContainerIds } from '@aglyn/aglyn/app-utils/container-membership'

/**
 * WHAT AN OPEN SUBMISSION LINKS TO (AGL-3461).
 *
 * A submission names the form that took it, the page it was on and — since
 * the submit route stamps it — the lead or contact the record system filed
 * for its sender. Each is somebody else's record: the form is the Forms
 * plugin's, the person the CRM's, and the page is the live site. So each
 * link is asked of the owner (`hrefOf`, the record-route registry) and falls
 * back to plain text when no plugin answers, rather than to a URL this
 * plugin spelled for them.
 */

/** The record the submit route stamps once the person is filed. */
export interface SubmissionCapturedRecord {
  kind?: string
  id?: string
}

/** The fields of a submission row this module reads. */
export interface SubmissionLinkSource {
  formId?: unknown
  formName?: unknown
  path?: unknown
  campaignIds?: unknown
  pageCampaignIds?: unknown
  capturedRecord?: SubmissionCapturedRecord | null
}

/** One line of the reader's "where it came in" block. */
export interface SubmissionLink {
  key: 'form' | 'page' | 'record'
  /** What the line is: `Form`, `Page`, `Lead`, `Contact`. */
  label: string
  /** What the link reads. */
  text: string
  /** Where it goes, or `null` to draw `text` plainly. */
  href: string | null
  /** The live site, which opens beside the console rather than over it. */
  external?: boolean
}

/** The record kinds a captured person may be filed as. */
const PERSON_KINDS: Record<string, string> = { lead: 'Lead', contact: 'Contact' }

/**
 * The submission's form, page and filed person, in that order, each with the
 * link its owner publishes. A line whose fact the row does not carry is
 * left out rather than drawn empty.
 */
export function submissionLinks(options: {
  submission: SubmissionLinkSource
  /** The record-route registry's answer for one record, or `null`. */
  hrefOf: (kind: string, id: string) => string | null
  /** The site's public origin, `https://…`, or `null` when unknown. */
  siteOrigin: string | null
}): SubmissionLink[] {
  const { submission, hrefOf, siteOrigin } = options
  const links: SubmissionLink[] = []
  const formId = typeof submission.formId === 'string' ? submission.formId : ''
  const formName =
    typeof submission.formName === 'string' && submission.formName.trim()
      ? submission.formName.trim()
      : 'Form'
  if (formId || typeof submission.formName === 'string') {
    links.push({
      key: 'form',
      label: 'Form',
      text: formName,
      href: formId ? hrefOf('form', formId) : null,
    })
  }
  const path = typeof submission.path === 'string' ? submission.path.trim() : ''
  if (path) {
    // Only a site-relative path is joined to the origin; anything else is a
    // value somebody else wrote, and is shown rather than followed.
    const relative = path.startsWith('/') && !path.startsWith('//')
    links.push({
      key: 'page',
      label: 'Page',
      text: path,
      href: relative && siteOrigin ? `${siteOrigin}${path}` : null,
      external: true,
    })
  }
  const captured = submission.capturedRecord
  const kind = typeof captured?.kind === 'string' ? captured.kind : ''
  const id = typeof captured?.id === 'string' ? captured.id : ''
  if (PERSON_KINDS[kind] && id) {
    links.push({
      key: 'record',
      label: PERSON_KINDS[kind],
      text: kind === 'lead' ? 'Open the lead' : 'Open the contact',
      href: hrefOf(kind, id),
    })
  }
  return links
}

/**
 * The campaigns a submission is FILED under: its form's, then its page's,
 * deduped — the two stamps the submit route writes when it arrives.
 */
export function submissionFiledUnder(submission: SubmissionLinkSource | null | undefined): string[] {
  return normalizeContainerIds([
    ...(Array.isArray(submission?.campaignIds) ? submission.campaignIds : []),
    ...(Array.isArray(submission?.pageCampaignIds) ? submission.pageCampaignIds : []),
  ])
}
