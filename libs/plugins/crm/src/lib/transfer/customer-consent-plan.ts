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

import {
  TRANSFER_FILE_SAMPLE_ROW,
  TRANSFER_WARNING_CLASSES,
  type PlannedTransferRow,
  type TransferFieldChange,
  type TransferPlan,
  type TransferPlanRow,
  type TransferPlanSummary,
  type TransferWarning,
  type TransferWarningSample,
} from '@aglyn/aglyn/data-transfer'
import {
  CUSTOMER_FIELD as C,
  CUSTOMER_FILE_SOURCE_NAMES,
  CUSTOMER_SOURCE_ONLY_FIELDS,
  MARKETING_CONSENT_FIELD_ID,
  readMarketingChoice,
  type CustomerFileSource,
} from './customer-sources'

/*==========================================
 * A STORE FILE'S MARKETING CHOICES, PLANNED (AGL-4245) — see the note of
 * `customer-sources.ts` for the rules. The server half: what each row's
 * choice comes to against the contact it matched, as a row change the apply
 * reads back, and the dry run's count of it.
 *=========================================*/


/** What the apply does with one row's choice, as the plan stamped it. */
export interface ImportedConsentDetail {
  action: 'grant' | 'decline'
  /** Who planned the import: the member who answered the Permission step. */
  by: string | null
  /** Whether that member confirmed these people agreed to hear from this business. */
  attested: boolean
  jobId: string | null
  /** The store the file came from, or `file` for one the import does not recognize. */
  source: CustomerFileSource | 'file'
}

/** A row's change to `marketingConsent`, carrying {@link ImportedConsentDetail}. */
export type ImportedConsentChange = TransferFieldChange & { consent: ImportedConsentDetail }

/** The consent change a planned row carries, if any. */
export function importedConsentChange(row: Pick<PlannedTransferRow, 'diff'>): ImportedConsentChange | null {
  const change = row.diff.find((entry) => entry.fieldId === MARKETING_CONSENT_FIELD_ID) as
    | Partial<ImportedConsentChange>
    | undefined
  const detail = change?.consent
  if (!change || !detail || (detail.action !== 'grant' && detail.action !== 'decline')) return null
  return change as ImportedConsentChange
}

/** The rows with every import-only value taken out, for the core's plan. */
export function withoutCustomerSourceFields(rows: readonly TransferPlanRow[]): TransferPlanRow[] {
  return rows.map((row) => {
    if (!CUSTOMER_SOURCE_ONLY_FIELDS.some((fieldId) => fieldId in row.values)) return row
    const values = { ...row.values }
    for (const fieldId of CUSTOMER_SOURCE_ONLY_FIELDS) delete values[fieldId]
    return { ...row, values }
  })
}

/** What the plan needs to know beside the rows. */
export interface ContactConsentPlanContext {
  /** The site the consent is recorded for; `null` for an import with no Source site. */
  hostId: string | null
  /** The Permission step's statement. */
  attested: boolean
  /** The member planning the import. */
  recordedBy: string | null
  jobId: string | null
  source: CustomerFileSource | null
  /** Addresses the site's unsubscribe list holds, lowercased. */
  suppressed: ReadonlySet<string>
}

/** What the file's choices come to, counted for the dry run. */
export interface ContactConsentCounts {
  optedIn: number
  unsubscribes: number
  /** Of the unsubscribes, people who were subscribed here. */
  unsubscribedFromSubscribed: number
  noConsent: number
  alreadySame: number
  notConfirmed: number
  keptUnsubscribed: number
  noSite: number
  noEmail: number
  unread: number
  unreadSample: string | null
}

const emptyCounts = (): ContactConsentCounts => ({
  optedIn: 0,
  unsubscribes: 0,
  unsubscribedFromSubscribed: 0,
  noConsent: 0,
  alreadySame: 0,
  notConfirmed: 0,
  keptUnsubscribed: 0,
  noSite: 0,
  noEmail: 0,
  unread: 0,
  unreadSample: null,
})

const lower = (value: unknown) => (value === null || value === undefined ? '' : String(value).trim().toLowerCase())

/** Whether any row carries the column. */
const carries = (rows: readonly TransferPlanRow[], fieldId: string) => rows.some((row) => fieldId in row.values)

/** The address a row is about: the file's, else the matched contact's. */
export function consentRowEmail(
  row: TransferPlanRow | undefined,
  planned: PlannedTransferRow,
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): string {
  const before = planned.recordId ? existing.get(planned.recordId) : undefined
  return lower(row?.values['email']) || lower(before?.['email'])
}

