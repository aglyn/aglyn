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

import { buildPageMarkdown } from '@aglyn/aglyn/app-utils/page-markdown'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { SCREEN_SEO_TEXT_GUIDANCE } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import { AI_BUILD_PLAN_LIMITS, type AiBuildPlanScreen } from '../model/ai-build-plan'
import {
  AI_PAGE_CREATE_KINDS,
  aiPageCreationRefusal,
  aiPagePlanRefusal,
  parseAiPageJobInputs,
} from '../model/ai-page-job'
import { aiPlanCapabilitiesForJob, aiPlanUncreatable } from '../model/ai-plan-capabilities'
import { aiSiteWords } from '../model/ai-site-job'
import type { AiJob, AiJobOutput, AiJobPlan, AiJobReview } from '../model/ai-jobs.types'
import { aiModelForStep } from '../providers/routing'
import { aiDoctrineNeedsInputMessage, runValidatedGeneration } from '../runtime/ai-doctrine'
import { validateAiDoctrineTree, type AiDoctrineTree } from '../runtime/ai-doctrine-validators'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { AI_SEO_FIELDS_MAX_TOKENS, generateSeoFields } from '../runtime/seo-fields'
import { readSiteInventory } from '../runtime/site-inventory'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiGenerationWorstCaseMs } from './ai-job-budget'
import { aiJobDraftId } from './ai-job-draft-ids'
import {
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  aiSiteSubdomain,
  readAiDraft,
  readAiDraftNodes,
  readAiPlanCapabilities,
  updateAiDraftNodes,
  writeAiDraft,
  writeAiDraftScreenSeo,
  type AiDraftRecord,
} from './ai-job-drafts'
import {
  aiBracketedFactsNote,
  aiConfirmedPlan,
  aiDoctrineReview,
  aiGenerationSpent,
  aiLimitReview,
  aiModelNodeIds,
  aiUnspentOutcome,
} from './ai-job-generation'
import {
  AI_JOB_PAGE_SECTION_MAX_TOKENS,
  AI_JOB_PAGE_SECTION_TOKENS,
  AI_JOB_PAGE_STEP_BUDGET,
  AI_JOB_PAGE_STEP_MINIMUM_MS,
  aiJobPageSectionMaxTokens,
} from './ai-job-page-budget'
import {
  AI_JOB_PAGE_INSTRUCTIONS,
  AI_PAGE_SECTION_TOOL,
  aiEmptyPage,
  aiPageCheckContext,
  aiPageSectionCheck,
  aiPageSectionNodeId,
  aiPageSectionPrompt,
  aiPageSectionSmaller,
  aiPageWithSection,
  type AiPageSection,
} from './ai-job-page-sections'
import { AI_PLAN_ITEMS_MIN, aiPlanCopiedPageViolations } from './ai-job-plan-conformance'
import {
  aiCreationUnit,
  aiRunJobUnit,
  aiSiteBuiltRefs,
  aiSitePendingUnits,
  aiSiteUnitJob,
  type AiSiteUnit,
} from './ai-job-site-step'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import {
  aiJobStepRunMinimumMs,
  aiJobStepRunnerFor,
  registerAiJobStep,
  registerAiJobStepPasses,
} from './ai-jobs'

