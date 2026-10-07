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

import { createHash } from 'node:crypto'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  AI_BUILD_PLAN_TOOL,
  aiBuildPlanToolFor,
  isAiPlanNewRef,
  type AiBuildPlan,
} from '../model/ai-build-plan'
import type { AiJob, AiJobKind, AiJobPlan, AiJobStatus } from '../model/ai-jobs.types'
import {
  AI_TEMPLATE_SUBJECT_DEFINITIONS,
  aiTemplateShownTokens,
  type AiTemplateSubject,
} from '../model/ai-template-subjects'
import { AI_JOB_CREATE_KINDS, AI_JOB_CREATE_NOUNS } from '../model/ai-job-creations'
import { AI_PAGE_CREATE_KINDS, aiPagePlanShapeRefusal } from '../model/ai-page-job'
import {
  aiPlanCapabilitiesForJob,
  aiPlanCapabilityLines,
  type AiPlanCapabilities,
  type AiPlanJobScope,
} from '../model/ai-plan-capabilities'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import {
  AI_FREE_SITE_WORST_CASE_CREDITS,
  AI_SITE_CREATE_KINDS,
  AI_SITE_FREE_PAGES,
  AI_SITE_PLAN_MAX_TOKENS,
  aiFreeSiteSectionsWithin,
  aiSitePlanShapeRefusal,
} from '../model/ai-site-job'
import { aiPlanFailureCopy, aiPlanRetryRefusal } from '../model/ai-job-failure-copy'
import { FREE_AI_TASTE_CREDITS_PER_MONTH } from '../plan-entitlements'
import { aiDoctrineSystemBlocks, runValidatedGeneration } from '../runtime/ai-doctrine'
import { AI_STEP_TIERS, aiCatalogEntry, aiDefaultModelFor } from '../providers/catalog'
import {
  AI_FREE_PAGE_WORST_CASE_CREDITS,
  aiPlanEmbedBriefViolations,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { ASSIST_RETURNED_USD_FIELD, assistSpendAfterReturnsUsd } from '../usage/assist-credit-returns'
import { freeAccountUsageRef, freeAssistAccount, type AssistMeteredOrg } from '../usage/assist-free-taste'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import type { AiTool } from '../providers/contract'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import { aiJobAdmissionRefusal } from './ai-job-admission'
import { readAiPlanCapabilities } from './ai-job-drafts'
import {
  AI_JOB_BRIEF_MAX_CHARS,
  type AiJobStepOutcome,
  type AiJobStepRunner,
} from './ai-job-text-step'
import { aiJobStepBudget } from './ai-job-budget'
import { aiDoctrineReview, aiUnspentOutcome } from './ai-job-generation'
import { aiPlanWithDraftIds } from './ai-job-draft-ids'
import { AI_JOBS_COLLECTION, registerAiJobPlanStep } from './ai-jobs'

/**
 * The plan step (AGL-2935): the first step of every job that builds site
 * structure. Before a node is generated, the model answers with a typed plan
 * — what the site already has that the job reuses, what it creates and why,
 * and the screens it builds from them — held to the doctrine's plan rules
 * against the site's inventory and re-asked once when it breaks one.
 *
 * A plan that passes is kept on the job, and the job stops for review: the
 * member reads what it will build before a credit is spent building it, and
 * confirms through the resume door. A plan that still breaks a rule on its
 * re-ask stops the job the same way, with the rules named. Either way the
 * step writes nothing itself; the machine records the plan, the spend and
 * the stop, as it records every step.
 *
 * ── Told what it may create, refused what it cannot build (AGL-3030) ─────
 *
 * Before it asks, the step reads what the job may create on its site: the
 * workspace's plan, the site's counts against its limits, and — for a kind
 * that builds only some plans — what the job builds itself. The user turn
 * states it, the plan rules refuse a creation outside it with the one re-ask,
 * and where the workspace keeps no reusable components they accept the page
 * built inline. A plan the confirm door would still refuse — the kind's own
 * admission, handed the plan, as the resume door hands it — is refused HERE,
 * before a member is shown a Confirm: the job fails with the door's sentence,
 * its plan is not kept, and it holds nothing.
 */

/** The plan step's own instructions, cached after the doctrine. */
export const AI_JOB_PLAN_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text:
      'You plan what a website builder job will build, before anything is built. You are given the kind of job and the brief from the person who owns the site. ' +
      'Answer with submit_build_plan: what the site inventory already has that the job reuses, what it must create and why nothing listed will do, and each page it builds (the screens list) with its layout, template, slug, search title, search description and sections from top to bottom. ' +
      'Refer to inventory records by id and to what the plan creates as new:<name>. Plan only what the brief asks for: a component, layout, template, form or email job plans no pages unless the brief asks for them, and a page job plans exactly one page.',
  },
]

