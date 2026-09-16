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

import type {
  PluginDraftRecord,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiJob, AiJobOutput, AiJobPlan } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import type { AiStepKind } from '../providers/catalog'
import { aiModelForStep } from '../providers/routing'
import {
  aiDoctrineTreeTool,
  runValidatedGeneration,
  type AiValidatedGeneration,
  type AiValidatedTree,
} from '../runtime/ai-doctrine'
import {
  walkTree,
  type AiDoctrineNode,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { AI_TEXT_LIMITS } from '../runtime/ai-palette'
import type { AiSystemBlock, AiTool } from '../runtime/ai-runtime'
import { readSiteInventory } from '../runtime/site-inventory'
import {
  aiEmailProductNote,
  resolveAiEmailProducts,
  type AiEmailProductBinding,
} from './ai-email-bindings'
import { registerAiJobAdmission, type AiJobAdmission } from './ai-job-admission'
import { aiSiteSubdomain } from './ai-job-drafts'
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
import {
  aiPluginDraftAdmissionRefusal,
  aiPluginDraftWriter,
  type AiPluginDraftWriterLookup,
} from './ai-job-plugin-drafts'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The email step (AGL-2912): the generation step of an `email` job, run once a
 * member confirmed the job's plan, and the generation the campaign step
 * drafts its email with.
 *
 * It builds ONE email design from the email palette — sections holding text,
 * buttons, images, dividers, spacers and product blocks, never hand-written
 * HTML, which is not on the email surface — through
 * `runValidatedGeneration('email', …)`, so every building rule holds on the
 * tree, rule 6's brand and rule 17's clip size included. Beside the design the
 * answer carries three subject lines and three preheaders. The door's checks
 * ride `extend`:
 *
 *  - every block sits in a section, every button links somewhere, and the
 *    copy's only merge tokens are the recipient's own, in text;
 *  - exactly as many product blocks as the job binds products;
 *  - three different subject lines and preheaders, within their lengths and
 *    free of merge tokens, which a subject line does not fill;
 *  - and the design RENDERS: the email plugin's writer checks it through the
 *    send path's own renderer, reached through the core's resource-drafts
 *    seam, and a problem it names is a violation the model is re-asked with.
 *
 * What the model is sent is the brief, the email's name and kind, the
 * confirmed plan and the site inventory, and how many product blocks to place.
 * The products themselves are bound by id after it answers
 * (`ai-email-bindings.ts`); a link to one of the site's pages is completed
 * with the site's address token, which the send fills.
 *
 * The design lands through that same writer: a draft email screen, listed on
 * the Emails page's templates, that no campaign sends until a member picks it.
 * The job never sends, schedules or publishes anything.
 *
 * Like the other generation steps, it has the job beat's budget for one step,
 * its re-ask included, so it runs without extended thinking under a tighter
 * answer ceiling than the doctrine's default for an email.
 */

/** The resource the email plugin writes an email design under. */
export const AI_EMAIL_DESIGN_RESOURCE = 'emailDesign'

/** The id the email plugin is registered under. */
export const AI_EMAIL_PLUGIN_ID = 'email'

/** The longest answer an email may run to; the tree is held to the email budget either way. */
export const AI_JOB_EMAIL_MAX_TOKENS = 6_000

/** How many subject lines, and how many preheaders, an email is written with. */
export const AI_EMAIL_VARIANTS = 3

/** A subject line is a headline. */
export const AI_EMAIL_SUBJECT_MAX_CHARS = AI_TEXT_LIMITS.headline

/** The longest preheader the campaign send route stores. */
export const AI_EMAIL_PREHEADER_MAX_CHARS = 200

/** An email's name when neither the plan nor the job names one. */
export const AI_JOB_EMAIL_DEFAULT_NAME = 'New email'

/** A job's failure when the site has no email design writer. */
export const AI_EMAIL_UNAVAILABLE_COPY = 'Email is not available on this site.'

/** A job's failure when a design that passed every check could not be stored. */
export const AI_EMAIL_SAVE_FAILURE_COPY =
  'The email was written but could not be saved. Try the job again.'

/** The kinds of email a member may pick for a job, as `inputs.emailType`, and how the prompt says each. */
export const AI_EMAIL_TYPES = {
  welcome: 'a welcome email for someone who just signed up',
  newsletter: 'a newsletter',
  launch: 'a launch announcement',
  abandonedCart: 'a reminder about items left in a cart',
  eventReminder: 'a reminder about an upcoming event',
} as const

export type AiEmailType = keyof typeof AI_EMAIL_TYPES

/** The merge tokens a generated email's copy may carry: the recipient's own, which each send fills. */
export const AI_EMAIL_TEXT_MERGE_TOKENS: readonly string[] = [
  'contact.firstName',
  'contact.name',
  'contact.email',
]

/** The token the send fills with the site's address, set in front of a link to one of its pages. */
export const AI_EMAIL_SITE_URL_TOKEN = '{{site.url}}'

/** The email step's own instructions, cached after the doctrine. */
export const AI_JOB_EMAIL_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      'You write one marketing email for the owner of a website: its design as one flat node map, three subject lines and three preheaders. Answer with submit_email.',
      'The root is the document wrapper (div, id "_@_") and holds only Email sections (emailSection). Each section is a band holding the email’s blocks from top to bottom: Email text (emailText), Email buttons (emailButton), Email images (emailImage), Email dividers (emailDivider), Email spacers (emailSpacer) and, only when the job binds products, Email product blocks (emailProduct).',
      'Open with a heading (emailText with variant heading), keep each paragraph short, and give the email one main call to action as a button. Greet the reader by first name with {{contact.firstName}} where a greeting fits. The only merge tokens are {{contact.firstName}}, {{contact.name}} and {{contact.email}}, and only in text: never in a link, a subject line or a preheader.',
      'Every button links somewhere: a page of the site by its address from the site inventory, such as /menu, which is completed with the site’s domain when the email is sent, or a full https address the brief gives.',
      'An image has an empty src for the owner to fill from the media library, alt text describing the picture it should show, and a width of 600 or less.',
      'Place exactly as many Email product blocks as the job binds products, one for each, in the order the brief names them. Each shows its product’s current name, price and picture when the email is sent, so never type a product’s price.',
      'Leave out an unsubscribe link and a postal address: the platform adds the unsubscribe link to every campaign email. A fact the brief does not give, such as a date or a place, goes in square brackets.',
      `Subject lines: three that take different approaches, such as direct, curious and benefit-led, each at most ${AI_EMAIL_SUBJECT_MAX_CHARS} characters and best under 60, with no merge token. Preheaders: three, each extending the subject line in the same position, at most ${AI_EMAIL_PREHEADER_MAX_CHARS} characters and best between 40 and 110.`,
    ].join('\n'),
  },
]