/** The addresses whose file opt-in the plan may carry, for the unsubscribe-list read. */
export function consentOptInEmails(
  plan: Pick<TransferPlan, 'rows'>,
  rows: readonly TransferPlanRow[],
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): string[] {
  const byIndex = new Map(rows.map((row) => [row.index, row]))
  const out = new Set<string>()
  for (const planned of plan.rows) {
    const row = byIndex.get(planned.index)
    if (!row || readMarketingChoice(row.values[C.emailMarketing]).choice !== 'optIn') continue
    const email = consentRowEmail(row, planned, existing)
    if (email) out.add(email)
  }
  return [...out]
}

const n = (count: number) => count.toLocaleString('en-US')
const people = (count: number) => `${n(count)} ${count === 1 ? 'person' : 'people'}`

/** The dry run's lines about the file's marketing choices and what is not kept. */
export function contactConsentSamples(
  counts: ContactConsentCounts | null,
  notes: { sms: boolean; spend: boolean },
  ctx: Pick<ContactConsentPlanContext, 'source'>,
): TransferWarningSample[] {
  const where = ctx.source ? `your ${CUSTOMER_FILE_SOURCE_NAMES[ctx.source]} file` : 'the file'
  const line = (fieldId: string, value: number | string, detail: string): TransferWarningSample => ({
    row: TRANSFER_FILE_SAMPLE_ROW,
    fieldId,
    value: typeof value === 'number' ? n(value) : value,
    detail,
  })
  const samples: TransferWarningSample[] = []
  const F = C.emailMarketing
  if (counts) {
    samples.push(
      line(
        F,
        counts.optedIn,
        counts.optedIn
          ? `${people(counts.optedIn)} will be opted in to marketing email, as ${where} records and as you confirmed they agreed to hear from you.`
          : 'Nobody will be opted in to marketing email from this file.',
      ),
      line(
        F,
        counts.unsubscribes,
        counts.unsubscribes
          ? `${n(counts.unsubscribes)} ${counts.unsubscribes === 1 ? 'unsubscribe' : 'unsubscribes'} from ${where} will be kept` +
              (counts.unsubscribedFromSubscribed
                ? `, and ${people(counts.unsubscribedFromSubscribed)} subscribed here will be unsubscribed.`
                : '.')
          : 'No unsubscribes in this file change anything here.',
      ),
      line(
        F,
        counts.noConsent,
        `${people(counts.noConsent)} ${counts.noConsent === 1 ? 'has' : 'have'} no marketing choice recorded, and nothing about their marketing email changes.`,
      ),
    )
    if (counts.notConfirmed) {
      samples.push(
        line(
          F,
          counts.notConfirmed,
          `${people(counts.notConfirmed)} said yes in ${where} but will not be opted in, because you did not confirm on the Permission step that they agreed to hear from you.`,
        ),
      )
    }
    if (counts.keptUnsubscribed) {
      samples.push(
        line(
          F,
          counts.keptUnsubscribed,
          `${people(counts.keptUnsubscribed)} said yes in ${where} but unsubscribed here, so they stay unsubscribed.`,
        ),
      )
    }
    if (counts.noSite) {
      samples.push(
        line(
          F,
          counts.noSite,
          `${people(counts.noSite)} said yes in ${where} but will not be opted in, because the import names no site. Import under the site they signed up on to bring opt-ins in.`,
        ),
      )
    }
    if (counts.alreadySame) {
      samples.push(line(F, counts.alreadySame, `${people(counts.alreadySame)} already ${counts.alreadySame === 1 ? 'has' : 'have'} the same choice recorded here.`))
    }
    if (counts.noEmail) {
      samples.push(
        line(F, counts.noEmail, `${people(counts.noEmail)} ${counts.noEmail === 1 ? 'has' : 'have'} a marketing choice but no email address, so it is not kept.`),
      )
    }
    if (counts.unread) {
      samples.push(
        line(
          F,
          counts.unreadSample ?? n(counts.unread),
          `${n(counts.unread)} marketing ${counts.unread === 1 ? 'value' : 'values'} could not be read, and count as no choice.`,
        ),
      )
    }
  }
  if (notes.sms) {
    samples.push(
      line(C.smsMarketing, '', 'The text message marketing column is not kept: marketing texts are not sent from here, so nobody is opted in to them.'),
    )
  }
  if (notes.spend) {
    samples.push(
      line(C.totalSpent, '', 'Total spent and order counts from your old store are not kept. A contact’s spend counts what they buy on your site.'),
    )
  }
  return samples
}

/** The summary of `rows`, counted again. */
function summaryOf(rows: readonly PlannedTransferRow[]): TransferPlanSummary {
  const summary: TransferPlanSummary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  return summary
}