/**
 * The page step (AGL-2907): the generation step of a `page` job, run once a
 * member confirmed the job's plan. It builds ONE screen, section by section,
 * from what the site already has, and leaves it an unpublished draft.
 *
 * ── Why a page is built in passes ────────────────────────────────────────
 *
 * A page is far larger than one answer the job beat can wait for: the beat
 * gives a step what is left of its budget, and a whole page, answered and re-asked,
 * takes several times that. The confirmed plan already names the page's
 * sections, so the step builds one section per pass and asks the machine to
 * continue. Every pass is one reservation and one generation — the section's
 * lookup rounds, its answer and, when it breaks a rule, its one re-ask — sized
 * so that worst case fits `AI_JOB_PAGE_STEP_MINIMUM_MS`, which the step
 * registers as the least time a section pass needs before it starts.
 *
 *  - The first pass builds the top section, which holds the page's h1, and
 *    writes the draft screen and its first version.
 *  - Each later pass builds the next section and adds it to that version.
 *  - The last pass generates no tree: it holds the whole page to the
 *    doctrine, writes the search title and description, and reports the
 *    draft with its measured weight and a navigation proposal.
 *
 * How a section is asked for and held to the rules as part of the page is
 * `ai-job-page-sections.ts`.
 *
 * ── What the plan creates comes first (AGL-3031) ─────────────────────────
 *
 * A plan that creates a layout, forms or components is built in the same job,
 * before its page, one creation a pass, through the site scaffold's unit
 * machinery: each creation is handed to the step that builds that kind, under
 * a job derived from this one, and lands as the draft that step writes. Where
 * the job stands is read from its outputs, so nothing is kept anywhere else.
 * Once every creation is built, the page's passes run on the plan with each
 * `new:<name>` resolved to the record that was built, which the site's
 * inventory now lists — so the page places the new component and binds the new
 * form by id, and renders inside the new layout, exactly as it would one the
 * site always had. A pass that builds a creation needs the time the step that
 * builds it registers, not a section's (`aiPageJobRunMinimumMs`, AGL-3035), so
 * neither the beat nor a door starts it with only a section's time left.
 *
 * ── Never published ──────────────────────────────────────────────────────
 *
 * The draft is written the way `/api/hosts/resources` and
 * `/api/hosts/versions` write a screen and its first version, and nothing
 * else is touched: not the host document, whose routing map is what the live
 * site serves, and no collection, store, layout or navigation pointer
 * (`ai-job-drafts.ts`). A screen the routing map does not name serves nothing
 * until a member publishes it.
 */

/**
 * A section pass's time, and the ceiling each pass asks on each model, are
 * declared apart from the step (`ai-job-page-budget.ts`): the site scaffold
 * builds its pages through this step and reads them without loading it.
 */
export {
  AI_JOB_PAGE_SECTION_MAX_TOKENS,
  AI_JOB_PAGE_SECTION_TOKENS,
  AI_JOB_PAGE_STEP_BUDGET,
  AI_JOB_PAGE_STEP_MINIMUM_MS,
  aiJobPageSectionMaxTokens,
}

/**
 * Tokens one element takes in a section's answer, ESTIMATED: the tree as JSON
 * text inside the tool call, at four characters a token. Measured on the ten
 * golden pages at a median of 38 and a most of 43 over their 39 sections, and
 * `ai-job-page-evals.spec.ts` holds every golden section under it.
 */
export const AI_JOB_PAGE_TOKENS_PER_ELEMENT = 45

/**
 * Real tokens to every token estimated at four characters (AGL-3042). A
 * section's ceiling is counted by the provider in its own tokens, which run
 * above that estimate. MEASURED on the first live document run on a Free
 * workspace (AGL-3024, test-org, 2026-09-16), as the cache read of a request
 * over the estimate of the same cached prefix: 4,059 over 2,825 for the page
 * plan and 6,649 over 4,310 for the layout, the higher of the two, 1.5427 —
 * the ratio `ai-job-free-page.spec.ts` prices a Free page at. It is measured on
 * prompt text; an answer's own is read off a recorded pass, whose output
 * tokens the step's record keeps (`lastRuns`), beside the section it stored.
 */
export const AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED = Math.max(4_059 / 2_825, 6_649 / 4_310)

/**
 * Real tokens one element takes in a section's answer: the estimate at its
 * golden most, in real tokens, rounded up — 45 × 1.5427 → 70 (AGL-3042).
 */
export const AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT = Math.ceil(
  AI_JOB_PAGE_TOKENS_PER_ELEMENT * AI_JOB_PAGE_REAL_TOKENS_PER_ESTIMATED,
)

/**
 * The most elements a section's request asks it to keep under at an answer
 * ceiling: 15 at the balanced tier's 1,050 (AGL-3042). Counted in real
 * tokens, because the ceiling is: counted in the estimate, the budget is 23
 * elements, which a section of the goldens' largest elements fills at 1,597
 * real tokens — half as much again as the ceiling that cuts it off.
 */
export function aiJobPageSectionMaxElements(maxTokens: number): number {
  return Math.max(1, Math.floor(maxTokens / AI_JOB_PAGE_REAL_TOKENS_PER_ELEMENT))
}

/** A page's name when the plan names none. */
export const AI_JOB_PAGE_DEFAULT_NAME = 'New page'