const DOCTRINE_EMAIL_TOOL = aiDoctrineTreeTool('email')

/** The doctrine's email tree tool, with the subject lines and preheaders beside the tree. */
export const AI_JOB_EMAIL_TOOL: AiTool = {
  name: DOCTRINE_EMAIL_TOOL.name,
  description:
    'Submit the email: its design as one flat node map, three subject lines and three preheaders.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['tree', 'subjects', 'preheaders'],
    properties: {
      tree: (DOCTRINE_EMAIL_TOOL.inputSchema['properties'] as Record<string, unknown>)['tree'],
      subjects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Three subject lines that take different approaches, the strongest first.',
      },
      preheaders: {
        type: 'array',
        items: { type: 'string' },
        description: 'Three preheaders, each extending the subject line in the same position.',
      },
    },
  },
}

/** How the prompt names the kind of email a member picked; `null` for none or an unknown one. */
export function aiEmailTypeLabel(value: unknown): string | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AI_EMAIL_TYPES, value)
    ? AI_EMAIL_TYPES[value as AiEmailType]
    : null
}

/** A name the member gave the job, on one line and bounded; empty when none. */
export function aiJobInputName(job: Pick<AiJob, 'inputs'>): string {
  const raw = job.inputs?.['name']
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
}

/** The email job as the generation's user turn. */
export function aiJobEmailPrompt(
  job: Pick<AiJob, 'brief' | 'inputs'>,
  plan: AiJobPlan | null,
  heading: string | null,
  products: number,
): string {
  const lines = heading ? [heading] : []
  const type = aiEmailTypeLabel(job.inputs?.['emailType'])
  if (type) lines.push(`Kind of email: ${type}`)
  lines.push(aiJobBriefLine(job), ...aiPlanReferenceLines(plan))
  lines.push(
    products > 0
      ? `Products bound to this email: ${products}. Place exactly ${products} Email product ${
          products === 1 ? 'block' : 'blocks'
        }.`
      : 'No products are bound to this email: place no Email product block.',
  )
  return lines.join('\n')
}

