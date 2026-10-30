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
import { holdsSiteKey } from '@aglyn/aglyn/app-utils/host-permissions'
import { orgPermissionLabel } from '@aglyn/aglyn/app-utils/org-permissions'
import { decodeStoredNodes, encodeStoredNodes } from '@aglyn/aglyn/app-utils/stored-nodes'
import { getLockdownVerdict } from '@aglyn/tenant-data-admin/server/lockdown'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import type { Firestore } from 'firebase-admin/firestore'
import { AI_EDIT_GONE_COPY, AI_EDIT_NEEDS_VERSIONING_COPY, AI_EDIT_NO_NODES_COPY, AI_EDIT_VERSION_GONE_COPY } from '../model/ai-edit-job'
import { isAiPlanNewRef } from '../model/ai-build-plan'
import { AI_BUILD_MADE_INPUT, type AiBuildMade } from '../model/ai-build-job'
import { aiBuildStoreLayoutOf } from '../model/ai-build-store-pages'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import {
  aiLayoutWithMenuChanges,
  aiMenuChangesEmpty,
  aiMenuChangesOf,
  aiMenusOf,
  type AiMenuChanges,
  type AiMenuName,
  type AiMenuTarget,
} from '../model/ai-layout-menus'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiOriginJobId } from './ai-job-draft-ids'
import { aiEditPlacement, aiEditVersionId, aiJobEditModel, readAiEditTarget } from './ai-job-edit-step'
import { aiLimitReview, aiUnspentOutcome } from './ai-job-generation'
import type { AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'

/**
 * The `navigation` step (AGL-3728): a change to a site's header or footer
 * menu — add, take out, rename, relink or reorder its items — as a
 * first-class build operation, so Assist's one plan card can say "add About
 * and Pricing to the menu, and take Blog out" and have it done.
 *
 * NO MODEL. The planner already wrote the change as the item's arguments, in
 * words (`aiMenuChangesOf`); this applies it to the layout's own Besigner
 * elements in code (`aiLayoutWithMenuChanges`), so it costs no credits and
 * cannot invent a link: every destination is one of the site's pages, a page
 * this build made, a path on the site or an https address.
 *
 * ── Where it lands ───────────────────────────────────────────────────────
 *
 * As the `edit` step's change to a layout does: a NEW version beside the
 * layout's current one, which visitors keep seeing until a person publishes
 * the new one. A layout is always served, so without version history there is
 * nowhere for it to land and it is refused as a plan limit, charged nothing.
 * The version is named by the job's id, so a pass asked again finds what it
 * wrote.
 *
 * ── Who may ──────────────────────────────────────────────────────────────
 *
 * The editor's own rule for a layout's versions (`canWriteHostContent` and
 * `hostWritesFrozen` in the Firestore rules): a member with a write role on
 * the site (admin, editor or author), while no lockdown freezes the site, its
 * org or the platform. Asked at the door, again before the write, and the
 * role once more inside the transaction that writes.
 *
 * ── Audit ────────────────────────────────────────────────────────────────
 *
 * The layout it wrote is the job's output, which the job machine records as
 * an `ai.job.output` activity row on the site, as every other operation's is.
 */

export const AI_NAVIGATION_KIND = 'navigation' as const

/**
 * ASSUMED: the least time the step needs — the site's pages, the layout and
 * its version, the org, and the one transaction that writes. No model, so it
 * fits an inline door.
 */
export const AI_JOB_NAVIGATION_STEP_MINIMUM_MS = 5_000

export const AI_NAVIGATION_NO_SITE_COPY = 'Open the site whose menu should change.'
/** Names "Edit site content" (`site.edit`, AGL-4047), never a role. */
export const AI_NAVIGATION_ROLE_COPY = `Changing the site’s menus needs the "${orgPermissionLabel('site.edit')}" permission on this site — ask an organization admin.`
export const AI_NAVIGATION_LOCKED_COPY = 'This site is not accepting changes right now.'
export const AI_NAVIGATION_NO_LAYOUT_COPY = 'This site has no layout with a header or footer to change. Make one in Layouts first.'
export const AI_NAVIGATION_NOTHING_COPY = 'The request named no menu change this could make.'

/** The name the new version carries in the layout's versions. */
export const AI_NAVIGATION_VERSION_NAME = 'Menu changes'

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** A path on the site, as a menu item may link it. */
const SITE_PATH = /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*)?\/?(?:[?#][^\s]*)?$/
const SCREEN_ID = /^[A-Za-z0-9_-]{1,128}$/

function buildMadeOf(inputs: Readonly<Record<string, unknown>> | null | undefined): AiBuildMade {
  const raw = (inputs?.[AI_BUILD_MADE_INPUT] ?? {}) as Partial<Record<'pages' | 'layouts', unknown>>
  const rows = (value: unknown, name: 'title' | 'name') =>
    (Array.isArray(value) ? value : []).flatMap((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>
      return text(row[name]) && SCREEN_ID.test(text(row['id'])) ? [{ [name]: text(row[name]), id: text(row['id']) }] : []
    })
  return { pages: rows(raw.pages, 'title') as AiBuildMade['pages'], layouts: rows(raw.layouts, 'name') as AiBuildMade['layouts'] }
}

/** The site's pages a menu may link, by id, with the layout each renders inside. */
export interface AiNavigationSitePage {
  id: string
  title: string
  slug: string
  template: boolean
  layoutId: string | null
}

/** The site's pages: not deleted, not an email design. */
export async function readAiNavigationSitePages(firestore: Firestore, hostId: string): Promise<AiNavigationSitePage[]> {
  const snapshot = await firestore.collection('hosts').doc(hostId).collection('screens').select('displayName', 'slug', 'kind', 'deletedAt', 'layoutId').get()
  return snapshot.docs.flatMap((doc) => {
    const kind = doc.get('kind')
    if (doc.get('deletedAt') || (kind && kind !== 'template')) return []
    const layoutId = doc.get('layoutId')
    return [
      {
        id: doc.id,
        slug: String(doc.get('slug') ?? ''),
        title: String(doc.get('displayName') ?? ''),
        template: kind === 'template',
        layoutId: typeof layoutId === 'string' && layoutId ? layoutId : null,
      },
    ]
  })
}

/**
 * What a destination in an item's words links (AGL-3728): a page this build
 * made (`new:<title>`), one of the site's pages by id (`page:<id>` or the bare
 * id), a path on the site, or an https address; `null` for anything else.
 */
export function aiNavigationTarget(
  destination: string,
  context: { pages: readonly Pick<AiNavigationSitePage, 'id' | 'template'>[]; made: AiBuildMade },
): AiMenuTarget | null {
  const value = destination.trim()
  const pageIds = new Set(context.pages.filter((page) => !page.template).map((page) => page.id))
  if (isAiPlanNewRef(value as string | null)) {
    const title = value.slice(value.indexOf(':') + 1).trim().toLowerCase()
    const made = context.made.pages.find((page) => page.title.trim().toLowerCase() === title)
    // A page this build was to make and did not is no destination.
    return made && pageIds.has(made.id) ? { screenId: made.id } : null
  }
  const id = value.replace(/^page:/i, '')
  if (pageIds.has(id)) return { screenId: id }
  if (value.startsWith('/') && !value.startsWith('//') && SITE_PATH.test(value)) return { href: value }
  if (/^https:\/\/[^\s/?#]+\.[^\s/?#]+(?:[/?#]\S*)?$/i.test(value)) return { href: value }
  return null
}

/** The layout an item changes: the one it names, else the one the site's pages render inside. */
export function aiNavigationLayoutOf(
  named: string,
  context: { pages: readonly AiNavigationSitePage[]; made: AiBuildMade },
): string | null {
  if (isAiPlanNewRef(named as string | null)) {
    const name = named.slice(named.indexOf(':') + 1).trim().toLowerCase()
    return context.made.layouts.find((layout) => layout.name.trim().toLowerCase() === name)?.id ?? null
  }
  if (SCREEN_ID.test(named)) return named
  return aiBuildStoreLayoutOf(null, context.pages)
}

/** Why this member may not change this site's menus now, or `null`. */
export async function aiNavigationAccessRefusal(
  input: { host: FirebaseFirestore.DocumentSnapshot; uid: string; org: object | null },
  deps: { lockdown?: typeof getLockdownVerdict } = {},
): Promise<string | null> {
  if (!holdsSiteKey(input.host, input.uid, 'site.edit')) return AI_NAVIGATION_ROLE_COPY
  const locked = await (deps.lockdown ?? getLockdownVerdict)({
    staff: false,
    uid: input.uid,
    org: input.org as never,
    host: input.host.data() as never,
    intent: 'write',
  })
  return locked ? AI_NAVIGATION_LOCKED_COPY : null
}

/** The new version's output note: what was done, what was not, and that it waits to be published. */
export function aiNavigationOutputNote(done: readonly string[], notDone: readonly string[]): string {
  const did = done.length ? `${done.join(' ')} ` : ''
  const not = notDone.length ? ` Not done: ${notDone.join(' ')}` : ''
  return `${did}Saved as a new version of the layout beside the one visitors see: open it to review it, and publish it when it is ready.${not}`.slice(0, 1_000)
}

export type AiNavigationWrite =
  | { ok: true; versionId: string; done: string[]; notDone: string[] }
  | { ok: false; error: string }

/**
 * The change written, in one transaction that reads the layout as it is
 * stored NOW: it still exists, its version is still there, the member still
 * holds a write role, and the plan still keeps version history. The change is
 * applied again to that version's nodes, so a save made since is kept.
 */
export async function writeAiNavigation(
  firestore: Firestore,
  input: {
    hostId: string
    layoutId: string
    sourceVersionId: string
    versionId: string
    menus: readonly AiMenuName[]
    changes: AiMenuChanges
    uid: string
    aiJobId: string
    versioning: boolean
    now: Date
  },
): Promise<AiNavigationWrite> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const docRef = hostRef.collection('layouts').doc(input.layoutId)
  const sourceRef = docRef.collection('versions').doc(input.sourceVersionId)
  const newRef = docRef.collection('versions').doc(input.versionId)
  return firestore.runTransaction(async (tx): Promise<AiNavigationWrite> => {
    const [host, doc, source, already] = await Promise.all([tx.get(hostRef), tx.get(docRef), tx.get(sourceRef), tx.get(newRef)])
    if (already.exists) return { ok: true, versionId: input.versionId, done: [], notDone: [] }
    if (!doc.exists || doc.get('deletedAt') != null) return { ok: false, error: AI_EDIT_GONE_COPY }
    if (!source.exists) return { ok: false, error: AI_EDIT_VERSION_GONE_COPY }
    if (!holdsSiteKey(host, input.uid, 'site.edit')) return { ok: false, error: AI_NAVIGATION_ROLE_COPY }
    const pointer = text(doc.get('versionId')) || null
    const placement = aiEditPlacement({
      versioning: input.versioning,
      served: true,
      sourceIsPointer: pointer === input.sourceVersionId,
      sourceScheduled: false,
    })
    if (placement === 'refused') return { ok: false, error: AI_EDIT_NEEDS_VERSIONING_COPY }
    const nodes = decodeStoredNodes<Record<string, unknown>>(source.get('nodes'))
    if (!nodes) return { ok: false, error: AI_EDIT_NO_NODES_COPY }
    const applied = aiLayoutWithMenuChanges(nodes, input.menus, input.changes)
    if (!applied.nodes) return { ok: false, error: applied.notDone.join(' ') || AI_NAVIGATION_NOTHING_COPY }
    const packed = encodeStoredNodes(applied.nodes as never)
    if (!packed) return { ok: false, error: AI_EDIT_NO_NODES_COPY }
    // A copy of the version it started from — everything the editor stored —
    // with the changed menus, as the versions route copies one.
    const copy = { ...(source.data() as Record<string, unknown>) }
    delete copy['aiEditJobId']
    tx.create(newRef, {
      ...copy,
      nodes: Buffer.from(packed),
      displayName: AI_NAVIGATION_VERSION_NAME,
      createdAt: input.now,
      updatedAt: input.now,
      createdBy: input.uid,
      aiJobId: input.aiJobId,
    })
    return { ok: true, versionId: input.versionId, done: applied.done, notDone: applied.notDone }
  })
}

export interface AiJobNavigationStepDeps {
  readTarget?: typeof readAiEditTarget
  readPages?: typeof readAiNavigationSitePages
  write?: typeof writeAiNavigation
  lockdown?: typeof getLockdownVerdict
}

/** What the step decided before writing: the layout, its version, the change and what was read away. */
interface AiNavigationPlan {
  layoutId: string
  menus: AiMenuName[]
  changes: AiMenuChanges
  problems: string[]
}

async function navigationPlanOf(
  firestore: Firestore,
  job: Pick<AiJob, 'hostId' | 'inputs'>,
  readPages: typeof readAiNavigationSitePages,
): Promise<AiNavigationPlan | string> {
  if (!job.hostId) return AI_NAVIGATION_NO_SITE_COPY
  const inputs = job.inputs ?? {}
  const pages = await readPages(firestore, job.hostId)
  const made = buildMadeOf(inputs)
  const layoutId = aiNavigationLayoutOf(text(inputs['layout']), { pages, made })
  if (!layoutId) return AI_NAVIGATION_NO_LAYOUT_COPY
  const read = aiMenuChangesOf(inputs, (destination) => aiNavigationTarget(destination, { pages, made }))
  if (aiMenuChangesEmpty(read.changes)) return [AI_NAVIGATION_NOTHING_COPY, ...read.problems].join(' ')
  return { layoutId, menus: aiMenusOf(inputs['menu']), changes: read.changes, problems: read.problems }
}

export function createAiJobNavigationStep(deps: AiJobNavigationStepDeps = {}): AiJobStepRunner {
  const readTarget = deps.readTarget ?? readAiEditTarget
  const readPages = deps.readPages ?? readAiNavigationSitePages
  const write = deps.write ?? writeAiNavigation
  return async ({ job, now, firestore, org, modelFor }): Promise<AiJobStepOutcome> => {
    // No model is asked: the outcome records the edit step's at no cost.
    const model = modelFor?.('job.edit') ?? aiJobEditModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const hostId = job.hostId
    if (!hostId) return unspent(AI_NAVIGATION_NO_SITE_COPY)
    const plan = await navigationPlanOf(firestore, job, readPages)
    if (typeof plan === 'string') return unspent(plan)
    const versionId = aiEditVersionId(job)
    const read = await readTarget(firestore, {
      orgId: job.orgId,
      hostId,
      inputs: { target: plan.layoutId, targetKind: 'layout', versionId: null, newVersion: false },
      jobId: versionId,
    })
    if ('error' in read) return unspent(read.error)
    const output = (done: readonly string[], notDone: readonly string[]): AiJobOutput => ({
      resource: 'layout',
      id: read.id,
      versionId,
      hostId,
      hostSubdomain: read.hostSubdomain,
      label: read.name,
      note: aiNavigationOutputNote(done, notDone),
    })
    if (read.written) return aiUnspentOutcome(model, { outputs: [output([], [])] })
    const orgData = org ?? ((await firestore.collection('orgs').doc(job.orgId).get()).data() ?? null)
    const host = await firestore.collection('hosts').doc(hostId).get()
    const refused = await aiNavigationAccessRefusal({ host, uid: job.createdBy, org: orgData }, { lockdown: deps.lockdown })
    if (refused) return aiUnspentOutcome(model, { review: aiLimitReview(refused) })
    const versioning = checkEntitlement(orgData as never, 'versioning')
    const placement = aiEditPlacement({
      versioning,
      served: true,
      sourceIsPointer: read.sourceVersionId === read.pointerVersionId,
      sourceScheduled: read.scheduledVersionId === read.sourceVersionId,
    })
    if (placement === 'refused') return aiUnspentOutcome(model, { review: aiLimitReview(AI_EDIT_NEEDS_VERSIONING_COPY) })
    const written = await write(firestore, {
      hostId,
      layoutId: read.id,
      sourceVersionId: read.sourceVersionId,
      versionId,
      menus: plan.menus,
      changes: plan.changes,
      uid: job.createdBy,
      aiJobId: aiOriginJobId(job),
      versioning,
      now,
    })
    if (written.ok === false) return unspent(written.error)
    return aiUnspentOutcome(model, { outputs: [output(written.done, [...written.notDone, ...plan.problems])] })
  }
}

export const runAiJobNavigationStep = createAiJobNavigationStep()

// ── Admission ─────────────────────────────────────────────────────────────

export interface AiNavigationJobAdmissionDeps {
  ownerOf?: typeof resolveOrgIdForHost
  readTarget?: typeof readAiEditTarget
  readPages?: typeof readAiNavigationSitePages
  lockdown?: typeof getLockdownVerdict
}

/**
 * A navigation change is admitted on a site of the job's own org, for a
 * member who may write its content now, where the site has a layout and the
 * change has somewhere to land that no visitor sees on this plan. Refused in
 * those words before anything exists.
 */
export function createAiNavigationJobAdmission(deps: AiNavigationJobAdmissionDeps = {}): AiJobAdmission {
  const ownerOf = deps.ownerOf ?? resolveOrgIdForHost
  const readTarget = deps.readTarget ?? readAiEditTarget
  const readPages = deps.readPages ?? readAiNavigationSitePages
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    if (!context.hostId) return { status: 400, error: AI_NAVIGATION_NO_SITE_COPY }
    const owner = await ownerOf(context.hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const host = await context.firestore.collection('hosts').doc(context.hostId).get()
    const refused = await aiNavigationAccessRefusal({ host, uid: context.uid ?? '', org: context.org }, { lockdown: deps.lockdown })
    if (refused) return { status: 403, error: refused }
    const plan = await navigationPlanOf(context.firestore as Firestore, { hostId: context.hostId, inputs: context.inputs as Record<string, unknown> }, readPages)
    if (typeof plan === 'string') return { status: 400, error: plan }
    const read = await readTarget(context.firestore, {
      orgId: context.orgId,
      hostId: context.hostId,
      inputs: { target: plan.layoutId, targetKind: 'layout', versionId: null, newVersion: false },
      jobId: null,
    })
    if ('error' in read) return read
    const placement = aiEditPlacement({
      versioning: checkEntitlement(context.org as never, 'versioning'),
      served: true,
      sourceIsPointer: read.sourceVersionId === read.pointerVersionId,
      sourceScheduled: read.scheduledVersionId === read.sourceVersionId,
    })
    return placement === 'refused' ? { status: 403, error: AI_EDIT_NEEDS_VERSIONING_COPY } : null
  }
}

export const aiNavigationJobAdmission = createAiNavigationJobAdmission()

/** Registers the navigation step and its door (AGL-3728). */
export function registerAiNavigationJob(): void {
  registerAiJobStep(AI_NAVIGATION_KIND, runAiJobNavigationStep, { minimumMs: AI_JOB_NAVIGATION_STEP_MINIMUM_MS })
  registerAiJobAdmission(AI_NAVIGATION_KIND, aiNavigationJobAdmission)
}
