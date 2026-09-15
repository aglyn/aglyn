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
  ASSIST_HARD_CAP_CONTROL_LOCATION,
  type AssistRefusedBy,
} from '@aglyn/aglyn/app-utils/assist-credits'
import { ORG_PERMISSIONS } from '@aglyn/aglyn/app-utils/org-permissions'

/**
 * AI ALLOTMENTS (AGL-2942): the pure half.
 *
 * The workspace's AI pool is one band. An allotment is a manager's decision
 * about how much of that band one SUBJECT may draw in a calendar month (UTC),
 * so one client site, one contractor or one teammate cannot spend what the
 * others were counting on:
 *
 *   orgs/{orgId}/aiAllotments/{subject}
 *     { subject, scope, uid, hostId, credits, mode, models, setBy,
 *       updatedAt, alerted }
 *
 * where `subject` is one of
 *
 *   member:{uid}           a team member, across every site
 *   collab:{hostId}:{uid}  a site collaborator, on that site
 *   host:{hostId}          a whole site, across everyone who works on it
 *   org                    the org-wide model restriction (no credits)
 *
 * ## An allotment never grants
 *
 * The org band stays the outer wall: the reservation decides the workspace's
 * own ceilings first and consults an allotment only once they admitted the
 * request. So an allotment larger than the band is not an error and not a
 * grant — it is a line the workspace reaches after the band.
 *
 * ## Hard and soft
 *
 * A HARD allotment refuses the request that finds the subject at or past it.
 * A SOFT one admits it and tells the subject and the workspace's billing
 * contacts at 80% and again at 100%. Both are measured against what the
 * subject already drew this month, before the request — the same shape the
 * band is measured in, so a request that starts under the line may finish
 * past it, and the next one is the one refused.
 *
 * Everything here is dependency-light so the gate, the routes and the console
 * cards read one definition of a subject, a standing and a refusal sentence.
 */

/** `orgs/{orgId}/{this}/{subject}`. */
export const AI_ALLOTMENTS_COLLECTION = 'aiAllotments'

/** The subject id of the org-wide model restriction. */
export const AI_ALLOTMENT_ORG_SUBJECT = 'org'

export type AiAllotmentMode = 'hard' | 'soft'

export type AiAllotmentScope = 'member' | 'collab' | 'host' | 'org'

/** The scopes an allotment of CREDITS can have; `org` carries models only. */
export type AiCreditAllotmentScope = Exclude<AiAllotmentScope, 'org'>

/**
 * Why a reservation refused: the meter's own ceilings, and an allotment.
 *
 * Widened here rather than in core's `AssistRefusedBy`, because an allotment
 * is the plugin's rung: core names the ceilings core's billing sells.
 */
export type AiRefusedBy = AssistRefusedBy | 'allotment'

/** The two thresholds a soft allotment announces. */
export type AiAllotmentThreshold = 80 | 100

/** The share of an allotment at which the strip warns and a soft one alerts. */
export const AI_ALLOTMENT_WARN_SHARE = 0.8

/**
 * The largest monthly allotment a write may carry. A bound on a typing
 * mistake, not a product limit: a billion credits is a million dollars of
 * provider spend, far past any band the platform sells.
 */
export const AI_ALLOTMENT_MAX_CREDITS = 1_000_000_000

/** The most catalog ids one allowlist may name. */
export const AI_ALLOTMENT_MAX_MODELS = 20

const ID_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

export interface AiAllotmentSubject {
  id: string
  scope: AiAllotmentScope
  uid: string | null
  hostId: string | null
}

export type AiAllotmentSubjectInput =
  | { scope: 'member'; uid: string }
  | { scope: 'collab'; hostId: string; uid: string }
  | { scope: 'host'; hostId: string }
  | { scope: 'org' }

/** The document id for a subject. Throws on a segment that is not an id. */
export function aiAllotmentSubjectId(input: AiAllotmentSubjectInput): string {
  const segment = (value: string): string => {
    if (!ID_SEGMENT.test(value)) throw new Error(`not an id segment: ${value}`)
    return value
  }
  switch (input.scope) {
    case 'member':
      return `member:${segment(input.uid)}`
    case 'collab':
      return `collab:${segment(input.hostId)}:${segment(input.uid)}`
    case 'host':
      return `host:${segment(input.hostId)}`
    default:
      return AI_ALLOTMENT_ORG_SUBJECT
  }
}

