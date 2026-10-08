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

/*==========================================
 * TASKS ON THE TRANSFER FRAMEWORK (AGL-3528) — the server half of
 * `crm.tasks`.
 *
 * A task's subject, its Type, Priority and Status as the org's lists label
 * them, its due date, its assignee, and the contact, company and deal it is
 * for — each a lookup: a contact by email, a company by domain or name, a
 * deal by its external id or its title. A row matches its task by Aglyn ID
 * or by the external id another product gave it, so a file imported twice
 * updates its tasks rather than doubling them.
 *
 * Written the way the tasks import route wrote them: the importing site's
 * scope stamp, the meaning and the label of each list value together, the
 * list's search keys, and a task marked done stamped with when and by whom.
 *=========================================*/

import {
  CRM_COLLECTIONS,
  CRM_TASK_PICKLIST_IDS,
  type ContactFieldDefinition,
  type CrmTaskPicklists,
  crmTaskLabelsForNew,
  crmTaskListFields,
  crmTaskPicklistLabels,
  resolveCrmSemanticPicklistWrite,
} from '@aglyn/aglyn/server'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  buildTransferPlan,
  planTransferUndo,
  TRANSFER_ID_FIELD,
  transferLookupNewName,
  type PlannedTransferRow,
  type TransferRowResult,
  type TransferUndoEntry,
  type TransferUndoStep,
} from '@aglyn/aglyn/data-transfer'
import type { TransferRecordsHooks } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { restampCrmListFieldsOf } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { readCrmTaskPicklists } from '../server/read-picklist'
import { TASK_ALIASES } from './aliases'
import {
  addCrmPicklistValues,
  countCrmExport,
  creationScope,
  crmMemberEmails,
  crmMembersTarget,
  crmPicklistLists,
  crmRecordsRoom,
  crmTransferEnv,
  type CrmTransferEnv,
  eachWithinBudget,
  failureMessage,
  isoOf,
  lookupByField,
  lookupById,
  lookupResult,
  pickValues,
  plannedValues,
  readCrmExportPage,
  requireCrmRecords,
  requireCrmSuite,
  requireSite,
  textOf,
  TransferEngineError,
  visibleIn,
} from './common'
import { companyForName } from './companies'
import {
  CRM_MEMBERS_TARGET,
  CRM_TIMESTAMP_FIELDS,
  TASK_TRANSFER_DERIVED,
  TASK_TRANSFER_FIELDS,
  TASK_TRANSFER_GROUPS,
} from './fields'

const SUITE_ACT = 'Importing tasks'
const NO_CUSTOM: readonly ContactFieldDefinition[] = []

const tasksOf = (env: CrmTransferEnv) => env.orgRef.collection(CRM_COLLECTIONS.tasks)

/** Names the export writes in place of the ids a task links by. */
interface TaskNames {
  assignee?: (uid: string) => string | undefined
  contact?: (id: string) => string | undefined
  company?: (id: string) => string | undefined
  deal?: (id: string) => string | undefined
}

/** One task as values by field id; links by id unless `names` names them. */
export function taskTransferValues(
  id: string,
  task: Record<string, unknown>,
  lists: CrmTaskPicklists,
  names: TaskNames = {},
): Record<string, unknown> {
  const text = (value: unknown) => textOf(value) || null
  const link = (value: unknown, resolve?: (id: string) => string | undefined) => {
    const linked = text(value)
    return linked ? (resolve?.(linked) ?? linked) : null
  }
  const labels = crmTaskPicklistLabels(task, lists)
  return {
    title: text(task['title']),
    externalId: text(task['externalId']),
    type: labels.type || null,
    priority: labels.priority || null,
    status: labels.status || null,
    dueAt: isoOf(task['dueAtMs']),
    completedAt: isoOf(task['completedAtMs']),
    assignee: link(task['assigneeUid'], names.assignee),
    contact: link(task['contactId'], names.contact),
    company: link(task['companyId'], names.company),
    deal: link(task['dealId'], names.deal),
    notes: text(task['notes']),
    createdAt: isoOf(task['createdAt']),
    updatedAt: isoOf(task['updatedAt']),
    [TRANSFER_ID_FIELD]: id,
  }
}

/** The tasks these ids name, as values. */
async function readTasks(env: CrmTransferEnv, ids: readonly string[], lists: CrmTaskPicklists) {
  const out = new Map<string, Record<string, unknown>>()
  const wanted = ids.filter((id) => id && !id.includes('/'))
  for (let at = 0; at < wanted.length; at += 500) {
    for (const snapshot of await env.firestore.getAll(...wanted.slice(at, at + 500).map((id) => tasksOf(env).doc(id)))) {
      const data = snapshot.data()
      if (snapshot.exists && data && visibleIn(env, data['visibleTo'])) out.set(snapshot.id, taskTransferValues(snapshot.id, data, lists))
    }
  }
  return out
}