/** The subject lines and preheaders an answer carries. */
export interface AiEmailCopy {
  subjects: string[]
  preheaders: string[]
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function parseAiEmailCopy(answer: Readonly<Record<string, unknown>>): AiEmailCopy {
  const lines = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string').map(oneLine)
      : []
  return { subjects: lines(answer['subjects']), preheaders: lines(answer['preheaders']) }
}

/** The copy's own rules: three different lines of each, within their lengths, with no merge token. */
export function aiEmailCopyViolations(copy: AiEmailCopy): AiDoctrineViolation[] {
  const violations: AiDoctrineViolation[] = []
  const distinct = (lines: string[]) =>
    new Set(lines.filter(Boolean).map((line) => line.toLowerCase())).size
  if (copy.subjects.length !== AI_EMAIL_VARIANTS || distinct(copy.subjects) !== AI_EMAIL_VARIANTS) {
    violations.push({
      rule: null,
      code: 'email-subjects',
      message: `Write exactly ${AI_EMAIL_VARIANTS} different subject lines.`,
    })
  }
  if (copy.preheaders.length !== AI_EMAIL_VARIANTS || distinct(copy.preheaders) !== AI_EMAIL_VARIANTS) {
    violations.push({
      rule: null,
      code: 'email-preheaders',
      message: `Write exactly ${AI_EMAIL_VARIANTS} different preheaders, one for each subject line.`,
    })
  }
  if (copy.subjects.some((line) => line.length > AI_EMAIL_SUBJECT_MAX_CHARS)) {
    violations.push({
      rule: null,
      code: 'email-subject-length',
      message: `A subject line is over ${AI_EMAIL_SUBJECT_MAX_CHARS} characters. Keep each within ${AI_EMAIL_SUBJECT_MAX_CHARS}, and best under 60.`,
    })
  }
  if (copy.preheaders.some((line) => line.length > AI_EMAIL_PREHEADER_MAX_CHARS)) {
    violations.push({
      rule: null,
      code: 'email-preheader-length',
      message: `A preheader is over ${AI_EMAIL_PREHEADER_MAX_CHARS} characters. Keep each within ${AI_EMAIL_PREHEADER_MAX_CHARS}.`,
    })
  }
  if ([...copy.subjects, ...copy.preheaders].some((line) => line.includes('{{'))) {
    violations.push({
      rule: null,
      code: 'email-header-token',
      message:
        'A subject line or preheader carries a merge token, which is not filled there. Write them without {{…}}.',
    })
  }
  return violations
}

const MERGE_TOKEN = /\{\{\s*([^}]*?)\s*\}\}/g

function visitsOf(tree: Pick<AiValidatedTree, 'rootId' | 'nodes'>) {
  return walkTree({
    rootId: tree.rootId,
    nodes: tree.nodes as unknown as Record<string, AiDoctrineNode>,
  })
}

