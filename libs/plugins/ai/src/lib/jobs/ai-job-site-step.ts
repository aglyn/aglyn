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
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import {
  isAiPlanNewRef,
  type AiBuildPlanCreate,
  type AiBuildPlanCreateKind,
  type AiBuildPlanScreen,
} from '../model/ai-build-plan'
import type {
  AiJob,
  AiJobKind,
  AiJobOutput,
  AiJobOutputResource,
  AiJobPlan,
} from '../model/ai-jobs.types'
import {
  AI_SITE_MAX_SECTIONS,
  AI_SITE_PAGES,
  aiSitePlanRefusal,
  parseAiSiteJobInputs,
  type AiSiteJobInputs,
} from '../model/ai-site-job'
import { aiModelForStep } from '../providers/routing'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiConfirmedPlan, aiUnspentOutcome } from './ai-job-generation'
import {
  AI_JOB_BRIEF_MAX_CHARS,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import {
  aiJobStepRunnerFor,
  registerAiJobStep,
  registerAiJobStepPasses,
} from './ai-jobs'

/**
 * The site scaffold (AGL-2911): the generation step of a `site` job, run once
 * a member confirmed the plan their brief produced.
 *
 * ── It builds nothing itself ─────────────────────────────────────────────
 *
 * A scaffold is a whole site: a palette suggestion, the layout its pages
 * render inside, the contact form they place, four to eight pages with their
 * search listings, and a welcome email. Every one of those is already a job
 * kind with a step of its own, so this step generates nothing and asks no
 * model anything. It works through the confirmed plan one UNIT at a time and
 * hands each unit to the runner registered for the kind that owns it — the
 * theme step for the palette, the page step for a page — under a job of that
 * kind derived from this one.
 *
 * That is why the scaffold cannot drift from the thing it scaffolds: a page
 * it builds is a page job's page, held to the same doctrine, written by the
 * same draft writer, left unpublished by the same rule. A kind whose step
 * this deployment has not loaded is simply not among the units, so nothing
 * here knows which issues have landed.
 *
 * ── One unit a pass ──────────────────────────────────────────────────────
 *
 * The step runs ONE delegated pass and asks the machine to continue, so every
 * pass is one reservation, one provider exchange and one recorded spend, and
 * the org's monthly ceiling binds a scaffold exactly as it binds a chat turn.
 * Credits running out mid-scaffold is therefore the machine's own park: the
 * job waits as `needs_input` with the meter's words, and the beat resumes it
 * where it stopped once the workspace's standing has changed.
 *
 * Where it stopped is read from the job's OUTPUTS rather than kept anywhere:
 * each unit reports exactly one output when it completes, so the units
 * already represented there are the ones already built. A pass interrupted
 * between its work and its record repeats a unit that then finds its own
 * draft and reports it, which is what every step's draft id already gives.
 *
 * ── Never published ──────────────────────────────────────────────────────
 *
 * Nothing here publishes, routes or sends: each delegated step writes the
 * unpublished draft it already wrote for a job of its own kind, and the
 * palette and navigation travel as proposals a member applies.
 */

/** What a scaffold's units are, in the order it builds them. */
export type AiSiteUnitKind = 'theme' | 'layout' | 'form' | 'page' | 'email'

export interface AiSiteUnit {
  kind: AiSiteUnitKind
  /** The job kind whose registered runner builds it. */
  jobKind: AiJobKind
  /** The resource the unit reports when it completes. */
  resource: AiJobOutputResource
  /** Stable within the job: what the unit's derived job and draft are addressed by. */
  slot: string
  /** The plan screen a page unit builds. */
  screen?: AiBuildPlanScreen
  /** The creation a theme, layout or form unit builds. */
  creation?: AiBuildPlanCreate
  /** What the unit is, for the derived job's brief. */
  label: string
}

/** The job kind and output resource each unit is built through. */
const UNIT_KINDS: Record<
  AiSiteUnitKind,
  { jobKind: AiJobKind; resource: AiJobOutputResource }
> = {
  theme: { jobKind: 'theme', resource: 'theme' },
  layout: { jobKind: 'layout', resource: 'layout' },
  form: { jobKind: 'form', resource: 'form' },
  page: { jobKind: 'page', resource: 'screen' },
  email: { jobKind: 'email', resource: 'emailScreen' },
}

/** The creation kinds a unit is built from, by unit kind. */
const CREATION_UNITS: Array<{
  unit: AiSiteUnitKind
  create: AiBuildPlanCreateKind
}> = [
  { unit: 'theme', create: 'theme-change' },
  { unit: 'layout', create: 'layout' },
  { unit: 'form', create: 'form' },
]

export const AI_SITE_NO_PLAN_COPY =
  'This site job has no confirmed plan to build.'

/** What a scaffold answers where the step that builds a page is not loaded. */
export const AI_SITE_NO_PAGE_STEP_COPY =
  'Building a whole site is not available yet.'

/** A unit that finished without reporting what it built; the scaffold cannot go on. */
export const AI_SITE_UNIT_EMPTY_COPY =
  'Part of this site could not be built. Try the site brief again.'

/**
 * The most passes a scaffold's step may take: the largest plan it admits —
 * eight pages of eight sections, its three creations and a welcome email —
 * with nothing to spare, so a runner that never finishes is still bounded
 * while a real site is not.
 */
export const AI_SITE_MAX_PASSES =
  AI_SITE_PAGES.max * (AI_SITE_MAX_SECTIONS + 1) + CREATION_UNITS.length + 1

/**
 * The units a plan implies, in build order: the palette first, because a
 * member reads it while the pages are still building; then the layout every
 * page renders inside and the form they place, because a page binds both by
 * id and so needs them to exist; then the pages; then the welcome email,
 * which is about the site rather than part of it.
 */
export function aiSiteJobUnits(
  plan: Pick<AiJobPlan, 'create' | 'screens'>,
  options: { welcomeEmail?: boolean } = {},
): AiSiteUnit[] {
  const units: AiSiteUnit[] = []
  for (const { unit, create } of CREATION_UNITS) {
    const creation = plan.create.find((entry) => entry.kind === create)
    if (!creation) continue
    units.push({
      kind: unit,
      ...UNIT_KINDS[unit],
      slot: unit[0],
      creation,
      label: creation.name,
    })
  }
  plan.screens.forEach((screen, index) => {
    units.push({
      kind: 'page',
      ...UNIT_KINDS.page,
      slot: `p${index}`,
      screen,
      label: screen.title,
    })
  })
  if (options.welcomeEmail) {
    units.push({
      kind: 'email',
      ...UNIT_KINDS.email,
      slot: 'e',
      label: 'Welcome email',
    })
  }
  return units
}

/**
 * The units a scaffold still owes after the outputs recorded so far. Each
 * unit reports one output of its own resource when it completes, so the
 * outputs already recorded are consumed against the units in build order.
 */
export function aiSitePendingUnits(
  units: readonly AiSiteUnit[],
  outputs: readonly Pick<AiJobOutput, 'resource'>[],
): AiSiteUnit[] {
  const done = new Map<AiJobOutputResource, number>()
  for (const output of outputs) {
    done.set(output.resource, (done.get(output.resource) ?? 0) + 1)
  }
  return units.filter((unit) => {
    const left = done.get(unit.resource) ?? 0
    if (left <= 0) return true
    done.set(unit.resource, left - 1)
    return false
  })
}

/** A record an earlier unit created, as a later one references it. */
export interface AiSiteBuiltRef {
  id: string
  label: string
  /** Only what becomes a record a page can name; a palette change is not one. */
  kind: 'layout' | 'form'
}

/**
 * What the scaffold has already created, as the plan's `new:<name>`
 * references resolve to: the id of the record each completed creation wrote.
 * A page unit is told about the layout and the form by id, exactly as a page
 * job is told about records the site already had.
 */
export function aiSiteBuiltRefs(
  units: readonly AiSiteUnit[],
  outputs: readonly Pick<AiJobOutput, 'resource' | 'id' | 'label'>[],
): Map<string, AiSiteBuiltRef> {
  const byResource = new Map<
    AiJobOutputResource,
    Array<Pick<AiJobOutput, 'id' | 'label'>>
  >()
  for (const output of outputs) {
    const rows = byResource.get(output.resource) ?? []
    rows.push(output)
    byResource.set(output.resource, rows)
  }
  const built = new Map<string, AiSiteBuiltRef>()
  for (const unit of units) {
    const rows = byResource.get(unit.resource)
    const row = rows?.shift()
    if (!row || !unit.creation) continue
    // A theme change is a proposal with no record to reference; only a layout
    // and a form become ids a page can name.
    if (unit.creation.kind !== 'layout' && unit.creation.kind !== 'form') continue
    built.set(unit.creation.name.toLowerCase(), {
      id: row.id,
      label: row.label || unit.creation.name,
      kind: unit.creation.kind,
    })
  }
  return built
}

type BuiltRefs = ReturnType<typeof aiSiteBuiltRefs>

/** A plan reference as the unit's own job reads it: an id the site now has, or nothing. */
function resolved(ref: string | null, built: BuiltRefs): string | null {
  if (!ref) return null
  if (!isAiPlanNewRef(ref)) return ref
  return (
    built.get(
      ref
        .slice(ref.indexOf(':') + 1)
        .trim()
        .toLowerCase(),
    )?.id ?? null
  )
}

/** The site's own words, as every unit's brief carries them. */
export function aiSiteBriefLines(
  brief: string,
  inputs: AiSiteJobInputs,
): string[] {
  const lines = [brief.trim()]
  const site = [
    inputs.businessName ? `name: ${inputs.businessName}` : '',
    `business: ${inputs.businessType}`,
    inputs.city ? `city: ${inputs.city}` : '',
    inputs.brand ? `brand: ${inputs.brand}` : '',
  ].filter(Boolean)
  lines.push(`Site — ${site.join('; ')}.`)
  return lines
}

/**
 * The job a unit is built under: this job's org, site, creator and model,
 * the kind that owns the unit, and a plan narrowed to the unit alone.
 *
 * The derived job carries NO steps and NO outputs of the scaffold's: a page
 * job's step reads its own draft and its own plan, and what the other units
 * produced is not its business. Its `$id` is this job's with the unit's slot,
 * which is what every step already addresses its draft by, so a unit re-run
 * after its write finds its own draft rather than writing a second.
 */
export function aiSiteUnitJob(
  job: AiJob,
  unit: AiSiteUnit,
  built: BuiltRefs,
): AiJob {
  const plan = job.plan as AiJobPlan
  const labels = { ...(plan.labels ?? {}) }
  for (const entry of built.values()) labels[entry.id] = entry.label
  const inputs = parseAiSiteJobInputs(job.inputs)
  const brief =
    typeof inputs === 'string'
      ? [job.brief]
      : aiSiteBriefLines(job.brief, inputs)
  const unitPlan: AiJobPlan = {
    ...plan,
    labels,
    reuse: [...plan.reuse],
    create: [],
    screens: [],
  }
  if (unit.creation) {
    unitPlan.create = [
      {
        ...unit.creation,
        duplicateOf: resolved(unit.creation.duplicateOf, built),
      },
    ]
    brief.push(
      `Build the ${unit.creation.kind} “${unit.creation.name}”: ${unit.creation.why}`,
    )
  }
  if (unit.screen) {
    const screen = unit.screen
    // Everything the scaffold has already built is a record the site has, so
    // the page is planned against it the way a page job is planned against
    // what the site always had.
    for (const entry of built.values()) {
      unitPlan.reuse.push({
        kind: entry.kind,
        id: entry.id,
        purpose: `the ${entry.kind} this site’s pages are built on`,
      })
    }
    unitPlan.screens = [
      {
        ...screen,
        layout: resolved(screen.layout, built),
        template: resolved(screen.template, built),
        duplicateOf: resolved(screen.duplicateOf, built),
        sections: screen.sections.map((section) => ({
          ...section,
          uses: section.uses
            .map((ref) => resolved(ref, built))
            .filter((ref): ref is string => !!ref),
        })),
      },
    ]
    brief.push(
      `Build the page “${screen.title}” of this site, at ${screen.slug}.`,
    )
  }
  if (unit.kind === 'email') {
    brief.push(
      'Write the welcome email this site sends someone who gets in touch.',
    )
  }
  return {
    ...job,
    $id: `${job.$id}-${unit.slot}`,
    kind: unit.jobKind,
    steps: [],
    outputs: [],
    plan: unitPlan,
    // A theme change on a site with no theme of its own is a new palette.
    ...(unit.kind === 'theme'
      ? { inputs: { ...job.inputs, mode: 'create' } }
      : {}),
    brief: brief.join('\n').slice(0, AI_JOB_BRIEF_MAX_CHARS),
  }
}

/**
 * A scaffold is admitted with inputs that read, for a site of the job's own
 * org, and only where this deployment has loaded the step that builds a page:
 * a scaffold whose pages nothing can build is not a scaffold.
 */
export const aiSiteJobAdmission: AiJobAdmission = async (context) => {
  const inputs = parseAiSiteJobInputs(context.inputs)
  if (typeof inputs === 'string') return { status: 400, error: inputs }
  if (!context.hostId) {
    return {
      status: 400,
      error: 'Open the site the scaffold is for before starting the job',
    }
  }
  const owner = await resolveOrgIdForHost(context.hostId)
  if (!owner || owner !== context.orgId)
    return { status: 404, error: 'Unknown site' }
  if (!aiJobStepRunnerFor('page')) {
    return { status: 400, error: AI_SITE_NO_PAGE_STEP_COPY }
  }
  return null
}

export interface AiJobSiteStepDeps {
  /** The runner registry; specs hand in a fake for a kind they drive. */
  runnerFor?: typeof aiJobStepRunnerFor
}

export function createAiJobSiteStep(
  deps: AiJobSiteStepDeps = {},
): AiJobStepRunner {
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  return async (context): Promise<AiJobStepOutcome> => {
    const { job } = context
    // The scaffold asks no model of its own. What it names where it spends
    // nothing is the model its plan ran on, which is the one exchange this
    // job has already had of its own.
    const model = context.modelFor?.('job.plan') ?? aiModelForStep('job.plan')
    const plan = aiConfirmedPlan(job)
    if (!plan)
      return { ...aiUnspentOutcome(model), failure: AI_SITE_NO_PLAN_COPY }
    // The resume door refuses such a plan at confirmation once it can read
    // one; a plan confirmed before a site changed still stops here, unspent.
    const refusal = aiSitePlanRefusal(plan)
    if (refusal) return { ...aiUnspentOutcome(model), failure: refusal }
    const inputs = parseAiSiteJobInputs(job.inputs)
    if (typeof inputs === 'string')
      return { ...aiUnspentOutcome(model), failure: inputs }

    // A kind this deployment has not loaded is not among the units at all, so
    // a scaffold owes only what something can build.
    const units = aiSiteJobUnits(plan, {
      welcomeEmail: inputs.welcomeEmail,
    }).filter((unit) => runnerFor(unit.jobKind))
    const outputs = job.outputs ?? []
    const pending = aiSitePendingUnits(units, outputs)
    if (!pending.length) return aiUnspentOutcome(model)
    const unit = pending[0]
    const runner = runnerFor(unit.jobKind)
    if (!runner) return aiUnspentOutcome(model)

    const outcome = await runner({
      ...context,
      job: aiSiteUnitJob(job, unit, aiSiteBuiltRefs(units, outputs)),
    })
    // A delegate proposes a plan for its own job, which does not exist: the
    // plan a scaffold builds from is the one a member confirmed.
    const spent: AiJobStepOutcome = {
      outputs: outcome.outputs,
      usage: outcome.usage,
      estCostUsd: outcome.estCostUsd,
      model: outcome.model,
      stopReason: outcome.stopReason,
      ...(outcome.effort ? { effort: outcome.effort } : {}),
      ...(outcome.refused ? { refused: true } : {}),
      ...(outcome.failure ? { failure: outcome.failure } : {}),
      ...(outcome.review ? { review: outcome.review } : {}),
    }
    // A unit that stopped for a person is what the job waits on, and one that
    // refused or failed is the job's refusal: neither continues.
    if (spent.review || spent.refused || spent.failure) return spent
    // The unit asked for another pass of its own.
    if (outcome.continue) return { ...spent, continue: true }
    // It finished without reporting what it built, so another pass would ask
    // the same thing again. The tokens it spent are on the bill either way.
    if (!outcome.outputs.length)
      return { ...spent, failure: AI_SITE_UNIT_EMPTY_COPY }
    return { ...spent, ...(pending.length > 1 ? { continue: true } : {}) }
  }
}

export const runAiJobSiteStep = createAiJobSiteStep()

/**
 * Registers the site scaffold, the passes a whole site's plan may take, and
 * the check a site job passes before it is created or resumed.
 */
export function registerAiSiteJob(): void {
  registerAiJobStep('site', runAiJobSiteStep)
  registerAiJobStepPasses('site', AI_SITE_MAX_PASSES)
  registerAiJobAdmission('site', aiSiteJobAdmission)
}
