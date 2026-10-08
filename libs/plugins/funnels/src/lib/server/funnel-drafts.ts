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
import {
  registerPluginResourceDraftWriter,
  type PluginDraftCheck,
  type PluginDraftContext,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID } from '../constants/bundle-common'
import { normalizeFunnelDefinition } from '../model/funnel-definition'
import { labelStepFromInventory, stepInventoryProblem } from '../model/funnel-inventory'
import {
  FUNNEL_FEATURE,
  FUNNEL_MANAGING_ROLES,
  FUNNELS_MAX_PER_SITE,
  isFunnelDraft,
  type FunnelDefinition,
} from '../model/funnels.types'
import { readFunnelInventory } from './funnel-inventory.server'

/**
 * A FUNNEL ANOTHER PLUGIN ASKS FOR (AGL-3616).
 *
 * The draft writer this plugin registers for the `funnel` resource on the
 * core's resource-drafts seam — what an AI build's `funnel` item is written
 * by. Every rule is the save door's (`funnels/save`), so a funnel made this
 * way is one a person could have saved:
 *
 *  - THE PLAN is the paid analytics tier ({@link FUNNEL_FEATURE}), read from
 *    the org the caller hands in; THE ROLE is a site admin or editor; THE
 *    ROOM is {@link FUNNELS_MAX_PER_SITE} funnels a site, drafts included —
 *    each refused in the save door's own words. (The save door also admits
 *    platform staff by their token's claim; a draft request carries a member,
 *    not a token, so a staff account without a role on the site is refused.)
 *  - THE CONTENT is a funnel definition — `{ name, steps }` — normalized as
 *    the save door normalizes it, and every step checked against the site's
 *    inventory at write time as the save door checks it: a page step names a
 *    path the site PUBLISHES, a form, service, product or overlay step a
 *    record the site HAS (a draft record made earlier in the same build is a
 *    document, and counts). Steps are labelled from the inventory the same way.
 *  - THE DOCUMENT is `hosts/{hostId}/funnels/{id}` in the save door's shape,
 *    under the caller's id, plus `status: 'draft'`. A second write under the
 *    same id answers the funnel it already wrote.
 *
 * DRAFTS CHANGE NOTHING LIVE. A funnel the save door saves switches the
 * site's visitor recording on; this writer never touches the host document.
 * A draft is not measured, not read by the AI insight figures and carries no
 * drop-off follow-up until a site admin or editor activates it on the
 * Funnels card (`funnels/activate`), which is the moment recording starts.
 *
 * A step a caller could not express carries `unresolved`: the sentence the
 * check refuses the content with (the `funnel` capability uses it for a
 * `new:<name>` its build did not make).
 */

type Firestore = any

/** The resource name this writer is registered under. */
export const FUNNEL_DRAFT_RESOURCE = 'funnel'

/** The save door's refusal for a member who may not change funnels. */
export const FUNNEL_ROLE_REFUSAL = 'Only a site admin or editor can change its funnels'
/** The save door's refusal for a plan without the analytics tier. */
export const FUNNEL_PLAN_REFUSAL =
  "Funnels come with per-page analytics, which this workspace's plan does not include"
/** The save door's refusal at the per-site cap. */
export const FUNNEL_ROOM_REFUSAL = `A site keeps up to ${FUNNELS_MAX_PER_SITE} funnels. Delete one to add another.`

/**
 * What a caller sends as `content`: the funnel as the save door takes it.
 * `steps` are `{ type, key, match?, label? }` (see `FunnelStep`); a step may
 * instead carry `unresolved`, a sentence saying why it could not be named.
 */