/** The design's own rules, on a tree the doctrine admitted. */
export function aiEmailTreeViolations(tree: AiValidatedTree, products: number): AiDoctrineViolation[] {
  const violations: AiDoctrineViolation[] = []
  const loose = (tree.nodes[tree.rootId]?.nodes ?? []).filter(
    (id) => tree.nodes[id]?.componentId !== 'emailSection',
  )
  if (loose.length) {
    violations.push({
      rule: null,
      code: 'email-loose-block',
      message: 'A block sits outside every Email section. Put each block inside a section.',
      nodeIds: aiModelNodeIds(loose, tree.sourceIds),
    })
  }
  const tokens = new Set<string>()
  const tokenNodes: string[] = []
  const unlinked: string[] = []
  let placed = 0
  for (const { id, node } of visitsOf(tree)) {
    for (const value of Object.values(node.props ?? {})) {
      if (typeof value !== 'string') continue
      for (const match of value.matchAll(MERGE_TOKEN)) {
        if (!AI_EMAIL_TEXT_MERGE_TOKENS.includes(match[1])) {
          tokens.add(`{{${match[1]}}}`)
          tokenNodes.push(id)
        }
      }
    }
    if (node.componentId === 'emailButton' && typeof node.props?.['href'] !== 'string') {
      unlinked.push(id)
    }
    if (node.componentId === 'emailProduct') placed += 1
  }
  if (tokens.size) {
    violations.push({
      rule: null,
      code: 'email-merge-token',
      message: `This email writes ${[...tokens].slice(0, 3).join(', ')}, which a generated email may not use. Use only {{contact.firstName}}, {{contact.name}} or {{contact.email}}, and only in text.`,
      nodeIds: aiModelNodeIds([...new Set(tokenNodes)], tree.sourceIds),
    })
  }
  if (unlinked.length) {
    violations.push({
      rule: null,
      code: 'email-button-link',
      message:
        'An Email button links nowhere. Link each to a page of the site by its address, such as /menu, or to a full https address the brief gives.',
      nodeIds: aiModelNodeIds(unlinked, tree.sourceIds),
    })
  }
  if (placed !== products) {
    violations.push({
      rule: null,
      code: 'email-product-count',
      message: products
        ? `This email binds ${products} ${products === 1 ? 'product' : 'products'}: place exactly ${products} Email product ${
            products === 1 ? 'block' : 'blocks'
          }.`
        : 'No products are bound to this email: remove the Email product blocks.',
    })
  }
  return violations
}

/**
 * The design as it is stored: a link to one of the site's pages completed with
 * the site's address token, and each product block bound, in document order,
 * to the next product the job binds.
 */
export function aiEmailDesignNodes(
  tree: Pick<AiValidatedTree, 'rootId' | 'nodes'>,
  productIds: readonly string[],
): NodesMap {
  const nodes: NodesMap = { ...tree.nodes }
  let next = 0
  for (const { id, node } of visitsOf(tree)) {
    const props: Record<string, unknown> = { ...(node.props ?? {}) }
    let changed = false
    const href = props['href']
    if (typeof href === 'string' && href.startsWith('/') && !href.startsWith('//')) {
      props['href'] = `${AI_EMAIL_SITE_URL_TOKEN}${href}`
      changed = true
    }
    if (node.componentId === 'emailProduct') {
      const productId = productIds[next]
      next += 1
      if (productId) {
        props['productId'] = productId
        changed = true
      }
    }
    if (changed) nodes[id] = { ...nodes[id], props } as NodesMap[string]
  }
  return nodes
}

/** The content the email plugin's writer stores a design from. */
export function aiEmailDesignContent(nodes: NodesMap, copy: AiEmailCopy): Record<string, unknown> {
  return {
    nodes,
    subject: copy.subjects[0] ?? '',
    preheader: copy.preheaders[0] ?? '',
    subjectVariants: copy.subjects,
    preheaderVariants: copy.preheaders,
  }
}