/**
 * The plan step's time (AGL-3026, AGL-3036): its two inventory-lookup rounds,
 * its answer and its re-ask at the routing table's ceiling for `job.plan`, on
 * the tier that step kind is served from, with the step's reads and writes,
 * at the rates `ai-job-budget.ts` assumes — fitted to what a beat can give a
 * step, so the served tier asks a little under the routing ceiling.
 */
export const AI_JOB_PLAN_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.plan'],
  maxTokens: AI_ROUTING_TABLE['job.plan'].maxTokens,
})

/**
 * The least time a plan needs before it starts. Registered with the step, so
 * an inline door never starts a plan. A plan thinks before it answers and
 * routinely runs past an inline door's budget, and a provider call that
 * budget cuts off is still generated and billed upstream while the meter
 * records nothing. The beat starts a plan only with this much of its own
 * budget left, and a spec holds it inside that budget.
 */
export const AI_JOB_PLAN_STEP_MINIMUM_MS = AI_JOB_PLAN_STEP_BUDGET.minimumMs

/**
 * The plan's answer ceiling on the model a job runs: the most whose worst
 * case fits the least time the step registered, and never more than the
 * routing table's. A model the catalog does not know is planned at the
 * slowest.
 */
export function aiJobPlanMaxTokens(model: string): number {
  return AI_JOB_PLAN_STEP_BUDGET.maxTokens(model)
}

/** What the member reads while a plan waits for them. */
export const AI_JOB_PLAN_REVIEW_COPY =
  'The plan is ready. Review what the job will reuse and create, then confirm it to build.'

/**
 * The job as the plan step's user turn: its kind, its brief, its scalar
 * inputs and, where the job read them, what it may create on its site
 * (AGL-3030). Per workspace and per site, which is why they ride here and
 * never in a system block the platform's cache entry is keyed on.
 */
export function aiJobPlanPrompt(
  job: Pick<AiJob, 'kind' | 'brief' | 'inputs'>,
  capabilities: AiPlanCapabilities | null = null,
  inventory: AiSiteInventory | null = null,
): string {
  const lines = [`Job kind: ${job.kind}`, `Brief: ${job.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`]
  for (const [key, value] of Object.entries(job.inputs ?? {})) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`)
    }
  }
  if (capabilities) lines.push(...aiPlanCapabilityLines(capabilities))
  lines.push(...aiPlanTemplateTokenLines(job))
  lines.push(...aiPlanSiteLines(job, inventory, capabilities))
  return lines.join('\n')
}

/**
 * What a SITE job's plan is told beside the inventory (AGL-3594): the pages
 * the site already has and that their addresses are taken, which one — the
 * untouched starter home — a planned home page at `/` replaces, the Free page
 * cap and its guidance, and that a plan is an outline.
 *
 * A site job only. A new site is born with a published home page at `/`
 * (AGL-3497), and a plan that did not know it could replace it planned its own
 * home there and was refused for the clash on every new site. Kept off a page
 * job's turn, whose length the Free page's wall is proven at.
 */
export function aiPlanSiteLines(
  job: Pick<AiJob, 'kind'>,
  inventory: AiSiteInventory | null,
  capabilities: AiPlanCapabilities | null,
): string[] {
  if (job.kind !== 'site') return []
  const lines: string[] = []
  const pages = (inventory?.screens ?? []).filter((screen) => !screen.template)
  const starter = pages.find((screen) => screen.replaceable)
  if (pages.length) {
    lines.push('Pages the site already has; their addresses are taken unless a line says otherwise:')
    for (const page of pages) {
      lines.push(
        page.replaceable
          ? `- ${page.name} at ${page.slug}: the starter home page the site was created with. Plan this site's home page at / and it replaces this one.`
          : `- ${page.name} at ${page.slug}`,
      )
    }
    if (!starter && pages.some((page) => page.slug.trim() === '/' || page.slug.trim() === '')) {
      lines.push("The home page at / is the owner's own and stays: give every page you plan another address.")
    }
  }
  const cap = capabilities?.freeSitePages
  if (cap !== undefined) {
    const sections = aiFreeSiteSectionsWithin(
      { layouts: (inventory?.layouts.length ?? 0) ? 0 : 1, pages: cap },
      FREE_AI_TASTE_CREDITS_PER_MONTH,
    )
    lines.push(
      `This is a Free workspace: plan at most ${cap} ${cap === 1 ? 'page' : 'pages'} — the home page at / and the one page the brief most needs, such as services, booking or contact — with at most ${sections} sections across them. Put the contact form on one of them.`,
    )
  }
  lines.push(
    "Keep the plan an outline: each page's title, address, a short search title and description, and its sections named in a few words. The build writes the copy.",
  )
  return lines
}

