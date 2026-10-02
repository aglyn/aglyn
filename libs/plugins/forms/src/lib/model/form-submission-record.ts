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

import type { PluginIndexedRecord } from '@aglyn/aglyn/plugin-manager/plugin-record-index'

/**
 * A FORM SUBMISSION, as this plugin shares it with another (AGL-3080).
 *
 * Submissions are this plugin's records: its door (`/api/forms/submit`)
 * writes every one, its `/v1` resource serves them, its counters are what the
 * plan bills, and they live where it keeps them —
 * `hosts/{hostId}/formSubmissions/{id}`, which only this plugin names. The
 * Inbox is the console's reader of them, and reads, marks and threads them
 * through what this plugin publishes for the `formSubmission` kind: a list
 * source in the console (`form-submission-list.ts`) and a record index on the
 * server (`server/form-submission-index.ts`).
 *
 * ## The record, as a reader may rely on it
 *
 * Every stored document carries, from the moment the door writes it:
 * `hostId`, and `orgId` when the site has one (both frozen by the rules);
 * `formId` for a verified form entity; `formName` and `path`; `fields`, the
 * values as typed, keyed by field name; `senderTokens` and `searchTokens`,
 * the word-prefix keys a list filters and searches by; `read`, a boolean;
 * `createdAt`, the server time it arrived; and `campaignIds`, `routing` and
 * `rateDegraded` where they apply. A reader may change `read`, and stamp
 * `repliedAtMs` with `read` when it answers one; it may keep its own records
 * of what it did with one under the document (the Inbox's `replies` and
 * `listAssignments`). Nothing else on it is a reader's to write, and the
 * security rules hold the client half of that line.
 *
 * `null` for a document that holds nothing. Otherwise its id, a name — the
 * form it was sent to, as it was called when it arrived — and `facts`:
 * `hostId`, `formId` (`null` for a submission no form entity filed),
 * `formName`, `path`, `fields`, `read` and `createdAtMs` (`null` before the
 * server stamped it).
 */
export function formSubmissionIndexedRecord(
  id: string,
  data: Readonly<Record<string, unknown>> | undefined,
): PluginIndexedRecord | null {
  if (!data) return null
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  const formName = text(data['formName'])
  const createdAt = data['createdAt'] as { toMillis?: () => number } | null | undefined
  const createdAtMs =
    typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : null
  return {
    id,
    name: formName || 'Form',
    facts: {
      hostId: text(data['hostId']) || null,
      formId: text(data['formId']) || null,
      formName,
      path: text(data['path']),
      fields:
        data['fields'] && typeof data['fields'] === 'object' ? data['fields'] : {},
      read: data['read'] === true,
      createdAtMs,
    },
  }
}
