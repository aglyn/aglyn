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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { SCREEN_KIND_TEMPLATE } from '@aglyn/aglyn/app-utils/screen-route'
import { screenSeoStageKey, SCREEN_SEO_TEXT_FIELDS } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { CanvasManager } from '@aglyn/aglyn/canvas-manager/canvas-manager'
import { FEATURE_FLAG } from '@aglyn/aglyn/foundation/constants/shared'
import type { EditorSession } from '@aglyn/aglyn/plugin-manager/editor-sessions'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { applyAssistEdit } from '../components/assist-edit-canvas'
import {
  AI_EDIT_COMPONENT_LEFT_OUT,
  AI_EDIT_EMAIL_COPY,
  AI_EDIT_GONE_COPY,
  AI_EDIT_NEEDS_VERSIONING_COPY,
  AI_EDIT_NO_NODES_COPY,
  AI_EDIT_NO_SITE_COPY,
  AI_EDIT_NOTHING_COPY,
  AI_EDIT_REFUSED_COPY,
  AI_EDIT_SEO_LEFT_OUT,
  AI_EDIT_STALE_COPY,
  AI_EDIT_VERSION_GONE_COPY,
  aiEditJobOutline,
  aiEditOutputNote,
  aiEditVersionName,
  parseAiEditJobInputs,
  type AiEditJobInputs,
  type AiEditPlacement,
  type AiEditTargetKind,
} from '../model/ai-edit-job'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import {
  ASSIST_EDIT_TOOL_NAME,
  type AssistEditCanvasContext,
  type AssistEditOp,
  type AssistEditProposal,
  type AssistEditTarget,
} from '../model/assist-edit'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import {
  runValidatedGeneration,
  validateStreamedGeneration,
  type AiCustomGenerationInput,
} from '../runtime/ai-doctrine'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import {
  assistEditTool,
  checkAssistEditAnswer,
  editCanvasBlock,
  editSelectionBlock,
  parseAssistEditContext,
} from '../server/assist-edit'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import { aiOriginJobId } from './ai-job-draft-ids'
import { aiGenerationSpent, aiLimitReview, aiUnspentOutcome } from './ai-job-generation'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobStepOutcome, type AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The `edit` step (AGL-3616): a change to a page or a layout the site already
 * has, from a description, made on the server with no editor open.
 *
 * It is the Assist edit rung, run as a job. The model is shown the stored
 * document as the rung's outline and proposes through the rung's own tool;
 * its answer is held to the rung's closed world and palette validators
 * (`checkAssistEditAnswer`) and re-asked once, naming what was left out; and
 * what survives lands through the canvas's own guarded mutators
 * (`applyAssistEdit`), on a `CanvasManager` built headless from the stored
 * nodes, inside the transaction that writes it.
 *
 * ── Where the change lands, decided before anything is spent ────────────
 *
 * Never on a version a visitor sees. With version history, a NEW version
 * beside the one it started from — a copy of that version's stored fields with
 * the changed nodes — which becomes the page's current version only when the
 * page is not published; a published page's current version, and a layout's,
 * never move. Without it, in place, on a version no visitor reaches: an
 * unpublished page's, or one that is not the current version and no schedule
 * will publish. Anything else is refused as a plan limit, charged nothing.
 *
 * ── What a job cannot do that the editor can ────────────────────────────
 *
 * The rung's chat door never offers saving part of a page as a reusable
 * component, and neither does this. A page's search title and description
 * live on the page itself, not on a version, so they are written only for a
 * page that is not published; on a published page they are left out, and the
 * output's note says so, as it says every change it left out.
 *
 * ── One version per job ──────────────────────────────────────────────────
 *
 * The new version is named by the job's id — a build's unit is named by its
 * plan item's id — so a run asked again finds what it wrote and spends
 * nothing. A change made in place stamps the version with the job's id for
 * the same reason.
 */