export interface FunnelDraftContent {
  name: string
  steps: Array<Record<string, unknown>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export type FunnelDraftContentRead =
  | { ok: true; funnel: FunnelDefinition }
  | { ok: false; problems: string[] }

/** The content as the writer stores it before the inventory check, or what stops it. Pure. */
export function readFunnelDraftContent(content: Readonly<Record<string, unknown>>): FunnelDraftContentRead {
  const steps = Array.isArray(content['steps']) ? (content['steps'] as unknown[]) : []
  const unresolved = steps.flatMap((step, index) =>
    isRecord(step) && typeof step['unresolved'] === 'string' && step['unresolved'].trim()
      ? [`Step ${index + 1}: ${step['unresolved'].trim()}`]
      : [],
  )
  if (unresolved.length) return { ok: false, problems: unresolved }
  const normalized = normalizeFunnelDefinition(content)
  if ('error' in normalized) return { ok: false, problems: [normalized.error] }
  return { ok: true, funnel: normalized.funnel }
}

function factsOf(funnel: FunnelDefinition, status: 'draft' | 'active' = 'draft') {
  return {
    status,
    steps: funnel.steps.length,
    stepTypes: funnel.steps.map((step) => step.type),
    // What a person reads: nothing is measured until the funnel is activated.
    recording: status === 'active',
  }
}

/** Whether content is a funnel this plugin would store, with what it says about it. Pure. */
export function checkFunnelDraftContent(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readFunnelDraftContent(content)
  if (read.ok === false) return read
  return { ok: true, facts: factsOf(read.funnel) }
}

function recordOf(snapshot: { id: string; data(): any }): PluginDraftRecord {
  const data = (snapshot.data() ?? {}) as Record<string, unknown>
  const normalized = normalizeFunnelDefinition(data)
  const funnel = 'funnel' in normalized ? normalized.funnel : { name: String(data['name'] ?? ''), steps: [] }
  return {
    id: snapshot.id,
    name: funnel.name,
    versionId: null,
    facts: factsOf(funnel, isFunnelDraft(data) ? 'draft' : 'active'),
  }
}

function roleRefusal(host: { get(field: string): unknown }, uid: string): PluginDraftRefusal | null {
  const role = ((host.get('memberRoles') ?? {}) as Record<string, unknown>)[uid]
  return FUNNEL_MANAGING_ROLES.has(String(role)) ? null : { status: 403, error: FUNNEL_ROLE_REFUSAL }
}

function planRefusal(org: PluginDraftContext['org']): PluginDraftRefusal | null {
  return checkEntitlement(org as never, FUNNEL_FEATURE) ? null : { status: 403, error: FUNNEL_PLAN_REFUSAL }
}

function roomRefusal(used: number): PluginDraftRefusal | null {
  return used >= FUNNELS_MAX_PER_SITE ? { status: 409, error: FUNNEL_ROOM_REFUSAL } : null
}

export interface FunnelDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

export function createFunnelDraftWriter(deps: FunnelDraftWriterDeps = {}): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore())
  const hostRef = (hostId: string) => firestore().collection('hosts').doc(hostId)
  // Spelled out (FUNNELS_COLLECTION) so the repo's host-collection sweeps find it.
  const funnelsRef = (hostId: string) => hostRef(hostId).collection('funnels')

  return {
    refusal: async (context) => {
      const host = await hostRef(context.hostId).get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      const early = roleRefusal(host, context.uid) ?? planRefusal(context.org)
      if (early) return early
      const used = (await funnelsRef(context.hostId).count().get()).data().count
      return roomRefusal(Number(used) || 0)
    },

    check: (content) => checkFunnelDraftContent(content),

    read: async ({ hostId, id }) => {
      const snapshot = await funnelsRef(hostId).doc(id).get()
      return snapshot.exists ? recordOf(snapshot) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      // The request's name is the one asked for; the content's stands in.
      const asked = String(request.name ?? '').trim()
      const read = readFunnelDraftContent(asked ? { ...request.content, name: asked } : request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const db = firestore()
      const site = hostRef(request.hostId)
      const collection = funnelsRef(request.hostId)
      const ref = collection.doc(request.id)

      // Asked again under the same id: the funnel it already wrote, whatever
      // the site holds now.
      const before = await ref.get()
      if (before.exists) return { ok: true, replayed: true, ...recordOf(before) }

      // The save door's step check, against what the site has right now.
      const inventory = await readFunnelInventory(db, request.hostId)
      for (const [index, step] of read.funnel.steps.entries()) {
        const problem = stepInventoryProblem(step, inventory)
        if (problem) return { ok: false, status: 400, error: `Step ${index + 1}: ${problem}` }
      }
      const steps = read.funnel.steps.map((step) => labelStepFromInventory(step, inventory))

      return db.runTransaction(async (tx: any): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const [host, existing] = await Promise.all([tx.get(site), tx.get(ref)])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        if (existing.exists) return { ok: true, replayed: true, ...recordOf(existing) }
        const early = roleRefusal(host, request.uid) ?? planRefusal(request.org)
        if (early) return { ok: false, ...early }
        const used = (await tx.get(collection.count())).data().count
        const room = roomRefusal(Number(used) || 0)
        if (room) return { ok: false, ...room }
        tx.create(ref, {
          name: read.funnel.name,
          steps,
          status: 'draft',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          createdBy: request.uid,
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name: read.funnel.name,
          versionId: null,
          facts: factsOf({ name: read.funnel.name, steps }),
        }
      })
    },
  }
}

export const funnelDraftWriter = createFunnelDraftWriter()

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs. Idempotent: a second call replaces the first.
 */
export function registerFunnelDraftWriter(): void {
  registerPluginResourceDraftWriter(FUNNEL_DRAFT_RESOURCE, funnelDraftWriter, { pluginId: BUNDLE_ID })
}
