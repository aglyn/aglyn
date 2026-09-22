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

import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'
import { normalizeScreenSlug } from '@aglyn/aglyn/app-utils/screen-route'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { AiJob, AiJobOutput, AiJobPlan, AiJobReview } from '../model/ai-jobs.types'
import {
  AI_TEMPLATE_SUBJECT_DEFINITIONS,
  AI_TEMPLATE_SUBJECTS,
  aiBindingTokensIn,
  aiTemplateAddressTokens,
  parseAiTemplateJobInputs,
  type AiTemplateSubjectDefinition,
} from '../model/ai-template-subjects'
import { AI_STEP_TIERS } from '../providers/catalog'
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
import type { AiLoadEstimate } from '../runtime/ai-palette'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { aiTemplateExamplesSystemBlock } from '../runtime/ai-template-examples'
import { readSiteInventory } from '../runtime/site-inventory'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiJobDraftId } from './ai-job-draft-ids'
import {
  aiDraftAdmissionRefusal,
  aiDraftAllowanceRefusal,
  aiSiteSubdomain,
  readAiDraft,
  readAiTemplateDraftNodes,
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
  aiPlacedComponentIds,
  aiPlanCreation,
  aiPlanReferenceLines,
  aiPlanReuseViolations,
  aiUnspentOutcome,
} from './ai-job-generation'
import { aiPlannedTemplateTokens, aiPlanTemplateTokenViolations } from './ai-job-plan-conformance'
import type { AiJobStepRunner } from './ai-job-text-step'
import { aiJobStepBudget } from './ai-job-budget'
import { registerAiJobStep } from './ai-jobs'

/**
 * The template step (AGL-2909): the generation step of a `template` job, run
 * once a member confirmed the job's plan.
 *
 * It builds ONE page template — the page a site renders once per record: a
 * content collection's entry, a product, an author — through
 * `runValidatedGeneration('template', …)`. Everything that differs per
 * record is a binding token from the subject's vocabulary
 * (`model/ai-template-subjects.ts`), which is the list the besigner's insert
 * picker offers for that page; a link or media prop may hold one of those
 * tokens whole, which the palette validator admits only because this door
 * names them. The door adds one check of its own through `extend` (rule 8):
 * no token the page does not fill, an h1 bound to the subject's title, and no
 * block that fills itself only on another subject's page.
 *
 * The model is shown the platform's starter pages as examples, in a cached
 * block (`runtime/ai-template-examples.ts`), and writes against them.
 *
 * The template lands in the site's library as a new draft
 * (`ai-job-drafts.ts`), inert until a member uses it: bound to no
 * collection, set as no product or author page, served nowhere. A plan that
 * starts from a copy of a template the site has gets that copy instead.
 */

/** The longest answer a template may run to; the tree is held to the template budget either way. */
export const AI_JOB_TEMPLATE_MAX_TOKENS = AI_ROUTING_TABLE['job.template'].maxTokens

/**
 * The template step's time (AGL-3035, AGL-3036): its two inventory-lookup
 * rounds, its answer and its re-ask at the routing table's ceiling on the tier
 * `job.template` is served from, fitted to what a beat can give a step. It
 * runs on the job beat, never at an inline door, and asks for no more of the
 * ceiling than fits that time on the model it runs.
 */
export const AI_JOB_TEMPLATE_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.template'],
  maxTokens: AI_JOB_TEMPLATE_MAX_TOKENS,
})

/** The least time one template step needs before it starts. */
export const AI_JOB_TEMPLATE_STEP_MINIMUM_MS = AI_JOB_TEMPLATE_STEP_BUDGET.minimumMs

/** The template step's own instructions, cached after the doctrine and before the examples. */
export const AI_JOB_TEMPLATE_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      'You build one page template: the page a website renders once for each record it keeps, such as each entry of a content collection, each product or each author. Answer with submit_template: the whole page as one flat node map.',
      'Everything that differs from one record to the next is a binding token, never typed copy. The request names what the page is for, the tokens that page fills and the blocks that fill themselves there; bind only those tokens.',
      'The page’s one h1 holds the title token the request names. Copy that reads the same on every record, such as a section heading, is written in the site’s voice.',
      'A link or media prop holds exactly one token from the request’s link and media tokens, such as an Image whose src is {{entry.coverImage}}; its alt text may combine words and tokens.',
      'The page renders inside the site’s layout, so it carries no header, navigation or footer of its own.',
    ].join('\n'),
  },
]