/**
 * What a TEMPLATE job's plan is told its creation's `fields` are (AGL-3143
 * §11): the subject's binding tokens, listed so the planner promises only
 * what the page can fill and the build can be held to it
 * (`aiPlanTemplateTokenViolations`).
 *
 * ⛔ It rides the job's own turn and NOT the `fields` description in the plan
 * tool, which every kind's request caches. Written there it read better and
 * cost 40 tokens of the shared prefix — 2,980 to 3,020 — which is one credit
 * of the Free page's 300-credit wall, taking the room it keeps for a re-asked
 * section from 45 credits to 44 and breaking `ai-job-free-page.spec.ts`. A
 * page job must not pay for a sentence about templates.
 *
 * The list is the tokens a reader sees, never the whole catalog (AGL-3143
 * §16). Offered a slug and the publish timestamp, a live plan promised them,
 * and its build kept the promise the only way a slug can be kept: it printed
 * "entry slug: {{entry.slug}}" on every article.
 */
export function aiPlanTemplateTokenLines(job: Pick<AiJob, 'kind' | 'inputs'>): string[] {
  if (job.kind !== 'template') return []
  const subject = (job.inputs ?? {})['subject']
  const definition =
    typeof subject === 'string'
      ? AI_TEMPLATE_SUBJECT_DEFINITIONS[subject as AiTemplateSubject]
      : undefined
  if (!definition) return []
  return [
    `The template's fields are the binding tokens its page shows a reader, each one of: ${aiTemplateShownTokens(
      definition,
    ).join(', ')}. A link or picture token is shown by the link or picture holding it. Promise only what the page fills.`,
  ]
}

/** A kind that builds only some plans: the creations it makes, and the shapes it refuses. */
export interface AiJobPlanScope extends AiPlanJobScope {
  /** Why a job of the kind cannot build a plan of this shape; `null` when it can. Pure. */
  shapeRefusal: (plan: AiBuildPlan, options?: { freeTaste?: boolean }) => string | null
}

/**
 * The kinds whose confirm door builds only some plans (AGL-3030). A page job
 * builds one screen and a scaffold four to eight; each builds only the
 * creations its list names. A template, layout, component, form or email job
 * builds its own record and what that record places (AGL-3143 §15,
 * `AI_JOB_CREATE_KINDS`), and holds no plan to a shape.
 */
export const AI_JOB_PLAN_SCOPES: Readonly<Partial<Record<AiJobKind, AiJobPlanScope>>> = {
  page: { noun: 'a page job', creates: AI_PAGE_CREATE_KINDS, shapeRefusal: aiPagePlanShapeRefusal },
  site: { noun: 'a site scaffold', creates: AI_SITE_CREATE_KINDS, shapeRefusal: aiSitePlanShapeRefusal },
  ...Object.fromEntries(
    Object.entries(AI_JOB_CREATE_KINDS).map(([kind, creates]) => [
      kind,
      { noun: AI_JOB_CREATE_NOUNS[kind as AiJobKind] as string, creates, shapeRefusal: () => null },
    ]),
  ),
}