/** What the email plugin's renderer says about the design, as violations the model is re-asked with. */
export function aiEmailRenderViolations(
  design: PluginResourceDraftWriter,
  hostId: string,
  nodes: NodesMap,
  copy: AiEmailCopy,
): AiDoctrineViolation[] {
  const checked = design.check(aiEmailDesignContent(nodes, copy), { hostId })
  if (checked.ok === true) return []
  return [...new Set(checked.problems)].map((problem) => ({
    rule: null,
    code: 'email-render',
    message: `The email does not render as written: ${problem}.`,
  }))
}

export interface AiEmailGenerationInput {
  job: AiJob
  step: Extract<AiStepKind, 'job.email' | 'job.campaign'>
  model: string
  /** The line naming what is built, such as `Email name: …`; `null` for none. */
  heading: string | null
  plan: AiJobPlan | null
  inventory: AiSiteInventory | null
  hostId: string
  products: AiEmailProductBinding
  /** The email plugin's design writer, whose check the design must pass. */
  design: PluginResourceDraftWriter
  signal?: AbortSignal
}

export interface AiEmailGeneration {
  result: AiValidatedGeneration<AiValidatedTree>
  /** The copy of the answer the doctrine kept; `null` unless it kept one. */
  copy: AiEmailCopy | null
  /** The kept design as it is stored; `null` unless the doctrine kept one. */
  nodes: NodesMap | null
}

/** Generates one email under the doctrine, with the email's own checks riding `extend`. */
export async function generateAiEmail(input: AiEmailGenerationInput): Promise<AiEmailGeneration> {
  // The answer `extend` saw last is the one the doctrine kept when it keeps one.
  let last = null as { copy: AiEmailCopy; nodes: NodesMap } | null
  const result = await runValidatedGeneration('email', {
    step: input.step,
    model: input.model,
    instructions: AI_JOB_EMAIL_INSTRUCTIONS,
    inventory: input.inventory,
    messages: [
      {
        role: 'user',
        content: aiJobEmailPrompt(input.job, input.plan, input.heading, input.products.ids.length),
      },
    ],
    tool: AI_JOB_EMAIL_TOOL,
    maxTokens: AI_JOB_EMAIL_MAX_TOKENS,
    thinking: 'off',
    extend: (tree, answer) => {
      const copy = parseAiEmailCopy(answer)
      const nodes = aiEmailDesignNodes(tree, input.products.ids)
      last = { copy, nodes }
      const violations = [
        ...aiEmailTreeViolations(tree, input.products.ids.length),
        ...aiEmailCopyViolations(copy),
      ]
      // Rendered once the design's own rules hold, so a problem is named once.
      return violations.length
        ? violations
        : aiEmailRenderViolations(input.design, input.hostId, nodes, copy)
    },
    ...(input.signal ? { signal: input.signal } : {}),
  })
  const kept = result.status === 'ok' ? last : null
  return { result, copy: kept?.copy ?? null, nodes: kept?.nodes ?? null }
}

/** An email design as the job's output. */
export function aiEmailDesignOutput(
  record: PluginDraftRecord,
  place: { hostId: string; hostSubdomain: string | null },
  note: string | null,
): AiJobOutput {
  return {
    resource: 'emailScreen',
    id: record.id,
    versionId: record.versionId,
    hostId: place.hostId,
    hostSubdomain: place.hostSubdomain,
    label: record.name,
    ...(note ? { note } : {}),
  }
}

/** An email job is admitted for a site of its org with email on and room for a design. */
export const aiEmailJobAdmission: AiJobAdmission = (context) =>
  aiPluginDraftAdmissionRefusal(context, {
    kind: 'email',
    drafts: [{ resource: AI_EMAIL_DESIGN_RESOURCE, pluginId: AI_EMAIL_PLUGIN_ID, label: 'Email' }],
  })

