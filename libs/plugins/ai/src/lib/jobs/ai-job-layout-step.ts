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

import { REUSABLE_INSTANCE_COMPONENT_ID } from '@aglyn/aglyn/app-utils/reusable-component-keys'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  aiDoctrineTreeTool,
  runValidatedGeneration,
  type AiValidatedTree,
} from '../runtime/ai-doctrine'
import {
  walkTree,
  type AiDoctrineNode,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { AI_INSTANCE_REF_PROP } from '../runtime/ai-node-tree'
import type { AiLoadEstimate } from '../runtime/ai-palette'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
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
  aiModelNodeIds,
  aiPlanCreation,
  aiPlanReferenceLines,
  aiUnspentOutcome,
} from './ai-job-generation'
import type { AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The layout step (AGL-2909): the generation step of a `layout` job, run once
 * a member confirmed the job's plan.
 *
 * It builds ONE shared layout — a header with the site's navigation, the
 * Layout Slot each page renders in, a footer — through
 * `runValidatedGeneration('layout', …)`, so every building rule holds on the
 * tree before it is kept, and adds two checks of its own through `extend`: a
 * component the confirmed plan reuses is placed (rule 7), and a navigation or
 * menu component the site already has is placed rather than drawn again
 * (rule 1).
 *
 * The layout lands as a new draft (`ai-job-drafts.ts`): no screen uses it and
 * no layout nests it, so nothing on the live site changes until a member
 * assigns it. A plan that starts from a copy of a layout the site has gets
 * that copy, through the platform's duplicate module, and nothing generated.
 *
 * A generation step has the job beat's budget for one step, its re-ask
 * included, so it runs without extended thinking — the plan was reasoned out
 * and confirmed before it — and under a tighter answer ceiling than the
 * doctrine's default for a layout.
 */

/** The longest answer a layout may run to; the tree is held to the layout budget either way. */
export const AI_JOB_LAYOUT_MAX_TOKENS = AI_ROUTING_TABLE['job.layout'].maxTokens

/** A layout's name when the plan names none. */
export const AI_JOB_LAYOUT_DEFAULT_NAME = 'Site layout'

/** The layout step's own instructions, cached after the doctrine. */
export const AI_JOB_LAYOUT_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      'You build one shared layout for a website: the frame every page of the site renders inside. Answer with submit_layout: the whole layout as one flat node map.',
      'A layout is a header, one Layout Slot and a footer, top to bottom. The header is an App Bar (muiAppBar) holding a Toolbar Content (muiToolbar) with the site’s name as text and its navigation. The footer is a Section (section) whose element is footer.',
      'Navigation links the site’s own screens by id: a Screen Link (muiScreenLink) whose screenId is a screen id from the site inventory, in the order the brief and the confirmed plan give, seven at most in the header. Never invent a screen id, and never link a screen by its address.',
      'When the site inventory lists a component whose name says it is navigation, a menu or a mega menu, place it in the header as an instance instead of building the navigation again. Place every component the confirmed plan reuses.',
      'The Layout Slot (layoutSlot) is where each page renders and is the page’s main landmark: leave its component unset or main, and put nothing inside it. A layout carries no h1, because every page brings its own.',
    ].join('\n'),
  },
]

/** The layout job as the generation's user turn: the name, the brief, the confirmed plan. */
export function aiJobLayoutPrompt(
  job: Pick<AiJob, 'brief'>,
  plan: AiJobPlan | null,
  name: string,
): string {
  return [`Layout name: ${name}`, aiJobBriefLine(job), ...aiPlanReferenceLines(plan)].join('\n')
}

/** A component name that says it is the site's navigation; a footer's links are not. */
const NAVIGATION_NAME = /\b(?:nav|navigation|navbar|menu|mega ?menu)\b/i
const FOOTER_NAME = /\bfooter\b/i

/** A node that links somewhere: a Screen Link, or a Button pointed at a screen or an address. */
function isLink(node: AiDoctrineNode): boolean {
  if (node.componentId === 'muiScreenLink') return true
  return (
    node.componentId === 'muiButton' &&
    (typeof node.props?.['screenId'] === 'string' || typeof node.props?.['href'] === 'string')
  )
}

/**
 * The layout door's checks on a tree the doctrine admitted: every component
 * the confirmed plan reuses is placed, and navigation the site already keeps
 * as a component is placed rather than drawn again in the header.
 */