/**
 * What the plan step holds beyond the doctrine's plan rules, as the
 * violations the plan's one re-ask names: the players the plan lists against
 * the brief it answers (AGL-3433), which only this step reads beside the plan,
 * and a kind's shape refusal.
 */
function planViolations(
  scope: AiJobPlanScope | null,
  brief: string,
  freeTaste = false,
): (plan: AiBuildPlan) => AiDoctrineViolation[] {
  return (plan) => {
    const message = scope?.shapeRefusal(plan, { freeTaste }) ?? null
    return [
      ...aiPlanEmbedBriefViolations(plan, brief),
      ...(message ? [{ rule: null, code: 'plan-job-shape', message }] : []),
    ]
  }
}

/**
 * The inventory names of every id the plan references, so the proposal reads
 * "the Services layout" rather than an id — kept on the plan because the
 * inventory is not read again when the member opens it.
 */
export function aiPlanLabels(
  plan: AiBuildPlan,
  inventory: AiSiteInventory | null,
): Record<string, string> {
  const names = new Map<string, string>()
  for (const rows of [
    inventory?.components,
    inventory?.layouts,
    inventory?.templates,
    inventory?.forms,
    inventory?.datasets,
    inventory?.collections,
    inventory?.screens,
  ]) {
    for (const row of rows ?? []) names.set(row.id, row.name)
  }
  const refs = [
    ...plan.reuse.map((entry) => entry.id),
    ...plan.create.map((entry) => entry.duplicateOf),
    ...plan.screens.flatMap((screen) => [
      screen.layout,
      screen.template,
      screen.duplicateOf,
      ...screen.sections.flatMap((section) => section.uses),
    ]),
  ]
  const labels: Record<string, string> = {}
  for (const ref of refs) {
    if (!ref || isAiPlanNewRef(ref)) continue
    const name = names.get(ref)
    if (name) labels[ref] = name
  }
  return labels
}

/* ------------------------------------------------------------------------ *
 * Reusing an identical brief's plan
 * ------------------------------------------------------------------------ */

/**
 * How long a plan may be reused for (AGL-2937).
 *
 * The window is what makes reuse safe rather than merely cheap. The key
 * already covers everything the request said — the brief, the inputs, the
 * model and the prompt as rendered, site inventory included — so a plan is
 * reused only when nothing the model was shown has changed. What the key
 * cannot see is the world outside the request: a page published, a component
 * renamed after the inventory was read, a member who meant something
 * different the second time. Fifteen minutes is short enough that the answer
 * is still the one the site would give, and long enough to cover what reuse
 * is actually for — the same brief run twice in a sitting, a job resubmitted
 * after a refused reservation, two members starting the same work.
 */
export const AI_PLAN_REUSE_WINDOW_MS = 15 * 60 * 1_000

/** Jobs one lookup reads. More than one can share a key; the newest plan wins. */
export const AI_PLAN_REUSE_CANDIDATES = 5

/** A job whose plan might be reused, as the finder reports it. */
export interface AiJobPlanCandidate {
  jobId: string
  status: AiJobStatus
  plan: AiJobPlan
}

/**
 * The digest a plan is reused by: the whole request, never the answer.
 *
 * It hashes what the model was asked and what it was shown — the job's kind
 * and site, the user turn (which carries the trimmed brief and every scalar
 * input), the model that would answer, every rendered system block including
 * the site inventory, and the tool's schema. Two requests that hash the same
 * would have been sent the same bytes to the same model, so the second can
 * keep the first's answer.
 *
 * The version tag is the escape hatch: anything that changes what a key
 * MEANS, rather than what it covers, bumps it and strands every old key
 * harmlessly, since a key nothing matches simply asks the model.
 */
