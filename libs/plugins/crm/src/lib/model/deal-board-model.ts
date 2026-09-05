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
 * The pipeline's arithmetic and the stage editor's rules (AGL-2598), as pure
 * functions — no Firestore, no React — so the board, the table, the detail
 * page and the server route read one definition of "what is this pipeline
 * worth" and "which stage edits are legal".
 */

import {
  type CrmDeal,
  type CrmDealStage,
  type CrmPipeline,
  dealStageById,
  weightedDealAmountCents,
} from '@aglyn/aglyn'

/** A deal as the console reads it: the model plus its document id. */
export type DealDoc = CrmDeal & {
  $id: string
  /**
   * The contact's and the company's names, copied onto the deal when the
   * link is made. A board of two hundred cards cannot afford a keyed read per
   * card to caption each one, and the caption is allowed to lag a rename —
   * the link itself is the id, which never changes.
   */
  contactName?: string
  companyName?: string
}

/** A pipeline as the console reads it. */
export type PipelineDoc = CrmPipeline & { $id: string }

/** The document id the seeded default pipeline is written under. */
export const DEFAULT_PIPELINE_ID = 'default'

/** Name of the pipeline every org starts with. */
export const DEFAULT_PIPELINE_NAME = 'Sales'

/**
 * Currencies the amount picker offers, lowercase ISO 4217 as the model
 * stores them. Short on purpose: a picker of a hundred and eighty currencies
 * is a scroll, and a deal in one outside this list is entered through the
 * API with whatever code it carries — the display below formats any code
 * `Intl` knows.
 */
export const DEAL_CURRENCIES = [
  'usd',
  'eur',
  'gbp',
  'cad',
  'aud',
  'nzd',
  'chf',
  'jpy',
  'sek',
  'nok',
  'dkk',
  'mxn',
  'brl',
  'inr',
  'sgd',
] as const

export const DEFAULT_DEAL_CURRENCY = 'usd'

/** How a deal's `status` reads on screen. */
export const DEAL_STATUS_LABELS: Record<CrmDeal['status'], string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
}

