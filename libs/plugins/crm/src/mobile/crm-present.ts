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

import type { ConsentGroup } from '@aglyn/aglyn/app-utils/consent-groups'
import { contactDisplayName, readContactFacet } from '@aglyn/aglyn/app-utils/contacts'
import {
  CONTACT_LIFECYCLE_STAGE_LABELS,
  type ContactLifecycleStage,
  type CrmPicklist,
  crmLeadStatusLabel,
} from '@aglyn/aglyn/app-utils/crm'
import { contactPrimaryGroup } from '../lib/model/contact-holder'
import { DEAL_STATUS_LABELS, formatMoney, sortedStages, timestampMs, type PipelineDoc } from '../lib/model/deal-board-model'
import type { CrmListKind } from './crm-lists'
import type { CrmRow } from './use-crm-list'

/*
 * How a CRM record reads in the app (AGL-3622): the facts the console's
 * record page heads with, and the ways to reach the person. Pure, so the
 * list row, the detail and the specs read them alike.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The holder a contact is read through: the viewing site's group, else its own first holder. */
export function contactGroupFor(
  row: Record<string, unknown> | null,
  viewing: ConsentGroup | null,
  org: Record<string, unknown> | null,
): ConsentGroup {
  return viewing ?? contactPrimaryGroup(row, org)
}

/** What the page needs to say about the people a list reads. */
export interface CrmPresentContext {
  /** The org's lead status values. */
  leadStatuses?: CrmPicklist
  /** The site the reader views as, or null at the organization level. */
  viewing: ConsentGroup | null
  org: Record<string, unknown> | null
  /** A deal's pipeline, for its stage's name. */
  pipelineById?: (id: unknown) => PipelineDoc | null
  /** How an owner reads. */
  ownerLabel?: (uid: unknown) => string
}

/** A stored instant as epoch ms: a number, a `Timestamp`, a `Date`. */
export const crmMs = (value: unknown): number | null => timestampMs(value)