/** A subject id read back, or `null` for anything that is not one. */
export function parseAiAllotmentSubject(value: unknown): AiAllotmentSubject | null {
  if (typeof value !== 'string') return null
  if (value === AI_ALLOTMENT_ORG_SUBJECT) {
    return { id: value, scope: 'org', uid: null, hostId: null }
  }
  const parts = value.split(':')
  if (parts.some((part) => !ID_SEGMENT.test(part))) return null
  if (parts.length === 2 && parts[0] === 'member') {
    return { id: value, scope: 'member', uid: parts[1], hostId: null }
  }
  if (parts.length === 2 && parts[0] === 'host') {
    return { id: value, scope: 'host', uid: null, hostId: parts[1] }
  }
  if (parts.length === 3 && parts[0] === 'collab') {
    return { id: value, scope: 'collab', uid: parts[2], hostId: parts[1] }
  }
  return null
}

/** One allotment as every reader hands it on. */
export interface AiAllotment {
  subject: string
  scope: AiAllotmentScope
  uid: string | null
  hostId: string | null
  /**
   * Credits a month, or `null` for an allotment that bounds models alone —
   * and always `null` on the org-wide restriction.
   */
  credits: number | null
  mode: AiAllotmentMode
  /** Catalog ids the subject may run on, or `null` for no restriction. */
  models: string[] | null
  setBy: string | null
  /** The last threshold announced, and the month it was announced in. */
  alerted: { month: string; threshold: AiAllotmentThreshold } | null
}

/** A finite positive whole number of credits, else `null`. */
export function aiAllotmentCredits(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(AI_ALLOTMENT_MAX_CREDITS, Math.floor(parsed))
}

/** An allowlist read back: unique strings, bounded; empty reads as none. */
export function aiAllotmentModels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const models = [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ].slice(0, AI_ALLOTMENT_MAX_MODELS)
  return models.length ? models : null
}

/**
 * A stored allotment as a complete record, or `null` when the id is not a
 * subject. The scope, uid and site are read off the ID, never off the
 * fields: the id is what the gate addresses, so it is the only claim about
 * who the document is for that can be trusted.
 *
 * `mode` defaults to `hard`: a document whose mode was lost is a cap, which
 * is the reading that cannot spend more than a manager set.
 */
export function aiAllotmentFrom(
  raw: Record<string, unknown> | null | undefined,
  id: string,
): AiAllotment | null {
  const subject = parseAiAllotmentSubject(id)
  if (!subject || !raw) return null
  const alertedRaw = raw['alerted'] as { month?: unknown; threshold?: unknown } | null
  const threshold = Number(alertedRaw?.threshold)
  return {
    subject: subject.id,
    scope: subject.scope,
    uid: subject.uid,
    hostId: subject.hostId,
    credits: subject.scope === 'org' ? null : aiAllotmentCredits(raw['credits']),
    mode: raw['mode'] === 'soft' ? 'soft' : 'hard',
    models: aiAllotmentModels(raw['models']),
    setBy: typeof raw['setBy'] === 'string' ? (raw['setBy'] as string) : null,
    alerted:
      typeof alertedRaw?.month === 'string' && (threshold === 80 || threshold === 100)
        ? { month: alertedRaw.month, threshold }
        : null,
  }
}

/** One allotment of credits measured against what its subject drew. */
export interface AiAllotmentStanding {
  subject: string
  scope: AiCreditAllotmentScope
  uid: string | null
  hostId: string | null
  credits: number
  /** Credits drawn this month before the request being decided. */
  used: number
  mode: AiAllotmentMode
}

export type AiAllotmentState = 'ok' | 'warn' | 'reached'

/** `reached` at or past the allotment, `warn` from 80% of it. */
export function aiAllotmentState(used: number, credits: number): AiAllotmentState {
  if (!(credits > 0)) return 'ok'
  if (used >= credits) return 'reached'
  if (used >= credits * AI_ALLOTMENT_WARN_SHARE) return 'warn'
  return 'ok'
}

/** The threshold a standing sits at, for the alert pipeline. */
export function aiAllotmentThreshold(
  used: number,
  credits: number,
): AiAllotmentThreshold | null {
  const state = aiAllotmentState(used, credits)
  return state === 'reached' ? 100 : state === 'warn' ? 80 : null
}

/**
 * Whether a standing admits a request.
 *
 * A soft allotment always does. A hard one admits while the subject is under
 * it — and, for a caller that knows what the request will cost before it
 * starts (a job's estimate), while the estimate still fits: a 100-credit job
 * at 0 of 100 is admitted, one at 1 of 100 is not.
 */
export function aiAllotmentAdmits(
  standing: Pick<AiAllotmentStanding, 'credits' | 'used' | 'mode'>,
  estimateCredits = 0,
): boolean {
  if (standing.mode === 'soft') return true
  const estimate = Number.isFinite(estimateCredits) && estimateCredits > 0 ? estimateCredits : 0
  return estimate > 0
    ? standing.used + estimate <= standing.credits
    : standing.used < standing.credits
}

/**
 * Which subject a refusal names when more than one allotment is spent: the
 * narrowest first — the person on this site, then the person, then the site.
 */