/** A content collection an entry template is for, as the prompt and the draft name it. */
export interface AiTemplateCollection {
  id: string
  name: string
  slug: string
}

/** The content collection by that id on the site, or `null` when there is none. */
export async function readAiTemplateCollection(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  collectionId: string,
): Promise<AiTemplateCollection | null> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('collections')
    .doc(collectionId)
    .get()
  if (!snapshot.exists) return null
  const data = (snapshot.data() ?? {}) as Record<string, unknown>
  if (hostCollectionKind(data) !== 'content') return null
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const slug = text(data['slug'])
  return {
    id: collectionId,
    name: text(data['displayName']) || text(data['name']) || slug || collectionId,
    slug,
  }
}

/** The template's name: the plan's, else the collection's or the subject's. */
export function aiTemplateDraftName(
  definition: AiTemplateSubjectDefinition,
  collection: AiTemplateCollection | null,
  planned: string | null | undefined,
): string {
  return planned || (collection ? `${collection.name} entry template` : definition.defaultName)
}

/** The address Use template offers for the page it creates. */
export function aiTemplateDraftSlug(
  definition: AiTemplateSubjectDefinition,
  collection: AiTemplateCollection | null,
): string | null {
  return (
    normalizeScreenSlug(
      collection
        ? `${collection.slug || collection.id}-entry-template`
        : `${definition.subject}-page-template`,
    ) ?? null
  )
}

/** The template job as the generation's user turn. */
export function aiJobTemplatePrompt(
  job: Pick<AiJob, 'brief'>,
  definition: AiTemplateSubjectDefinition,
  collection: AiTemplateCollection | null,
  plan: AiJobPlan | null,
  name: string,
): string {
  const of = collection
    ? ` of the "${collection.name}" collection${collection.slug ? ` (/${collection.slug})` : ''}`
    : ''
  return [
    `Template name: ${name}`,
    `The page is for ${definition.noun}${of}.`,
    `Title token: ${definition.titleToken}`,
    `Tokens this page fills: ${definition.tokens.map((entry) => `${entry.token} ${entry.label}`).join('; ')}`,
    `Link and media tokens: ${aiTemplateAddressTokens(definition).join(', ')}`,
    definition.blocks.length
      ? `Blocks that fill themselves on this page: ${definition.blocks.join(', ')}`
      : 'No block fills itself on this page: bind the tokens.',
    aiJobBriefLine(job),
    ...aiPlanReferenceLines(plan),
  ].join('\n')
}

/** Which subject's page each self-filling block belongs to. */
const BLOCK_SUBJECTS = new Map<string, AiTemplateSubjectDefinition>(
  AI_TEMPLATE_SUBJECTS.flatMap((subject) =>
    AI_TEMPLATE_SUBJECT_DEFINITIONS[subject].blocks.map(
      (block) => [block, AI_TEMPLATE_SUBJECT_DEFINITIONS[subject]] as const,
    ),
  ),
)

/** Every string a prop value holds, however deeply. */
function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const inner of value) stringsIn(inner, out)
  else if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) stringsIn(inner, out)
  }
  return out
}

/** The page's title: a Typography that renders as an h1. */
function isPageTitle(node: AiDoctrineNode): boolean {
  if (node.componentId !== 'muiTypography') return false
  const element = typeof node.props?.['component'] === 'string' ? String(node.props['component']) : ''
  return (element || String(node.props?.['variant'] ?? '')) === 'h1'
}

/**
 * The template door's check on a tree the doctrine admitted (rule 8): every
 * token is one the page fills, the h1 binds the subject's title, and no block
 * that fills itself on another subject's page is placed — except inside a
 * Collection Entries card, where each fills from the card's own entry.
 */