export function aiJobPlanKey(input: {
  job: Pick<AiJob, 'kind' | 'hostId'>
  prompt: string
  model: string
  system: readonly AiSystemBlock[]
  /** The plan tool the request offers (AGL-3433); the plain one when absent. */
  tool?: AiTool
}): string {
  const digest = createHash('sha256')
  for (const part of [
    'plan.v1',
    input.job.kind,
    input.job.hostId ?? '',
    input.model,
    input.prompt,
    ...input.system.map((block) => block.text),
    JSON.stringify(input.tool ?? AI_BUILD_PLAN_TOOL),
  ]) {
    // Length-prefixed, so two different splits of the same characters cannot
    // collide by running into one another.
    digest.update(`${part.length}:${part}\u0000`)
  }
  return digest.digest('hex')
}

/** A job that could not have produced a reusable plan, whatever its key says. */
const UNREUSABLE: readonly AiJobStatus[] = ['canceled', 'failed']

function planMillis(plan: AiJobPlan): number | null {
  const at = plan.proposedAt as unknown
  if (at instanceof Date) return at.getTime()
  if (at && typeof (at as { toMillis?: unknown }).toMillis === 'function') {
    return (at as { toMillis(): number }).toMillis()
  }
  return null
}

/**
 * The newest plan worth reusing out of what the finder returned: another
 * job's, still proposed or already confirmed, on a job that was neither
 * canceled nor failed, proposed inside the window.
 *
 * A canceled or failed job is excluded even though its plan may be perfectly
 * good: those are the jobs a member walked away from, and handing their plan
 * to the next one would make a rejected answer look like a fresh one.
 */
export function aiReusablePlan(
  candidates: readonly AiJobPlanCandidate[],
  context: { jobId: string; now: Date },
): AiJobPlanCandidate | null {
  const floor = context.now.getTime() - AI_PLAN_REUSE_WINDOW_MS
  let best: AiJobPlanCandidate | null = null
  let bestAt = -1
  for (const candidate of candidates) {
    if (candidate.jobId === context.jobId) continue
    if (UNREUSABLE.includes(candidate.status)) continue
    if (candidate.plan.status !== 'proposed' && candidate.plan.status !== 'confirmed') continue
    const at = planMillis(candidate.plan)
    if (at === null || at < floor || at > context.now.getTime()) continue
    if (at > bestAt) {
      best = candidate
      bestAt = at
    }
  }
  return best
}

export type AiJobPlanFinder = (
  orgId: string,
  key: string,
  firestore?: FirebaseFirestore.Firestore,
) => Promise<AiJobPlanCandidate[]>

/**
 * The finder the step uses in production: an equality on `plan.key` inside
 * the org's own jobs.
 *
 * One equality on one field, with no ordering beside it, so Firestore's
 * automatic single-field index answers it and no composite index is deployed.
 * The window and the statuses are applied in memory instead, which is what
 * keeps it that way.
 */
export const findAiJobsByPlanKey: AiJobPlanFinder = async (orgId, key, firestore) => {
  if (!firestore) return []
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(AI_JOBS_COLLECTION)
    .where('plan.key', '==', key)
    .limit(AI_PLAN_REUSE_CANDIDATES)
    .get()
  return snapshot.docs.flatMap((doc) => {
    const data = doc.data() as { status?: AiJobStatus; plan?: AiJobPlan | null }
    return data.plan
      ? [{ jobId: doc.id, status: data.status ?? 'queued', plan: data.plan }]
      : []
  })
}

/** What a job may create on its site, read for the plan step; `null` for no site. */
export type AiPlanCapabilitiesReader = (input: {
  job: AiJob
  org: Partial<AglynOrgBilling> | null
  firestore: FirebaseFirestore.Firestore
}) => Promise<AiPlanCapabilities | null>

/** The reader the step uses in production: the draft bands' own arithmetic, for the job's site. */
export const readAiJobPlanCapabilities: AiPlanCapabilitiesReader = async ({ job, org, firestore }) =>
  job.hostId ? readAiPlanCapabilities(firestore, { hostId: job.hostId, org }) : null