export const AI_JOB_PAGE_NO_PLAN_COPY = 'This page job has no confirmed plan to build.'
export const AI_JOB_PAGE_DELETED_COPY = 'The draft page was deleted while it was being built.'

/** A creation the plan names that this deployment has no step to build. */
export const AI_JOB_PAGE_CREATION_UNAVAILABLE_COPY =
  'This page needs something that cannot be built here yet. Describe the page again.'

/** A creation that finished without reporting what it built; the page cannot place it. */
export const AI_JOB_PAGE_CREATION_EMPTY_COPY =
  'Part of this page could not be built. Describe the page again.'

/**
 * What a page refused on its last pass tells the member beside the rules it
 * broke (AGL-3143). The draft is reported with the review, and mending what
 * the findings name in it is what lets the next pass finish the job.
 */
export const AI_JOB_PAGE_REFUSED_DRAFT_COPY =
  'The draft is yours to open: mend what these name in it, then try again.'

/**
 * The most passes a page job may take (AGL-3031): every creation the plan
 * limits admit, every section they admit, and the last pass that reports the
 * draft. A creation's step builds it in one pass, and a page one section a
 * pass, so a runner that never finishes is still bounded while a real page is
 * not.
 */
export const AI_JOB_PAGE_MAX_PASSES = AI_BUILD_PLAN_LIMITS.create + AI_BUILD_PLAN_LIMITS.sections + 1

/**
 * The units a plan's creations are built as, in the order a scaffold builds
 * them: the layout, then the forms, then the components. Each is addressed by
 * its place in the plan, so a unit run again finds its own draft.
 */
export function aiPageJobUnits(plan: Pick<AiJobPlan, 'create'>): AiSiteUnit[] {
  return AI_PAGE_CREATE_KINDS.flatMap((kind) =>
    plan.create.flatMap((creation, index) => {
      if (creation.kind !== kind) return []
      const unit = aiCreationUnit(creation, `c${index}`)
      return unit ? [unit] : []
    }),
  )
}

/**
 * The least time this page job's next pass needs (AGL-3035). A pass that
 * builds a creation hands it to the step registered for that kind, under the
 * job derived for it, so it needs what that step registers for that job — a
 * layout's time, not a section's. Every other pass — a section, the last one —
 * needs a section pass's.
 */
export function aiPageJobRunMinimumMs(job: AiJob): number {
  const confirmed = aiConfirmedPlan(job)
  if (!confirmed) return AI_JOB_PAGE_STEP_MINIMUM_MS
  const units = aiPageJobUnits(confirmed)
  const outputs = job.outputs ?? []
  const [unit] = aiSitePendingUnits(units, outputs)
  if (!unit) return AI_JOB_PAGE_STEP_MINIMUM_MS
  return aiJobStepRunMinimumMs(aiSiteUnitJob(job, unit, aiSiteBuiltRefs(units, outputs)))
}

/** The one-segment address a draft asks for, from the plan's slug. */
export function aiPageDraftSlug(screen: Pick<AiBuildPlanScreen, 'slug'>): string {
  const segments = screen.slug.split('/').map((part) => part.trim()).filter(Boolean)
  return segments[segments.length - 1] ?? ''
}

/** A plan's listing value held to the length the SEO editor guides it to, cut at a word. */
function clip(value: string, max: number): string {
  const text = value.trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : text.slice(0, max)).trim()
}

/** The site's name as its visitors see it, read the way the SEO step reads it. */
function siteNameOf(host: FirebaseFirestore.DocumentSnapshot): string {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  return text(host.get('seo.title')) || text(host.get('displayName')) || text(host.get('subdomain'))
}

/**
 * The counts the confirmed plan's sections promised, against the page a COPY
 * actually produced (AGL-3024); `null` when the copy keeps the plan, or when
 * the plan promised no count to keep.
 *
 * The same hole the layout copy had (`aiCopiedLayoutReview`), on the kind the
 * defect was measured on. This branch generates nothing, so no model ever
 * answers for the plan: a plan reading "start from the Services page, one
 * card per practice area" gets the Services page and whatever IT had, and
 * until now reported `Done` — the one report that tells a customer there is
 * no reason to re-read the page.
 *
 * A copy that cannot be read back settles nothing, and a promise this step
 * cannot settle is reviewed by a person rather than reported as kept.
 */