export function aiTemplateBindingCheck(
  definition: AiTemplateSubjectDefinition,
): (tree: AiValidatedTree) => AiDoctrineViolation[] {
  const allowed = new Set(definition.tokens.map((entry) => entry.token))
  return (tree) => {
    const nodes = tree.nodes as unknown as Record<string, AiDoctrineNode>
    const unknown = new Set<string>()
    const unknownAt: string[] = []
    const foreign: Array<{ id: string; componentId: string; owner: AiTemplateSubjectDefinition }> = []
    const titles: string[] = []
    let titleBound = false
    for (const { id, node, ancestors } of walkTree({ rootId: tree.rootId, nodes })) {
      const tokens = stringsIn(node.props).flatMap(aiBindingTokensIn)
      const strays = tokens.filter((token) => !allowed.has(token))
      if (strays.length) {
        for (const token of strays) unknown.add(token)
        unknownAt.push(id)
      }
      const owner = BLOCK_SUBJECTS.get(node.componentId)
      const inCard = ancestors.some((ancestor) => nodes[ancestor]?.componentId === 'collectionEntries')
      if (owner && owner.subject !== definition.subject && !inCard) {
        foreign.push({ id, componentId: node.componentId, owner })
      }
      if (isPageTitle(node)) {
        titles.push(id)
        if (tokens.includes(definition.titleToken)) titleBound = true
      }
    }
    const violations: AiDoctrineViolation[] = []
    if (unknown.size) {
      violations.push({
        rule: 8,
        code: 'unknown-binding',
        message: `This binds ${[...unknown].slice(0, 3).join(', ')}, which ${definition.noun}’s page does not fill. Bind only the tokens listed for this page.`,
        nodeIds: aiModelNodeIds(unknownAt, tree.sourceIds),
      })
    }
    // The doctrine already refuses a page with no h1 or with several.
    if (titles.length === 1 && !titleBound) {
      violations.push({
        rule: 8,
        code: 'typed-title',
        message: `The page title is typed, so every record would show the same one. Put ${definition.titleToken} in the h1.`,
        nodeIds: aiModelNodeIds(titles, tree.sourceIds),
      })
    }
    if (foreign.length) {
      const [first] = foreign
      violations.push({
        rule: 8,
        code: 'foreign-block',
        message: `The ${AI_PALETTE[first.componentId]?.displayName ?? first.componentId} block fills itself only on ${first.owner.noun}’s page, and this template is for ${definition.noun}. Remove it.`,
        nodeIds: aiModelNodeIds(
          foreign.map((entry) => entry.id),
          tree.sourceIds,
        ),
      })
    }
    return violations
  }
}

export interface AiTemplateJobAdmissionDeps {
  readCollection?: typeof readAiTemplateCollection
}

/**
 * A template job is admitted with inputs that say what the page is for, for
 * a site of the job's own org that holds the collection it names, with a
 * template to spare.
 */
export function createAiTemplateJobAdmission(deps: AiTemplateJobAdmissionDeps = {}): AiJobAdmission {
  const readCollection = deps.readCollection ?? readAiTemplateCollection
  return async (context) => {
    const inputs = parseAiTemplateJobInputs(context.inputs)
    if (typeof inputs === 'string') return { status: 400, error: inputs }
    return aiDraftAdmissionRefusal(context.firestore, {
      orgId: context.orgId,
      hostId: context.hostId,
      kind: 'template',
      org: context.org,
      ownCheck: async (hostId) =>
        inputs.collectionId && !(await readCollection(context.firestore, hostId, inputs.collectionId))
          ? { status: 404, error: 'That content collection is not on this site' }
          : null,
    })
  }
}

export interface AiJobTemplateStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** The platform's duplicate module, for a plan that starts from a copy. */
  duplicate?: typeof duplicateResource
  readCollection?: typeof readAiTemplateCollection
  /** The starter examples block; built from the starters once per process otherwise. */
  examples?: () => AiSystemBlock
}

