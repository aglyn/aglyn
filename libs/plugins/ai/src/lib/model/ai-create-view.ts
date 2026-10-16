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


import { pluginRecordHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { AI_JOB_BESIGNER_SEGMENT } from './ai-job-notice'
import {
  AI_BRIEF_COPY,
  AI_BRIEF_MAX_CHARS,
  AI_TEMPLATE_SUBJECT_LABELS,
  type AiBriefCopy,
} from './ai-brief-copy'
import { aiJobCreditRange } from './ai-build-job'
import { aiCreditRangeText } from './ai-credit-estimate'
import {
  AI_JOB_FOLLOW_PHASE_LINES,
  AI_JOB_PHASE_LABELS,
  AI_SITE_BUILD_IN_FLIGHT_COPY,
  aiJobConfirmingOwnPlan,
  aiJobPhase,
  aiJobProblem,
  type AiFollowTone,
  type AiJobPhase,
} from './ai-job-activity'
import { aiJobPlanHeading, aiJobPlanLines } from './ai-job-plan-lines'
import { AI_JOB_TERMINAL_STATUSES, type AiJobOutput, type AiJobSummary } from './ai-jobs.types'
import { AI_PAGE_TYPES } from './ai-page-job'
import { aiFreeCreditsResetLabel, type AiFreeCreditsLeft } from './ai-site-job'
import { AI_TEMPLATE_SUBJECTS } from './ai-template-subjects'
import type { AiTemplateCollectionOption } from './ai-template-collections'
import { AI_UPSELL_COPY, AI_UPSELL_CREATE_LABEL, aiUpsellOffer } from './ai-upsell-copy'

/**
 * "CREATE WITH AI" AS THE NATIVE APPS DRAW IT (AGL-3854): the door a list's
 * Create with AI button reads, and the follow view of the job it starts.
 *
 * The console decides each entry from gates its shell already resolved — the
 * plan and the add-on it could buy, `ai.generate`, the release flag and the
 * site's AI switch — and draws the brief and the job from the plugin's own
 * components. An app has neither the shell nor the components, so the AI
 * plugin's `/api/ai/create` door answers both as data: whether the entry is
 * drawn and as what, every word the brief dialog says, and the job as the
 * dialog's follow card reads it, in sentences built here from the same models
 * the console's components read. Nothing here decides what a request may do:
 * the jobs route's own ladder still decides each start, confirm and cancel.
 */

/** The lists the apps offer Create with AI on, beside their own create action. */
export const AI_CREATE_KINDS = ['page', 'template', 'layout', 'form', 'component'] as const

export type AiCreateKind = (typeof AI_CREATE_KINDS)[number]

export function isAiCreateKind(value: unknown): value is AiCreateKind {
  return typeof value === 'string' && (AI_CREATE_KINDS as readonly string[]).includes(value)
}

/** One row of chips beside the brief, and the input the pick is sent as. */
export interface AiCreateChoiceView {
  /** The `inputs` key the pick is sent under. */
  key: 'pageType' | 'subject'
  label: string
  /** A required pick keeps the start disabled until one is made; an optional one clears when pressed again. */
  required: boolean
  options: Array<{ id: string; label: string }>
}

/** A template's collection field, shown once "Collection entry" is picked. */
export interface AiCreateCollectionsView {
  /** The subject the field belongs to. */
  when: 'entry'
  label: string
  options: AiTemplateCollectionOption[]
  helper: string
}

/** What is left of the month's AI credits, said before a brief is sent. */
export interface AiCreateCreditsView {
  text: string
  /** Nothing is left and the workspace stops at its band, so a start is refused until credits return. */
  exhausted: boolean
}

/** The add-on's offer, on a plan that could buy it and has not (AGL-3601). */
export interface AiCreateUpsellView {
  title: string
  does: string
  offer: string
  /** The reader may add the add-on (`billing.manage`); the action is drawn only then. */
  canManageBilling: boolean
  /** "Add Aglyn AI", or `null` for a reader who cannot. */
  action: string | null
  dismiss: string
}

export interface AiCreateDoorView {
  kind: AiCreateKind
  /** `create`: the brief; `upsell`: the add-on's offer; `hidden`: the entry is not drawn. */
  door: 'create' | 'upsell' | 'hidden'
  /** The entry's label, "Create with AI". */
  label: string
  copy: AiBriefCopy | null
  briefMaxChars: number
  choices: AiCreateChoiceView[]
  collections: AiCreateCollectionsView | null
  credits: AiCreateCreditsView | null
  /** Another page already being built on this site (AGL-3765): a warning, not a stop. */
  building: string | null
  upsell: AiCreateUpsellView | null
}

/** What the door knows about the month's credits. */
export type AiCreateCreditsFacts =
  | { kind: 'free'; left: AiFreeCreditsLeft }
  | { kind: 'band'; used: number; limit: number; remaining: number; stopsAtBand: boolean }
  | { kind: 'unlimited' }
  | { kind: 'none' }

const n = (value: number) => Math.max(0, Math.round(value)).toLocaleString('en-US')

/** The credits line above the brief, or `null` where the workspace has no band to read. */
export function aiCreateCreditsView(facts: AiCreateCreditsFacts): AiCreateCreditsView | null {
  if (facts.kind === 'unlimited') return { text: 'AI credits are not capped on this workspace.', exhausted: false }
  if (facts.kind === 'free') {
    const until = aiFreeCreditsResetLabel(facts.left.resetsOn)
    return facts.left.left > 0
      ? {
          text: `You have ${n(facts.left.left)} of your ${n(facts.left.total)} free AI credits left this month, until ${until}.`,
          exhausted: false,
        }
      : { text: `You have used your free AI credits for this month. They come back on ${until}.`, exhausted: true }
  }
  if (facts.kind === 'band') {
    if (facts.remaining > 0) {
      return { text: `${n(facts.remaining)} of ${n(facts.limit)} AI credits left this month.`, exhausted: false }
    }
    return facts.stopsAtBand
      ? { text: 'This workspace used its AI credits for the month.', exhausted: true }
      : {
          text: `This workspace used its ${n(facts.limit)} AI credits for the month; more are billed as overage.`,
          exhausted: false,
        }
  }
  return null
}

/** The chips each kind offers beside its brief, as the console's dialog draws them. */
export function aiCreateChoices(kind: AiCreateKind): AiCreateChoiceView[] {
  if (kind === 'page') {
    return [
      {
        key: 'pageType',
        label: 'Page type (optional)',
        required: false,
        options: AI_PAGE_TYPES.map((type) => ({ id: type.id, label: type.label })),
      },
    ]
  }
  if (kind === 'template') {
    return [
      {
        key: 'subject',
        label: 'One page for each (required)',
        required: true,
        options: AI_TEMPLATE_SUBJECTS.map((subject) => ({ id: subject, label: AI_TEMPLATE_SUBJECT_LABELS[subject] })),
      },
    ]
  }
  return []
}

export interface AiCreateDoorInput {
  kind: AiCreateKind
  /** The gates that draw no entry at all: `ai.generate`, the release flag, the site's AI switch. */
  shown: boolean
  /** The plan carries `aiGenerative`. */
  entitled: boolean
  /** The workspace could buy the add-on that grants it, and the add-on store is open to it. */
  purchasable: boolean
  canManageBilling: boolean
  credits: AiCreateCreditsFacts
  /** The site's content collections, read only for a template's door. */
  collections?: { status: 'success' | 'error'; options: AiTemplateCollectionOption[] } | null
  /** Another page build in flight on the site, for a page's door. */
  buildInFlight?: boolean
  addonName: string
}

const HIDDEN = (kind: AiCreateKind): AiCreateDoorView => ({
  kind,
  door: 'hidden',
  label: AI_UPSELL_CREATE_LABEL,
  copy: null,
  briefMaxChars: AI_BRIEF_MAX_CHARS,
  choices: [],
  collections: null,
  credits: null,
  building: null,
  upsell: null,
})

/** The door one list's Create with AI reads. */
export function aiCreateDoorView(input: AiCreateDoorInput): AiCreateDoorView {
  const { kind } = input
  if (!input.shown) return HIDDEN(kind)
  if (!input.entitled) {
    if (!input.purchasable) return HIDDEN(kind)
    const copy = AI_UPSELL_COPY[kind]
    return {
      ...HIDDEN(kind),
      door: 'upsell',
      upsell: {
        title: copy.title,
        does: copy.does,
        offer: aiUpsellOffer(input.canManageBilling),
        canManageBilling: input.canManageBilling,
        action: input.canManageBilling ? `Add ${input.addonName}` : null,
        dismiss: input.canManageBilling ? 'Not now' : 'Close',
      },
    }
  }
  const collections =
    kind === 'template' && input.collections
      ? {
          when: 'entry' as const,
          label: 'Collection',
          options: input.collections.options,
          helper:
            input.collections.status === 'error'
              ? 'This site’s collections could not be loaded. Close this and try again.'
              : input.collections.options.length
                ? 'Each page shows one entry of this collection.'
                : 'This site has no content collections yet. Add one in Content first.',
        }
      : null
  return {
    ...HIDDEN(kind),
    door: 'create',
    copy: AI_BRIEF_COPY[kind],
    choices: aiCreateChoices(kind),
    collections,
    credits: aiCreateCreditsView(input.credits),
    building: kind === 'page' && input.buildInFlight ? AI_SITE_BUILD_IN_FLIGHT_COPY : null,
  }
}

// ── The job it started ──────────────────────────────────────────────────

export { AI_JOB_FOLLOW_PHASE_LINES, type AiFollowTone }

/**
 * Where one output opens in an app, as the console addresses the apps' link
 * resolver answers natively: a page opens its page (the console's preview
 * address, which the apps' Pages claims), a component, layout or template its
 * details, and anything else the page its owner publishes through the
 * record-route seam (a form's own page). `besigner` is the version the job
 * wrote, opened in the Besigner. `null` where the output has no page of its own,
 * names no site, or its owner is not loaded.
 */
export function aiJobOutputAppLinks(
  output: Pick<AiJobOutput, 'resource' | 'id' | 'versionId' | 'hostSubdomain'>,
  orgSlug: string,
): { detail: string; besigner: string | null } | null {
  const host = output.hostSubdomain
  if (!host || !orgSlug) return null
  const site = `/${orgSlug}/hosts/${host}`
  const id = encodeURIComponent(output.id)
  const segment = AI_JOB_BESIGNER_SEGMENT[output.resource]
  if (segment) {
    const version = output.versionId ? encodeURIComponent(output.versionId) : null
    const besigner = version ? `${site}/${segment}/${id}/versions/${version}/besigner` : null
    if (output.resource === 'screen' || output.resource === 'emailScreen') {
      return { detail: version ? `${site}/screens/${id}/versions/${version}/view` : `${site}/screens`, besigner }
    }
    return { detail: `${site}/${segment}/${id}`, besigner }
  }
  // A new form has no version to design yet: it opens on its own page.
  const record = pluginRecordHref(output.resource, { orgSlug, host }, output.id)
  return record ? { detail: record, besigner: null } : null
}

/** The one thing a finished job leads with, as the console's `aiJobPrimaryLink` picks it. */
export interface AiJobFollowOpen {
  label: string
  detail: string
  besigner: string | null
}

export function aiJobFollowOpen(
  job: Pick<AiJobSummary, 'status' | 'outputs'>,
  orgSlug: string,
): AiJobFollowOpen | null {
  if (job.status !== 'done' || !orgSlug) return null
  const screens = job.outputs.filter((output) => output.resource === 'screen' && output.hostSubdomain)
  if (screens.length > 1) {
    return {
      label: 'Open your draft pages',
      detail: `/${orgSlug}/hosts/${screens[0].hostSubdomain}/screens`,
      besigner: null,
    }
  }
  for (const output of job.outputs) {
    const links = aiJobOutputAppLinks(output, orgSlug)
    if (links) {
      return { label: output.resource === 'screen' ? 'Open the draft page' : `Open ${output.label}`, ...links }
    }
  }
  return null
}

export interface AiJobFollowView {
  id: string
  kind: string
  status: string
  hostId: string | null
  phase: AiJobPhase
  phaseLabel: string
  line: { tone: AiFollowTone; text: string }
  /** Still moving, so the apps read it again shortly. */
  moving: boolean
  /** Finished, failed or canceled: nothing more happens to it. */
  settled: boolean
  /** "2 of 3 steps", for a job of more than one step. */
  steps: string | null
  plan: { heading: string; lines: string[] } | null
  /** The building rules a refused answer broke, as a member reads them. */
  findings: string[]
  /** The checks' own sentence on a refused answer, for staff. */
  detail: string | null
  /** The plan's estimated cost, read before it is confirmed. */
  estimate: string | null
  retryRefusal: string | null
  /** "Confirm plan" or "Try again" while the job waits for the person. */
  confirm: { label: string; enabled: boolean } | null
  /** Another page build in flight on the site, said beside Confirm (AGL-3765). */
  building: string | null
  /** Why a stopped job has nothing to show. */
  problem: string | null
  /** What the job spent so far. */
  spent: string | null
  open: AiJobFollowOpen | null
}

/** The follow card's view of one job, for the apps (the console's `AiJobFollow` and `AiJobPlan`). */
export function aiJobFollowView(
  job: AiJobSummary,
  options: { orgSlug?: string | null; staff?: boolean; buildInFlight?: boolean; now?: number } = {},
): AiJobFollowView {
  const phase = aiJobPhase(job)
  const line = AI_JOB_FOLLOW_PHASE_LINES[phase]
  const { plan, review } = job
  const waiting = job.status === 'needs_review' && review !== null && !aiJobConfirmingOwnPlan(job, options.now)
  const range = plan && waiting && review.reason === 'plan' ? aiJobCreditRange(job.kind, plan) : null
  const freeCredits = review?.freeCredits ?? null
  const estimate =
    range && range.ceiling > 0
      ? `Estimated cost: ${aiCreditRangeText(range)}. What it costs is what its steps spend.` +
        (freeCredits
          ? ` You have ${freeCredits.left.toLocaleString('en-US')} of your free AI credits left this month, until ${aiFreeCreditsResetLabel(freeCredits.resetsOn)}.`
          : '')
      : null
  const stepsDone = job.steps.filter((step) => step.status === 'done').length
  const problem = phase === 'attention' || phase === 'failed' ? aiJobProblem(job, line.text) : null
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    hostId: job.hostId,
    phase,
    phaseLabel: AI_JOB_PHASE_LABELS[phase],
    line: { tone: line.severity, text: problem ?? line.text },
    moving: phase === 'queued' || phase === 'planning' || phase === 'building',
    settled: AI_JOB_TERMINAL_STATUSES.includes(job.status),
    steps: job.steps.length > 1 ? `${stepsDone} of ${job.steps.length} steps` : null,
    plan: plan ? { heading: aiJobPlanHeading(plan), lines: aiJobPlanLines(plan).map((entry) => entry.text) } : null,
    findings:
      review?.reason === 'doctrine' && review.findings.length > 0 && (options.staff || !review.detail)
        ? review.findings.map((finding) => finding.message)
        : [],
    detail: options.staff && review?.detail ? review.detail : null,
    estimate,
    retryRefusal: waiting && review.retryRefusal && review.reason !== 'plan' ? review.retryRefusal : null,
    confirm: waiting
      ? {
          label: review.reason === 'plan' ? 'Confirm plan' : 'Try again',
          enabled: review.reason === 'plan' || !review.retryRefusal,
        }
      : null,
    building: waiting && review.reason === 'plan' && options.buildInFlight ? AI_SITE_BUILD_IN_FLIGHT_COPY : null,
    problem,
    spent:
      job.creditsSpent > 0
        ? `Used ${n(job.creditsSpent)} ${job.creditsSpent === 1 ? 'credit' : 'credits'}${phase === 'done' || AI_JOB_TERMINAL_STATUSES.includes(job.status) ? '' : ' so far'}.`
        : null,
    open: aiJobFollowOpen(job, options.orgSlug ?? ''),
  }
}
