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
 * The deals CSV — one file from the table's Export button and the bulk
 * bar's (AGL-2621).
 *
 * A deal names its stage, its owner, its contact and its company by id, and
 * an id is nothing a spreadsheet can read: the stage and the pipeline are
 * written by NAME, resolved through the caller's pipelines, the owner by
 * address, and the contact and the company by the names the deal already
 * carries as captions. The amount is written in major units (`1250.00`),
 * with the currency beside it, because a column of cents is a column
 * somebody will sum wrongly.
 *
 * There is no deals import, so the header is free to read well; it stays
 * in the table's column order so the file and the screen agree.
 */

import { csvDocument } from '@aglyn/aglyn'
import {
  DEAL_STATUS_LABELS,
  DEFAULT_DEAL_CURRENCY,
  type DealDoc,
  dateInputValue,
} from './deal-board-model'

/** As much of a deal row as the file reads. */
export type DealCsvRow = Partial<
  Pick<
    DealDoc,
    | 'title'
    | 'pipelineId'
    | 'stageId'
    | 'status'
    | 'amountCents'
    | 'currency'
    | 'ownerUid'
    | 'expectedCloseAtMs'
    | 'closedAtMs'
    | 'contactName'
    | 'companyName'
    | 'lostReason'
    | 'notes'
  >
>

export interface DealCsvOptions {
  /** The pipeline's name for a stored id; absent, the id is written. */
  pipelineName?: (pipelineId: string) => string | undefined
  /** The stage's name within its pipeline; absent, the stage id is written. */
  stageName?: (pipelineId: string, stageId: string) => string | undefined
  /** The owner's address for a stored uid; absent, the uid is written. */
  ownerEmail?: (uid: string) => string
}

export const DEAL_CSV_COLUMNS = [
  'Title',
  'Pipeline',
  'Stage',
  'Amount',
  'Currency',
  'Owner',
  'Expected close',
  'Status',
  'Contact',
  'Company',
  'Closed',
  'Lost reason',
  'Notes',
] as const

/** Cents as a major-unit decimal — `125000` → `1250.00`; `''` for none. */
export function csvAmount(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents)
    ? (cents / 100).toFixed(2)
    : ''
}

/** An epoch as an ISO timestamp, or `''` for none. */
export function csvInstant(ms: number | null | undefined): string {
  return typeof ms === 'number' && Number.isFinite(ms)
    ? new Date(ms).toISOString()
    : ''
}

/** The whole file, header first. */
export function dealsCsv(
  rows: readonly DealCsvRow[],
  options: DealCsvOptions = {},
): string {
  const { pipelineName, stageName, ownerEmail } = options
  return csvDocument(
    DEAL_CSV_COLUMNS,
    rows.map((deal) => {
      const pipelineId = deal.pipelineId ?? ''
      const stageId = deal.stageId ?? ''
      return [
        deal.title ?? '',
        pipelineName?.(pipelineId) ?? pipelineId,
        stageName?.(pipelineId, stageId) ?? stageId,
        csvAmount(deal.amountCents),
        typeof deal.amountCents === 'number'
          ? String(deal.currency || DEFAULT_DEAL_CURRENCY).toUpperCase()
          : '',
        deal.ownerUid ? (ownerEmail?.(deal.ownerUid) ?? deal.ownerUid) : '',
        // A close DATE, in the reader's own zone — stored at local noon, so
        // the calendar day is what comes back out.
        dateInputValue(deal.expectedCloseAtMs),
        deal.status ? (DEAL_STATUS_LABELS[deal.status] ?? deal.status) : '',
        deal.contactName ?? '',
        deal.companyName ?? '',
        csvInstant(deal.closedAtMs),
        deal.lostReason ?? '',
        deal.notes ?? '',
      ]
    }),
  )
}