/** The longest the step may take reading the page and writing it. */
export const AI_EDIT_READS_MS = 2_000

/** The step's time: its answer and its re-ask at the `job.edit` ceiling, with its own reads. */
export const AI_JOB_EDIT_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.edit'],
  maxTokens: AI_ROUTING_TABLE['job.edit'].maxTokens,
  lookups: 0,
  ownReadsMs: AI_EDIT_READS_MS,
})

export const AI_JOB_EDIT_STEP_MINIMUM_MS = AI_JOB_EDIT_STEP_BUDGET.minimumMs

export function aiJobEditModel(): string {
  return aiModelForStep('job.edit')
}

/**
 * The job's own rules, byte-identical on every request, ahead of the rung's
 * protocol and catalog for the document's kind, which carries the breakpoint:
 * both are the same for every site, so a kind's whole prefix caches once.
 */
export const AI_JOB_EDIT_RULES: AiSystemBlock = {
  text: [
    'You change a page or a layout the person already has, as a job that runs on its own. No editor is open, nothing is selected, and nobody can answer a question before you finish.',
    `- Make exactly the change the request asks for, and keep everything else as it is: other elements, their text, their styles and their order. Never rewrite, restyle, move or remove what the request does not ask about.`,
    '- Find the elements the request means in the canvas outline the request carries, by what they say and what they are. Name only ids that outline lists.',
    `- If the outline does not show an element the request is about, change nothing for that part: never guess at an element.`,
    `- Call ${ASSIST_EDIT_TOOL_NAME} exactly once, with every operation. Its summary is one short line saying what changed, in the language of the request; it names the version the change is saved in.`,
    "- Fill in a page's search title or description only when the request asks for it.",
    '- What you change is saved where no visitor sees it until the person publishes it, so never say the site or the page has changed.',
    '- The protocol below was written for Assist’s chat. In this job there is no user to ask or to press Apply, and no selection: what it says about those does not apply. Everything else in it — the operations, their fields, the elements and the style tokens — does.',
  ].join('\n'),
}

/** The system blocks for one kind of document. */
export function aiJobEditInstructions(kind: AiEditTargetKind): AiSystemBlock[] {
  return [AI_JOB_EDIT_RULES, { text: editCanvasBlock(kind), cacheBreakpoint: true }]
}

/** What the change is asked from: the document's outline, then the request. */
export function aiJobEditPrompt(input: { brief: string; context: AssistEditCanvasContext }): string {
  return [editSelectionBlock(input.context), '', `Request: ${input.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`].join('\n')
}

