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
 * The AI actions an activity log can carry (AGL-2929).
 *
 * Every other action in `orgs/{orgId}/activity` and `hosts/{hostId}/activity`
 * is a prose sentence written at the call site — "Saved the screen". The AI
 * rows are CODES instead, because they are read by more than a person: the
 * org feed's "AI" chip, the staff audit facet and the actor table all need
 * to recognize an AI row without parsing a sentence, and a sentence that
 * three writers phrase three ways is three rows that look unrelated.
 *
 * One list, so the writers in `ai-activity.ts`, the feed presenter and the
 * staff facet cannot disagree about what counts as AI. A code missing from
 * `AI_ACTIVITY_ACTION_LABELS` fails the type, not the reader.
 */

import type { AiJobOutputResource } from '../model/ai-jobs.types'
import {
  pluginStaffAuditActionGroup,
  pluginStaffAuditActionGroupLabel,
  registerPluginActivityActions,
  type PluginActivityScope,
} from '@aglyn/aglyn/plugin-manager/plugin-activity-actions'

/** The action code each AI writer stores. */
export const AI_ACTIVITY_ACTIONS = {
  jobCreated: 'ai.job.created',
  jobOutput: 'ai.job.output',
  jobCanceled: 'ai.job.canceled',
  jobNeedsInput: 'ai.job.needs_input',
  editApplied: 'ai.edit.applied',
  seoApplied: 'ai.seo.applied',
  assistSection: 'ai.assist.section',
  overageHardCap: 'ai.overage.hardCap',
  overageCap: 'ai.overage.cap',
  allotmentChanged: 'ai.allotment.changed',
  permissionChanged: 'ai.permission.changed',
  addonPurchased: 'ai.addon.purchased',
  addonRemoved: 'ai.addon.removed',
} as const

export type AiActivityAction =
  (typeof AI_ACTIVITY_ACTIONS)[keyof typeof AI_ACTIVITY_ACTIONS]

/** What a person reads for each code, in the feed and the actor table. */
export const AI_ACTIVITY_ACTION_LABELS: Record<AiActivityAction, string> = {
  'ai.job.created': 'Started an AI generation',
  'ai.job.output': 'AI generated',
  'ai.job.canceled': 'Canceled an AI generation',
  'ai.job.needs_input': 'AI generation paused for input',
  'ai.edit.applied': 'Applied AI edits',
  'ai.seo.applied': 'Applied AI SEO fixes as drafts',
  'ai.assist.section': 'AI generated a section',
  'ai.overage.hardCap': 'AI stop-at-band switch',
  'ai.overage.cap': 'AI overage ceiling',
  'ai.allotment.changed': 'AI allotment changed',
  'ai.permission.changed': 'AI permission changed',
  'ai.addon.purchased': 'Added the AI add-on',
  'ai.addon.removed': 'Removed the AI add-on',
}

/** Every code, in catalog order — what a filter sends as `isAnyOf`. */
export const AI_ACTIVITY_ACTION_LIST: readonly AiActivityAction[] =
  Object.values(AI_ACTIVITY_ACTIONS)

/** The feed's filter chip and the staff facet's group, by one name. */
export const AI_ACTIVITY_FILTER_LABEL = 'AI'

/**
 * Why a generation stopped and asked for a person (AGL-2904): the plan's
 * band ran out, the org's own ceiling refused, the monthly message cap or
 * the job's own token budget did — or, on the Free taste (AGL-2925), one of
 * its own precautions: the account's credits, its daily request cap, a
 * pause after declined briefs, or the platform's day of free spend. Those
 * are the meter's `AssistRefusedBy` less its `null`, so a ceiling the meter
 * can name is one the feed can label. The last three are the job's own: its
 * plan is ready for review, or an answer broke a building rule on its re-ask
 * (AGL-2935), or the site is at an allowance its plan sets for what the job
 * writes (AGL-2909).
 */
export type AiJobNeedsInputReason =
  | 'band'
  | 'cap'
  | 'messages'
  | 'budget'
  | 'allotment'
  | 'account'
  | 'requests'
  | 'refusals'
  | 'platform'
  | 'plan'
  | 'doctrine'
  | 'limit'

export const AI_JOB_NEEDS_INPUT_REASON_LABELS: Record<
  AiJobNeedsInputReason,
  string
> = {
  plan: 'its plan is ready for review',
  doctrine: 'its answer broke a building rule twice',
  limit: 'the site reached an allowance of its plan',
  band: 'the included AI band is used up',
  cap: 'the overage ceiling was reached',
  messages: 'the monthly message cap was reached',
  budget: 'the job budget was reached',
  allotment: 'the creator’s or the site’s AI allotment is used up',
  account: 'the account’s free AI credits are used up',
  requests: 'the daily free request cap was reached',
  refusals: 'free generation is paused for the day after declined briefs',
  platform: 'free AI generation is paused for the day',
}

/**
 * The feed target types a generation job's output can be filed under: the
 * kinds both activity logs know, so the org row and its host copy share a
 * shape.
 */
export type AiOutputTargetType =
  | 'screen'
  | 'layout'
  | 'component'
  | 'template'
  | 'workflow'
  | 'content'
  | 'theme'

