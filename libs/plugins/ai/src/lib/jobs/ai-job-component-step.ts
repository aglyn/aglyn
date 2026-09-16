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
import type { ReusableComponentProp } from '@aglyn/aglyn/foundation/definitions/platform.types'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { runValidatedGeneration } from '../runtime/ai-doctrine'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import {
  AI_COMPONENT_TOOL_NAME,
  aiComponentPropKindWords,
  aiComponentTool,
} from '../tools/ai-component-tool'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import { aiComponentCheck } from './ai-job-component-checks'
import {
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  aiSiteSubdomain,
  readAiDraft,
  writeAiDraft,
  type AiDraftRecord,
} from './ai-job-drafts'
import {
  aiConfirmedPlan,
  aiDoctrineReview,
  aiGenerationSpent,
  aiJobBriefLine,
  aiLimitReview,
  aiPlanCreation,
  aiPlanReferenceLines,
  aiUnspentOutcome,
} from './ai-job-generation'
import type { AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The component step (AGL-2908): the generation step of a `component` job,
 * run once a member confirmed the job's plan.
 *
 * It builds ONE reusable component from the brief — its tree, and the typed
 * properties each page that places it fills in — through
 * `runValidatedGeneration('component', …)`, so every building rule holds on
 * the tree before it is kept. The tree binds each property with
 * `{{prop.<name>}}`; the palette validator keeps those tokens as written
 * (`definesComponent`), and the step's own check, through `extend`, holds
 * each binding to what the Properties dialog and the Attributes panel allow
 * (`ai-job-component-checks.ts`).
 *
 * The component lands as a new draft (`ai-job-drafts.ts`) that no page
 * places, and gets its first version when a member opens it, as every
 * component created outside the besigner does. A plan that starts from a copy
 * of a component the site has gets that copy, through the platform's
 * duplicate module, and nothing generated.
 *
 * A generation step runs on the job beat, never at an inline door: it
 * registers the least time its lookup rounds, its answer and its re-ask need
 * (AGL-3035), runs without extended thinking, and asks for no more of the
 * ceiling the layout and template steps keep than fits that time on the model
 * it runs. The step's spec measures the request and the answer against it.
 */

/** The longest answer a component may run to; the tree is held to the component budget either way. */
export const AI_JOB_COMPONENT_MAX_TOKENS = AI_ROUTING_TABLE['job.component'].maxTokens

/**
 * The component step's time (AGL-3035, AGL-3036): its two inventory-lookup
 * rounds, its answer and its re-ask at the routing table's ceiling on the tier
 * `job.component` is served from, fitted to what a beat can give a step.
 */
export const AI_JOB_COMPONENT_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.component'],
  maxTokens: AI_JOB_COMPONENT_MAX_TOKENS,
})

/** The least time one component step needs before it starts. */
export const AI_JOB_COMPONENT_STEP_MINIMUM_MS = AI_JOB_COMPONENT_STEP_BUDGET.minimumMs

/** A component's name when the plan names none. */
export const AI_JOB_COMPONENT_DEFAULT_NAME = 'Component'

/** The component step's own instructions, cached after the doctrine and before the catalog. */
export const AI_JOB_COMPONENT_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      `You build one reusable component for a website: a block the site places on many pages, each placement filling in its own values. Answer with ${AI_COMPONENT_TOOL_NAME}: the component’s tree as one flat node map, and the properties it declares.`,
      'The root is the document wrapper holding the component. A component is placed inside pages: it carries no main landmark and at most one h1, and its colors, spacing and type come from the theme.',
      'Every value that should differ from one placement to the next is a property, bound in the tree with its token {{prop.<name>}}. Declare every property the tree binds, and bind every property you declare.',
      `Property kinds, as type (the name a page reads): ${aiComponentPropKindWords()}.`,
      'A property binds only to a field that holds its kind of value:',
      '- text, richText and number: copy, such as a Typography’s text, an Image’s alt or a Button’s label, as the whole value or inside a sentence.',
      '- image: an Image’s src, as the whole value.',
      '- href: a screenId or an href, as the whole value.',
      '- icon: an Icon element’s iconId, as the whole value.',
      '- boolean: a switch setting such as a Button’s fullWidth, or hideIf on the part it hides, as the whole value.',
      '- choice: a setting with fixed options such as a Button’s variant, as the whole value, with every answer’s value one that setting lists.',
      'An optional part, such as a photo, a badge or a second button, gets a boolean property labeled "Hide <the part>" whose default is "false", and the part’s own element carries "hideIf": "{{prop.<name>}}". Never hide the whole component.',
      'A default is what the component shows until a page sets it: copy in the site’s voice from the brief, with a fact the brief does not give in square brackets; for href a screen id from the site inventory, or ""; for image "", for an upload; for icon "", for the site owner to pick; for choice one of its answers’ values.',
    ].join('\n'),
  },
]