/** Cents → the reader's locale, or a plain number when the code is unknown. */
export function formatMoney(cents: number, currency: string | undefined): string {
  const code = String(currency || DEFAULT_DEAL_CURRENCY).toUpperCase()
  const amount = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${code}`
  }
}

/**
 * A typed amount, as cents, or `null` when it is not a number.
 *
 * Accepts what people paste from an invoice — a thousands separator, a
 * currency symbol, surrounding space — and refuses a negative: a deal is
 * worth zero or more, and a negative amount here is a typo rather than a
 * refund. Rounded rather than truncated so `19.995` does not lose a cent.
 */
export function parseAmountInput(input: string): number | null {
  const cleaned = String(input ?? '')
    .replace(/[^0-9.-]/g, '')
    .trim()
  if (!cleaned) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/** Cents → the string the amount field shows, `''` for nothing. */
export function amountInputValue(cents: number | undefined | null): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return ''
  return (cents / 100).toFixed(2)
}

/**
 * Epoch ms from whatever a timestamp field holds after a round trip — a
 * Firestore `Timestamp`, a `Date` a client just wrote, or a number.
 */
export function timestampMs(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value instanceof Date) return value.getTime()
  const seconds = (value as { seconds?: unknown }).seconds
  if (typeof seconds === 'number') return seconds * 1000
  const toMillis = (value as { toMillis?: () => number }).toMillis
  if (typeof toMillis === 'function') return toMillis.call(value)
  return null
}

/** Whole days a deal has sat in its current stage, never negative. */
export function daysInStage(
  deal: Pick<CrmDeal, 'stageChangedAtMs' | 'createdAt'>,
  nowMs: number,
): number {
  const since =
    typeof deal.stageChangedAtMs === 'number'
      ? deal.stageChangedAtMs
      : timestampMs(deal.createdAt)
  if (!since) return 0
  return Math.max(0, Math.floor((nowMs - since) / 86_400_000))
}

/** A sum per currency, because two currencies never add into one number. */
export type AmountByCurrency = Record<string, number>

function addAmount(
  totals: AmountByCurrency,
  currency: string | undefined,
  cents: number,
): void {
  const code = String(currency || DEFAULT_DEAL_CURRENCY).toLowerCase()
  totals[code] = (totals[code] ?? 0) + cents
}

export interface BoardSummary {
  /** Deals whose `status` is `open`, whatever stage they sit in. */
  openCount: number
  /** Every open deal's full amount, per currency. */
  valueByCurrency: AmountByCurrency
  /** Every open deal's amount times its stage's probability, per currency. */
  weightedByCurrency: AmountByCurrency
}

/**
 * The three figures above the board.
 *
 * Closed deals are excluded from both totals rather than counted at full or
 * zero value: the summary describes what is still in play, and a won deal
 * counted in "pipeline value" would make the pipeline look larger every time
 * something closed. `weightedDealAmountCents` already answers zero for a
 * stage the pipeline no longer has.
 */
export function boardSummary(
  deals: readonly Pick<
    CrmDeal,
    'status' | 'amountCents' | 'currency' | 'stageId'
  >[],
  pipeline: Pick<CrmPipeline, 'stages'> | null | undefined,
): BoardSummary {
  const summary: BoardSummary = {
    openCount: 0,
    valueByCurrency: {},
    weightedByCurrency: {},
  }
  for (const deal of deals) {
    if (deal.status !== 'open') continue
    summary.openCount += 1
    const amount = Math.max(0, Math.round(Number(deal.amountCents ?? 0) || 0))
    addAmount(summary.valueByCurrency, deal.currency, amount)
    addAmount(
      summary.weightedByCurrency,
      deal.currency,
      weightedDealAmountCents(deal, dealStageById(pipeline, deal.stageId)),
    )
  }
  return summary
}

/** `$1,200.00 · €300.00` — one figure per currency, largest first. */
export function formatAmountByCurrency(totals: AmountByCurrency): string {
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1])
  if (!entries.length) return formatMoney(0, DEFAULT_DEAL_CURRENCY)
  return entries.map(([code, cents]) => formatMoney(cents, code)).join(' · ')
}

/** The pipeline's stages in `order`, ties broken by position. */
export function sortedStages(
  pipeline: Pick<CrmPipeline, 'stages'> | null | undefined,
): CrmDealStage[] {
  return [...(pipeline?.stages ?? [])]
    .map((stage, index) => ({ stage, index }))
    .sort((a, b) => a.stage.order - b.stage.order || a.index - b.index)
    .map(({ stage }) => stage)
}

/** The stages a deal can be dragged between — everything that is not closed. */
export function openStages(
  pipeline: Pick<CrmPipeline, 'stages'> | null | undefined,
): CrmDealStage[] {
  return sortedStages(pipeline).filter((stage) => stage.kind === 'open')
}

/** The stage whose `kind` is `won` or `lost`, or null when the pipeline lacks one. */
export function closingStage(
  pipeline: Pick<CrmPipeline, 'stages'> | null | undefined,
  kind: 'won' | 'lost',
): CrmDealStage | null {
  return sortedStages(pipeline).find((stage) => stage.kind === kind) ?? null
}

/**
 * The id a new stage is stored under: the name as a slug, made unique
 * against the stages already there.
 *
 * A slug rather than a random id because the id appears in every deal that
 * sits in the stage and in every automation filter that names it, so a
 * reader looking at `stageId == "demo-booked"` should be able to tell which
 * stage that is without opening the pipeline. Uniqueness is what keeps a
 * second "Demo" from silently becoming the first.
 */
export function newStageId(
  name: string,
  existing: readonly CrmDealStage[],
): string {
  const base =
    String(name ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'stage'
  const taken = new Set(existing.map((stage) => stage.id))
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/**
 * Stages re-numbered 0..n in the order they are GIVEN.
 *
 * Positional on purpose: every caller hands this an array it has already
 * arranged — a swap, a splice, a filter over the sorted stages — and the
 * stored `order` on each entry is the arrangement being replaced. Sorting by
 * it here would put a swapped pair straight back where it was.
 */
export function renumberStages(
  stages: readonly CrmDealStage[],
): CrmDealStage[] {
  return stages.map((stage, order) => ({ ...stage, order }))
}

/** 0–100, whole numbers; anything else becomes the nearest bound. */
export function clampProbability(value: unknown): number {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return 0
  return Math.min(100, Math.max(0, number))
}

/**
 * Add an open stage in front of the closing stages.
 *
 * Won and Lost stay last: a pipeline reads left to right as a progression,
 * and a stage added after "Won" would be a step past the end.
 */
export function addStage(
  stages: readonly CrmDealStage[],
  name: string,
  probability = 50,
): CrmDealStage[] {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return [...stages]
  const sorted = sortedStages({ stages: [...stages] })
  const firstClosed = sorted.findIndex((stage) => stage.kind !== 'open')
  const at = firstClosed === -1 ? sorted.length : firstClosed
  const stage: CrmDealStage = {
    id: newStageId(trimmed, sorted),
    name: trimmed,
    order: at,
    probability: clampProbability(probability),
    kind: 'open',
  }
  sorted.splice(at, 0, stage)
  return renumberStages(sorted)
}

export function renameStage(
  stages: readonly CrmDealStage[],
  stageId: string,
  name: string,
): CrmDealStage[] {
  const trimmed = String(name ?? '').trim()
  return stages.map((stage) =>
    stage.id === stageId && trimmed ? { ...stage, name: trimmed } : stage,
  )
}

/**
 * Set an OPEN stage's probability. Won is 100 and Lost is 0 by definition —
 * `weightedDealAmountCents` reads the status before the stage, so a Won
 * stage at 60% would change nothing and only mislead the editor.
 */
export function setStageProbability(
  stages: readonly CrmDealStage[],
  stageId: string,
  probability: unknown,
): CrmDealStage[] {
  return stages.map((stage) =>
    stage.id === stageId && stage.kind === 'open'
      ? { ...stage, probability: clampProbability(probability) }
      : stage,
  )
}

/**
 * Swap an open stage with its open neighbor. The closing stages are not in
 * the reorderable range, so an open stage can never be moved past Won.
 */
export function moveStage(
  stages: readonly CrmDealStage[],
  stageId: string,
  direction: 'up' | 'down',
): CrmDealStage[] {
  const sorted = sortedStages({ stages: [...stages] })
  const index = sorted.findIndex((stage) => stage.id === stageId)
  if (index === -1 || sorted[index].kind !== 'open') return sorted
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= sorted.length) return sorted
  if (sorted[target].kind !== 'open') return sorted
  const swapped = [...sorted]
  const moving = swapped[index]
  swapped[index] = swapped[target]
  swapped[target] = moving
  return renumberStages(swapped)
}

/**
 * Why a stage cannot be removed, or `null` when it can.
 *
 * `dealsInStage` is the server's count, asked for before this is called: a
 * stage with deals in it cannot go, because every one of those deals would
 * be left pointing at a stage that no longer exists and worth nothing to the
 * forecast. The closing stages cannot go at all — a deal has to be able to
 * be won and lost.
 */
export function stageRemovalRefusal(
  stages: readonly CrmDealStage[],
  stageId: string,
  dealsInStage: number,
): string | null {
  const stage = stages.find((entry) => entry.id === stageId)
  if (!stage) return 'This stage is no longer in the pipeline.'
  if (stage.kind !== 'open') {
    return `Every pipeline keeps its ${stage.kind === 'won' ? 'Won' : 'Lost'} stage.`
  }
  if (openStages({ stages: [...stages] }).length <= 1) {
    return 'A pipeline needs at least one open stage.'
  }
  if (dealsInStage > 0) {
    return (
      `${dealsInStage.toLocaleString()} ${dealsInStage === 1 ? 'deal is' : 'deals are'} ` +
      'in this stage. Move them first, so none is left in a stage that no longer exists.'
    )
  }
  return null
}

export function removeStage(
  stages: readonly CrmDealStage[],
  stageId: string,
): CrmDealStage[] {
  return renumberStages(stages.filter((stage) => stage.id !== stageId))
}

/**
 * What a stored set of stages has to satisfy before it is written back:
 * unique ids, a name on every stage, exactly one Won and one Lost, at least
 * one open stage. The editor refuses a save that fails this rather than
 * writing a pipeline the board cannot draw.
 */
export function stagesProblem(stages: readonly CrmDealStage[]): string | null {
  if (!stages.length) return 'A pipeline needs stages.'
  const ids = new Set<string>()
  for (const stage of stages) {
    if (!stage.id) return 'Every stage needs an id.'
    if (ids.has(stage.id)) return `Two stages share the id "${stage.id}".`
    ids.add(stage.id)
    if (!String(stage.name ?? '').trim()) return 'Every stage needs a name.'
  }
  const won = stages.filter((stage) => stage.kind === 'won').length
  const lost = stages.filter((stage) => stage.kind === 'lost').length
  if (won !== 1) return 'A pipeline has exactly one Won stage.'
  if (lost !== 1) return 'A pipeline has exactly one Lost stage.'
  if (!stages.some((stage) => stage.kind === 'open')) {
    return 'A pipeline needs at least one open stage.'
  }
  return null
}

/**
 * The event a stage change emits, and the flat payload a workflow filter
 * reads (AGL-2598). Strings and numbers only — a workflow expression
 * evaluates over scalars, and an absent link is the empty string rather than
 * a missing key so `contactId == ""` is a filter somebody can write.
 */
export type DealEventName = 'dealStageChanged' | 'dealWon' | 'dealLost'

export function dealEventName(status: CrmDeal['status']): DealEventName {
  if (status === 'won') return 'dealWon'
  if (status === 'lost') return 'dealLost'
  return 'dealStageChanged'
}

export function dealEventPayload(
  dealId: string,
  deal: Pick<
    CrmDeal,
    | 'title'
    | 'amountCents'
    | 'currency'
    | 'stageId'
    | 'ownerUid'
    | 'contactId'
    | 'companyId'
    | 'lostReason'
  >,
  previousStageId: string,
): Record<string, string | number> {
  return {
    dealId,
    title: String(deal.title ?? ''),
    amountCents: Math.max(0, Math.round(Number(deal.amountCents ?? 0) || 0)),
    currency: String(deal.currency || DEFAULT_DEAL_CURRENCY).toLowerCase(),
    stageId: String(deal.stageId ?? ''),
    previousStageId: String(previousStageId ?? ''),
    ownerUid: String(deal.ownerUid ?? ''),
    contactId: String(deal.contactId ?? ''),
    companyId: String(deal.companyId ?? ''),
    ...(deal.lostReason ? { lostReason: String(deal.lostReason) } : {}),
  }
}

/** Initials for an avatar: the first letters of the first two words. */
export function initialsFor(label: string): string {
  const words = String(label ?? '')
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean)
  const letters = words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
  return (letters || '?').toUpperCase()
}

/**
 * A stable hue for one person, so an owner keeps one color across cards and
 * sessions. Hashing the label rather than picking from a palette is what
 * makes the same uid the same color on every machine.
 */
export function hueFor(label: string): number {
  let hash = 0
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) % 360
  }
  return hash
}

/** `2026-09-05` for a date input, from epoch ms; `''` for none. */
export function dateInputValue(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const at = new Date(ms)
  const offset = at.getTimezoneOffset() * 60_000
  return new Date(ms - offset).toISOString().slice(0, 10)
}

/**
 * Epoch ms at local noon of a typed `YYYY-MM-DD`, or `null`.
 *
 * Noon rather than midnight so the day survives a timezone round trip: a
 * close date stored at local midnight and read back one timezone west shows
 * the day before.
 */
export function dateInputMs(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const at = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0,
    0,
  )
  return Number.isNaN(at.getTime()) ? null : at.getTime()
}