/**
 * The binding tokens the confirmed plan gives the template, against the
 * template a COPY actually produced (AGL-3024); `null` when the copy keeps
 * the plan, or when the plan promised no token to keep.
 *
 * The same hole as `aiCopiedLayoutReview` and `aiCopiedPageReview`, on the
 * third kind that can start from a duplicate. The generate path already holds
 * a built template to `aiPlanTemplateTokenViolations`; the copy path reached
 * none of it, so a plan reading "duplicate it and bind the author's photo"
 * got the duplicate and reported Done.
 *
 * A copy that cannot be read back settles nothing, and a promise this step
 * cannot settle is reviewed by a person rather than reported as kept.
 */
export async function aiCopiedTemplateReview(
  firestore: FirebaseFirestore.Firestore,
  input: {
    hostId: string
    id: string
    name: string
    plan: AiJobPlan | null
    definition: AiTemplateSubjectDefinition
  },
): Promise<AiJobReview | null> {
  const { tokens, unreadable } = aiPlannedTemplateTokens(input.plan, input.definition)
  if (!tokens.length && !unreadable.length) return null
  const stored = await readAiTemplateDraftNodes(firestore, {
    hostId: input.hostId,
    id: input.id,
  })
  const nodes = (stored ?? {}) as unknown as Record<string, AiDoctrineNode>
  if (!nodes[CANVAS_ROOT_ELEMENT_ID]) {
    return {
      reason: 'doctrine',
      message: `"${input.name}" was copied from the template the plan names, and this job could not read the copy back to check it shows what the plan gives it. Open the template and check it before you apply it.`,
      findings: [],
    }
  }
  const violations = aiPlanTemplateTokenViolations(input.plan, input.definition, {
    rootId: CANVAS_ROOT_ELEMENT_ID,
    nodes,
  })
  if (!violations.length) return null
  return aiDoctrineReview({
    message: `"${input.name}" is a copy of the template the plan names, and a copy is all it is: ${violations[0].message}`,
    violations,
  })
}

