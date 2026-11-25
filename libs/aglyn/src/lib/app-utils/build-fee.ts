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
 * A ONE-TIME WEBSITE BUILD FEE, READ IN ONE PLACE (AGL-4244).
 *
 * Staff who build a site for a client sell it with a plan: the client pays
 * the build fee, with sales tax, together with the plan, in the hand-off
 * checkout. The fee rides the upgrade proposal (`OrgUpgradeProposal`) or a
 * staff bundle link, and the checkout adds it to the FIRST invoice of the
 * subscription it starts, once. This module decides what a fee may be, how
 * it reads to the owner, and whether it is still due; the server modules
 * store it and the checkout charges it.
 *
 * A workspace that already pays has no first invoice left to carry a fee,
 * so a fee is refused there: the build is billed with Charge for work.
 */

import type { OrgBuildFee } from '../foundation/definitions/org-billing.types'
import { SITE_CARE_EXTRA_TIME_TAX_CODE } from './site-care'
import { SITE_CARE_PROJECT_STATUS_LABELS, type SiteCareProjectStatus } from './site-care-project'

/** The least a build fee may be, in cents: $1. */
export const BUILD_FEE_MIN_CENTS = 100

/** The most a build fee may be, in cents: $50,000. Above it reads as a typo. */
export const BUILD_FEE_MAX_CENTS = 5_000_000

/** The line the owner sees when staff do not name it. */
export const BUILD_FEE_DEFAULT_LABEL = 'Website build'

/** The longest line a fee may carry. */
export const BUILD_FEE_LABEL_MAX = 120

/**
 * The tax code the fee is billed under: the code every Aglyn service carries
 * (the Decision Log of 2026-10-18), the one Site Care extra time and Charge
 * for work bill under. A build is the same kind of service.
 */
export const BUILD_FEE_TAX_CODE = SITE_CARE_EXTRA_TIME_TAX_CODE

/** Said when a fee is asked of a workspace that already pays for a plan. */
export const BUILD_FEE_PAYING_WORKSPACE_REFUSAL =
  'This workspace already pays; bill the build with Charge for work.'

/** The subscription metadata the checkout stamps, which the webhook reads. */
export const BUILD_FEE_METADATA = {
  cents: 'buildFeeCents',
  source: 'buildFeeSource',
} as const

/** Where a fee came from: the standing proposal, or one bundle link. */
export type BuildFeeSource = { kind: 'proposal' } | { kind: 'bundle-link'; id: string }

export function buildFeeSourceKey(source: BuildFeeSource): string {
  return source.kind === 'proposal' ? 'proposal' : `bundle:${source.id}`
}

export function parseBuildFeeSourceKey(raw: unknown): BuildFeeSource | null {
  if (raw === 'proposal') return { kind: 'proposal' }
  if (typeof raw === 'string' && raw.startsWith('bundle:')) {
    const id = raw.slice('bundle:'.length).trim()
    return id && !id.includes('/') ? { kind: 'bundle-link', id } : null
  }
  return null
}

export type BuildFeeInput = { amountCents?: unknown; label?: unknown } | null | undefined

export type NormalizedBuildFee =
  | { ok: true; fee: OrgBuildFee | null }
  | { ok: false; error: string }

/**
 * A fee as staff send it, checked: whole cents from $1 to $50,000 and a
 * label of at most 120 characters, "Website build" when blank. No fee at all
 * (absent, null, or an amount of 0 or blank) is `fee: null`, not an error,
 * so a dialog whose field was left empty sends nothing.
 */
export function normalizeBuildFee(input: BuildFeeInput): NormalizedBuildFee {
  if (input == null) return { ok: true, fee: null }
  if (typeof input !== 'object') return { ok: false, error: 'The build fee is not readable' }
  const raw = input.amountCents
  if (raw == null || raw === '' || raw === 0) return { ok: true, fee: null }
  const amountCents = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(amountCents)) {
    return { ok: false, error: 'The build fee must be a whole number of cents' }
  }
  if (amountCents < BUILD_FEE_MIN_CENTS || amountCents > BUILD_FEE_MAX_CENTS) {
    return { ok: false, error: 'The build fee must be between $1 and $50,000' }
  }
  if (input.label != null && typeof input.label !== 'string') {
    return { ok: false, error: 'The build fee’s label must be text' }
  }
  const label = String(input.label ?? '').replace(/\s+/g, ' ').trim()
  if (label.length > BUILD_FEE_LABEL_MAX) {
    return { ok: false, error: `The build fee’s label is at most ${BUILD_FEE_LABEL_MAX} characters` }
  }
  return { ok: true, fee: { amountCents, label: label || BUILD_FEE_DEFAULT_LABEL } }
}

/** A stored fee, narrowed, or null when there is none worth reading. */
export function readBuildFee(raw: unknown): OrgBuildFee | null {
  if (!raw || typeof raw !== 'object') return null
  const stored = raw as Partial<OrgBuildFee>
  const normalized = normalizeBuildFee({ amountCents: stored.amountCents, label: stored.label })
  if ('error' in normalized || !normalized.fee) return null
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  const invoiceId = text(stored.invoiceId)
  const subscriptionId = text(stored.subscriptionId)
  const paidInvoiceId = text(stored.paidInvoiceId)
  const paidAt = Number.isFinite(stored.paidAt) ? Number(stored.paidAt) : undefined
  return {
    ...normalized.fee,
    ...(invoiceId ? { invoiceId } : {}),
    ...(subscriptionId ? { subscriptionId } : {}),
    ...(paidInvoiceId ? { paidInvoiceId } : {}),
    ...(paidAt !== undefined ? { paidAt } : {}),
  }
}