/** The component job as the generation's user turn: the name, the brief, the confirmed plan. */
export function aiJobComponentPrompt(
  job: Pick<AiJob, 'brief'>,
  plan: AiJobPlan | null,
  name: string,
): string {
  return [`Component name: ${name}`, aiJobBriefLine(job), ...aiPlanReferenceLines(plan)].join('\n')
}

/** A component job is admitted for a site of the job's own org whose plan includes reusable components. */
export const aiComponentJobAdmission: AiJobAdmission = (context) =>
  aiDraftAdmissionRefusal(context.firestore, {
    orgId: context.orgId,
    hostId: context.hostId,
    kind: 'component',
    org: context.org,
  })

export interface AiJobComponentStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The platform's duplicate module, for a plan that starts from a copy. */
  duplicate?: typeof duplicateResource
}

export function createAiJobComponentStep(deps: AiJobComponentStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const duplicate = deps.duplicate ?? duplicateResource
  return async ({ job, now, signal, firestore, modelFor }) => {
    const hostId = job.hostId
    if (!hostId) throw new Error('a component job names no site, and its admission refuses one')
    const output = (draft: AiDraftRecord, load?: AiLoadEstimate | null): AiJobOutput => ({
      resource: 'reusableComponent',
      id: draft.id,
      versionId: draft.versionId,
      hostId,
      hostSubdomain: draft.hostSubdomain,
      label: draft.name,
      ...(load ? { load } : {}),
    })
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.component') ?? aiModelForStep('job.component')

    // A run cut off after its draft was written reports that draft.
    const written = await readAiDraft(firestore, { kind: 'component', hostId, id: job.$id })
    if (written) return aiUnspentOutcome(model, { outputs: [output(written)] })

    const [inventory, orgSnapshot] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
    ])
    const org = (orgSnapshot.data() ?? null) as Partial<AglynOrgBilling> | null
    const plan = aiConfirmedPlan(job)
    const creation = aiPlanCreation(plan, 'component')
    const name = creation?.name || AI_JOB_COMPONENT_DEFAULT_NAME

    // The plan starts from a copy of a component the site has (rule 15): the
    // copy is the draft, and nothing is generated. A source gone since the
    // plan was made is built from the brief instead.
    if (
      creation?.duplicateOf &&
      inventory.components.some((component) => component.id === creation.duplicateOf)
    ) {
      const copy = await duplicate('component', {
        orgId: job.orgId,
        hostId,
        sourceId: creation.duplicateOf,
        name,
        uid: job.createdBy,
        org: org as Record<string, unknown> | null,
      })
      if (copy.ok) {
        const hostSubdomain = await aiSiteSubdomain(firestore, hostId)
        return aiUnspentOutcome(model, {
          outputs: [
            output({ id: copy.id, versionId: copy.versionId ?? null, name: copy.name, hostSubdomain }),
          ],
        })
      }
      if (copy.ok === false && copy.status === 403) {
        return aiUnspentOutcome(model, { review: aiLimitReview(copy.error) })
      }
    }

    const allowance = await aiDraftAllowanceRefusal(firestore, { kind: 'component', hostId, org })
    if (allowance) return aiUnspentOutcome(model, { review: aiLimitReview(allowance) })

    let props: ReusableComponentProp[] = []
    const result = await runValidatedGeneration('component', {
      step: 'job.component',
      model,
      instructions: AI_JOB_COMPONENT_INSTRUCTIONS,
      inventory,
      messages: [{ role: 'user', content: aiJobComponentPrompt(job, plan, name) }],
      tool: aiComponentTool(),
      maxTokens: AI_JOB_COMPONENT_STEP_BUDGET.maxTokens(model),
      ...(AI_ROUTING_TABLE['job.component'].thinking
        ? { thinking: AI_ROUTING_TABLE['job.component'].thinking }
        : {}),
      ...(AI_ROUTING_TABLE['job.component'].effort
        ? { effort: AI_ROUTING_TABLE['job.component'].effort }
        : {}),
      context: { definesComponent: true },
      extend: aiComponentCheck({
        inventory,
        plan,
        onProps: (declared) => {
          props = declared
        },
      }),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }

    const draft = await writeAiDraft(firestore, {
      kind: 'component',
      hostId,
      id: job.$id,
      uid: job.createdBy,
      org,
      name,
      nodes: result.value.nodes,
      rootId: result.value.rootId,
      props,
      now,
    })
    if (draft.ok === false) {
      if (draft.status === 404) throw new Error(`site ${hostId} vanished while its component was generated`)
      return { ...spent, review: aiLimitReview(draft.error) }
    }
    return { ...spent, outputs: [output(draft, result.value.load)] }
  }
}

export const runAiJobComponentStep = createAiJobComponentStep()

/** Registers the component step and the check a component job passes before it is created or resumed. */
export function registerAiComponentJob(): void {
  registerAiJobStep('component', runAiJobComponentStep, { minimumMs: AI_JOB_COMPONENT_STEP_MINIMUM_MS })
  registerAiJobAdmission('component', aiComponentJobAdmission)
}