const SCOPE_ORDER: readonly AiCreditAllotmentScope[] = ['collab', 'member', 'host']

const scopeRank = (scope: AiCreditAllotmentScope): number => SCOPE_ORDER.indexOf(scope)

export interface AiAllotmentVerdict {
  /** The hard allotment that refuses the request, or `null`. */
  refusal: AiAllotmentStanding | null
  /** The allotment with the least left, for the usage strip; `null` for none. */
  binding: AiAllotmentStanding | null
  /** Soft allotments at a threshold, for the alert pipeline. */
  alerts: Array<{ standing: AiAllotmentStanding; threshold: AiAllotmentThreshold }>
}

/** The verdict over every allotment that applies to one request. */
export function aiAllotmentVerdict(
  standings: readonly AiAllotmentStanding[],
  estimateCredits = 0,
): AiAllotmentVerdict {
  const ordered = [...standings].sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope))
  const refusal =
    ordered.find((standing) => !aiAllotmentAdmits(standing, estimateCredits)) ?? null
  let binding: AiAllotmentStanding | null = null
  for (const standing of ordered) {
    if (!binding || standing.credits - standing.used < binding.credits - binding.used) {
      binding = standing
    }
  }
  const alerts = ordered.flatMap((standing) => {
    if (standing.mode !== 'soft') return []
    const threshold = aiAllotmentThreshold(standing.used, standing.credits)
    return threshold ? [{ standing, threshold }] : []
  })
  return { refusal, binding, alerts }
}

/**
 * The allowlists that apply to a request, intersected — `null` when none of
 * the allotments names one. An empty result is a real answer: two lists that
 * share no model leave nothing to pick, and the model choice falls back to
 * the routing table rather than turning AI off for a mistake in a list.
 */
export function aiAllotmentModelsAllowed(
  allotments: ReadonlyArray<Pick<AiAllotment, 'models'> | null | undefined>,
): string[] | null {
  const lists = allotments
    .map((allotment) => allotment?.models)
    .filter((models): models is string[] => Array.isArray(models) && models.length > 0)
  if (!lists.length) return null
  return lists.reduce((kept, list) => kept.filter((id) => list.includes(id)))
}

/** The catalog label for `billing.manage`, the word a sentence names it by. */
export function billingManageLabel(): string {
  return (
    ORG_PERMISSIONS.find((definition) => definition.key === 'billing.manage')?.label ??
    'Manage billing'
  )
}

/**
 * The sentence a refused request is told, naming who can raise the
 * allotment and where. No figures: the strip beside it carries those, and a
 * refusal that quoted a count would be stale the moment someone raised it.
 */
export function aiAllotmentRefusalText(
  scope: AiCreditAllotmentScope | null | undefined,
): string {
  const managers = `an organization admin with the "${billingManageLabel()}" permission`
  switch (scope) {
    case 'collab':
      return (
        'You have used your AI allotment on this site for this month. ' +
        `The site's admin, or ${managers}, can raise it on the site's Users card.`
      )
    case 'host':
      return (
        'This site has used its AI allotment for this month. ' +
        `Ask ${managers} to raise it under ${ASSIST_HARD_CAP_CONTROL_LOCATION}.`
      )
    default:
      return (
        'You have used your AI allotment for this month. ' +
        `Ask ${managers} to raise it under ${ASSIST_HARD_CAP_CONTROL_LOCATION}.`
      )
  }
}

/**
 * The words a soft allotment's alert carries, for BOTH channels — the
 * console notification and the email — so the two cannot say different
 * things about one crossing. `name` is the member's name or the site's.
 */
export function aiAllotmentAlertCopy(input: {
  scope: AiCreditAllotmentScope
  threshold: AiAllotmentThreshold
  used: number
  credits: number
  name: string
}): { title: string; body: string } {
  const who =
    input.scope === 'host' ? `The ${input.name} site` : input.name
  const whose = input.scope === 'host' ? 'its' : 'their'
  const where = input.scope === 'collab' ? ' on its site' : ''
  const figures =
    `${input.used.toLocaleString('en-US')} of ` +
    `${input.credits.toLocaleString('en-US')} credits used this month.`
  if (input.threshold >= 100) {
    return {
      title: `${who} has used ${whose} whole AI allotment${where}`,
      body:
        `${figures} The allotment is soft, so requests keep working and ` +
        'draw on the workspace’s pool. Raise it or make it hard under ' +
        `${ASSIST_HARD_CAP_CONTROL_LOCATION}.`,
    }
  }
  return {
    title: `${who} is past ${Math.round(AI_ALLOTMENT_WARN_SHARE * 100)}% of ${whose} AI allotment${where}`,
    body: `${figures} The allotment is soft, so nothing stops at the line.`,
  }
}