export interface AiJobEmailStepDeps {
  /** The inventory reader; specs hand in a fake. */
  readInventory?: typeof readSiteInventory
  /** How a resource's draft writer is found; the core's registry otherwise. */
  writerFor?: AiPluginDraftWriterLookup
}

export function createAiJobEmailStep(deps: AiJobEmailStepDeps = {}): AiJobStepRunner {
  const readInventory = deps.readInventory ?? readSiteInventory
  const writerFor = deps.writerFor ?? aiPluginDraftWriter
  return async ({ job, now, signal, firestore, modelFor }): Promise<AiJobStepOutcome> => {
    const hostId = job.hostId
    if (!hostId) throw new Error('an email job names no site, and its admission refuses one')
    // The switch's answer for this job, else the routing table's (AGL-2942).
    const model = modelFor?.('job.email') ?? aiModelForStep('job.email')
    const design = writerFor(AI_EMAIL_DESIGN_RESOURCE)
    if (!design) return { ...aiUnspentOutcome(model), failure: AI_EMAIL_UNAVAILABLE_COPY }

    // A run cut off after its design was written reports that design.
    const written = await design.read({ hostId, id: job.$id })
    if (written) {
      const hostSubdomain = await aiSiteSubdomain(firestore, hostId)
      return aiUnspentOutcome(model, {
        outputs: [aiEmailDesignOutput(written, { hostId, hostSubdomain }, null)],
      })
    }

    const [inventory, orgSnapshot, products, hostSubdomain] = await Promise.all([
      readInventory(job.orgId, hostId, { firestore }),
      firestore.collection('orgs').doc(job.orgId).get(),
      resolveAiEmailProducts(firestore, { hostId, brief: job.brief, inputs: job.inputs }),
      aiSiteSubdomain(firestore, hostId),
    ])
    const org = (orgSnapshot.data() ?? null) as Record<string, unknown> | null
    const context = { orgId: job.orgId, hostId, uid: job.createdBy, org, now }
    const refusal = await design.refusal(context)
    if (refusal) {
      return refusal.status === 403
        ? aiUnspentOutcome(model, { review: aiLimitReview(refusal.error) })
        : { ...aiUnspentOutcome(model), failure: refusal.error }
    }

    const plan = aiConfirmedPlan(job)
    const name =
      aiPlanCreation(plan, 'email')?.name || aiJobInputName(job) || AI_JOB_EMAIL_DEFAULT_NAME
    const generated = await generateAiEmail({
      job,
      step: 'job.email',
      model,
      heading: `Email name: ${name}`,
      plan,
      inventory,
      hostId,
      products,
      design,
      ...(signal ? { signal } : {}),
    })
    const { result } = generated
    const spent = aiGenerationSpent(result)
    if (result.status === 'refused') return { ...spent, refused: true }
    if (result.status === 'needs_input') return { ...spent, review: aiDoctrineReview(result) }
    if (!generated.copy || !generated.nodes) return { ...spent, failure: AI_EMAIL_SAVE_FAILURE_COPY }

    const write = await design.write({
      ...context,
      id: job.$id,
      name,
      content: aiEmailDesignContent(generated.nodes, generated.copy),
    })
    if (write.ok === false) {
      return write.status === 403
        ? { ...spent, review: aiLimitReview(write.error) }
        : { ...spent, failure: AI_EMAIL_SAVE_FAILURE_COPY }
    }
    return {
      ...spent,
      outputs: [aiEmailDesignOutput(write, { hostId, hostSubdomain }, aiEmailProductNote(products))],
    }
  }
}

export const runAiJobEmailStep = createAiJobEmailStep()

registerAiJobStep('email', runAiJobEmailStep)
registerAiJobAdmission('email', aiEmailJobAdmission)