/**
 * Where the feed files each resource kind a job can write (AGL-2904).
 *
 * A job names its output by the resource it wrote, and the activity logs
 * know a narrower set of targets. The map is total, so a resource kind
 * added to the job document must say where the feed shows it before the
 * machine can log it. `reusableComponent` is the feed's `component`; a
 * `text` output is copy, which the feed files as `content`; a `theme`
 * proposal is filed under the site's theme, which the host feed links to the
 * Theme section (AGL-2938); the kinds whose runners have not shipped are
 * content of the site too, and are filed there until a target of their own
 * exists.
 */
const AI_OUTPUT_TARGET_TYPES: Record<AiJobOutputResource, AiOutputTargetType> = {
  screen: 'screen',
  reusableComponent: 'component',
  layout: 'layout',
  template: 'template',
  form: 'content',
  emailScreen: 'content',
  campaign: 'content',
  product: 'content',
  experiment: 'content',
  workflow: 'workflow',
  // An SEO proposal (AGL-2910) is about the site's content, and is filed there.
  seo: 'content',
  text: 'content',
  theme: 'theme',
  // An insight answer (AGL-2915) is about the site's figures; the feed row
  // names it and never what it says.
  insight: 'content',
  // A CRM proposal (AGL-2917) writes nothing; the feed files it with content.
  crm: 'content',
}

export function aiOutputTargetType(resource: AiJobOutputResource): AiOutputTargetType {
  return AI_OUTPUT_TARGET_TYPES[resource]
}

/** Whether a stored action is one of the AI codes above. */
export function isAiActivityAction(action: unknown): action is AiActivityAction {
  return (
    typeof action === 'string' &&
    (AI_ACTIVITY_ACTION_LIST as readonly string[]).includes(action)
  )
}

/** The readable label for an AI code; `undefined` for any other action. */
export function aiActivityActionLabel(action: unknown): string | undefined {
  return isAiActivityAction(action)
    ? AI_ACTIVITY_ACTION_LABELS[action]
    : undefined
}

/**
 * Staff audit rows that are ABOUT AI without carrying an `ai.` code: the
 * customer's overage controls already write `billing.assistOverage.*`, and
 * the platform's free-spend auto-pause writes `platform.aiFreeSpend.*`
 * (AGL-2925). The audit page's facet folds them under the same group as the
 * codes, because "what did we do about AI this week" is one question.
 */
export const AI_STAFF_AUDIT_ACTION_PREFIXES: readonly string[] = [
  'ai.',
  'billing.assistOverage.',
  'platform.aiFreeSpend.',
]

/** The facet group an `adminAudit` action belongs to. */
export const STAFF_AUDIT_AI_GROUP = 'ai'

/**
 * Which log each code is written to. The job and edit codes land in both
 * the org feed and the host's copy; the billing and permission codes are
 * org-level facts and land in the org feed alone.
 */
const AI_ACTIVITY_ACTION_SCOPES: Record<
  AiActivityAction,
  PluginActivityScope | readonly PluginActivityScope[]
> = {
  'ai.job.created': ['org', 'host'],
  'ai.job.output': ['org', 'host'],
  'ai.job.canceled': ['org', 'host'],
  'ai.job.needs_input': ['org', 'host'],
  'ai.edit.applied': ['org', 'host'],
  'ai.seo.applied': ['org', 'host'],
  'ai.assist.section': ['org', 'host'],
  'ai.overage.hardCap': 'org',
  'ai.overage.cap': 'org',
  'ai.allotment.changed': 'org',
  'ai.permission.changed': 'org',
  'ai.addon.purchased': 'org',
  'ai.addon.removed': 'org',
}

/**
 * The catalog, declared through the generic activity-action seam
 * (AGL-2940) so the feed's chip, the actor table's filter and the staff
 * facet read it from the registry beside every other plugin's codes.
 * `registerAiDeclarations` calls it, in both apps and in the browser.
 */
export function registerAiActivityActions(): void {
  registerPluginActivityActions({
    pluginId: 'ai',
    group: {
      id: STAFF_AUDIT_AI_GROUP,
      label: AI_ACTIVITY_FILTER_LABEL,
      staffAuditPrefixes: AI_STAFF_AUDIT_ACTION_PREFIXES.filter(
        (prefix) => prefix !== 'ai.',
      ),
      // The staff cards opening on an org (AGL-2930) and on one account
      // (AGL-2928): reads of spend and attribution, and nothing altered.
      staffAuditAccessActions: ['org.ai-viewed', 'user.ai-usage-viewed'],
    },
    actions: AI_ACTIVITY_ACTION_LIST.map((key) => ({
      key,
      label: AI_ACTIVITY_ACTION_LABELS[key],
      scope: AI_ACTIVITY_ACTION_SCOPES[key],
    })),
  })
}

/**
 * The group the staff audit facet files an action under: `ai` for every
 * AI row, otherwise the action's leading namespace (`billing`, `org`,
 * `plugins`). Roughly seventy distinct actions write to `adminAudit`, so
 * the facet offers namespaces rather than a seventy-entry menu. Answered
 * by the registry, so every plugin's group is filed the same way.
 */
export function staffAuditActionGroup(action: unknown): string {
  return pluginStaffAuditActionGroup(action)
}

/** How a facet group reads in the menu: `ai` → `AI`, `billing` → `billing`. */
export function staffAuditActionGroupLabel(group: string): string {
  return pluginStaffAuditActionGroupLabel(group)
}
