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

import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftContext,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import {
  EXPERIMENT_MAX_VARIANTS,
  validateExperiment,
  type ExperimentTarget,
  type HostExperiment,
} from '../model/experiments'
import {
  OVERLAY_LIST_CEILING,
  overlayDraftContentProblems,
  overlayDraftFromProposal,
  type OverlayCopyProposal,
} from '../model/overlay-drafts'

/**
 * The overlay and A/B test draft writers this plugin registers on the core's
 * resource-drafts seam (AGL-3616), for another plugin — an AI build turning a
 * request into a plan — to make one without importing this plugin.
 *
 * ## What a draft is here
 *
 * - **An overlay is written SWITCHED OFF** (`enabled: false`) at
 *   `hosts/{hostId}/overlays/{id}`: no visitor sees it until a member turns
 *   it on in the Overlays section. Its copy is held to the editor's limits
 *   and its trigger to the catalog the runtime opens a popup on; a link,
 *   pages, a schedule and an order are never written.
 * - **An A/B test is written STOPPED** (`status: 'draft'`) at
 *   `hosts/{hostId}/experiments/{id}`: assignment serves nothing for a test
 *   that is not running. Its variants are drafts of copy — an email's subject
 *   and body, a page's or section's name — and pin only versions that exist
 *   on the page under test; the published page stays every variant's default.
 *
 * Neither write changes what a published page serves, so neither drops the
 * site's cache the way an edit to a live overlay does.
 *
 * ## The owner's rules
 *
 * `refusal` holds the member's role on the site (one that writes its content)
 * and the plan's entitlement (`marketingOverlays`, `abTesting`), and for an
 * overlay the room in a site's list, which reads and reorders at most
 * {@link OVERLAY_LIST_CEILING}. `check` is pure. `write` replays a draft
 * already written under its id, asks `refusal` again before it writes, and
 * CREATES the document, so two writes racing for one id cannot both land.
 */

type Firestore = FirebaseFirestore.Firestore

/** The resource names the writers are registered under. */
export const OVERLAY_DRAFT_RESOURCE = 'overlay'
export const EXPERIMENT_DRAFT_RESOURCE = 'experiment'

const MARKETING_PLUGIN_ID = 'marketing'

export const OVERLAY_DRAFT_ROLE_REFUSAL = 'Editing this site requires the editor role'
export const OVERLAY_DRAFT_PLAN_REFUSAL =
  'Announcement bars and popups are not included on this workspace’s plan — see Billing to upgrade.'
export const OVERLAY_DRAFT_ROOM_REFUSAL =
  `This site already has ${OVERLAY_LIST_CEILING} overlays — delete the ones you have finished with first.`
export const EXPERIMENT_DRAFT_PLAN_REFUSAL =
  'A/B testing is not included on this workspace’s plan — see Billing to upgrade.'

export interface MarketingDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The site, and the member's role on it, or the refusal that stands in for them. */
async function siteFor(
  firestore: Firestore,
  context: Pick<PluginDraftContext, 'hostId' | 'uid' | 'orgId'>,
): Promise<{ host: FirebaseFirestore.DocumentSnapshot } | PluginDraftRefusal> {
  const host = await firestore.collection('hosts').doc(context.hostId).get()
  if (!host.exists || (context.orgId && host.get('orgId') && host.get('orgId') !== context.orgId)) {
    return { status: 404, error: 'Unknown site' }
  }
  const role = ((host.get('memberRoles') ?? {}) as Record<string, unknown>)[context.uid]
  if (!hostRoleCanWrite(role)) return { status: 403, error: OVERLAY_DRAFT_ROLE_REFUSAL }
  return { host }
}

const isRefusal = (value: object): value is PluginDraftRefusal => 'status' in value

function overlayRecord(snapshot: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  return {
    id: snapshot.id,
    name: str(snapshot.get('name')),
    versionId: null,
    facts: { kind: snapshot.get('kind') ?? null, enabled: snapshot.get('enabled') !== false },
  }
}

/** The overlay content as the writer documents it: a proposal's fields and its kind. */
function overlayProposal(content: Readonly<Record<string, unknown>>): OverlayCopyProposal {
  const proposal: OverlayCopyProposal = {}
  for (const field of ['name', 'text', 'headline', 'body', 'ctaLabel', 'trigger'] as const) {
    if (typeof content[field] === 'string') proposal[field] = content[field] as string
  }
  if (typeof content['triggerValue'] === 'number') proposal.triggerValue = content['triggerValue']
  return proposal
}

