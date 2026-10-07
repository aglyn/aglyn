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

import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import {
  AI_BUILD_LIMITS,
  AI_BUILD_PUBLISH_INPUT,
  aiArticle,
  aiBuildCreditEstimate,
  aiBuildDegradation,
  aiBuildInitialLedger,
  aiBuildItemDelivered,
  aiBuildItemOpen,
  aiBuildNextUnit,
  aiBuildOrder,
  aiBuildPlacedItemLines,
  aiBuildPlanShapeRefusal,
  aiBuildUnits,
  type AiBuildOps,
  type AiBuildUnit,
} from '../model/ai-build-job'
import { isAiPlanNewRef, type AiBuildPlanCreateKind } from '../model/ai-build-plan'
import type {
  AiJob,
  AiJobItemFailure,
  AiJobItemLedger,
  AiJobKind,
  AiJobOutput,
  AiJobPlan,
} from '../model/ai-jobs.types'
import { AI_SITE_MAX_SECTIONS } from '../model/ai-site-job'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import { aiModelForStep } from '../providers/routing'
import { AiUpstreamError } from '../runtime/ai-runtime'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { ASSIST_RETURNED_USD_FIELD, assistSpendAfterReturnsUsd } from '../usage/assist-credit-returns'
import { freeAccountUsageRef, freeAssistAccount, type AssistMeteredOrg } from '../usage/assist-free-taste'
import { aiBuildOps, type AiBuildOpsContext } from './ai-build-capabilities'
import {
  aiJobAdmissionRefusal,
  registerAiJobAdmission,
  type AiJobAdmission,
  type AiJobAdmissionContext,
} from './ai-job-admission'
import { aiOriginJobId } from './ai-job-draft-ids'
import { readAiDraftNodes } from './ai-job-drafts'
import { aiConfirmedPlan, aiUnspentOutcome } from './ai-job-generation'
import { AI_JOB_PAGE_STEP_MINIMUM_MS } from './ai-job-page-budget'
import {
  aiPluginDraftAdmissionRefusal,
  aiPluginDraftWriter,
  type AiPluginDraftWriterLookup,
} from './ai-job-plugin-drafts'
import { aiSitePageWritten, aiSiteResolvedRef, type AiSiteBuiltRef } from './ai-job-site-step'
import {
  AI_JOB_BRIEF_MAX_CHARS,
  type AiJobItemOutcome,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import { aiJobPublishesBuild, aiPublishGuidedSite } from './ai-site-publish'
import {
  AI_PLANNED_JOB_KINDS,
  aiJobStepRunMinimumMs,
  aiJobStepRunnerFor,
  registerAiJobStep,
  registerAiJobStepPasses,
} from './ai-jobs'

/**
 * The build step (AGL-3616): the generation step of a `build` job, run once
 * the member confirmed the plan their request produced.
 *
 * Like the site scaffold it generalizes, it builds nothing itself and asks no
 * model of its own. Each pass takes the next unit in dependency order and
 * hands it to what builds that kind of thing — a page, layout, form,
 * component, email design or template to this plugin's own step, under a job
 * derived for the unit; another plugin's resource to that plugin's writer on
 * the resource-draft seam, with the content the owner's capability derives
 * from the item's arguments. One unit, one pass, one recorded spend.
 *
 * ── Settled item by item ────────────────────────────────────────────────
 *
 * Where a unit stands is read from the job's ITEM LEDGER, never from counting
 * outputs: the machine writes each pass's row in the transaction that
 * records its spend (`recordStep`). A unit that fails is a FAILED ROW, not a
 * failed job: the pass reports it, the machine gives back that item's spend
 * where the failure was ours, and the next pass builds the next unit. What
 * depended on it is built without it, or skipped where it cannot stand
 * without it (`aiBuildDegradation`). The machine ends the job when nothing is
 * left: `done` when anything was delivered, `failed` — its planning given
 * back too — when nothing was.
 *
 * ── Drafts, unless asked and confirmed ───────────────────────────────────
 *
 * Every unit writes the draft its own kind writes, which nothing publishes.
 * Only a build whose request asked to publish AND whose member ticked the
 * plan card's box puts its built pages live, once, on its last pass, through
 * the guided start's publish.
 */

/** What a build answers with no confirmed plan to build. */
export const AI_BUILD_NO_PLAN_COPY = 'This build has no confirmed plan to build.'

/** What a unit says when nothing on this site builds its operation any more. */
export const aiBuildUnavailableCopy = (noun: string): string =>
  `Not built: ${aiArticle(noun)} cannot be made on this site right now.`

/** What a unit that finished without reporting anything says. */
export const AI_BUILD_UNIT_EMPTY_COPY = 'It could not be built this time.'

/** What a page that was reported built but holds none of its plan says. */
export const AI_BUILD_PAGE_NOT_WRITTEN_COPY = 'The page was not written from its plan.'

/** What a unit's model declining the request says. */
export const AI_BUILD_UNIT_REFUSED_COPY = 'The AI declined to build this one.'

/**
 * The most passes a build's step may take: every unit at a page's worst — its
 * sections and its listing — so a runner that never finishes is still
 * bounded while the largest plan is not. Try again starts the count over.
 */
export const AI_BUILD_MAX_PASSES = AI_BUILD_LIMITS.units * (AI_SITE_MAX_SECTIONS + 1)

/** The job kind a creation of the build is built by. */
const CREATION_JOB_KINDS: Partial<Record<AiBuildPlanCreateKind, AiJobKind>> = {
  layout: 'layout',
  form: 'form',
  component: 'component',
  email: 'email',
}

/** The job kind a unit is built by, where an AI runner builds it. */
export function aiBuildUnitJobKind(unit: AiBuildUnit, ops: AiBuildOps): AiJobKind | null {
  if (unit.screen) return 'page'
  if (unit.creation) return CREATION_JOB_KINDS[unit.creation.kind] ?? null
  const runnerKind = ops.get(unit.op)?.runnerKind
  return runnerKind ? (runnerKind as AiJobKind) : null
}

/** The id a unit's job, and so its draft, is named by. */
export function aiBuildUnitJobId(job: Pick<AiJob, '$id'>, unit: AiBuildUnit): string {
  return unit.creation?.id ?? unit.screen?.id ?? unit.item?.id ?? `${job.$id}-${unit.slot}`
}

/**
 * What the build has created that a later unit can name: each delivered
 * creation's record, by its plan name. A creation's first output is the
 * record it wrote.
 */
export function aiBuildBuiltRefs(
  units: readonly AiBuildUnit[],
  ledger: readonly AiJobItemLedger[],
  outputs: readonly Pick<AiJobOutput, 'id' | 'label'>[],
): Map<string, AiSiteBuiltRef> {
  const rows = new Map(ledger.map((row) => [row.slot, row]))
  const built = new Map<string, AiSiteBuiltRef>()
  for (const unit of units) {
    const creation = unit.creation
    const row = rows.get(unit.slot)
    if (!creation || !row || !aiBuildItemDelivered(row) || !row.outputs.length) continue
    if (creation.kind !== 'layout' && creation.kind !== 'form' && creation.kind !== 'component') continue
    const id = row.outputs[0]
    const label = outputs.find((output) => output.id === id)?.label || creation.name
    built.set(creation.name.toLowerCase(), { id, label, kind: creation.kind })
  }
  return built
}

/**
 * The job a unit is built under (generalizing `aiSiteUnitJob`): this job's
 * org, site, creator and model; the kind that builds the unit; a plan
 * narrowed to the unit, its `new:` references resolved to what was built and
 * the failed ones left out; and a brief that says what the unit is, what it
 * is built without, and which blocks its sections place.
 */
export function aiBuildUnitJob(
  job: AiJob,
  unit: AiBuildUnit,
  context: {
    kind: AiJobKind
    units: readonly AiBuildUnit[]
    ledger: readonly AiJobItemLedger[]
    ops: AiBuildOps
    briefLines?: readonly string[]
  },
): AiJob {
  const plan = job.plan as AiJobPlan
  const built = aiBuildBuiltRefs(context.units, context.ledger, job.outputs ?? [])
  const labels = { ...(plan.labels ?? {}) }
  for (const entry of built.values()) labels[entry.id] = entry.label
  const brief = [job.brief.trim()]
  const unitPlan: AiJobPlan = { ...plan, labels, reuse: [...plan.reuse], create: [], screens: [] }
  delete unitPlan.items
  const placedByScreens = new Set(plan.screens.flatMap((screen) => screen.sections.flatMap((section) => section.uses)))
  if (unit.creation) {
    unitPlan.reuse = plan.reuse.filter((entry) => !placedByScreens.has(entry.id))
    unitPlan.create = [{ ...unit.creation, duplicateOf: aiSiteResolvedRef(unit.creation.duplicateOf, built) }]
    brief.push(`Build the ${unit.creation.kind} “${unit.creation.name}”: ${unit.creation.why}`)
  }
  if (unit.screen) {
    const screen = unit.screen
    for (const entry of built.values()) {
      unitPlan.reuse.push({ kind: entry.kind, id: entry.id, purpose: `the ${entry.kind} this request built` })
    }
    let builtLayout: string | null = null
    for (const entry of built.values()) if (entry.kind === 'layout') builtLayout = builtLayout ?? entry.id
    unitPlan.screens = [
      {
        ...screen,
        // A page whose layout failed renders inside the site's own: the page
        // step falls back to it when the plan names none.
        layout: aiSiteResolvedRef(screen.layout, built) ?? (isAiPlanNewRef(screen.layout) ? builtLayout : null),
        template: aiSiteResolvedRef(screen.template, built),
        duplicateOf: aiSiteResolvedRef(screen.duplicateOf, built),
        record: screen.record
          ? { ...screen.record, dataset: aiSiteResolvedRef(screen.record.dataset, built) ?? screen.record.dataset }
          : null,
        sections: screen.sections.map((section) => ({
          ...section,
          uses: section.uses
            .map((ref) => aiSiteResolvedRef(ref, built))
            .filter((ref): ref is string => !!ref),
        })),
      },
    ]
    brief.push(`Build the page “${screen.title}”, at ${screen.slug}.`)
    brief.push(...aiBuildPlacedItemLines(unit, { units: context.units, ledger: context.ledger, ops: context.ops }))
  }
  const item = unit.item
  if (item) {
    const noun = context.ops.get(item.op)?.noun ?? item.op
    brief.push(`Build the ${noun} “${item.name}”${item.why ? `: ${item.why}` : '.'}`)
    // A planned kind's step builds the plan's first creation of its kind.
    unitPlan.create = AI_PLANNED_JOB_KINDS.includes(context.kind)
      ? [{ kind: context.kind as AiBuildPlanCreateKind, name: item.name, why: item.why, duplicateOf: null, fields: [], ...(item.id ? { id: item.id } : {}) }]
      : []
  }
  brief.push(...(context.briefLines ?? []))
  const inputs: Record<string, unknown> = {
    ...job.inputs,
    ...(item?.args ?? {}),
    originJobId: aiOriginJobId(job),
  }
  delete inputs[AI_BUILD_PUBLISH_INPUT]
  return {
    ...job,
    $id: aiBuildUnitJobId(job, unit),
    kind: context.kind,
    steps: [],
    outputs: [],
    items: null,
    plan: item && !AI_PLANNED_JOB_KINDS.includes(context.kind) ? null : unitPlan,
    inputs,
    brief: brief.join('\n').slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/** The unit's failure, for its row: ours or not, why, in customer-safe words. */
function failed(
  slot: string,
  failure: AiJobItemFailure,
  extra: Partial<AiJobItemOutcome> = {},
): AiJobItemOutcome {
  return { slot, status: 'failed', failure, ...extra }
}

export interface AiJobBuildStepDeps {
  /** The runner registry; specs hand in fakes. */
  runnerFor?: typeof aiJobStepRunnerFor
  /** The draft writer registry; specs hand in fakes. */
  writerFor?: AiPluginDraftWriterLookup
  /** The operations this site may use; the registry and its gates otherwise. */
  opsFor?: (context: AiBuildOpsContext) => Promise<AiBuildOps>
  /** A runner kind's own admission, asked before its item runs; the registry's otherwise. */
  admissionFor?: typeof aiJobAdmissionRefusal
  /** Another plugin's admission for its writer; the seam's otherwise. */
  pluginAdmission?: typeof aiPluginDraftAdmissionRefusal
  /** The draft reader a built page is checked through. */
  readNodes?: typeof readAiDraftNodes
  /** The publish a build asked for and confirmed. */
  publish?: typeof aiPublishGuidedSite
}

/** Whether a build's workspace spends the Free taste. */
export function aiBuildFreeTaste(org: object | null | undefined): boolean {
  return Boolean(org) && resolveEffectivePlan(org as never) === 'free'
}

/** The site document a gate reads, or `null`. */
async function readHost(firestore: FirebaseFirestore.Firestore, hostId: string | null) {
  if (!hostId) return null
  return ((await firestore.collection('hosts').doc(hostId).get()).data() ?? null) as Record<string, unknown> | null
}

export function createAiJobBuildStep(deps: AiJobBuildStepDeps = {}): AiJobStepRunner {
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  const writerFor = deps.writerFor ?? aiPluginDraftWriter
  const opsFor = deps.opsFor ?? ((context) => aiBuildOps(context))
  const admissionFor = deps.admissionFor ?? aiJobAdmissionRefusal
  const pluginAdmission = deps.pluginAdmission ?? aiPluginDraftAdmissionRefusal
  const readNodes = deps.readNodes ?? readAiDraftNodes
  const publish = deps.publish ?? aiPublishGuidedSite

  return async (context): Promise<AiJobStepOutcome> => {
    const { job, firestore } = context
    const model = context.modelFor?.('job.plan') ?? aiModelForStep('job.plan')
    const plan = aiConfirmedPlan(job)
    if (!plan) return { ...aiUnspentOutcome(model), failure: AI_BUILD_NO_PLAN_COPY }
    const org = (context.org ?? null) as Partial<AglynOrgBilling> | null
    const units = aiBuildUnits(plan)
    const ordered = aiBuildOrder(units) ?? units
    const starting = !job.items?.length
    const ledger = starting ? aiBuildInitialLedger(units) : (job.items as AiJobItemLedger[])
    const init = starting ? { items: ledger } : {}
    const unit = aiBuildNextUnit(ordered, ledger)
    const rows = new Map(ledger.map((row) => [row.slot, row]))
    const host = await readHost(firestore, job.hostId ?? null)
    const ops = await opsFor({
      orgId: job.orgId,
      hostId: job.hostId ?? null,
      org,
      host,
      freeTaste: aiBuildFreeTaste(org),
    })

    /** Whether units other than this one are still to build. */
    const othersOpen = (slot: string) =>
      ordered.some((one) => one.slot !== slot && aiBuildItemOpen(rows.get(one.slot) ?? { status: 'pending' }))

    /** The build's last pass puts its pages live, where it was asked and confirmed. */
    const finish = async (outcome: AiJobStepOutcome, extraPages: readonly AiJobOutput[] = []): Promise<AiJobStepOutcome> => {
      if (!aiJobPublishesBuild(job) || job.sitePublish || !job.hostId) return outcome
      const pageIds = new Set(
        units
          .filter((one) => one.screen && aiBuildItemDelivered(rows.get(one.slot) ?? { status: 'pending' }))
          .flatMap((one) => rows.get(one.slot)?.outputs ?? []),
      )
      const pages = [
        ...(job.outputs ?? []).filter((output) => output.resource === 'screen' && pageIds.has(output.id)),
        ...extraPages,
      ]
      if (!pages.length) return outcome
      const sitePublish = await publish(firestore, { job, outputs: pages, now: context.now }).catch((error: unknown) => {
        console.error('ai build publish threw', { orgId: job.orgId, jobId: job.$id, error })
        return null
      })
      return sitePublish ? { ...outcome, sitePublish } : outcome
    }

    if (!unit) return finish({ ...aiUnspentOutcome(model), ...init })

    const settle = (item: AiJobItemOutcome, spent: AiJobStepOutcome = aiUnspentOutcome(model)): AiJobStepOutcome => ({
      ...spent,
      ...init,
      item,
      continue: item.status === 'running' || othersOpen(unit.slot),
    })

    // What its dependencies came to.
    const degradation = aiBuildDegradation(unit, { units, ledger, ops })
    if (degradation.skip) {
      return settle({ slot: unit.slot, status: 'skipped', note: degradation.skip, degradedBy: degradation.degradedBy })
    }
    const capability = ops.get(unit.op)
    const noun = capability?.noun ?? unit.op
    if (!capability) return settle({ slot: unit.slot, status: 'skipped', note: aiBuildUnavailableCopy(noun) })
    const degraded = degradation.degradedBy.length > 0
    const note = degradation.notes.length ? degradation.notes.join(' ') : null

    // Another plugin's resource: its writer, with the content its capability derives.
    if (capability.draftResource) {
      const item = unit.item
      const writer = writerFor(capability.draftResource)
      if (!item || !writer || !job.hostId) {
        return settle({ slot: unit.slot, status: 'skipped', note: aiBuildUnavailableCopy(noun) })
      }
      const admission: AiJobAdmissionContext = {
        firestore,
        orgId: job.orgId,
        hostId: job.hostId,
        inputs: {},
        org,
        uid: job.createdBy,
      }
      const refusal = await pluginAdmission(admission, {
        kind: 'build',
        drafts: [{ resource: capability.draftResource, label: capability.noun }],
        writerFor,
      })
      if (refusal) return settle({ slot: unit.slot, status: 'skipped', note: `Not built: ${refusal.error}` })
      const dependencies: Record<string, { op: string; id: string }> = {}
      for (const slot of unit.deps) {
        const dep = units.find((one) => one.slot === slot)
        const row = rows.get(slot)
        if (!dep || !row || !aiBuildItemDelivered(row) || !row.outputs.length) continue
        dependencies[`new:${dep.label}`] = { op: dep.op, id: row.outputs[0] }
      }
      const content = capability.draftContent?.({ name: item.name, args: item.args }, { hostId: job.hostId, dependencies }) ?? item.args
      const checked = writer.check(content, { hostId: job.hostId })
      if (checked.ok === false) {
        return settle(
          failed(unit.slot, { ours: true, reason: 'step-failure', message: checked.problems[0] ?? AI_BUILD_UNIT_EMPTY_COPY }),
        )
      }
      const id = aiBuildUnitJobId(job, unit)
      const written = await writer.write({
        orgId: job.orgId,
        hostId: job.hostId,
        uid: job.createdBy,
        org,
        now: context.now,
        id,
        name: item.name,
        content,
      })
      if (written.ok === false) {
        return settle(failed(unit.slot, { ours: false, reason: 'review', message: written.error }))
      }
      const output: AiJobOutput = {
        resource: 'draft',
        id: written.id,
        versionId: written.versionId,
        hostId: job.hostId,
        label: written.name,
        draftResource: capability.draftResource,
        note: `A draft, in ${capability.where}.`,
      }
      return settle(
        {
          slot: unit.slot,
          status: degraded ? 'degraded' : 'succeeded',
          outputs: [written.id],
          note,
          ...(degraded ? { degradedBy: degradation.degradedBy } : {}),
        },
        { ...aiUnspentOutcome(model), outputs: [output] },
      )
    }

    // This plugin's own runner, under a job derived for the unit.
    const kind = aiBuildUnitJobKind(unit, ops)
    const runner = kind ? runnerFor(kind) : null
    if (!kind || !runner) return settle({ slot: unit.slot, status: 'skipped', note: aiBuildUnavailableCopy(noun) })
    const derived = aiBuildUnitJob(job, unit, { kind, units, ledger, ops, briefLines: degradation.briefLines })
    // An item's kind is asked its own admission first (a campaign's plan,
    // a template's subject), once, before its first pass.
    if (unit.item && rows.get(unit.slot)?.status !== 'running') {
      const refusal = await admissionFor(kind, {
        firestore,
        orgId: job.orgId,
        hostId: job.hostId ?? null,
        inputs: derived.inputs,
        org,
        uid: job.createdBy,
      }).catch((error: unknown) => {
        console.error('ai build item admission failed', { orgId: job.orgId, jobId: job.$id, slot: unit.slot, error })
        return { status: 403 as const, error: AI_BUILD_UNIT_EMPTY_COPY }
      })
      if (refusal) return settle({ slot: unit.slot, status: 'skipped', note: `Not built: ${refusal.error}` })
    }

    let outcome: AiJobStepOutcome
    try {
      outcome = await runner({ ...context, job: derived })
    } catch (error) {
      // A provider that will answer later is the machine's to retry; anything
      // else is this item's failure, and the build goes on.
      if (error instanceof AiUpstreamError && error.retryable) throw error
      if ((error as { name?: string } | null)?.name === 'AbortError' || (error as { name?: string } | null)?.name === 'TimeoutError') {
        throw error
      }
      console.error('ai build unit threw', { orgId: job.orgId, jobId: job.$id, slot: unit.slot, error })
      return settle(failed(unit.slot, { ours: true, reason: 'provider', message: AI_BUILD_UNIT_EMPTY_COPY }))
    }
    const spent: AiJobStepOutcome = {
      outputs: outcome.outputs,
      usage: outcome.usage,
      estCostUsd: outcome.estCostUsd,
      model: outcome.model,
      stopReason: outcome.stopReason,
      ...(outcome.effort ? { effort: outcome.effort } : {}),
    }
    const ids = outcome.outputs.map((output) => output.id)
    if (outcome.refused) {
      return settle(failed(unit.slot, { ours: false, reason: 'refused', message: AI_BUILD_UNIT_REFUSED_COPY }, { outputs: ids }), spent)
    }
    if (outcome.review) {
      // A building rule still broken after its re-ask is ours (AGL-3596); a
      // site at an allowance is the workspace's to change.
      const ours = outcome.review.reason === 'doctrine'
      return settle(
        failed(
          unit.slot,
          { ours, reason: ours ? 'doctrine-refused' : 'review', message: outcome.review.message || AI_BUILD_UNIT_EMPTY_COPY },
          { outputs: ids },
        ),
        spent,
      )
    }
    if (outcome.failure) {
      return settle(failed(unit.slot, { ours: true, reason: 'step-failure', message: outcome.failure }, { outputs: ids }), spent)
    }
    if (outcome.continue) return settle({ slot: unit.slot, status: 'running', outputs: ids }, spent)
    if (!outcome.outputs.length) {
      return settle(failed(unit.slot, { ours: true, reason: 'step-failure', message: AI_BUILD_UNIT_EMPTY_COPY }), spent)
    }
    // A page counts as built only when its plan's sections are in it (AGL-3596).
    if (unit.screen && job.hostId) {
      const page = outcome.outputs.find((output) => output.resource === 'screen')
      const written =
        page !== undefined &&
        (await aiSitePageWritten(
          firestore,
          { hostId: job.hostId, unitJobId: derived.$id, screen: unit.screen, draftId: page.id },
          readNodes,
        ))
      if (!written) {
        return settle(
          failed(unit.slot, { ours: true, reason: 'step-failure', message: AI_BUILD_PAGE_NOT_WRITTEN_COPY }),
          { ...spent, outputs: outcome.outputs.filter((output) => output.resource !== 'screen') },
        )
      }
    }
    const done = settle(
      {
        slot: unit.slot,
        status: degraded ? 'degraded' : 'succeeded',
        outputs: ids,
        note,
        ...(degraded ? { degradedBy: degradation.degradedBy } : {}),
      },
      spent,
    )
    if (done.continue) return done
    // The last unit: what was built goes live where it was asked and confirmed.
    rows.set(unit.slot, { ...(rows.get(unit.slot) as AiJobItemLedger), status: degraded ? 'degraded' : 'succeeded', outputs: ids })
    return finish(done, unit.screen ? outcome.outputs.filter((output) => output.resource === 'screen') : [])
  }
}

export const runAiJobBuildStep = createAiJobBuildStep()

/**
 * The least time a build's next pass needs: what the step that builds its
 * next unit registers for the job derived for it; a page pass's when the
 * next unit is another plugin's draft, which asks no model.
 */
export function aiBuildJobRunMinimumMs(job: AiJob): number {
  const plan = aiConfirmedPlan(job)
  if (!plan) return AI_JOB_PAGE_STEP_MINIMUM_MS
  const units = aiBuildUnits(plan)
  const ordered = aiBuildOrder(units) ?? units
  const ledger = job.items?.length ? job.items : aiBuildInitialLedger(units)
  const unit = aiBuildNextUnit(ordered, ledger)
  if (!unit) return AI_JOB_PAGE_STEP_MINIMUM_MS
  const kind: AiJobKind | null = unit.screen
    ? 'page'
    : unit.creation
      ? (CREATION_JOB_KINDS[unit.creation.kind] ?? null)
      : (AI_BUILD_ITEM_RUNNER_KINDS[unit.op] ?? null)
  if (!kind) return AI_JOB_PAGE_STEP_MINIMUM_MS
  return aiJobStepRunMinimumMs(aiBuildUnitJob(job, unit, { kind, units, ledger, ops: new Map() }))
}

/** The runner kinds this plugin's own item operations use, for the time a pass needs without the registry. */
const AI_BUILD_ITEM_RUNNER_KINDS: Readonly<Record<string, AiJobKind>> = {
  template: 'template',
  campaign: 'campaign',
  workflow: 'workflow',
}

/**
 * Why a Free build cannot be confirmed: its estimate is more than the owner's
 * Free allowance has left this month. Read off the account month the meter
 * writes, net of give-backs; a read that fails admits, since the reservation
 * still refuses at the wall.
 */
export async function aiBuildFreeBalanceRefusal(input: {
  firestore: FirebaseFirestore.Firestore
  org: object | null
  estimate: number
  now: Date
}): Promise<string | null> {
  const account = freeAssistAccount(input.org as AssistMeteredOrg | null)
  if (!account?.accountUid) return null
  try {
    const month = input.now.toISOString().slice(0, 7)
    const snapshot = await freeAccountUsageRef(input.firestore, account.accountUid, month).get()
    const spent = assistCreditsFromUsd(
      assistSpendAfterReturnsUsd(snapshot.get('estCostUsd'), snapshot.get(ASSIST_RETURNED_USD_FIELD)),
    )
    const left = Math.max(0, FREE_AI_TASTE_CREDITS_PER_MONTH - spent)
    return input.estimate > left
      ? `This plan is estimated at ${input.estimate} credits, and your Free AI credits have ${left} left this month. Ask for less, or upgrade for more.`
      : null
  } catch (error) {
    console.error('ai build free balance read failed', { error })
    return null
  }
}

export interface AiBuildAdmissionDeps {
  opsFor?: (context: AiBuildOpsContext) => Promise<AiBuildOps>
  freeBalanceRefusal?: typeof aiBuildFreeBalanceRefusal
  ownerOf?: typeof resolveOrgIdForHost
  now?: () => Date
}

/**
 * A build is admitted for a site of the job's own org where a page can be
 * built; and confirmed only for a plan it can build here — its shape, its
 * operations as this site has them, and on the Free taste an estimate the
 * month's Free credits still cover.
 */
export function createAiBuildJobAdmission(deps: AiBuildAdmissionDeps = {}): AiJobAdmission {
  const opsFor = deps.opsFor ?? ((context) => aiBuildOps(context))
  const freeBalanceRefusal = deps.freeBalanceRefusal ?? aiBuildFreeBalanceRefusal
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  return async (context) => {
    if (!context.hostId) return { status: 400, error: 'Open the site to build on before asking Assist to build' }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    if (!aiJobStepRunnerFor('page')) return { status: 400, error: 'Building from a request is not available yet.' }
    const plan = context.plan
    if (!plan) return null
    const org = context.org as Partial<AglynOrgBilling> | null
    const freeTaste = aiBuildFreeTaste(org)
    const host = await readHost(context.firestore, context.hostId)
    const ops = await opsFor({ orgId: context.orgId, hostId: context.hostId, org, host, freeTaste })
    const shape = aiBuildPlanShapeRefusal(plan, { freeTaste, ops })
    if (shape) return { status: 400, error: shape }
    if (freeTaste) {
      const refusal = await freeBalanceRefusal({
        firestore: context.firestore,
        org,
        estimate: aiBuildCreditEstimate(plan, { ops }),
        now: deps.now?.() ?? new Date(),
      })
      if (refusal) return { status: 403, error: refusal }
    }
    return null
  }
}

export const aiBuildJobAdmission = createAiBuildJobAdmission()

/**
 * Registers the build with the least time a pass needs, the time its next
 * pass needs, the passes its largest plan may take, and its admission.
 */
export function registerAiBuildJob(): void {
  registerAiJobStep('build', runAiJobBuildStep, {
    minimumMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
    minimumMsFor: aiBuildJobRunMinimumMs,
  })
  registerAiJobStepPasses('build', AI_BUILD_MAX_PASSES)
  registerAiJobAdmission('build', aiBuildJobAdmission)
}