export interface AiJobPlanStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The reuse lookup; specs hand in a fake, and `null` turns reuse off. */
  findPlansByKey?: AiJobPlanFinder | null
  /** What the job may create on its site (AGL-3030); specs and the eval recorder hand in their own. */
  readCapabilities?: AiPlanCapabilitiesReader
  /** The kind's admission, asked of a plan before it is kept; the registry's otherwise. */
  admissionRefusal?: typeof aiJobAdmissionRefusal
}

export function createAiJobPlanStep(deps: AiJobPlanStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const findPlansByKey =
    deps.findPlansByKey === undefined ? findAiJobsByPlanKey : deps.findPlansByKey
  const readCapabilities = deps.readCapabilities ?? readAiJobPlanCapabilities
  const admissionRefusal = deps.admissionRefusal ?? aiJobAdmissionRefusal
  return async ({ job, now, signal, firestore, modelFor, org: orgDocument }) => {
    const org = (orgDocument ?? null) as Partial<AglynOrgBilling> | null
    const [inventory, workspace] = await Promise.all([
      job.hostId ? readInventory(job.orgId, job.hostId, { firestore }) : Promise.resolve(null),
      readCapabilities({ job, org, firestore }),
    ])
    const scope = AI_JOB_PLAN_SCOPES[job.kind] ?? null
    const capabilities = aiSitePlanCapabilities(
      job,
      workspace ? aiPlanCapabilitiesForJob(workspace, scope) : null,
    )
    const freeTaste = capabilities?.freeTaste === true
    const site = job.kind === 'site'
    // The model switch's answer for this job (AGL-2942): the creator's pick
    // where the plan, the org restriction and the allotment allowlists allow
    // it, and Auto held to those same lists otherwise. Without a resolver the
    // doctrine asks the routing table itself. A Free site plans on its
    // provider's fast tier (AGL-3594), unless the creator picked a model.
    const model = aiSitePlanModel(job, modelFor?.('job.plan'), freeTaste)
    const route = AI_ROUTING_TABLE['job.plan']
    const prompt = aiJobPlanPrompt(job, capabilities, inventory)

    /**
     * The confirm door's answer for this plan, asked before the plan is kept
     * (AGL-3030): the kind's own admission, handed the plan as the resume
     * door hands it. A refusal fails the job with the door's sentence; a door
     * that could not answer keeps the plan, since the resume door asks again
     * before anything is built.
     */
    const refusalOnKeep = async (plan: AiJobPlan, outcome: AiJobStepOutcome): Promise<AiJobStepOutcome | null> => {
      let refusal: Awaited<ReturnType<typeof aiJobAdmissionRefusal>> = null
      try {
        refusal = await admissionRefusal(job.kind, {
          firestore,
          orgId: job.orgId,
          hostId: job.hostId ?? null,
          inputs: job.inputs ?? {},
          org,
          plan,
          uid: job.createdBy,
        })
      } catch (error) {
        console.error('ai plan admission failed', { orgId: job.orgId, jobId: job.$id, error })
      }
      return refusal ? { ...outcome, failure: refusal.error } : null
    }

    // Reuse before asking (AGL-2937). The key covers the whole request, so a
    // hit is a request that would have been sent the same bytes to the same
    // model; the window covers what the key cannot see. A reused plan spends
    // nothing, so the machine's spent-nothing branch releases the reservation
    // and meters no credit, and the job still stops for the member to confirm
    // — this job's plan is proposed to this member, whatever the last one did
    // with theirs.
    const resolved = model ?? aiModelForStep('job.plan')
    // A brief that asks for a video is offered the plan's list of players
    // (AGL-3433), and a job that may bind a dataset a record template on
    // each screen (AGL-3475).
    const tool = aiBuildPlanToolFor(job.brief, {
      records: Boolean(inventory?.datasets.length) || capabilities?.create.dataset.allowed === true,
    })
    const key = aiJobPlanKey({
      job,
      prompt,
      model: resolved,
      system: aiDoctrineSystemBlocks(inventory, { instructions: AI_JOB_PLAN_INSTRUCTIONS }),
      tool,
    })
    const reused = findPlansByKey
      ? aiReusablePlan(await findPlansByKey(job.orgId, key, firestore), {
          jobId: job.$id,
          now,
        })
      : null
    if (reused) {
      // The reused plan's draft ids name the other job's drafts; this job's are its own.
      const plan: AiJobPlan = aiPlanWithDraftIds(job.kind, {
        ...reused.plan,
        status: 'proposed',
        labels: aiPlanLabels(reused.plan, inventory),
        proposedAt: now as unknown as AiJobPlan['proposedAt'],
        confirmedAt: null,
        confirmedBy: null,
        key,
        reusedFrom: reused.jobId,
      })
      const unspent = aiUnspentOutcome(resolved)
      return (
        (await refusalOnKeep(plan, unspent)) ?? {
          ...unspent,
          plan,
          review: { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] },
        }
      )
    }

    const result = await runValidatedGeneration('plan', {
      step: 'job.plan',
      ...(model ? { model } : {}),
      instructions: AI_JOB_PLAN_INSTRUCTIONS,
      inventory,
      messages: [{ role: 'user', content: prompt }],
      tool,
      // The routing ceiling, lowered on a tier too slow to look records up,
      // answer and ask again inside the least time the step registered; a
      // scaffold's outline is held to its own, far lower ceiling (AGL-3594).
      maxTokens: aiSitePlanMaxTokens(job, resolved, freeTaste),
      // A scaffold plans an outline without thinking (AGL-3594): the thinking
      // was nearly all of the 13,491 tokens a Free site's plan spent.
      ...(site ? { thinking: 'off' as const } : route.thinking ? { thinking: route.thinking } : {}),
      ...(route.effort ? { effort: route.effort } : {}),
      ...(signal ? { signal } : {}),
      capabilities,
      extend: planViolations(scope, job.brief, freeTaste),
    })
    const spent: AiJobStepOutcome = {
      outputs: [],
      usage: result.usage,
      estCostUsd: result.estCostUsd,
      model: result.model,
      stopReason: result.stopReason,
      ...(result.effort ? { effort: result.effort } : {}),
    }
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') {
      // Refused by our own checks, after the one re-ask (AGL-3594): the member
      // reads a sentence and an action, staff the rules; the machine gives the
      // credits back (`uncredited`), and on the Free taste Try again says when
      // it cannot work. Whether the give-back was made is the job's to say
      // (`refundedCredits`), so this sentence does not promise it.
      const review = aiDoctrineReview(result)
      const retryRefusal = freeTaste
        ? await aiFreePlanRetryRefusal({ job, org, firestore, now, site })
        : null
      return {
        ...spent,
        uncredited: true,
        review: {
          ...review,
          message: aiPlanFailureCopy({
            kind: job.kind,
            codes: result.violations.map((violation) => violation.code),
            refunded: false,
          }),
          detail: review.message,
          ...(retryRefusal ? { retryRefusal } : {}),
        },
      }
    }
    // Each draft the plan decides is named as the plan is kept, before anything is built (AGL-3079).
    const plan: AiJobPlan = aiPlanWithDraftIds(job.kind, {
      ...result.value,
      status: 'proposed',
      labels: aiPlanLabels(result.value, inventory),
      // A Date the Admin SDK stores as a timestamp, like every instant the machine writes.
      proposedAt: now as unknown as AiJobPlan['proposedAt'],
      confirmedAt: null,
      confirmedBy: null,
      key,
    })
    return (
      (await refusalOnKeep(plan, spent)) ?? {
        ...spent,
        plan,
        review: { reason: 'plan', message: AI_JOB_PLAN_REVIEW_COPY, findings: [] },
      }
    )
  }
}