/**
 * The `overlay` writer. Content: `{ kind: 'bar' | 'popup', text?, headline?,
 * body?, ctaLabel?, trigger?, triggerValue? }` — a bar's text, a popup's
 * body, each within the overlay copy limits (`OVERLAY_COPY_LIMITS`).
 */
export function createOverlayDraftWriter(deps: MarketingDraftWriterDeps = {}): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  const refusal = async (context: PluginDraftContext): Promise<PluginDraftRefusal | null> => {
    const site = await siteFor(firestore(), context)
    if (isRefusal(site)) return site
    if (!checkEntitlement(context.org as never, 'marketingOverlays')) {
      return { status: 403, error: OVERLAY_DRAFT_PLAN_REFUSAL }
    }
    const count = await site.host.ref.collection('overlays').count().get()
    if (Number(count.data().count) >= OVERLAY_LIST_CEILING) {
      return { status: 409, error: OVERLAY_DRAFT_ROOM_REFUSAL }
    }
    return null
  }
  return {
    refusal,
    check: (content) => {
      const problems = overlayDraftContentProblems(content)
      return problems.length
        ? { ok: false, problems }
        : { ok: true, facts: { kind: content['kind'], enabled: false } }
    },
    read: async ({ hostId, id }) => {
      if (!isDocumentId(id)) return null
      const snapshot = await firestore().collection('hosts').doc(hostId).collection('overlays').doc(id).get()
      return snapshot.exists ? overlayRecord(snapshot) : null
    },
    write: async (request): Promise<PluginDraftWrite> => {
      if (!isDocumentId(request.id)) return { ok: false, status: 400, error: 'Invalid overlay id' }
      const problems = overlayDraftContentProblems(request.content)
      if (problems.length) return { ok: false, status: 400, error: problems[0] }
      const kind = request.content['kind'] as 'bar' | 'popup'
      const draft = overlayDraftFromProposal(kind, {
        ...overlayProposal(request.content),
        ...(str(request.name) ? { name: str(request.name) } : {}),
      })
      if (!draft) return { ok: false, status: 400, error: 'There was no copy to save' }
      const ref = firestore().collection('hosts').doc(request.hostId).collection('overlays').doc(request.id)
      const earlier = await ref.get()
      if (earlier.exists) return { ok: true, replayed: true, ...overlayRecord(earlier) }
      const refused = await refusal(request)
      if (refused) return { ok: false, ...refused }
      const name = draft.name ?? null
      await ref.create({
        ...draft,
        // The list orders on `name`, which every overlay carries, null or not.
        name,
        createdAt: request.now,
        updatedAt: request.now,
        createdBy: request.uid,
      })
      return {
        ok: true,
        replayed: false,
        id: request.id,
        name: name ?? '',
        versionId: null,
        facts: { kind, enabled: false },
      }
    },
  }
}

/** One variant as the writer documents it. */
interface ExperimentDraftVariant {
  name: string
  subject?: string
  body?: string
  versionId?: string
}

/** The experiment content, read and checked; problems instead when it is not one. */
export function readExperimentDraftContent(
  content: Readonly<Record<string, unknown>>,
  name: string,
): { ok: true; value: HostExperiment } | { ok: false; problems: string[] } {
  const target = content['target'] as ExperimentTarget
  const rawVariants = Array.isArray(content['variants']) ? content['variants'] : []
  const problems: string[] = []
  if (rawVariants.length > EXPERIMENT_MAX_VARIANTS) {
    problems.push(`Experiments are capped at ${EXPERIMENT_MAX_VARIANTS} variants`)
  }
  const variants = rawVariants.slice(0, EXPERIMENT_MAX_VARIANTS).map((raw, index) => {
    const variant = (raw ?? {}) as ExperimentDraftVariant
    const id = String.fromCharCode(97 + index)
    return {
      id,
      name: str(variant.name).slice(0, 80) || (index === 0 ? 'A (control)' : id.toUpperCase()),
      weight: 1,
      ...(target === 'email' && str(variant.subject) ? { subject: str(variant.subject).slice(0, 200) } : {}),
      ...(target === 'email' && str(variant.body) ? { body: str(variant.body).slice(0, 4_000) } : {}),
      ...(target !== 'email' && str(variant.versionId) ? { versionId: str(variant.versionId) } : {}),
    }
  })
  const goal = str(content['goal'])
  const value: HostExperiment = {
    name: str(name || content['name']).slice(0, 120),
    // STOPPED: assignment serves nothing for a test that is not running.
    status: 'draft',
    target,
    ...(str(content['screenId']) ? { screenId: str(content['screenId']) } : {}),
    ...(target === 'section' && str(content['nodeId']) ? { nodeId: str(content['nodeId']) } : {}),
    variants,
    goal: { event: goal || 'formSubmission' },
  }
  const invalid = validateExperiment(value)
  if (invalid) problems.push(invalid)
  if (variants.some((variant) => 'versionId' in variant && !isDocumentId(String(variant.versionId)))) {
    problems.push('A variant names a version that is not one')
  }
  return problems.length ? { ok: false, problems } : { ok: true, value }
}