export function aiLayoutReuseCheck(
  inventory: AiSiteInventory | null,
  plan: AiJobPlan | null,
): (tree: AiValidatedTree) => AiDoctrineViolation[] {
  const components = inventory?.components ?? []
  const names = new Map(components.map((component) => [component.id, component.name]))
  const reused = [
    ...new Set(
      (plan?.reuse ?? []).filter((entry) => entry.kind === 'component').map((entry) => entry.id),
    ),
  ]
  const navigation = components.filter(
    (component) => NAVIGATION_NAME.test(component.name) && !FOOTER_NAME.test(component.name),
  )
  return (tree) => {
    const visits = walkTree({
      rootId: tree.rootId,
      nodes: tree.nodes as unknown as Record<string, AiDoctrineNode>,
    })
    const placed = new Set<string>()
    for (const { node } of visits) {
      const ref = node.props?.[AI_INSTANCE_REF_PROP]
      if (node.componentId === REUSABLE_INSTANCE_COMPONENT_ID && typeof ref === 'string') {
        placed.add(ref)
      }
    }
    const violations: AiDoctrineViolation[] = []
    const missing = reused.filter((id) => !placed.has(id))
    if (missing.length) {
      const listed = missing.map((id) => `"${names.get(id) ?? id}"`).join(', ')
      violations.push({
        rule: 7,
        code: 'plan-reuse-not-placed',
        message: `The confirmed plan reuses ${listed}, and the layout does not place ${
          missing.length === 1 ? 'it' : 'them'
        }. Place every component the plan reuses.`,
      })
    }
    if (navigation.length && !navigation.some((component) => placed.has(component.id))) {
      const slot = visits.findIndex(({ node }) => node.componentId === 'layoutSlot')
      const header = slot === -1 ? visits : visits.slice(0, slot)
      const links = header.filter(({ node }) => isLink(node)).map(({ id }) => id)
      if (links.length >= 2) {
        violations.push({
          rule: 1,
          code: 'navigation-rebuilt',
          message: `The site already has the "${navigation[0].name}" component. Place it in the header instead of building the navigation again.`,
          nodeIds: aiModelNodeIds(links, tree.sourceIds),
        })
      }
    }
    return violations
  }
}

/** A layout job is admitted for a site of the job's own org with a shared layout to spare. */
export const aiLayoutJobAdmission: AiJobAdmission = (context) =>
  aiDraftAdmissionRefusal(context.firestore, {
    orgId: context.orgId,
    hostId: context.hostId,
    kind: 'layout',
    org: context.org,
  })

export interface AiJobLayoutStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The platform's duplicate module, for a plan that starts from a copy. */
  duplicate?: typeof duplicateResource
}

export function createAiJobLayoutStep(deps: AiJobLayoutStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const duplicate = deps.duplicate ?? duplicateResource
  return async ({ job, now, signal, firestore, modelFor }) => {
    const hostId = job.hostId
    if (!hostId) throw new Error('a layout job names no site, and its admission refuses one')
    const output = (draft: AiDraftRecord, load?: AiLoadEstimate | null): AiJobOutput => ({
      resource: 'layout',
      id: draft.id,
      versionId: draft.versionId,
      hostId,
      hostSubdomain: draft.hostSubdomain,
      label: draft.name,
      ...(load ? { load } : {}),
    })
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.layout') ?? aiModelForStep('job.layout')

    // A run cut off after its draft was written reports that draft.
    const written = await readAiDraft(firestore, { kind: 'layout', hostId, id: job.$id })
    if (written) return aiUnspentOutcome(model, { outputs: [output(written)] })

    const [inventory, orgSnapshot] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
    ])
    const org = (orgSnapshot.data() ?? null) as Partial<AglynOrgBilling> | null
    const plan = aiConfirmedPlan(job)
    const creation = aiPlanCreation(plan, 'layout')
    const name = creation?.name || AI_JOB_LAYOUT_DEFAULT_NAME

    // The plan starts from a copy of a layout the site has (rule 15): the copy
    // is the draft, and nothing is generated. A source gone since the plan
    // was made is built from the brief instead.
    if (creation?.duplicateOf && inventory.layouts.some((layout) => layout.id === creation.duplicateOf)) {
      const copy = await duplicate('layout', {
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
          outputs: [output({ id: copy.id, versionId: copy.versionId, name: copy.name, hostSubdomain })],
        })
      }
      if (copy.ok === false && copy.status === 403) {
        return aiUnspentOutcome(model, { review: aiLimitReview(copy.error) })
      }
    }

    const allowance = await aiDraftAllowanceRefusal(firestore, { kind: 'layout', hostId, org })
    if (allowance) return aiUnspentOutcome(model, { review: aiLimitReview(allowance) })

    const result = await runValidatedGeneration('layout', {
      step: 'job.layout',
      model,
      instructions: AI_JOB_LAYOUT_INSTRUCTIONS,
      inventory,
      messages: [{ role: 'user', content: aiJobLayoutPrompt(job, plan, name) }],
      tool: aiDoctrineTreeTool('layout'),
      maxTokens: AI_JOB_LAYOUT_MAX_TOKENS,
      ...(AI_ROUTING_TABLE['job.layout'].thinking ? { thinking: AI_ROUTING_TABLE['job.layout'].thinking } : {}),
      ...(AI_ROUTING_TABLE['job.layout'].effort ? { effort: AI_ROUTING_TABLE['job.layout'].effort } : {}),
      extend: aiLayoutReuseCheck(inventory, plan),
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }

    const draft = await writeAiDraft(firestore, {
      kind: 'layout',
      hostId,
      id: job.$id,
      uid: job.createdBy,
      org,
      name,
      nodes: result.value.nodes,
      now,
    })
    if (draft.ok === false) {
      if (draft.status === 404) throw new Error(`site ${hostId} vanished while its layout was generated`)
      return { ...spent, review: aiLimitReview(draft.error) }
    }
    return { ...spent, outputs: [output(draft, result.value.load)] }
  }
}

export const runAiJobLayoutStep = createAiJobLayoutStep()

registerAiJobStep('layout', runAiJobLayoutStep)
registerAiJobAdmission('layout', aiLayoutJobAdmission)
