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
import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type {
  PluginDraftCheck,
  PluginDraftContext,
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginDraftWrite,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  checkFunctionDraftContent,
  checkVariableDraftContent,
  functionDraftFacts,
  type LogicDraftRead,
  logicNameKey,
  readFunctionDraftContent,
  readVariableDraftContent,
  variableDraftFacts,
} from './logic-draft-content'

/**
 * A VARIABLE OR A FUNCTION ANOTHER PLUGIN ASKS FOR (AGL-3616).
 *
 * The draft writers this plugin registers for the `variable` and `function`
 * resources on the core's resource-drafts seam. An AI build that sets a site
 * up from a brief asks for one by name and gets this plugin's rules:
 *
 *  - THE DOCUMENT is the one the Variables and Functions cards create through
 *    `/api/hosts/resources`: the fields the plugin declares for the kind in
 *    `plugins.config.json`, stamped `createdAt`, `updatedAt` and `createdBy`.
 *    A variable is never computed here (`workflowId` and `workflowName` are
 *    empty, as the card writes a plain one).
 *  - THE ROLE is a member who may write the site's content, refused in the
 *    resources route's words. THE ROOM is `variablesPerHost` or
 *    `functionsPerHost`, counted as that route counts it — every document in
 *    the collection — inside the transaction that creates. Logic carries no
 *    plan feature of its own: the Free plan has three variables and one
 *    function.
 *  - THE NAME is held to the binding grammar (`logic-draft-content.ts`) and
 *    must be free: no LIVE record of the kind on the site carries it, compared
 *    case-insensitively as both cards compare it. A taken name is REFUSED,
 *    never overwritten and never renumbered — a binding names what it reads,
 *    so a variable quietly called `price_2` is one no page asked for.
 *
 * ## Draft by default, without a draft state
 *
 * Neither resource has one: a variable or a function is live the moment it
 * exists. It is still a draft in every sense the seam means, because a NEW,
 * UNREFERENCED variable or function changes nothing a visitor sees. A page
 * shows a variable only where a binding names its id (`{{var:id}}`) and runs
 * a function only where a token or a Function Widget names it, and nothing
 * names a document that did not exist a moment ago. What a person reviews is
 * the record itself, on the Logic page, before anything binds it.
 *
 * Asked again under the same id, the writer reports the record it already
 * wrote and writes nothing. Nothing is published, and the writer touches the
 * one new document.
 */

type Firestore = FirebaseFirestore.Firestore

/** The resources route's refusal for a member who may not write the site. */
export const LOGIC_DRAFT_ROLE_REFUSAL = 'Editing requires the editor role'

/** The resources route's refusal at the plan's allowance. */
export function logicDraftLimitRefusal(noun: 'variable' | 'function', limit: number): string {
  return `Your plan includes ${limit} ${limit === 1 ? noun : `${noun}s`} — upgrade in Billing for more`
}

/** The refusal for a name a live record of the kind already carries. */
export function logicDraftNameTaken(noun: 'variable' | 'function', name: string): string {
  return `This site already has a ${noun} named ${name}. Choose another name.`
}

/** How one kind differs from the other. */
interface LogicDraftKind<T extends { name: string }> {
  noun: 'variable' | 'function'
  collection: 'variables' | 'functions'
  quota: 'variablesPerHost' | 'functionsPerHost'
  read: (content: Readonly<Record<string, unknown>>) => LogicDraftRead<T>
  check: (content: Readonly<Record<string, unknown>>) => PluginDraftCheck
  facts: (document: Partial<T>) => Readonly<Record<string, unknown>>
}

export interface LogicDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

function roleRefusal(host: FirebaseFirestore.DocumentSnapshot, uid: string): PluginDraftRefusal | null {
  const role = (host.get('memberRoles') ?? {})[uid]
  return hostRoleCanWrite(role) ? null : { status: 403, error: LOGIC_DRAFT_ROLE_REFUSAL }
}

function createLogicDraftWriter<T extends { name: string }>(
  kind: LogicDraftKind<T>,
  deps: LogicDraftWriterDeps,
): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  const roomRefusal = (org: PluginDraftContext['org'], used: number): PluginDraftRefusal | null => {
    const quota = checkQuota(org as never, kind.quota, used)
    return quota.allowed ? null : { status: 403, error: logicDraftLimitRefusal(kind.noun, quota.limit) }
  }
  const recordOf = (snapshot: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord => {
    const data = (snapshot.data() ?? {}) as Partial<T>
    return { id: snapshot.id, name: String(data.name ?? ''), versionId: null, facts: kind.facts(data) }
  }
  return {
    refusal: async (context) => {
      const hostRef = firestore().collection('hosts').doc(context.hostId)
      const host = await hostRef.get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      const role = roleRefusal(host, context.uid)
      if (role) return role
      const used = (await hostRef.collection(kind.collection).count().get()).data().count
      return roomRefusal(context.org, Number(used) || 0)
    },

    check: (content) => kind.check(content),

    read: async ({ hostId, id }) => {
      const snapshot = await firestore().collection('hosts').doc(hostId).collection(kind.collection).doc(id).get()
      return snapshot.exists ? recordOf(snapshot) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      // The content's name is the one a binding reads; the request's stands
      // in only where the content carries none.
      const named = typeof request.content['name'] === 'string' && request.content['name'].trim()
      const read = kind.read(named ? request.content : { ...request.content, name: request.name })
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const document = read.value
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const records = hostRef.collection(kind.collection)
      const ref = records.doc(request.id)
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const [host, existing] = await Promise.all([tx.get(hostRef), tx.get(ref)])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        // Asked again under the same id: the record it already wrote.
        if (existing.exists) return { ok: true, replayed: true, ...recordOf(existing) }
        const role = roleRefusal(host, request.uid)
        if (role) return { ok: false, ...role }
        // One projected read answers both: the route counts every document
        // for the allowance, and the cards compare names among the live ones.
        const rows = (await tx.get(records.select('name', 'deletedAt'))).docs
        const room = roomRefusal(request.org, rows.length)
        if (room) return { ok: false, ...room }
        const key = logicNameKey(document.name)
        const taken = rows.some(
          (row) => row.get('deletedAt') == null && logicNameKey(String(row.get('name') ?? '')) === key,
        )
        if (taken) return { ok: false, status: 409, error: logicDraftNameTaken(kind.noun, document.name) }
        tx.create(ref, {
          ...document,
          createdAt: request.now,
          updatedAt: request.now,
          createdBy: request.uid,
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name: document.name,
          versionId: null,
          facts: kind.facts(document),
        }
      })
    },
  }
}

/** The `variable` writer. */
export function createVariableDraftWriter(deps: LogicDraftWriterDeps = {}): PluginResourceDraftWriter {
  return createLogicDraftWriter(
    {
      noun: 'variable',
      collection: 'variables',
      quota: 'variablesPerHost',
      read: readVariableDraftContent,
      check: checkVariableDraftContent,
      facts: variableDraftFacts,
    },
    deps,
  )
}

/** The `function` writer. */
export function createFunctionDraftWriter(deps: LogicDraftWriterDeps = {}): PluginResourceDraftWriter {
  return createLogicDraftWriter(
    {
      noun: 'function',
      collection: 'functions',
      quota: 'functionsPerHost',
      read: readFunctionDraftContent,
      check: checkFunctionDraftContent,
      facts: functionDraftFacts,
    },
    deps,
  )
}

export const variableDraftWriter = createVariableDraftWriter()
export const functionDraftWriter = createFunctionDraftWriter()