/** The edit as the doctrine's loop runs it: the rung's tool, held to the rung's check. */
export function aiJobEditGeneration(request: {
  brief: string
  context: AssistEditCanvasContext
  target: AssistEditTarget
  model: string
  signal?: AbortSignal
}): AiCustomGenerationInput<AssistEditProposal> {
  const row = AI_ROUTING_TABLE['job.edit']
  const kind = request.target.kind as AiEditTargetKind
  return {
    step: 'job.edit',
    model: request.model,
    instructions: aiJobEditInstructions(kind),
    messages: [{ role: 'user', content: aiJobEditPrompt(request) }],
    tool: assistEditTool(kind),
    maxTokens: AI_JOB_EDIT_STEP_BUDGET.maxTokens(request.model),
    ...(row.thinking ? { thinking: row.thinking } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    check: (answer) => checkAssistEditAnswer(answer, { context: request.context, target: request.target }),
  }
}

// ── The document, headless ────────────────────────────────────────────────

/**
 * The slice of the platform a headless canvas asks: whether an element takes
 * children, answered from the AI palette the edit validator reads, so the
 * canvas refuses exactly what the validator refuses.
 */
const AI_EDIT_CANVAS_PLATFORM = {
  components: {
    getSchema: (componentId: string) => {
      const entry = AI_PALETTE[componentId]
      if (!entry) return undefined
      return entry.acceptsChildren ? {} : { flags: { dropping: FEATURE_FLAG.DISABLED } }
    },
    getLabel: (componentId: string) => AI_PALETTE[componentId]?.displayName ?? componentId,
  },
}

/** A canvas over a stored node map, with the editor's own guarded mutators and no editor. */
export function aiEditCanvas(nodes: NodesMap): CanvasManager {
  const canvas = new CanvasManager(AI_EDIT_CANVAS_PLATFORM as never)
  canvas.setNodes(nodes)
  return canvas
}

/**
 * Lands a proposal on a stored node map, as the editor lands one on its open
 * canvas: checked whole first, then one batch, all or nothing. The session is
 * the version being written, which is never one a visitor sees; a page's
 * search fields are captured into `seo` only where `seo` is given.
 */
export function aiApplyEditToNodes(
  nodes: NodesMap,
  proposal: AssistEditProposal,
  seo?: Partial<Record<(typeof SCREEN_SEO_TEXT_FIELDS)[number], string>>,
): { ok: true; nodes: NodesMap } | { ok: false; reason: string } {
  const canvas = aiEditCanvas(nodes)
  const fields: Record<string, (value: string) => void> = {}
  if (seo) {
    for (const field of SCREEN_SEO_TEXT_FIELDS) fields[screenSeoStageKey(field)] = (value) => (seo[field] = value)
  }
  const session: EditorSession = {
    documentKind: proposal.target.kind,
    documentId: proposal.target.documentId,
    versionId: proposal.target.versionId,
    isLiveVersion: () => false,
    ...(seo ? { fields } : {}),
  }
  const applied = applyAssistEdit(canvas, proposal, session)
  if (applied.ok === false) return { ok: false, reason: applied.reason }
  return { ok: true, nodes: canvas.toJSON().nodes as NodesMap }
}

// ── Reading the document ──────────────────────────────────────────────────

type Firestore = FirebaseFirestore.Firestore

const COLLECTIONS: Readonly<Record<AiEditTargetKind, 'screens' | 'layouts'>> = {
  screen: 'screens',
  layout: 'layouts',
}

/** The page or layout an edit job changes, as it stands before anything is spent. */
export interface AiEditTargetRead {
  kind: AiEditTargetKind
  id: string
  name: string
  hostSubdomain: string | null
  /** The document's current version. */
  pointerVersionId: string | null
  /** The version the change starts from. */
  sourceVersionId: string
  nodes: NodesMap
  /** Whether visitors see the document's current version: a published page, a collection template, any layout. */
  served: boolean
  /** The version a pending publish schedule will make current, if any. */
  scheduledVersionId: string | null
  /** What this job already wrote, when a run of it got that far. */
  written: { versionId: string; placement: AiEditPlacement } | null
}

export interface AiEditTargetRefusal {
  status: 400 | 404
  error: string
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Whether visitors see a page's current version: it is routed, or it renders a collection's entries. */
function screenServed(screen: FirebaseFirestore.DocumentSnapshot, host: FirebaseFirestore.DocumentSnapshot): boolean {
  if (screen.get('kind') === SCREEN_KIND_TEMPLATE) return true
  const routing = host.get('screens') as Record<string, unknown> | null | undefined
  return typeof routing?.[screen.id] === 'string'
}

function pendingScheduleVersion(doc: FirebaseFirestore.DocumentSnapshot): string | null {
  const schedule = doc.get('publishSchedule') as Record<string, unknown> | null | undefined
  if (!schedule || schedule['status'] !== 'pending' || schedule['action'] === 'unpublish') return null
  return text(schedule['versionId']) || null
}

/**
 * The document an edit job changes, on the job's own site: the page or
 * layout named, not deleted, not an email design, and the version it starts
 * from with a document in it. A refusal names what is wrong.
 */
export async function readAiEditTarget(
  firestore: Firestore,
  input: {
    orgId: string
    hostId: string
    inputs: AiEditJobInputs
    /** The job's own version id, to find what a run of it wrote; `null` at the door, before there is one. */
    jobId: string | null
  },
): Promise<AiEditTargetRead | AiEditTargetRefusal> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const host = await hostRef.get()
  if (!host.exists || host.get('orgId') !== input.orgId) return { status: 404, error: AI_EDIT_NO_SITE_COPY }
  const kinds: AiEditTargetKind[] = input.inputs.targetKind ? [input.inputs.targetKind] : ['screen', 'layout']
  for (const kind of kinds) {
    const docRef = hostRef.collection(COLLECTIONS[kind]).doc(input.inputs.target)
    const doc = await docRef.get()
    if (!doc.exists) continue
    if (doc.get('deletedAt') != null) return { status: 404, error: AI_EDIT_GONE_COPY }
    if (kind === 'screen' && doc.get('kind') === 'email') return { status: 400, error: AI_EDIT_EMAIL_COPY }
    const pointerVersionId = text(doc.get('versionId')) || null
    const versions = docRef.collection('versions')
    const hostSubdomain = text(host.get('subdomain')) || null
    const name = text(doc.get('displayName')) || (kind === 'screen' ? 'Page' : 'Layout')
    // A run of this job that got as far as its write.
    const own = input.jobId ? await versions.doc(input.jobId).get() : null
    const sourceVersionId = input.inputs.versionId ?? pointerVersionId
    const base = {
      kind,
      id: doc.id,
      name,
      hostSubdomain,
      pointerVersionId,
      served: kind === 'layout' || screenServed(doc, host),
      scheduledVersionId: pendingScheduleVersion(doc),
    }
    if (own?.exists && input.jobId) {
      const placement: AiEditPlacement = pointerVersionId === input.jobId ? 'new-current' : 'new-beside'
      return { ...base, sourceVersionId: sourceVersionId ?? input.jobId, nodes: {}, written: { versionId: input.jobId, placement } }
    }
    if (!sourceVersionId) return { status: 404, error: AI_EDIT_VERSION_GONE_COPY }
    const source = await versions.doc(sourceVersionId).get()
    if (!source.exists) return { status: 404, error: AI_EDIT_VERSION_GONE_COPY }
    if (input.jobId && source.get('aiEditJobId') === input.jobId) {
      return { ...base, sourceVersionId, nodes: {}, written: { versionId: sourceVersionId, placement: 'in-place' } }
    }
    const nodes = decodeStoredNodes<NodesMap>(source.get('nodes'))
    if (!nodes || !Object.keys(nodes).length) return { status: 400, error: AI_EDIT_NO_NODES_COPY }
    return { ...base, sourceVersionId, nodes, written: null }
  }
  return { status: 404, error: AI_EDIT_GONE_COPY }
}

/**
 * Where a change may land (see the module head), or `refused` when the only
 * place is a version visitors see and the plan keeps no version history.
 */
export function aiEditPlacement(input: {
  versioning: boolean
  served: boolean
  sourceIsPointer: boolean
  sourceScheduled: boolean
}): AiEditPlacement | 'refused' {
  if (input.versioning) return !input.served && input.sourceIsPointer ? 'new-current' : 'new-beside'
  const seen = input.sourceScheduled || (input.sourceIsPointer && input.served)
  return seen ? 'refused' : 'in-place'
}

// ── Writing it ────────────────────────────────────────────────────────────

export interface AiEditWriteInput {
  hostId: string
  kind: AiEditTargetKind
  id: string
  sourceVersionId: string
  /** The new version's id, which is the job's; also the stamp a change in place carries. */
  jobVersionId: string
  versioning: boolean
  proposal: AssistEditProposal
  /** Whether the page's search fields may be written: a page no visitor reaches. */
  writeSeo: boolean
  versionName: string
  uid: string
  /** The job the member started, stamped as `aiJobId` on a new version. */
  aiJobId: string
  now: Date
}

export type AiEditWrite =
  | { ok: true; versionId: string; placement: AiEditPlacement; seoWritten: boolean }
  | { ok: false; error: string }

/**
 * The change written, in one transaction that reads the document as it is
 * stored NOW — a member may have saved, published or changed plan's history
 * since the read — decides where it lands again on that, and applies the
 * proposal to the stored nodes through the canvas's guards. An element that
 * changed since the model saw it refuses the whole change, as the editor does.
 */
export async function writeAiEdit(firestore: Firestore, input: AiEditWriteInput): Promise<AiEditWrite> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const docRef = hostRef.collection(COLLECTIONS[input.kind]).doc(input.id)
  const versions = docRef.collection('versions')
  const sourceRef = versions.doc(input.sourceVersionId)
  const newRef = versions.doc(input.jobVersionId)
  return firestore.runTransaction(async (tx): Promise<AiEditWrite> => {
    const [host, doc, source, already] = await Promise.all([tx.get(hostRef), tx.get(docRef), tx.get(sourceRef), tx.get(newRef)])
    const pointer = text(doc.get('versionId')) || null
    if (already.exists) {
      return { ok: true, versionId: input.jobVersionId, placement: pointer === input.jobVersionId ? 'new-current' : 'new-beside', seoWritten: false }
    }
    if (!doc.exists || doc.get('deletedAt') != null) return { ok: false, error: AI_EDIT_GONE_COPY }
    if (!source.exists) return { ok: false, error: AI_EDIT_VERSION_GONE_COPY }
    const served = input.kind === 'layout' || screenServed(doc, host)
    const placement = aiEditPlacement({
      versioning: input.versioning,
      served,
      sourceIsPointer: pointer === input.sourceVersionId,
      sourceScheduled: pendingScheduleVersion(doc) === input.sourceVersionId,
    })
    if (placement === 'refused') return { ok: false, error: AI_EDIT_NEEDS_VERSIONING_COPY }
    const nodes = decodeStoredNodes<NodesMap>(source.get('nodes'))
    if (!nodes) return { ok: false, error: AI_EDIT_NO_NODES_COPY }
    const versionId = placement === 'in-place' ? input.sourceVersionId : input.jobVersionId
    const seo: Partial<Record<(typeof SCREEN_SEO_TEXT_FIELDS)[number], string>> = {}
    const writeSeo = input.writeSeo && input.kind === 'screen' && !served
    const proposal: AssistEditProposal = {
      ...input.proposal,
      ops: writeSeo ? input.proposal.ops : input.proposal.ops.filter((op) => op.op !== 'setSeo'),
      target: { ...input.proposal.target, versionId },
    }
    const applied = aiApplyEditToNodes(nodes, proposal, writeSeo ? seo : undefined)
    if (applied.ok === false) return { ok: false, error: applied.reason === 'stale' ? AI_EDIT_STALE_COPY : AI_EDIT_REFUSED_COPY }
    const packed = encodeStoredNodes(applied.nodes)
    if (!packed) return { ok: false, error: AI_EDIT_NO_NODES_COPY }
    const stored = Buffer.from(packed)
    const docPatch: Record<string, unknown> = {}
    if (placement === 'in-place') {
      tx.update(sourceRef, { nodes: stored, updatedAt: input.now, aiEditJobId: input.jobVersionId })
    } else {
      // A copy of the version it started from — its layout binding, its
      // declared properties, everything the editor stored — with the changed
      // tree, as the versions route copies one.
      const copy = { ...(source.data() as Record<string, unknown>) }
      delete copy['aiEditJobId']
      tx.create(newRef, {
        ...copy,
        nodes: stored,
        displayName: input.versionName,
        createdAt: input.now,
        updatedAt: input.now,
        createdBy: input.uid,
        aiJobId: input.aiJobId,
      })
      if (placement === 'new-current') docPatch['versionId'] = input.jobVersionId
    }
    for (const [field, value] of Object.entries(seo)) {
      if (value) docPatch[`seo.${field}`] = value
    }
    if (Object.keys(docPatch).length) tx.update(docRef, { ...docPatch, updatedAt: input.now })
    return { ok: true, versionId, placement, seoWritten: Object.keys(seo).length > 0 }
  })
}