/**
 * The plan with the file's marketing choices carried (see the module note):
 * each opt-in it may carry and each opt-out that changes something becomes a
 * `marketingConsent` change on its row — an otherwise unchanged row becomes
 * an update — and the dry run gains one `screening` warning counting what
 * happens and what is not kept. A file with none of the columns is returned
 * as it came.
 *
 * `rows` are the rows as the file read them, import-only values included;
 * `existing` holds each matched contact's values, `marketingConsent` read
 * for the import's site (`true`, `false` or `null`).
 */
export function planContactConsent(
  plan: TransferPlan,
  rows: readonly TransferPlanRow[],
  existing: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  ctx: ContactConsentPlanContext,
): { plan: TransferPlan; counts: ContactConsentCounts | null } {
  const notes = { sms: carries(rows, C.smsMarketing), spend: carries(rows, C.totalSpent) || carries(rows, C.orderCount) }
  const mapped = carries(rows, C.emailMarketing)
  if (!mapped && !notes.sms && !notes.spend) return { plan, counts: null }

  const counts = mapped ? emptyCounts() : null
  const byIndex = new Map(rows.map((row) => [row.index, row]))
  const planned = plan.rows.map((plannedRow): PlannedTransferRow => {
    if (!counts) return plannedRow
    if (plannedRow.verdict !== 'create' && plannedRow.verdict !== 'update' && plannedRow.verdict !== 'unchanged') {
      return plannedRow
    }
    const row = byIndex.get(plannedRow.index)
    const raw = row?.values[C.emailMarketing]
    const { choice, read } = readMarketingChoice(raw)
    if (!read) {
      counts.unread += 1
      counts.unreadSample ??= String(raw ?? '').slice(0, 40)
    }
    const email = consentRowEmail(row, plannedRow, existing)
    const before = plannedRow.recordId ? existing.get(plannedRow.recordId)?.[MARKETING_CONSENT_FIELD_ID] : null
    const stored = before === true ? true : before === false ? false : null
    if (choice === 'none') {
      counts.noConsent += 1
      return plannedRow
    }
    if (!email) {
      counts.noEmail += 1
      return plannedRow
    }
    let action: ImportedConsentDetail['action'] | null = null
    if (choice === 'optOut') {
      if (stored === false) counts.alreadySame += 1
      else {
        action = 'decline'
        counts.unsubscribes += 1
        if (stored === true) counts.unsubscribedFromSubscribed += 1
      }
    } else if (!ctx.hostId) counts.noSite += 1
    else if (stored === false || ctx.suppressed.has(email)) counts.keptUnsubscribed += 1
    else if (stored === true) counts.alreadySame += 1
    else if (!ctx.attested) counts.notConfirmed += 1
    else {
      action = 'grant'
      counts.optedIn += 1
    }
    if (!action) return plannedRow
    const change: ImportedConsentChange = {
      fieldId: MARKETING_CONSENT_FIELD_ID,
      before: stored,
      after: action === 'grant',
      mode: 'overwrite',
      source: 'locked',
      rule: 'written',
      consent: {
        action,
        by: ctx.recordedBy,
        attested: ctx.attested,
        jobId: ctx.jobId,
        source: ctx.source ?? 'file',
      },
    }
    return {
      ...plannedRow,
      verdict: plannedRow.verdict === 'unchanged' ? 'update' : plannedRow.verdict,
      diff: [...plannedRow.diff.filter((entry) => entry.fieldId !== MARKETING_CONSENT_FIELD_ID), change],
    }
  })

  const samples = contactConsentSamples(counts, notes, ctx)
  const warning: TransferWarning = {
    class: 'screening',
    count: samples.length,
    rows: 0,
    fieldIds: [...new Set(samples.map((sample) => sample.fieldId).filter((id): id is string => Boolean(id)))],
    samples,
    requiresAcknowledgement: true,
  }
  const prior = plan.warnings.find((entry) => entry.class === 'screening')
  const warnings = prior
    ? plan.warnings.map((entry) =>
        entry === prior
          ? {
              ...prior,
              count: prior.count + warning.count,
              fieldIds: [...new Set([...prior.fieldIds, ...warning.fieldIds])],
              samples: [...prior.samples, ...samples],
              requiresAcknowledgement: true,
            }
          : entry,
      )
    : [...plan.warnings, warning]
  // The core's order of classes, kept.
  warnings.sort((a, b) => TRANSFER_WARNING_CLASSES.indexOf(a.class) - TRANSFER_WARNING_CLASSES.indexOf(b.class))
  return {
    plan: {
      rows: planned,
      summary: summaryOf(planned),
      warnings,
      acknowledgementsRequired: warnings.filter((entry) => entry.requiresAcknowledgement).map((entry) => entry.class),
    },
    counts,
  }
}