/** A day the reader recognizes: `Oct 7, 2026`. */
export function crmDate(ms: number | null): string {
  if (ms === null) return ''
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The name a record is listed by: its name, else its address, else its id. */
export function crmTitle(kind: CrmListKind, row: CrmRow, context: CrmPresentContext): string {
  switch (kind) {
    case 'leads':
      return text(row['name']) || text(row['email']) || row.$id
    case 'contacts': {
      const group = contactGroupFor(row, context.viewing, context.org)
      return contactDisplayName(row, group.groupId) || text(row['email']) || row.$id
    }
    case 'companies':
      return text(row['name']) || text(row['domain']) || row.$id
    case 'deals':
      return text(row['title']) || row.$id
  }
}

/** A deal's stage as its pipeline names it, or the status for a closed deal. */
export function dealStageLabel(row: Record<string, unknown>, pipeline: PipelineDoc | null): string {
  const status = row['status'] === 'won' || row['status'] === 'lost' ? row['status'] : 'open'
  if (status !== 'open') return DEAL_STATUS_LABELS[status]
  const stage = sortedStages(pipeline).find((entry) => entry.id === row['stageId'])
  return stage?.name ?? 'Unknown stage'
}

/** A deal's amount, in its own currency; empty when it has none. */
export function dealAmount(row: Record<string, unknown>): string {
  const cents = row['amountCents']
  return typeof cents === 'number' && Number.isFinite(cents)
    ? formatMoney(cents, typeof row['currency'] === 'string' ? row['currency'] : undefined)
    : ''
}

/** The status a record is in, as its list's chip and its page name it. */
export function crmStatusLabel(kind: CrmListKind, row: CrmRow, context: CrmPresentContext): string {
  switch (kind) {
    case 'leads':
      return crmLeadStatusLabel(row as Parameters<typeof crmLeadStatusLabel>[0], context.leadStatuses)
    case 'contacts': {
      const group = contactGroupFor(row, context.viewing, context.org)
      const stage = readContactFacet(row, group.groupId).lifecycleStage
      return stage ? (CONTACT_LIFECYCLE_STAGE_LABELS[stage as ContactLifecycleStage] ?? '') : ''
    }
    case 'companies':
      return ''
    case 'deals':
      return dealStageLabel(row, context.pipelineById?.(row['pipelineId']) ?? null)
  }
}

/** The line under a row's title. */
export function crmSubtitle(kind: CrmListKind, row: CrmRow, context: CrmPresentContext): string {
  const parts: string[] = []
  const status = crmStatusLabel(kind, row, context)
  switch (kind) {
    case 'leads':
      parts.push(status, text(row['company']), text(row['name']) ? text(row['email']) : '')
      break
    case 'contacts':
      parts.push(status, crmTitle(kind, row, context) !== text(row['email']) ? text(row['email']) : '')
      break
    case 'companies':
      parts.push(text(row['domain']), text(row['phone']))
      break
    case 'deals':
      parts.push(dealAmount(row), status)
      break
  }
  return parts.filter(Boolean).join(' · ')
}

/** The ways to reach the person a record is about, as the console's record page dials them. */
export interface CrmReach {
  email: string
  phone: string
  /** A phone a text can go to: the mobile number, else the phone. */
  sms: string
  /** The person asked not to be phoned (AGL-3513). */
  doNotCall: boolean
}

export function crmReach(kind: CrmListKind, row: Record<string, unknown> | null, context: CrmPresentContext): CrmReach {
  if (!row) return { email: '', phone: '', sms: '', doNotCall: false }
  switch (kind) {
    case 'leads': {
      const phone = text(row['phone'])
      const mobile = text(row['mobilePhone'])
      return { email: text(row['email']), phone: phone || mobile, sms: mobile || phone, doNotCall: row['doNotCall'] === true }
    }
    case 'contacts': {
      const group = contactGroupFor(row, context.viewing, context.org)
      const facet = readContactFacet(row, group.groupId)
      const phone = text(facet.phone) || text(row['phone'])
      return { email: text(row['email']), phone, sms: phone, doNotCall: (facet as { doNotCall?: unknown }).doNotCall === true }
    }
    case 'companies': {
      const phone = text(row['phone'])
      return { email: '', phone, sms: '', doNotCall: false }
    }
    case 'deals':
      return { email: '', phone: '', sms: '', doNotCall: false }
  }
}

/** A dialable address: digits and a leading plus, as `tel:` and `sms:` take them. */
export function dialable(phone: string): string {
  const trimmed = phone.trim()
  const plus = trimmed.startsWith('+') ? '+' : ''
  return plus + trimmed.replace(/[^0-9]/g, '')
}

/** One labeled fact on a record page. */
export interface CrmFact {
  label: string
  value: string
}

/** The facts a record's page shows under its name — the console's header and properties, read-only. */
export function crmFacts(kind: CrmListKind, row: Record<string, unknown>, context: CrmPresentContext): CrmFact[] {
  const owner = context.ownerLabel?.(kind === 'contacts' ? undefined : row['ownerUid']) ?? ''
  const created = crmDate(crmMs(row['createdAt']))
  const updated = crmDate(crmMs(row['updatedAt']))
  const facts: CrmFact[] = []
  const add = (label: string, value: string) => {
    if (value) facts.push({ label, value })
  }
  switch (kind) {
    case 'leads': {
      add('Status', crmStatusLabel(kind, row as CrmRow, context))
      if (row['status'] === 'unqualified') add('Reason', text(row['unqualifiedReason']))
      add('Owner', owner || 'Unassigned')
      add('Email', text(row['email']))
      add('Phone', text(row['phone']))
      add('Mobile', text(row['mobilePhone']))
      add('Company', text(row['company']))
      add('Title', text(row['jobTitle']))
      add('Lead source', text(row['leadSource']))
      add('First seen', crmDate(crmMs(row['firstSeenAtMs'])))
      add('Last seen', crmDate(crmMs(row['lastSeenAtMs'])))
      add('Converted', crmDate(crmMs(row['convertedAtMs'])))
      break
    }
    case 'contacts': {
      const group = contactGroupFor(row, context.viewing, context.org)
      const facet = readContactFacet(row, group.groupId)
      add('Stage', crmStatusLabel(kind, row as CrmRow, context))
      add('Owner', context.ownerLabel?.(facet.ownerUid) || 'Unassigned')
      add('Email', text(row['email']))
      add('Phone', text(facet.phone) || text(row['phone']))
      add('Company', text(facet.companyName) || text(row['companyName']))
      add('Title', text(facet.jobTitle))
      add('Lead source', text(facet.leadSource))
      break
    }
    case 'companies': {
      add('Owner', owner || 'Unassigned')
      add('Domain', text(row['domain']))
      add('Website', text(row['website']))
      add('Phone', text(row['phone']))
      add('Industry', text(row['industry']))
      add('Type', text(row['type']))
      break
    }
    case 'deals': {
      const pipeline = context.pipelineById?.(row['pipelineId']) ?? null
      add('Amount', dealAmount(row))
      add('Stage', dealStageLabel(row, pipeline))
      add('Pipeline', text(pipeline?.name))
      add('Owner', owner || 'Unassigned')
      add('Expected close', crmDate(crmMs(row['expectedCloseAtMs'])))
      add('Closed', crmDate(crmMs(row['closedAtMs'])))
      if (row['status'] === 'lost') add('Lost because', text(row['lostReason']))
      add('Next step', text(row['nextStep']))
      break
    }
  }
  add('Created', created)
  add('Updated', updated)
  return facts
}