/** Whether a fee is still owed: one is set and no paid invoice is recorded. */
export function buildFeeIsDue(fee: OrgBuildFee | null | undefined): fee is OrgBuildFee {
  return !!fee && fee.amountCents > 0 && !fee.paidInvoiceId
}

/** "$350" or "$350.50". */
export function formatBuildFeeUsd(cents: number): string {
  const dollars = Math.round(Number(cents) || 0) / 100
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString('en-US')}`
    : `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "Website build, $350 one time": the fee as the owner reads it beside a plan. */
export function describeBuildFee(fee: Pick<OrgBuildFee, 'amountCents' | 'label'>): string {
  return `${fee.label}, ${formatBuildFeeUsd(fee.amountCents)} one time`
}

/**
 * The plan line and the fee together: "Starter with Site Care, billed
 * yearly, plus Website build, $350 one time". The summary alone when no fee
 * is due.
 */
export function withBuildFee(
  summary: string,
  fee: Pick<OrgBuildFee, 'amountCents' | 'label' | 'paidInvoiceId'> | null | undefined,
): string {
  return buildFeeIsDue(fee as OrgBuildFee | null) && fee
    ? `${summary}, plus ${describeBuildFee(fee)}`
    : summary
}

/**
 * Dollars as staff type them ("350", "$1,250.50") as whole cents, or null
 * when the field is blank. NaN for anything else, which the server refuses.
 */
export function buildFeeCentsFromDollars(dollars: string): number | null {
  const cleaned = String(dollars ?? '').replace(/[$,\s]/g, '')
  if (!cleaned) return null
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return Number.NaN
  return Math.round(Number(cleaned) * 100)
}

/** Why typed dollars cannot be a fee, or null when they can (or are blank). */
export function buildFeeDraftProblem(draft: { amount: string; label: string } | null | undefined): string | null {
  if (!draft) return null
  const cents = buildFeeCentsFromDollars(draft.amount)
  if (cents === null) return null
  const checked = normalizeBuildFee({ amountCents: cents, label: draft.label })
  return 'error' in checked ? checked.error : null
}

/** A Charge for work project as the warning reads it (`SiteCareProject`). */
export interface ChargeForWorkProjectSummary {
  title: string
  status: SiteCareProjectStatus | string
  quote?: { priceUsd?: number } | null
}

/**
 * The open Charge for work quotes a build fee might duplicate (AGL-4244):
 * quoted or accepted, with no invoice sent. A project with an invoice out
 * or paid is past the point of being withdrawn.
 */
export function openChargeForWorkQuotes<T extends ChargeForWorkProjectSummary>(
  projects: readonly T[] | null | undefined,
): T[] {
  return (projects ?? []).filter((project) => project.status === 'quoted' || project.status === 'accepted')
}

/**
 * The warning staff see beside a build fee when the workspace also has an
 * open Charge for work quote. A warning, not a refusal: the quote may be for
 * different work.
 */
export function chargeForWorkOverlapWarning(
  projects: readonly ChargeForWorkProjectSummary[] | null | undefined,
): string | null {
  const open = openChargeForWorkQuotes(projects)
  if (!open.length) return null
  const named = open
    .map((project) => {
      const price = Number(project.quote?.priceUsd ?? 0)
      const status = SITE_CARE_PROJECT_STATUS_LABELS[project.status as SiteCareProjectStatus] ?? project.status
      return `${project.title} ${formatBuildFeeUsd(Math.round(price * 100))} (${status.toLowerCase()})`
    })
    .join('; ')
  return open.length === 1
    ? `This workspace has an open Charge for work quote, ${named}. If it is the same build, ` +
        'withdraw it so the client is not billed twice.'
    : `This workspace has open Charge for work quotes: ${named}. If one is the same build, ` +
        'withdraw it so the client is not billed twice.'
}

/** A build fee as the Charge for work warning reads it: where it is, and whether it was paid. */
export interface StandingBuildFee {
  source: 'proposal' | 'bundle-link'
  amountCents: number
  label: string
  paid: boolean
}

/**
 * The warning staff see before sending a Charge for work invoice when a
 * proposal or a bundle link already carries a build fee, paid or not.
 */
export function buildFeeOverlapWarning(fees: readonly StandingBuildFee[] | null | undefined): string | null {
  const list = fees ?? []
  if (!list.length) return null
  const named = list
    .map(
      (fee) =>
        `${fee.label} ${formatBuildFeeUsd(fee.amountCents)} on the ` +
        `${fee.source === 'proposal' ? 'upgrade proposal' : 'bundle link'}` +
        (fee.paid ? ', already paid' : ', not paid yet'),
    )
    .join('; ')
  return (
    `This workspace already has a build fee: ${named}. If this invoice is for the same build, ` +
    'do not send it, so the client is not billed twice.'
  )
}