// ── The runner ────────────────────────────────────────────────────────────

export interface AiJobEditStepDeps {
  readTarget?: typeof readAiEditTarget
  writeEdit?: typeof writeAiEdit
}

/** What an edit wrote, as the job's output: a link into the Besigner on the version written. */
export function aiEditOutput(
  read: Pick<AiEditTargetRead, 'kind' | 'id' | 'name' | 'hostSubdomain'>,
  hostId: string,
  written: { versionId: string; placement: AiEditPlacement },
  leftOut: readonly string[],
): AiJobOutput {
  return {
    resource: read.kind,
    id: read.id,
    versionId: written.versionId,
    hostId,
    hostSubdomain: read.hostSubdomain,
    label: read.name,
    note: aiEditOutputNote({ kind: read.kind, placement: written.placement, leftOut }),
  }
}

/** The new version's id: the job's own, which a build's unit takes from its plan item. */
export function aiEditVersionId(job: Pick<AiJob, '$id'>): string {
  return job.$id.slice(0, 64)
}

/**
 * The ops a job may save, and why it left the rest out: never a component
 * save, and a page's search fields only where no visitor reaches the page.
 */
export function aiEditJobOps(
  ops: readonly AssistEditOp[],
  options: { seo: boolean },
): { ops: AssistEditOp[]; leftOut: string[] } {
  const kept: AssistEditOp[] = []
  const leftOut = new Set<string>()
  for (const op of ops) {
    if (op.op === 'saveAsComponent') leftOut.add(AI_EDIT_COMPONENT_LEFT_OUT)
    else if (op.op === 'setSeo' && !options.seo) leftOut.add(AI_EDIT_SEO_LEFT_OUT)
    else kept.push(op)
  }
  return { ops: kept, leftOut: [...leftOut] }
}