/**
 * A site job's capabilities on the Free taste (AGL-3594): its plan holds at
 * most the pages the member asked for within the Free band, which the Free
 * wall then holds it to, and it changes no theme — the site was born with
 * one (AGL-3497), and a palette pass is credits the two pages need. Every
 * other job's capabilities pass through.
 */
export function aiSitePlanCapabilities(
  job: Pick<AiJob, 'kind' | 'inputs'>,
  capabilities: AiPlanCapabilities | null,
): AiPlanCapabilities | null {
  if (job.kind !== 'site' || !capabilities?.freeTaste) return capabilities
  const asked = Number((job.inputs ?? {})['pages'])
  const pages =
    Number.isInteger(asked) && asked >= AI_SITE_FREE_PAGES.min
      ? Math.min(asked, AI_SITE_FREE_PAGES.max)
      : AI_SITE_FREE_PAGES.max
  return {
    ...capabilities,
    freeSitePages: pages,
    create: {
      ...capabilities.create,
      'theme-change': {
        allowed: false,
        left: null,
        reason: "a Free workspace's site start keeps the theme the site was created with",
      },
    },
  }
}

/**
 * The model a plan runs on (AGL-3594): the resolved one, except a Free site
 * plans on its provider's fast tier — an outline the plan rules hold and
 * re-ask, at a fifth of the balanced tier's output rate. A model the creator
 * picked by name stays theirs.
 */