/** Reads `field` of each linked record by id, for an export's names. */
async function namesOf(
  env: CrmTransferEnv,
  collection: string,
  ids: Iterable<string>,
  field: (data: Record<string, unknown>) => string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Set(ids)].filter((id) => id && !id.includes('/'))
  for (let at = 0; at < wanted.length; at += 500) {
    const refs = wanted.slice(at, at + 500).map((id) => env.orgRef.collection(collection).doc(id))
    for (const snapshot of await env.firestore.getAll(...refs)) {
      if (snapshot.exists) out.set(snapshot.id, field(snapshot.data() ?? {}))
    }
  }
  return out
}

/** Everything one apply call shares. */
interface ApplyRun {
  env: CrmTransferEnv
  actorUid: string | null
  lists: CrmTaskPicklists
  companies: Map<string, Promise<{ id: string; name: string } | null>>
  admit: () => Promise<boolean>
}

/** A linked record this site sees, by id, or the refusal naming it. */
async function linked(run: ApplyRun, collection: string, value: unknown, what: string): Promise<string | null> {
  const id = textOf(value)
  if (!id) return null
  const snapshot = await run.env.orgRef.collection(collection).doc(id).get()
  if (!snapshot.exists || !visibleIn(run.env, snapshot.get('visibleTo'))) {
    throw new TransferEngineError('notFound', 404, `The ${what} this row names no longer exists.`)
  }
  return snapshot.id
}

/** The fields a row's values write, over the task as it stands; `null` clears. */
async function taskFields(
  run: ApplyRun,
  values: Readonly<Record<string, unknown>>,
  current: Record<string, unknown>,
  actorUid: string | null,
): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {}
  if ('title' in values) {
    const title = textOf(values['title']).slice(0, 200)
    if (!title) throw new TransferEngineError('invalid', 422, 'A task needs a subject.')
    fields['title'] = title
  }
  if ('externalId' in values) fields['externalId'] = textOf(values['externalId']).slice(0, 200) || null
  const semantic = [
    ['type', 'kind', 'typeLabel', CRM_TASK_PICKLIST_IDS.type, run.lists.type],
    ['priority', 'priority', 'priorityLabel', CRM_TASK_PICKLIST_IDS.priority, run.lists.priority],
    ['status', 'status', 'statusLabel', CRM_TASK_PICKLIST_IDS.status, run.lists.status],
  ] as const
  for (const [fieldId, meaningField, labelField, picklistId, list] of semantic) {
    if (!(fieldId in values)) continue
    const write = resolveCrmSemanticPicklistWrite(picklistId, list, values[fieldId], current[labelField])
    if (!write) continue
    if (write.ok === false) throw new TransferEngineError('invalid', 422, write.error)
    fields[meaningField] = write.meaning
    fields[labelField] = write.label
  }
  // Done is a moment: a task the file closes is stamped, one it reopens unstamped.
  if (fields['status'] !== undefined && fields['status'] !== current['status']) {
    const done = fields['status'] === 'done'
    fields['completedAtMs'] = done ? Date.now() : null
    fields['completedByUid'] = done ? actorUid : null
  }
  if ('dueAt' in values) {
    const ms = values['dueAt'] ? Date.parse(String(values['dueAt'])) : NaN
    fields['dueAtMs'] = Number.isFinite(ms) ? ms : null
  }
  if ('assignee' in values) fields['assigneeUid'] = textOf(values['assignee']) || null
  if ('contact' in values) fields['contactId'] = await linked(run, 'contacts', values['contact'], 'contact')
  if ('deal' in values) fields['dealId'] = await linked(run, CRM_COLLECTIONS.deals, values['deal'], 'deal')
  if ('company' in values) {
    const create = transferLookupNewName(values['company'])
    if (create) {
      const company = await companyForName(run.env, create, run.actorUid, run.companies, run.admit)
      if (!company) throw new TransferEngineError('invalid', 422, 'The CRM records limit has no room for the company.')
      fields['companyId'] = company.id
    } else {
      fields['companyId'] = await linked(run, CRM_COLLECTIONS.companies, values['company'], 'company')
    }
  }
  if ('notes' in values) fields['notes'] = textOf(values['notes']).slice(0, 4000)
  return fields
}

const asUpdate = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === null ? FieldValue.delete() : value]))