export function createAiJobEditStep(deps: AiJobEditStepDeps = {}): AiJobStepRunner {
  const readTarget = deps.readTarget ?? readAiEditTarget
  const writeEdit = deps.writeEdit ?? writeAiEdit
  return async ({ job, now, signal, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    const model = modelFor?.('job.edit') ?? aiJobEditModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const inputs = parseAiEditJobInputs(job.inputs)
    if (typeof inputs === 'string') return unspent(inputs)
    const hostId = job.hostId
    if (!hostId) return unspent(AI_EDIT_NO_SITE_COPY)
    const read = await readTarget(firestore, { orgId: job.orgId, hostId, inputs, jobId: aiEditVersionId(job) })
    if ('error' in read) return unspent(read.error)
    if (read.written) return aiUnspentOutcome(model, { outputs: [aiEditOutput(read, hostId, read.written, [])] })

    const orgData = org ?? ((await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null)
    const versioning = checkEntitlement(orgData as never, 'versioning')
    const placement = aiEditPlacement({
      versioning,
      served: read.served,
      sourceIsPointer: read.sourceVersionId === read.pointerVersionId,
      sourceScheduled: read.scheduledVersionId === read.sourceVersionId,
    })
    if (placement === 'refused') return aiUnspentOutcome(model, { review: aiLimitReview(AI_EDIT_NEEDS_VERSIONING_COPY) })
    const outline = aiEditJobOutline(read.nodes)
    const context = outline ? parseAssistEditContext(outline) : null
    if (!context) return unspent(AI_EDIT_NO_NODES_COPY)
    const target: AssistEditTarget = {
      kind: read.kind,
      documentId: read.id,
      versionId: placement === 'in-place' ? read.sourceVersionId : aiEditVersionId(job),
      hostId,
    }

    const generation = await runValidatedGeneration(
      'edit',
      aiJobEditGeneration({ brief: job.brief, context, target, model, ...(signal ? { signal } : {}) }),
    )
    const spent = { ...aiGenerationSpent(generation), ...(generation.effort ? { effort: generation.effort } : {}) }
    if (generation.status === 'refused') return { ...spent, refused: true }
    // An answer its re-ask still could not make whole keeps the changes that
    // survived, as the chat door's card does, and says what it left out; one
    // with none, or one that broke a numbered rule, is nothing to save.
    let proposal: AssistEditProposal | null = generation.status === 'ok' ? generation.value : null
    const refused = generation.status === 'needs_input' ? generation.answer : null
    if (!proposal && refused) {
      const salvaged = validateStreamedGeneration('edit', {
        answer: refused,
        check: (answer) => checkAssistEditAnswer(answer, { context, target }),
      })
      proposal = salvaged.status === 'ok' ? salvaged.value : null
    }
    if (!proposal) return { ...spent, failure: AI_EDIT_NOTHING_COPY }

    const seo = read.kind === 'screen' && !read.served
    const kept = aiEditJobOps(proposal.ops, { seo })
    const leftOut = [...proposal.dropped, ...kept.leftOut]
    if (!kept.ops.length) {
      return { ...spent, failure: `Nothing was saved. Left out: ${leftOut.join('; ') || 'every change'}.` }
    }
    const write = await writeEdit(firestore, {
      hostId,
      kind: read.kind,
      id: read.id,
      sourceVersionId: read.sourceVersionId,
      jobVersionId: aiEditVersionId(job),
      versioning,
      proposal: { ...proposal, ops: kept.ops },
      writeSeo: seo,
      versionName: aiEditVersionName(proposal.summary),
      uid: job.createdBy,
      aiJobId: aiOriginJobId(job),
      now,
    })
    if (write.ok === false) return { ...spent, failure: write.error }
    return { ...spent, outputs: [aiEditOutput(read, hostId, write, leftOut)] }
  }
}

export const runAiJobEditStep = createAiJobEditStep()

// ── Admission ─────────────────────────────────────────────────────────────

export interface AiEditJobAdmissionDeps {
  readTarget?: typeof readAiEditTarget
  ownerOf?: typeof resolveOrgIdForHost
}

/**
 * An edit job is admitted for a page or layout of a site of its own org,
 * and only where the change has somewhere to land that no visitor sees on
 * this workspace's plan — refused in the plan's words before anything exists.
 */
export function createAiEditJobAdmission(deps: AiEditJobAdmissionDeps = {}): AiJobAdmission {
  const readTarget = deps.readTarget ?? readAiEditTarget
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    const inputs = parseAiEditJobInputs(context.inputs)
    if (typeof inputs === 'string') return { status: 400, error: inputs }
    if (!context.hostId) return { status: 400, error: AI_EDIT_NO_SITE_COPY }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    // A job asked about at its door has no run to find yet.
    const read = await readTarget(context.firestore, { orgId: context.orgId, hostId: context.hostId, inputs, jobId: null })
    if ('error' in read) return read
    const placement = aiEditPlacement({
      versioning: checkEntitlement(context.org as never, 'versioning'),
      served: read.served,
      sourceIsPointer: read.sourceVersionId === read.pointerVersionId,
      sourceScheduled: read.scheduledVersionId === read.sourceVersionId,
    })
    return placement === 'refused' ? { status: 403, error: AI_EDIT_NEEDS_VERSIONING_COPY } : null
  }
}

export const aiEditJobAdmission = createAiEditJobAdmission()

/** Registers the edit step and the check an edit job passes before it is created or resumed. */
export function registerAiEditJob(): void {
  registerAiJobStep('edit', runAiJobEditStep, { minimumMs: AI_JOB_EDIT_STEP_MINIMUM_MS })
  registerAiJobAdmission('edit', aiEditJobAdmission)
}