export function aiSitePlanModel(
  job: Pick<AiJob, 'kind' | 'model'>,
  resolved: string | undefined,
  freeTaste: boolean,
): string | undefined {
  if (job.kind !== 'site' || !freeTaste) return resolved
  const picked = typeof job.model === 'string' ? job.model.trim() : ''
  if (picked && picked !== 'auto') return resolved
  const entry = aiCatalogEntry(resolved ?? aiModelForStep('job.plan'))
  return (entry ? aiDefaultModelFor(entry.provider, 'fast') : undefined) ?? resolved
}

/** The plan's answer ceiling: the step's own, and a scaffold's outline ceiling under it (AGL-3594). */
export function aiSitePlanMaxTokens(
  job: Pick<AiJob, 'kind'>,
  model: string,
  freeTaste: boolean,
): number {
  const ceiling = aiJobPlanMaxTokens(model)
  if (job.kind !== 'site') return ceiling
  return Math.min(ceiling, freeTaste ? AI_SITE_PLAN_MAX_TOKENS.free : AI_SITE_PLAN_MAX_TOKENS.paid)
}

/**
 * Why trying a Free plan again cannot work this month, or `null` (AGL-3594):
 * the owner's Free allowance left, read off the account month the meter
 * writes net of give-backs, against what a plan of this kind costs at its
 * worst. Read before this step is metered, and the machine gives a refused
 * plan's credits back, so the figure read is the figure left. A read that fails
 * leaves the button on: the reservation still refuses at the wall.
 */
async function aiFreePlanRetryRefusal(input: {
  job: AiJob
  org: Partial<AglynOrgBilling> | null
  firestore: FirebaseFirestore.Firestore
  now: Date
  site: boolean
}): Promise<string | null> {
  const account = freeAssistAccount(input.org as AssistMeteredOrg | null)
  if (!account?.accountUid) return null
  try {
    // The meter's month key, `YYYY-MM` in UTC (`assistUsageMonth`).
    const month = input.now.toISOString().slice(0, 7)
    const snapshot = await freeAccountUsageRef(input.firestore, account.accountUid, month).get()
    const spent = assistCreditsFromUsd(
      assistSpendAfterReturnsUsd(snapshot.get('estCostUsd'), snapshot.get(ASSIST_RETURNED_USD_FIELD)),
    )
    return aiPlanRetryRefusal({
      creditsLeft: FREE_AI_TASTE_CREDITS_PER_MONTH - spent,
      planCredits: input.site ? AI_FREE_SITE_WORST_CASE_CREDITS.plan : AI_FREE_PAGE_WORST_CASE_CREDITS.plan,
    })
  } catch (error) {
    console.error('ai plan retry allowance read failed', { orgId: input.job.orgId, jobId: input.job.$id, error })
    return null
  }
}

export const runAiJobPlanStep = createAiJobPlanStep()

/**
 * Registers the plan step every planned kind runs first, with the least time
 * a plan needs; the plugin's console surface calls it.
 */
export function registerAiJobPlan(): void {
  registerAiJobPlanStep(runAiJobPlanStep, { minimumMs: AI_JOB_PLAN_STEP_MINIMUM_MS })
}
