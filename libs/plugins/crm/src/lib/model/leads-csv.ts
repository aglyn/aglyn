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
 * The leads CSV — one file from the Leads section's Export button and the
 * bulk bar's (AGL-2662).
 *
 * A lead is a capture the CRM has annotated: what the door wrote (the
 * address, the name, every surface that met the person, when, how often)
 * and what the team wrote on top (a status, an owner, a reason, notes).
 * The file carries both. The status is written by its LABEL and an absent
 * one as `New`, the way the list reads it, and the owner by ADDRESS rather
 * than uid, the way every other CRM file writes one. The sources are joined
 * with `|` as the contacts file joins its multi-valued cells.
 *
 * At the organization level the same file gains a `Site` column, because a
 * row there is some site's lead and the file must say which; under a site
 * every row is the site's own and the column is not written. There is no
 * leads import — a lead is captured, not filed — so the header is free to
 * read well.
 */

import {
  CRM_LEAD_STATUS_LABELS,
  type CrmLeadFields,
  crmLeadStatus,
  csvDocument,
} from '@aglyn/aglyn'
import { leadSourceLabel, leadSources } from '../components/lead-history-card'
import { csvInstant } from './deals-csv'

/** As much of a lead row as the file reads. */
export type LeadCsvRow = Record<string, unknown> &
  Pick<
    CrmLeadFields,
    'status' | 'ownerUid' | 'notes' | 'unqualifiedReason' | 'convertedAtMs'
  > & {
    /** The site the lead lives under — what the `Site` column names. */
    hostId?: string
  }

export interface LeadCsvOptions {
  /** The owner's address for a stored uid; absent, the uid is written. */
  ownerEmail?: (uid: string) => string
  /**
   * The site's name for a row's `hostId`. Given, the file carries a `Site`
   * column — the organization-level file; absent, it does not.
   */
  siteName?: (hostId: string) => string | undefined
}

/** The columns every leads file carries, in the list's order. */
export const LEAD_CSV_COLUMNS = [
  'Email',
  'Name',
  'Status',
  'Owner',
  'Sources',
  'First seen',
  'Last seen',
  'Captures',
  'Unqualified reason',
  'Converted',
  'Notes',
] as const

/** The header row: the standard columns, with `Site` after `Owner` at the org level. */
export function leadCsvHeader(options: LeadCsvOptions = {}): string[] {
  const columns: string[] = [...LEAD_CSV_COLUMNS]
  if (options.siteName) columns.splice(columns.indexOf('Owner') + 1, 0, 'Site')
  return columns
}

/** Epoch millis or a Firestore timestamp as an ISO instant, or `''`. */
function leadInstant(value: unknown): string {
  if (typeof value === 'number') return csvInstant(value)
  const asDate = (value as { toDate?: () => Date } | null | undefined)?.toDate?.()
  return asDate ? asDate.toISOString() : ''
}

/** The whole file, header first. */
export function leadsCsv(
  rows: readonly LeadCsvRow[],
  options: LeadCsvOptions = {},
): string {
  const { ownerEmail, siteName } = options
  return csvDocument(
    leadCsvHeader(options),
    rows.map((lead) => {
      const hostId = String(lead.hostId ?? '')
      const sources = leadSources(lead).map(leadSourceLabel).join('|')
      const captures = Number(lead['submissionCount'] ?? 0)
      return [
        String(lead['email'] ?? ''),
        String(lead['name'] ?? ''),
        CRM_LEAD_STATUS_LABELS[crmLeadStatus(lead)],
        lead.ownerUid ? (ownerEmail?.(lead.ownerUid) ?? lead.ownerUid) : '',
        ...(siteName ? [siteName(hostId) ?? hostId] : []),
        sources,
        leadInstant(lead['firstSeenAtMs'] ?? lead['createdAt']),
        leadInstant(lead['lastSeenAtMs'] ?? lead['createdAt']),
        Number.isFinite(captures) && captures > 0 ? String(captures) : '',
        lead.unqualifiedReason ?? '',
        csvInstant(lead.convertedAtMs),
        lead.notes ?? '',
      ]
    }),
  )
}