export async function aiCopiedPageReview(
  firestore: FirebaseFirestore.Firestore,
  input: { hostId: string; id: string; name: string; screen: Pick<AiBuildPlanScreen, 'sections'> },
): Promise<AiJobReview | null> {
  if (!input.screen.sections.some((section) => section.items >= AI_PLAN_ITEMS_MIN)) return null
  const stored = await readAiDraftNodes(firestore, { kind: 'screen', hostId: input.hostId, id: input.id })
  const nodes = (stored?.nodes ?? {}) as unknown as AiDoctrineTree['nodes']
  if (!nodes[CANVAS_ROOT_ELEMENT_ID]) {
    return {
      reason: 'doctrine',
      message: `"${input.name}" was copied from the page the plan names, and this job could not read the copy back to check it shows what the plan says it shows. Open the page and check it before you put it in front of anyone.`,
      findings: [],
    }
  }
  const violations = aiPlanCopiedPageViolations(input.screen, { rootId: CANVAS_ROOT_ELEMENT_ID, nodes })
  if (!violations.length) return null
  return aiDoctrineReview({
    message: `"${input.name}" is a copy of the page the plan names, and a copy is all it is: ${violations[0].message}`,
    violations,
  })
}

/**
 * A page job is admitted with inputs that read, for a site of the job's own
 * org with a screen to spare; and confirmed only for a plan it can build —
 * one screen, whose creations are ones a page job builds, this deployment has
 * a step for, and this workspace may still make on this site (AGL-3031).
 */
export const aiPageJobAdmission: AiJobAdmission = async (context) => {
  const inputs = parseAiPageJobInputs(context.inputs)
  if (typeof inputs === 'string') return { status: 400, error: inputs }
  const plan = context.plan
  if (plan) {
    const refusal = aiPagePlanRefusal(plan)
    if (refusal) return { status: 400, error: refusal }
    if (aiPageJobUnits(plan).some((unit) => !aiJobStepRunnerFor(unit.jobKind))) {
      return { status: 400, error: AI_JOB_PAGE_CREATION_UNAVAILABLE_COPY }
    }
  }
  const org = context.org as Partial<AglynOrgBilling> | null
  return aiDraftAdmissionRefusal(context.firestore, {
    orgId: context.orgId,
    hostId: context.hostId,
    kind: 'screen',
    noun: 'page',
    org,
    // What the workspace may still make here, read once the site is known to
    // be the org's: the site may have changed since the plan was told.
    ...(plan?.create.length
      ? {
          ownCheck: async (hostId: string) => {
            const capabilities = aiPlanCapabilitiesForJob(
              await readAiPlanCapabilities(context.firestore, { hostId, org }),
              { noun: 'a page job', creates: AI_PAGE_CREATE_KINDS },
            )
            const refusal = aiPageCreationRefusal(aiPlanUncreatable(plan, capabilities))
            return refusal ? { status: 403 as const, error: refusal } : null
          },
        }
      : {}),
  })
}

export interface AiJobPageStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The platform's duplicate module, for a plan that starts from a copy. */
  duplicate?: typeof duplicateResource
  /** The listing generator (AGL-2910). */
  seoFields?: typeof generateSeoFields
  /** The runners a plan's creations are built by (AGL-3031); the registry's otherwise. */
  runnerFor?: typeof aiJobStepRunnerFor
}