function experimentRecord(snapshot: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  return {
    id: snapshot.id,
    name: str(snapshot.get('name')),
    versionId: null,
    facts: { status: snapshot.get('status') ?? null, target: snapshot.get('target') ?? null },
  }
}

/**
 * The `experiment` writer. Content: `{ target: 'screen' | 'section' | 'email',
 * screenId?, nodeId?, goal?, variants: [{ name, subject?, body?, versionId? }] }`,
 * two to four variants, the first the control.
 */
export function createExperimentDraftWriter(deps: MarketingDraftWriterDeps = {}): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  const refusal = async (context: PluginDraftContext): Promise<PluginDraftRefusal | null> => {
    const site = await siteFor(firestore(), context)
    if (isRefusal(site)) return site
    if (!checkEntitlement(context.org as never, 'abTesting')) {
      return { status: 403, error: EXPERIMENT_DRAFT_PLAN_REFUSAL }
    }
    return null
  }
  return {
    refusal,
    check: (content) => {
      const read = readExperimentDraftContent(content, str(content['name']) || 'A/B test')
      return read.ok === false
        ? read
        : { ok: true, facts: { status: 'draft', target: read.value.target, variants: read.value.variants.length } }
    },
    read: async ({ hostId, id }) => {
      if (!isDocumentId(id)) return null
      const snapshot = await firestore().collection('hosts').doc(hostId).collection('experiments').doc(id).get()
      return snapshot.exists ? experimentRecord(snapshot) : null
    },
    write: async (request): Promise<PluginDraftWrite> => {
      if (!isDocumentId(request.id)) return { ok: false, status: 400, error: 'Invalid experiment id' }
      const read = readExperimentDraftContent(request.content, request.name || 'A/B test')
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const hostRef = firestore().collection('hosts').doc(request.hostId)
      const ref = hostRef.collection('experiments').doc(request.id)
      const earlier = await ref.get()
      if (earlier.exists) return { ok: true, replayed: true, ...experimentRecord(earlier) }
      const refused = await refusal(request)
      if (refused) return { ok: false, ...refused }
      const { value } = read
      // A page under test, and every version a variant pins, exist on this site.
      if (value.screenId) {
        const screenRef = hostRef.collection('screens').doc(value.screenId)
        const screen = await screenRef.get()
        if (!screen.exists || screen.get('deletedAt')) {
          return { ok: false, status: 400, error: 'The page under test does not exist' }
        }
        for (const variant of value.variants) {
          if (!variant.versionId) continue
          const version = await screenRef.collection('versions').doc(variant.versionId).get()
          if (!version.exists || version.get('deletedAt')) {
            return { ok: false, status: 400, error: 'A variant pins a version the page does not have' }
          }
        }
      }
      await ref.create({
        ...value,
        createdAt: request.now,
        updatedAt: request.now,
        createdBy: request.uid,
      })
      return {
        ok: true,
        replayed: false,
        id: request.id,
        name: value.name,
        versionId: null,
        facts: { status: 'draft', target: value.target },
      }
    },
  }
}

/**
 * Registers both writers; the console surface calls it, since only the
 * console runs the AI builds that write through them. Idempotent.
 */
export function registerMarketingDraftWriters(deps: MarketingDraftWriterDeps = {}): void {
  registerPluginResourceDraftWriter(OVERLAY_DRAFT_RESOURCE, createOverlayDraftWriter(deps), {
    pluginId: MARKETING_PLUGIN_ID,
  })
  registerPluginResourceDraftWriter(EXPERIMENT_DRAFT_RESOURCE, createExperimentDraftWriter(deps), {
    pluginId: MARKETING_PLUGIN_ID,
  })
}