/** The `crm.tasks` hooks. */
export function tasksTransferResource(): TransferRecordsHooks {
  return {
    fields: () => ({
      standard: TASK_TRANSFER_FIELDS,
      derived: TASK_TRANSFER_DERIVED,
      system: CRM_TIMESTAMP_FIELDS,
      groups: TASK_TRANSFER_GROUPS,
    }),
    matchKeys: [
      { fieldId: TRANSFER_ID_FIELD, normalizer: 'aglynId' },
      { fieldId: 'externalId', normalizer: 'externalId' },
    ],
    aliases: TASK_ALIASES,
    lookupTargets: { [CRM_MEMBERS_TARGET]: crmMembersTarget() },

    async count(ctx, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'tasks')
      return countCrmExport(env, tasksOf(env), options, (data) => visibleIn(env, data['visibleTo'], options.scopeTokens))
    },

    async readPage(ctx, cursor, fieldIds, options) {
      const env = await crmTransferEnv(ctx)
      requireCrmRecords(env, 'tasks')
      const lists = await readCrmTaskPicklists(env.firestore, env.orgId)
      const emails = fieldIds.includes('assignee') ? await crmMemberEmails(env.orgId) : new Map<string, string>()
      return readCrmExportPage(
        env,
        tasksOf(env),
        cursor,
        options,
        (data) => visibleIn(env, data['visibleTo'], options?.scopeTokens),
        async (docs) => {
          const ids = (field: string) => docs.map((doc) => textOf(doc.data[field])).filter(Boolean)
          const [contacts, companies, deals] = await Promise.all([
            fieldIds.includes('contact') ? namesOf(env, 'contacts', ids('contactId'), (data) => textOf(data['email'])) : new Map<string, string>(),
            fieldIds.includes('company') ? namesOf(env, CRM_COLLECTIONS.companies, ids('companyId'), (data) => textOf(data['name'])) : new Map<string, string>(),
            fieldIds.includes('deal')
              ? namesOf(env, CRM_COLLECTIONS.deals, ids('dealId'), (data) => textOf(data['externalId']) || textOf(data['title']))
              : new Map<string, string>(),
          ])
          const names: TaskNames = {
            assignee: (uid) => emails.get(uid),
            contact: (id) => contacts.get(id) || undefined,
            company: (id) => companies.get(id) || undefined,
            deal: (id) => deals.get(id) || undefined,
          }
          return docs.map((doc) => pickValues(taskTransferValues(doc.id, doc.data, lists, names), fieldIds))
        },
      )
    },

    async lookup(ctx, requests) {
      const env = await crmTransferEnv(ctx)
      const lists = await readCrmTaskPicklists(env.firestore, env.orgId)
      const visible = (data: Record<string, unknown>) => visibleIn(env, data['visibleTo'])
      const found = { lookup: new Map<string, string[]>(), docs: new Map<string, Record<string, unknown>>() }
      for (const request of requests) {
        if (request.fieldId === TRANSFER_ID_FIELD) await lookupById(env, tasksOf(env), request, visible, found)
        else if (request.fieldId === 'externalId') {
          await lookupByField(tasksOf(env), request, 'externalId', (value) => value.trim(), visible, found)
        }
      }
      return lookupResult(found, (id, data) => taskTransferValues(id, data, lists))
    },

    async picklists(ctx, ids) {
      return crmPicklistLists(await crmTransferEnv(ctx), ids, NO_CUSTOM)
    },

    async addPicklistValues(ctx, picklistId, values) {
      await addCrmPicklistValues(await crmTransferEnv(ctx), picklistId, values)
    },

    lockedRules: () => [],

    async plan(ctx, input) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, SUITE_ACT)
      requireSite(env, 'tasks')
      return buildTransferPlan(input)
    },

    async apply(ctx, chunk, writer) {
      const env = await crmTransferEnv(ctx)
      requireCrmSuite(env, SUITE_ACT)
      requireSite(env, 'tasks')
      const run: ApplyRun = {
        env,
        actorUid: ctx.actorUid,
        lists: await readCrmTaskPicklists(env.firestore, env.orgId),
        companies: new Map(),
        admit: crmRecordsRoom(env),
      }
      const results: TransferRowResult[] = []
      const undo: TransferUndoEntry[] = []
      await eachWithinBudget(chunk.rows as PlannedTransferRow[], () => writer.timeLeftMs(), async (row) => {
        const earlier = await writer.alreadyApplied(row.index)
        if (earlier) {
          results.push(earlier)
          return
        }
        const changed = row.diff.map((change) => change.fieldId)
        let result: TransferRowResult
        let entry: TransferUndoEntry | undefined
        try {
          const values = plannedValues(row)
          if (row.verdict === 'update' && row.recordId) {
            const ref = tasksOf(env).doc(row.recordId)
            const current = (await ref.get()).data()
            if (!current || !visibleIn(env, current['visibleTo'])) throw new TransferEngineError('notFound', 404, 'That task no longer exists.')
            const before = taskTransferValues(ref.id, current, run.lists)
            const fields = await taskFields(run, values, current, ctx.actorUid)
            await ref.update({
              ...asUpdate(fields),
              ...crmTaskListFields({ ...current, ...fields }),
              updatedAt: FieldValue.serverTimestamp(),
            })
            const after = (await readTasks(env, [ref.id], run.lists)).get(ref.id) ?? {}
            result = { row: row.index, outcome: 'updated', recordId: ref.id }
            entry = { row: row.index, recordId: ref.id, action: 'updated', previous: pickValues(before, changed), written: pickValues(after, changed) }
          } else {
            const fields = await taskFields(run, values, {}, ctx.actorUid)
            const kind = (fields['kind'] as 'call' | 'email' | 'meeting' | 'todo' | undefined) ?? 'todo'
            const priority = (fields['priority'] as 'low' | 'normal' | 'high' | undefined) ?? 'normal'
            const status = (fields['status'] as 'open' | 'done' | undefined) ?? 'open'
            const labels = crmTaskLabelsForNew(run.lists, { kind, priority, status })
            const scope = creationScope(env, ctx.actorUid)
            const stored = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined))
            const ref = tasksOf(env).doc(createResourceUid())
            await ref.set({
              kind,
              priority,
              status,
              ...labels,
              dueAtMs: null,
              notes: '',
              completedAtMs: status === 'done' ? Date.now() : null,
              ...(status === 'done' && ctx.actorUid ? { completedByUid: ctx.actorUid } : {}),
              ...stored,
              ...scope,
              // What the Tasks list searches and sorts by (AGL-3321, AGL-3680).
              ...crmTaskListFields({
                title: stored['title'],
                priority: stored['priority'] ?? priority,
                visibleTo: scope['visibleTo'],
              }),
            })
            const after = (await readTasks(env, [ref.id], run.lists)).get(ref.id) ?? {}
            result = { row: row.index, outcome: 'created', recordId: ref.id }
            entry = { row: row.index, recordId: ref.id, action: 'created', written: pickValues(after, changed) }
          }
        } catch (error) {
          result = { row: row.index, outcome: 'failed', ...(row.recordId ? { recordId: row.recordId } : {}), message: failureMessage(error) }
          entry = undefined
        }
        await writer.markApplied(result, entry)
        results.push(result)
        if (entry) undo.push(entry)
      })
      return { results, undo }
    },

    async revert(ctx, snapshot, decisions) {
      const env = await crmTransferEnv(ctx)
      const run: ApplyRun = {
        env,
        actorUid: ctx.actorUid,
        lists: await readCrmTaskPicklists(env.firestore, env.orgId),
        companies: new Map(),
        admit: crmRecordsRoom(env),
      }
      const current = await readTasks(env, snapshot.entries.map((entry) => entry.recordId), run.lists)
      const done: TransferUndoStep[] = []
      const conflicts: TransferUndoStep[] = []
      const touched: FirebaseFirestore.DocumentReference[] = []
      for (const entry of snapshot.entries) {
        const step = planTransferUndo(entry, current.get(entry.recordId) ?? null)
        if (step.action === 'conflict' && decisions?.[entry.recordId] !== 'revert') {
          if (decisions?.[entry.recordId] === 'keep') done.push({ action: 'nothing', recordId: entry.recordId, why: 'alreadyReverted' })
          else conflicts.push(step)
          continue
        }
        if (step.action === 'nothing') {
          done.push(step)
          continue
        }
        const ref = tasksOf(env).doc(entry.recordId)
        if (entry.action === 'created') {
          await ref.delete()
          done.push({ action: 'delete', recordId: entry.recordId })
          continue
        }
        const stored = (await ref.get()).data() ?? {}
        const values = step.action === 'restore' || step.action === 'conflict' ? step.values : {}
        const fields = await taskFields(run, values, stored, ctx.actorUid)
        await ref.update({ ...asUpdate(fields), ...crmTaskListFields({ ...stored, ...fields }), updatedAt: FieldValue.serverTimestamp() })
        touched.push(ref)
        done.push(step)
      }
      if (touched.length) await restampCrmListFieldsOf(touched, 'crmTasks').catch(() => undefined)
      return { done, conflicts }
    },
  }
}