export function createAiJobPageStep(deps: AiJobPageStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const duplicate = deps.duplicate ?? duplicateResource
  const seoFields = deps.seoFields ?? generateSeoFields
  const runnerFor = deps.runnerFor ?? aiJobStepRunnerFor
  return async (stepContext): Promise<AiJobStepOutcome> => {
    const { job, now, signal, firestore, modelFor } = stepContext
    const hostId = job.hostId
    if (!hostId) throw new Error('a page job names no site, and its admission refuses one')
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.page') ?? aiModelForStep('job.page')
    const confirmed = aiConfirmedPlan(job)
    if (!confirmed) return { ...aiUnspentOutcome(model), failure: AI_JOB_PAGE_NO_PLAN_COPY }
    // The resume door refuses such a plan at confirmation; one confirmed
    // before a site changed still stops here, before any spend.
    const refusal = aiPagePlanRefusal(confirmed)
    if (refusal) return { ...aiUnspentOutcome(model), failure: refusal }

    // ── The creations first (AGL-3031): one a pass, by the steps that own them ──
    const units = aiPageJobUnits(confirmed)
    const outputs = job.outputs ?? []
    const [unit] = aiSitePendingUnits(units, outputs)
    if (unit) {
      const runner = runnerFor(unit.jobKind)
      if (!runner) return { ...aiUnspentOutcome(model), failure: AI_JOB_PAGE_CREATION_UNAVAILABLE_COPY }
      const pass = await aiRunJobUnit(stepContext, {
        unit,
        units,
        runner,
        emptyCopy: AI_JOB_PAGE_CREATION_EMPTY_COPY,
      })
      // A built creation is followed by the next, or by the page's first section.
      return pass.built ? { ...pass.outcome, continue: true } : pass.outcome
    }
    // The page's plan with every creation resolved to the record it built, as
    // a scaffold's page is planned against what the scaffold built.
    const plan: AiJobPlan = units.length
      ? (aiSiteUnitJob(
          job,
          {
            kind: 'page',
            jobKind: 'page',
            resource: 'screen',
            slot: 'page',
            screen: confirmed.screens[0],
            label: confirmed.screens[0].title,
          },
          aiSiteBuiltRefs(units, outputs),
        ).plan as AiJobPlan)
      : confirmed
    const screen = plan.screens[0] as AiBuildPlanScreen
    const name = screen.title || AI_JOB_PAGE_DEFAULT_NAME
    const slug = aiPageDraftSlug(screen)
    const sectionIds = screen.sections.map((_, index) => aiPageSectionNodeId(job.$id, index))
    // The draft screen, by the id the job recorded for it: every pass writes and finds the same one.
    const draftId = aiJobDraftId(job, 'screen')

    const output = (
      draft: Pick<AiDraftRecord, 'id' | 'versionId' | 'name' | 'hostSubdomain'>,
      load?: AiLoadEstimate | null,
      note?: string | null,
    ): AiJobOutput => ({
      resource: 'screen',
      id: draft.id,
      versionId: draft.versionId,
      hostId,
      hostSubdomain: draft.hostSubdomain,
      label: draft.name,
      ...(load ? { load } : {}),
      ...(note ? { note } : {}),
      // Rule 10: a navigation entry travels with the page as a proposal, for
      // the member to add once the page is live; no menu is written.
      ...(screen.nav ? { proposal: { navigation: { label: name, slug } } } : {}),
    })

    const [inventory, orgSnapshot, written] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
      readAiDraft(firestore, { kind: 'screen', hostId, id: draftId }),
    ])
    const org = (orgSnapshot.data() ?? null) as Partial<AglynOrgBilling> | null
    if (written?.deleted) return { ...aiUnspentOutcome(model), failure: AI_JOB_PAGE_DELETED_COPY }

    // The plan starts from a copy of a screen the site has (rule 15): the copy
    // is the draft — unrouted, as every copy is — and nothing is generated.
    // Only a page is a page's start: a collection entry template's copy stays
    // a template, so a plan naming one builds the page instead.
    if (
      !written &&
      screen.duplicateOf &&
      inventory.screens.some((row) => row.id === screen.duplicateOf && !row.template)
    ) {
      const copy = await duplicate('screen', {
        orgId: job.orgId,
        hostId,
        sourceId: screen.duplicateOf,
        name,
        uid: job.createdBy,
        org: org as Record<string, unknown> | null,
        // A copy core mints is written under core's id, never `draftId`, so
        // `written` above cannot find it and this branch would fire on every
        // pass — and the pass after a refused copy is the common one, since
        // the review below offers to try again. The job's recorded id is the
        // claim, so a second pass replays the one copy instead of leaving
        // another orphan screen behind it (AGL-3024).
        attemptKey: draftId,
      })
      if (copy.ok) {
        // A copy is not a build (AGL-3024). Nothing is generated here, so
        // whatever the plan promised BEYOND the source is in the draft only
        // if the source already had it, and no model is left to answer for
        // the difference — the copy itself has to.
        const review = await aiCopiedPageReview(firestore, { hostId, id: copy.id, name, screen })
        if (review) return aiUnspentOutcome(model, { review })
        const hostSubdomain = await aiSiteSubdomain(firestore, hostId)
        return aiUnspentOutcome(model, {
          outputs: [output({ id: copy.id, versionId: copy.versionId, name: copy.name, hostSubdomain })],
        })
      }
      if (copy.ok === false && copy.status === 403) {
        return aiUnspentOutcome(model, { review: aiLimitReview(copy.error) })
      }
    }

    const stored = written ? await readAiDraftNodes(firestore, { kind: 'screen', hostId, id: draftId }) : null
    if (written && !stored) return { ...aiUnspentOutcome(model), failure: AI_JOB_PAGE_DELETED_COPY }
    const page = stored?.nodes ?? aiEmptyPage()
    const index = sectionIds.findIndex((id) => !(id in page))
    // A workspace that keeps no reusable components or saved forms builds its
    // page inline, and every pass is held to the rules that way (AGL-3030).
    const reusableComponents = checkEntitlement(org, 'reusableComponents')
    // A link may take a visitor to a section of this page, by its name in the plan (AGL-3097).
    const sections = screen.sections.map((section) => section.name)
    const context = aiPageCheckContext(inventory, { reusableComponents, sections })

    // ── The last pass: the whole page, its listing, and the draft reported ──
    if (index === -1 && written) {
      // A link the page carries to one of its sections goes there, now every section is built.
      const report = validateAiDoctrineTree({ rootId: CANVAS_ROOT_ELEMENT_ID, nodes: page }, 'page', {
        ...context,
        scrollTargetIds: sectionIds,
      })
      // The facts the brief did not give, on the page or in the defaults its components show (AGL-3056).
      const note = aiBracketedFactsNote({
        tree: { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: page as unknown as AiDoctrineTree['nodes'] },
        inventory,
      })
      // The page's own draft, reported once however many times the last pass
      // runs (AGL-3143): a refused pass reports it and a later one that
      // passes does not report it twice.
      const reported = outputs.some((entry) => entry.resource === 'screen' && entry.id === draftId)
      const reports = reported ? [] : [output(written, report.load, note)]
      if (report.violations.length) {
        // The check mints its own ids; the review names the nodes by the ids the draft stores them under.
        const storedIds = report.tree?.sourceIds ?? {}
        const violations = report.violations.map((violation) =>
          violation.nodeIds ? { ...violation, nodeIds: aiModelNodeIds(violation.nodeIds, storedIds) } : violation,
        )
        // THE DRAFT TRAVELS WITH THE REFUSAL (AGL-3143). Every other review
        // parks on a model's answer, so trying again asks the model again and
        // can come back different. This one reads the STORED page and spends
        // nothing, so trying again refuses the same page for the same reasons
        // forever — and a job parked here having reported no output names no
        // draft at all, which leaves the member nowhere to mend the nodes the
        // findings name and no way to finish the job from the console. The
        // draft is reported now instead, and the job still parks: what the
        // review names is mended in the draft, and the next pass then passes.
        return aiUnspentOutcome(model, {
          outputs: reports,
          review: aiDoctrineReview({
            message: `${aiDoctrineNeedsInputMessage(violations)} ${AI_JOB_PAGE_REFUSED_DRAFT_COPY}`,
            violations,
            answer: { tree: { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: page } },
          }),
        })
      }
      let spent: AiJobStepOutcome = aiUnspentOutcome(model)
      if (!written.seo?.title?.trim() || !written.seo?.description?.trim()) {
        const seoModel = modelFor?.('job.seo') ?? aiModelForStep('job.seo')
        // The plan's own listing, held to the editor's guidance, when the
        // listing cannot be written inside this pass's time on the model the
        // job runs.
        let values = {
          title: clip(screen.seoTitle, SCREEN_SEO_TEXT_GUIDANCE.title),
          description: clip(screen.seoDescription, SCREEN_SEO_TEXT_GUIDANCE.description),
        }
        if (
          // A listing is written from the page's own text, with no inventory
          // and so no lookup round.
          aiGenerationWorstCaseMs({ maxTokens: AI_SEO_FIELDS_MAX_TOKENS, model: seoModel, lookups: 0 }) <=
          AI_JOB_PAGE_STEP_MINIMUM_MS
        ) {
          const host = await firestore.collection('hosts').doc(hostId).get()
          const result = await seoFields({
            subject: { kind: 'screen', name, path: `/${slug}` },
            brand: siteNameOf(host),
            // What the site is and who it is for (AGL-2918). The page's own
            // Markdown says what the page is about and cannot say who it was
            // written for, so the listing borrows the two answers the job was
            // started from — the scaffold's derived page job carries them,
            // and a page job started from the Screens page carries neither.
            site: aiSiteWords(job.inputs),
            text: buildPageMarkdown({ nodes: page as never, rootId: CANVAS_ROOT_ELEMENT_ID }),
            fields: ['title', 'description'],
            // Other screens by name only: their own listings are their content.
            otherTitles: inventory.screens.map((row) => row.name),
            model: seoModel,
            ...(signal ? { signal } : {}),
          })
          spent = { ...spent, ...aiGenerationSpent(result) }
          if (result.status === 'ok') {
            values = {
              title: result.value.title?.trim() || values.title,
              description: result.value.description?.trim() || values.description,
            }
          }
        }
        await writeAiDraftScreenSeo(firestore, { hostId, id: draftId, seo: values, now })
      }
      return { ...spent, outputs: reports }
    }

    // ── A section pass ──
    if (!written) {
      const allowance = await aiDraftAllowanceRefusal(firestore, { kind: 'screen', hostId, org })
      if (allowance) return aiUnspentOutcome(model, { review: aiLimitReview(allowance) })
    }
    const maxTokens = aiJobPageSectionMaxTokens(model)
    const maxElements = aiJobPageSectionMaxElements(maxTokens)
    const result = await runValidatedGeneration<AiPageSection>('page-section', {
      step: 'job.page',
      model,
      instructions: AI_JOB_PAGE_INSTRUCTIONS,
      inventory,
      messages: [
        {
          role: 'user',
          content: aiPageSectionPrompt({ job, plan, screen, index, maxElements, reusableComponents }),
        },
      ],
      tool: AI_PAGE_SECTION_TOOL,
      maxTokens,
      // A section cut off at its ceiling is asked for smaller, and a member
      // whose section still does not fit reads that it was too large (AGL-3042).
      cutOff: { noun: 'section', smaller: aiPageSectionSmaller({ maxElements, reusableComponents }) },
      thinking: 'off',
      check: aiPageSectionCheck({
        page,
        sectionIds,
        index,
        context,
        section: screen.sections[index],
        inventory,
      }),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }

    if (!written) {
      const draft = await writeAiDraft(firestore, {
        kind: 'screen',
        hostId,
        id: draftId,
        uid: job.createdBy,
        org,
        name,
        nodes: aiPageWithSection(aiEmptyPage(), result.value, sectionIds),
        slug,
        layoutId:
          screen.layout && inventory.layouts.some((row) => row.id === screen.layout) ? screen.layout : null,
        now,
      })
      if (draft.ok === false) {
        if (draft.status === 404) throw new Error(`site ${hostId} vanished while its page was generated`)
        return { ...spent, review: aiLimitReview(draft.error) }
      }
    } else {
      const update = await updateAiDraftNodes(firestore, {
        kind: 'screen',
        hostId,
        id: draftId,
        now,
        // A pass run again after its write finds its section and changes nothing.
        update: (nodes) =>
          result.value.rootId in nodes ? null : aiPageWithSection(nodes, result.value, sectionIds),
      })
      if (update.ok === false) return { ...spent, failure: AI_JOB_PAGE_DELETED_COPY }
    }
    return { ...spent, continue: true }
  }
}

export const runAiJobPageStep = createAiJobPageStep()

/**
 * Registers the page step with the least time a section pass needs and the
 * time its next pass needs, the passes a page with its creations may take, and
 * the check a page job passes when it is created or its plan is confirmed.
 */
export function registerAiPageJob(): void {
  registerAiJobStep('page', runAiJobPageStep, {
    minimumMs: AI_JOB_PAGE_STEP_MINIMUM_MS,
    minimumMsFor: aiPageJobRunMinimumMs,
  })
  registerAiJobStepPasses('page', AI_JOB_PAGE_MAX_PASSES)
  registerAiJobAdmission('page', aiPageJobAdmission)
}
