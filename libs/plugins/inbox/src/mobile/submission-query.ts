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
 * WHICH SUBMISSIONS THE APP'S INBOX ASKS FOR (AGL-3622), as plain data.
 *
 * The console's Submissions card picks one of three declarations and a
 * scope (`../lib/constants/list-queries.ts`) and plans every clause and the
 * search word onto ONE Firestore query. The app picks the same way:
 *
 *  - a site's Inbox: `hosts/{hostId}/formSubmissions` under
 *    `SUBMISSION_LIST_QUERY`;
 *  - one form's submissions (the Forms screens hand a form over): the same
 *    collection under `FORM_SCOPED_SUBMISSION_LIST_QUERY` and the
 *    `formId ==` scope, which no clause can widen;
 *  - every site's, on the organization's Inbox: the `formSubmissions`
 *    collection group under `ORG_SUBMISSION_LIST_QUERY` and the `orgId ==`
 *    scope the rules require of that group read (an org-wide member only).
 *
 * Read is the console's Read filter (the stored boolean), asked by the
 * words the console offers it by.
 */

import type {
  ListQueryDeclaration,
  ListQueryRequest,
} from '@aglyn/shared-util-tools/list-query/list-query-plan'
import {
  FORM_SCOPED_SUBMISSION_LIST_QUERY,
  ORG_SUBMISSION_LIST_QUERY,
  SUBMISSION_LIST_QUERY,
  SUBMISSION_READ_OPTIONS,
  formSubmissionBase,
  orgSubmissionBase,
} from '../lib/constants/list-queries'

/** The collection the forms plugin keeps a site's submissions in. */
export const FORM_SUBMISSIONS_COLLECTION = 'formSubmissions'

/** Every row, or the stored `read` boolean by the console's words. */
export type SubmissionReadFilter = 'all' | 'false' | 'true'

/** The Read chips: All, then the console's own options (Unread, Read). */
export const SUBMISSION_READ_CHOICES: readonly { value: SubmissionReadFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...SUBMISSION_READ_OPTIONS.map((option) => ({
    value: option.value as SubmissionReadFilter,
    label: option.label,
  })),
]

export type SubmissionScope = 'site' | 'org'

export interface SubmissionListAsk {
  scope: SubmissionScope
  hostId: string | null
  orgId: string | null
  /** One form's submissions; a site scope only. */
  formId?: string | null
  read: SubmissionReadFilter
  /** The quick search's words. */
  search: readonly string[]
}

export type SubmissionListSource =
  | { kind: 'collection'; path: readonly string[] }
  | { kind: 'group'; collectionId: string }

export interface SubmissionListSpec {
  source: SubmissionListSource
  declaration: ListQueryDeclaration
  request: ListQueryRequest
}

/** The query the console's card would run for this ask, or null while it has no subject. */
export function submissionListSpec(ask: SubmissionListAsk): SubmissionListSpec | null {
  const clauses = ask.read === 'all' ? [] : [{ field: 'read', op: 'equals', value: ask.read }]
  const search = ask.search.filter((word) => word.trim())
  if (ask.scope === 'org') {
    if (!ask.orgId) return null
    return {
      source: { kind: 'group', collectionId: FORM_SUBMISSIONS_COLLECTION },
      declaration: ORG_SUBMISSION_LIST_QUERY,
      request: { clauses, search, base: orgSubmissionBase(ask.orgId) },
    }
  }
  if (!ask.hostId) return null
  const source = {
    kind: 'collection' as const,
    path: ['hosts', ask.hostId, FORM_SUBMISSIONS_COLLECTION],
  }
  if (ask.formId) {
    return {
      source,
      declaration: FORM_SCOPED_SUBMISSION_LIST_QUERY,
      request: { clauses, search, base: formSubmissionBase(ask.formId) },
    }
  }
  return { source, declaration: SUBMISSION_LIST_QUERY, request: { clauses, search } }
}

/** A submission row as the list and the reader read it. */
export interface SubmissionRow {
  $id: string
  hostId?: string
  orgId?: string
  formId?: string
  formName?: string
  path?: string
  fields?: Record<string, unknown>
  read?: boolean
  createdAt?: { toMillis?: () => number } | null
  routing?: Record<string, unknown>
  capturedRecord?: { kind?: string; id?: string } | null
  campaignIds?: unknown
  pageCampaignIds?: unknown
  repliedAtMs?: number
}

/** When it arrived, in epoch ms, or undefined before the server stamped it. */
export function receivedAtMs(row: Pick<SubmissionRow, 'createdAt'> | null | undefined): number | undefined {
  const value = row?.createdAt?.toMillis?.()
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The site a row lives on, which every act on it is addressed to: the list's
 * own site, or, across every site, the `hostId` the submit route stamped
 * (frozen by the rules, so it names the document's real parent).
 */
export function submissionSite(row: Pick<SubmissionRow, 'hostId'>, listHostId: string | null): string | null {
  if (listHostId) return listHostId
  return typeof row.hostId === 'string' && row.hostId ? row.hostId : null
}

/** Every field of a message as one line, the console list's Message column. */
export function messageTextOf(row: Pick<SubmissionRow, 'fields'>): string {
  return Object.entries(row.fields ?? {})
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ')
}

/**
 * The host roles that decide what a member may do with a submission, as
 * the rules and the reply route read `hosts/{hostId}.memberRoles`:
 * marking read and deleting are `canWriteHostContent` (admin, editor,
 * author); a reply is the route's admin-or-editor check.
 */
export function submissionPermissions(role: unknown): { canWrite: boolean; canReply: boolean } {
  const value = typeof role === 'string' ? role : ''
  return {
    canWrite: value === 'admin' || value === 'editor' || value === 'author',
    canReply: value === 'admin' || value === 'editor',
  }
}

/** A field the form declares, as `hosts/{hostId}/forms/{formId}.fields` holds it. */
export interface DeclaredFormField {
  fieldName?: unknown
  label?: unknown
}

/**
 * A submission's values in the order its form declares them, each under the
 * form's label for it; values the form does not declare (a field since
 * removed, or a submission no form entity filed) follow in their stored
 * order under their own key.
 */
export function orderedSubmissionFields(
  fields: Record<string, unknown> | undefined,
  declared: readonly DeclaredFormField[] | null | undefined,
): { key: string; label: string; value: string }[] {
  const values = fields ?? {}
  const shown = new Set<string>()
  const ordered: { key: string; label: string; value: string }[] = []
  for (const field of Array.isArray(declared) ? declared : []) {
    const key = typeof field?.fieldName === 'string' ? field.fieldName : ''
    if (!key || shown.has(key) || !(key in values)) continue
    shown.add(key)
    const label = typeof field.label === 'string' && field.label.trim() ? field.label.trim() : key
    ordered.push({ key, label, value: String(values[key]) })
  }
  for (const [key, value] of Object.entries(values)) {
    if (!shown.has(key)) ordered.push({ key, label: key, value: String(value) })
  }
  return ordered
}