export function createAiJobTemplateStep(deps: AiJobTemplateStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const duplicate = deps.duplicate ?? duplicateResource
  const readCollection = deps.readCollection ?? readAiTemplateCollection
  const examples = deps.examples ?? aiTemplateExamplesSystemBlock
  return async ({ job, now, signal, firestore, modelFor }) => {
    const hostId = job.hostId
    if (!hostId) throw new Error('a template job names no site, and its admission refuses one')
    const inputs = parseAiTemplateJobInputs(job.inputs)
    if (typeof inputs === 'string') {
      throw new Error(`a template job's inputs no longer read as they were admitted: ${inputs}`)
    }
    const definition = AI_TEMPLATE_SUBJECT_DEFINITIONS[inputs.subject]
    const output = (draft: AiDraftRecord, load?: AiLoadEstimate | null): AiJobOutput => ({
      resource: 'template',
      id: draft.id,
      versionId: null,
      hostId,
      hostSubdomain: draft.hostSubdomain,
      label: draft.name,
      ...(load ? { load } : {}),
    })
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.template') ?? aiModelForStep('job.template')

    // A run cut off after its draft was written reports that draft, found by the id the job recorded.
    const draftId = aiJobDraftId(job, 'template')
    const written = await readAiDraft(firestore, { kind: 'template', hostId, id: draftId })
    if (written) return aiUnspentOutcome(model, { outputs: [output(written)] })

    const [inventory, orgSnapshot, collection] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
      inputs.collectionId
        ? readCollection(firestore, hostId, inputs.collectionId)
        : Promise.resolve(null),
    ])
    if (inputs.collectionId && !collection) {
      throw new Error(`collection ${inputs.collectionId} left site ${hostId} after its template job was admitted`)
    }
    const org = (orgSnapshot.data() ?? null) as Partial<AglynOrgBilling> | null
    const plan = aiConfirmedPlan(job)
    const creation = aiPlanCreation(plan, 'template')
    const name = aiTemplateDraftName(definition, collection, creation?.name)

    // The plan starts from a copy of a template the site has (rule 15): the
    // copy is the draft, and nothing is generated. A source gone since the
    // plan was made is built from the brief instead.
    if (
      creation?.duplicateOf &&
      inventory.templates.some((template) => template.id === creation.duplicateOf)
    ) {
      const copy = await duplicate('template', {
        orgId: job.orgId,
        hostId,
        sourceId: creation.duplicateOf,
        name,
        uid: job.createdBy,
        org: org as Record<string, unknown> | null,
        // The same claim the page step makes (AGL-3024): a copy core mints is
        // written under core's own id, never `draftId`, so a step that runs
        // again — a pass resumed, a run cut off after the copy — would mint a
        // second. The job's recorded id makes core replay the one it made.
        attemptKey: draftId,
      })
      if (copy.ok) {
        const hostSubdomain = await aiSiteSubdomain(firestore, hostId)
        // The copy is reported with what the plan promised of it read back
        // (AGL-3024): this branch generates nothing, so nothing else can.
        const review = await aiCopiedTemplateReview(firestore, {
          hostId,
          id: copy.id,
          name: copy.name,
          plan,
          definition,
        })
        if (review) return aiUnspentOutcome(model, { review })
        return aiUnspentOutcome(model, {
          outputs: [output({ id: copy.id, versionId: null, name: copy.name, hostSubdomain })],
        })
      }
      if (copy.ok === false && copy.status === 403) {
        return aiUnspentOutcome(model, { review: aiLimitReview(copy.error) })
      }
    }

    const allowance = await aiDraftAllowanceRefusal(firestore, { kind: 'template', hostId, org })
    if (allowance) return aiUnspentOutcome(model, { review: aiLimitReview(allowance) })

    const result = await runValidatedGeneration('template', {
      step: 'job.template',
      model,
      instructions: [...AI_JOB_TEMPLATE_INSTRUCTIONS, examples()],
      inventory,
      messages: [
        {
          role: 'user',
          content: aiJobTemplatePrompt(job, definition, collection, plan, name),
        },
      ],
      tool: aiDoctrineTreeTool('template'),
      maxTokens: AI_JOB_TEMPLATE_STEP_BUDGET.maxTokens(model),
      ...(AI_ROUTING_TABLE['job.template'].thinking ? { thinking: AI_ROUTING_TABLE['job.template'].thinking } : {}),
      ...(AI_ROUTING_TABLE['job.template'].effort ? { effort: AI_ROUTING_TABLE['job.template'].effort } : {}),
      context: { bindingTokens: aiTemplateAddressTokens(definition) },
      // Rule 8's binding check, and the confirmed plan kept in both halves: a
      // token the plan promised that the template does not bind (AGL-3143
      // §11), and a component the plan reuses that it does not place. The
      // layout and component doors hold their builds to that reuse; the
      // template door did not, so it could drop a promised component and
      // still answer `Done` (AGL-3024).
      extend: (tree) => [
        ...aiTemplateBindingCheck(definition)(tree),
        ...aiPlanTemplateTokenViolations(plan, definition, {
          rootId: tree.rootId,
          nodes: tree.nodes as unknown as Record<string, AiDoctrineNode>,
        }),
        ...aiPlanReuseViolations(inventory, plan, aiPlacedComponentIds(tree), 'template'),
      ],
      ...(signal ? { signal } : {}),
    })
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }

    const draft = await writeAiDraft(firestore, {
      kind: 'template',
      hostId,
      id: draftId,
      uid: job.createdBy,
      org,
      name,
      nodes: result.value.nodes,
      slug: aiTemplateDraftSlug(definition, collection),
      now,
    })
    if (draft.ok === false) {
      if (draft.status === 404) throw new Error(`site ${hostId} vanished while its template was generated`)
      return { ...spent, review: aiLimitReview(draft.error) }
    }
    return { ...spent, outputs: [output(draft, result.value.load)] }
  }
}

export const runAiJobTemplateStep = createAiJobTemplateStep()

/** Registers the template step and the check a template job passes before it is created or resumed. */
export function registerAiTemplateJob(): void {
  registerAiJobStep('template', runAiJobTemplateStep, { minimumMs: AI_JOB_TEMPLATE_STEP_MINIMUM_MS })
  registerAiJobAdmission('template', createAiTemplateJobAdmission())
}
