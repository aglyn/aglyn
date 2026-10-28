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

import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { orgPermissionLabel } from '@aglyn/aglyn/app-utils/org-permissions'
import {
  DUPLICABLE_RESOURCE_NOUNS,
  type DuplicableHostResourceKind,
} from '@aglyn/aglyn/app-utils/duplicate-resource'
import { duplicateResource, recipeFor } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import type { Firestore } from 'firebase-admin/firestore'
import { isAiPlanNewRef } from '../model/ai-build-plan'
import type { AiJob, AiJobOutput, AiJobOutputResource } from '../model/ai-jobs.types'
import { parseAiDuplicateResourceInput, type AiDuplicateResourceInput } from '../tools/ai-duplicate-resource-tool'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobEditModel } from './ai-job-edit-step'
import { aiLimitReview, aiUnspentOutcome } from './ai-job-generation'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The `duplicate` step (AGL-3740): copying something the site already has —
 * a page, a component, a layout, a template, a form, an email design or a
 * workflow — as a first-class build operation, so "make another page like
 * Services" copies instead of regenerating.
 *
 * NO MODEL. The copy is core's `duplicateResource`, the very function the
 * console's Duplicate… row menus and `/api/hosts/resources` (`action:
 * 'duplicate'`) call, and the one the `duplicate_resource` tool wraps: the
 * same fields carried, the same uniqueness rules, the same plan counters met
 * inside the transaction, the same `*.duplicated` activity row. So it costs
 * no credits, and it can copy nothing the console could not.
 *
 * DRAFTS ONLY, by construction of the copy: a page copy has no address, a
 * workflow copy no trigger, and nothing places a component, layout or form
 * copy until a person does.
 *
 * ── Who may ──────────────────────────────────────────────────────────────
 *
 * The console door's rule: a member with a write role on the site (admin,
 * editor or author), while no lockdown freezes the site, its org or the
 * platform. `ai.generate` is the jobs door's own check. Asked at the door
 * and again before the copy.
 *
 * ── Once per job ─────────────────────────────────────────────────────────
 *
 * The job's id is the copy's attempt key, so a pass asked again answers with
 * the copy the first made rather than making a second.
 */

export const AI_DUPLICATE_KIND = 'duplicate' as const

/**
 * ASSUMED: the least time the step needs — the site, the org, the source's
 * collection when it is named by name, and the one transaction that copies.
 * No model, so it fits an inline door.
 */
export const AI_JOB_DUPLICATE_STEP_MINIMUM_MS = 5_000

export const AI_DUPLICATE_NO_SITE_COPY = 'Open the site whose content should be copied.'
/** Names "Edit site content" (`site.edit`, AGL-4047), never a role. */
export const AI_DUPLICATE_ROLE_COPY = `Copying on this site needs the "${orgPermissionLabel('site.edit')}" permission on this site — ask an organization admin.`
export const AI_DUPLICATE_LOCKED_COPY = 'This site is not accepting changes right now.'
export const AI_DUPLICATE_UNREADABLE_COPY = 'The request did not name something on this site to copy.'
export const AI_DUPLICATE_NOT_YET_COPY = 'Only something the site already has can be copied, not something this build is making.'

/** The output resource each duplicable kind is opened as. */
export const AI_DUPLICATE_OUTPUT_RESOURCES: Readonly<Record<DuplicableHostResourceKind, AiJobOutputResource>> = {
  screen: 'screen',
  component: 'reusableComponent',
  layout: 'layout',
  template: 'template',
  form: 'form',
  emailDesign: 'emailScreen',
  workflow: 'workflow',
}

/** The copy's attempt key: one copy per job, however often it is asked. */
export function aiDuplicateAttemptKey(job: Pick<AiJob, '$id'>): string {
  return `ai-job:${job.$id}`.slice(0, 200)
}

/** What the plan's item asks, read; a refusal in words when it is unreadable. */
export function aiDuplicateRequestOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiDuplicateResourceInput | string {
  const source = typeof inputs?.['source'] === 'string' ? inputs['source'].trim() : ''
  if (isAiPlanNewRef(source)) return AI_DUPLICATE_NOT_YET_COPY
  const name = typeof inputs?.['name'] === 'string' ? inputs['name'] : null
  return parseAiDuplicateResourceInput({ kind: inputs?.['kind'], sourceId: source, name }) ?? AI_DUPLICATE_UNREADABLE_COPY
}

/** One row of a kind's collection, as a source is looked up by. */
export interface AiDuplicateSourceRow {
  id: string
  name: string
  kind: unknown
  deleted: boolean
}

/** The rows of a kind's collection on a site. */
export async function readAiDuplicateSourceRows(
  firestore: Firestore,
  hostId: string,
  kind: DuplicableHostResourceKind,
): Promise<AiDuplicateSourceRow[]> {
  const recipe = recipeFor(kind)
  if (!recipe) return []
  const snapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection(recipe.collection)
    .select(recipe.nameField, 'kind', 'deletedAt')
    .get()
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    name: String(doc.get(recipe.nameField) ?? ''),
    kind: doc.get('kind'),
    deleted: doc.get('deletedAt') != null,
  }))
}

/** Whether a row of a shared collection is of this kind: pages and email designs share `screens`. */
function rowIsKind(kind: DuplicableHostResourceKind, row: AiDuplicateSourceRow): boolean {
  if (kind === 'emailDesign') return row.kind === 'email'
  if (kind === 'screen') return row.kind !== 'email'
  return true
}

/**
 * The source's id: the row whose id it names, else the one row whose name it
 * is (case aside) — so "copy the Welcome email" works where the inventory
 * lists no email designs. Two rows of one name, or none, are refused in words.
 */
export function aiDuplicateSourceId(
  kind: DuplicableHostResourceKind,
  source: string,
  rows: readonly AiDuplicateSourceRow[],
): { id: string } | { error: string } {
  const noun = DUPLICABLE_RESOURCE_NOUNS[kind]
  const live = rows.filter((row) => !row.deleted && rowIsKind(kind, row))
  if (live.some((row) => row.id === source)) return { id: source }
  const wanted = source.trim().toLowerCase()
  const named = live.filter((row) => row.name.trim().toLowerCase() === wanted)
  if (named.length === 1) return { id: named[0].id }
  if (named.length > 1) return { error: `This site has more than one ${noun} called “${source}”; name the one to copy.` }
  return { error: `This site has no ${noun} “${source}” to copy.` }
}

/** Why this member may not copy on this site now, or `null`. */
export async function aiDuplicateAccessRefusal(
  input: { host: FirebaseFirestore.DocumentSnapshot; uid: string; org: object | null },
  deps: { lockdown?: typeof getLockdownVerdict } = {},
): Promise<string | null> {
  if (!input.host.exists) return 'Unknown site'
  if (!holdsSiteKey(input.host, input.uid, 'site.edit')) return AI_DUPLICATE_ROLE_COPY
  const locked = await (deps.lockdown ?? getLockdownVerdict)({
    staff: false,
    uid: input.uid,
    org: input.org as never,
    host: input.host.data() as never,
    intent: 'write',
  })
  return locked ? AI_DUPLICATE_LOCKED_COPY : null
}

/** The copy's output note: what it is and what it waits for. */
export function aiDuplicateOutputNote(kind: DuplicableHostResourceKind): string {
  const noun = DUPLICABLE_RESOURCE_NOUNS[kind]
  return `A copy of the ${noun}, saved as a draft: nothing on the live site uses it until you do.`
}

export interface AiJobDuplicateStepDeps {
  duplicate?: typeof duplicateResource
  readRows?: typeof readAiDuplicateSourceRows
  lockdown?: typeof getLockdownVerdict
}

/** The request read and its source found, or a refusal in words. */
async function duplicatePlanOf(
  firestore: Firestore,
  job: Pick<AiJob, 'hostId' | 'inputs'>,
  readRows: typeof readAiDuplicateSourceRows,
): Promise<(AiDuplicateResourceInput & { id: string }) | string> {
  if (!job.hostId) return AI_DUPLICATE_NO_SITE_COPY
  const request = aiDuplicateRequestOf(job.inputs)
  if (typeof request === 'string') return request
  const found = aiDuplicateSourceId(request.kind, request.sourceId, await readRows(firestore, job.hostId, request.kind))
  if ('error' in found) return found.error
  return { ...request, id: found.id }
}

export function createAiJobDuplicateStep(deps: AiJobDuplicateStepDeps = {}): AiJobStepRunner {
  const duplicate = deps.duplicate ?? duplicateResource
  const readRows = deps.readRows ?? readAiDuplicateSourceRows
  return async ({ job, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    // No model is asked: the outcome records the edit step's at no cost.
    const model = modelFor?.('job.edit') ?? aiJobEditModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const hostId = job.hostId
    if (!hostId) return unspent(AI_DUPLICATE_NO_SITE_COPY)
    const plan = await duplicatePlanOf(firestore, job, readRows)
    if (typeof plan === 'string') return unspent(plan)
    const orgData = (org ?? ((await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null)) as Record<string, unknown> | null
    const host = await firestore.collection('hosts').doc(hostId).get()
    const refused = await aiDuplicateAccessRefusal({ host, uid: job.createdBy, org: orgData }, { lockdown: deps.lockdown })
    if (refused) return aiUnspentOutcome(model, { review: aiLimitReview(refused) })
    const result = await duplicate(plan.kind, {
      orgId: job.orgId,
      hostId,
      sourceId: plan.id,
      name: plan.name,
      uid: job.createdBy,
      email: null,
      org: orgData,
      attemptKey: aiDuplicateAttemptKey(job),
    })
    if (result.ok === false) {
      // A plan counter or a feature the plan lacks is a limit to relay, not a fault.
      return result.status === 403 ? aiUnspentOutcome(model, { review: aiLimitReview(result.error) }) : unspent(result.error)
    }
    const output: AiJobOutput = {
      resource: AI_DUPLICATE_OUTPUT_RESOURCES[plan.kind],
      id: result.id,
      versionId: result.versionId,
      hostId,
      hostSubdomain: (typeof host.get('subdomain') === 'string' && host.get('subdomain')) || null,
      label: result.name,
      note: aiDuplicateOutputNote(plan.kind),
    }
    return aiUnspentOutcome(model, { outputs: [output] })
  }
}

export const runAiJobDuplicateStep = createAiJobDuplicateStep()

// ── Admission ─────────────────────────────────────────────────────────────

export interface AiDuplicateJobAdmissionDeps {
  ownerOf?: typeof resolveOrgIdForHost
  readRows?: typeof readAiDuplicateSourceRows
  lockdown?: typeof getLockdownVerdict
}

/**
 * A copy is admitted on a site of the job's own org, for a member who may
 * write its content now, of a source the site holds. Refused in those words
 * before anything exists; what the plan's counters allow is the copy's own
 * transaction to say.
 */
export function createAiDuplicateJobAdmission(deps: AiDuplicateJobAdmissionDeps = {}): AiJobAdmission {
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  const readRows = deps.readRows ?? readAiDuplicateSourceRows
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    if (!context.hostId) return { status: 400, error: AI_DUPLICATE_NO_SITE_COPY }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const host = await context.firestore.collection('hosts').doc(context.hostId).get()
    const refused = await aiDuplicateAccessRefusal({ host, uid: context.uid ?? '', org: context.org }, { lockdown: deps.lockdown })
    if (refused) return { status: 403, error: refused }
    const plan = await duplicatePlanOf(context.firestore as Firestore, { hostId: context.hostId, inputs: context.inputs as Record<string, unknown> }, readRows)
    return typeof plan === 'string' ? { status: 400, error: plan } : null
  }
}

export const aiDuplicateJobAdmission = createAiDuplicateJobAdmission()

/** Registers the duplicate step and its door (AGL-3740). */
export function registerAiDuplicateJob(): void {
  registerAiJobStep(AI_DUPLICATE_KIND, runAiJobDuplicateStep, { minimumMs: AI_JOB_DUPLICATE_STEP_MINIMUM_MS })
  registerAiJobAdmission(AI_DUPLICATE_KIND, aiDuplicateJobAdmission)
}
