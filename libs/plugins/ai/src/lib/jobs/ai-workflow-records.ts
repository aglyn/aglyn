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

import { actionRunResult } from '@aglyn/aglyn/app-utils/activity-presenter'
import { isFormArchived } from '@aglyn/aglyn/app-utils/forms'
import {
  pluginRecordIndex,
  type PluginIndexedRecord,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { ORG_SCOPE_TOKEN, scopeCovers, visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { listOrgContainers } from '@aglyn/tenant-data-admin/server/org-containers'
import type {
  AiAutomationForm,
  AiAutomationNamedRecord,
  AiAutomationRecords,
} from '../model/ai-automation-draft'
import type { AiIndexedWorkflow, AiRunRecord } from '../model/ai-automation-outline'
import type { AiWorkflowTargetType } from '../model/ai-workflow-job'
import type { AiAutomation } from '../model/ai-automation-format'

/**
 * What a `workflow` job reads (AGL-2919), scoped to the job's own site and
 * org: the records a drafted automation's words are looked up among, the
 * automation an explanation reads, and the run it explains. Every read is
 * windowed the way the Actions editor's pickers are, so a lookup never reads
 * more than the editor would offer.
 *
 * The site's workflows, webhooks and saved actions are the workflows plugin's
 * records, and the org's datasets the data plugin's, so they are read through
 * the indexes those plugins publish (`workflow`, `webhook`, `action`,
 * `dataset` — AGL-3080), never from their collections: where no plugin keeps a
 * kind, there are none to name. The rest are read through the Admin SDK as
 * projections of the fields named here.
 */

type Firestore = FirebaseFirestore.Firestore
type Data = Record<string, unknown>

/** Records of one kind a lookup reads: the Actions editor's picker window. */
export const AI_WORKFLOW_RECORDS_WINDOW = 100

/** Pipelines a stage lookup reads. */
export const AI_WORKFLOW_PIPELINES_WINDOW = 20

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function named(
  query: FirebaseFirestore.Query,
  fields: string[],
  keep: (data: Data) => boolean,
  nameOf: (data: Data, id: string) => string,
): Promise<AiAutomationNamedRecord[]> {
  const snapshot = await query
    .select(...fields)
    .limit(AI_WORKFLOW_RECORDS_WINDOW)
    .get()
  return snapshot.docs
    .map((doc) => ({ data: (doc.data() ?? {}) as Data, id: doc.id }))
    .filter(({ data }) => keep(data))
    .map(({ data, id }) => ({ id, name: nameOf(data, id) }))
    .filter((record) => record.name)
}

const live = (data: Data) => data['deletedAt'] == null

/** The org's live campaigns placed on the site, named, in the editor's window. */
async function placedCampaigns(
  firestore: Firestore,
  orgId: string,
  hostId: string,
): Promise<AiAutomationNamedRecord[]> {
  const containers = await listOrgContainers(firestore, 'campaign', orgId, AI_WORKFLOW_RECORDS_WINDOW)
  return containers
    .filter((container) => container.live && container.name && visibleToHost(container.visibleTo, hostId))
    .map((container) => ({ id: container.id, name: container.name }))
}

/**
 * The live records of a kind another plugin keeps, through its index, in the
 * editor's window; none where no plugin keeps the kind here.
 */
async function indexed(
  kind: string,
  scope: { orgId?: string; hostId: string | null },
  keep: (record: PluginIndexedRecord) => boolean = () => true,
): Promise<AiAutomationNamedRecord[]> {
  const owner = pluginRecordIndex(kind)
  if (!owner) return []
  const { records } = await owner.index.list({ ...scope, limit: AI_WORKFLOW_RECORDS_WINDOW })
  return records.filter(keep).map(({ id, name }) => ({ id, name }))
}

/** The site's forms that are not archived, with the field names their submissions carry. */
async function readForms(host: FirebaseFirestore.DocumentReference): Promise<AiAutomationForm[]> {
  const snapshot = await host
    .collection('forms')
    .select('displayName', 'slug', 'fields', 'archivedAt')
    .limit(AI_WORKFLOW_RECORDS_WINDOW)
    .get()
  return snapshot.docs
    .filter((doc) => !isFormArchived((doc.data() ?? {}) as { archivedAt?: unknown }))
    .map((doc) => {
      const data = (doc.data() ?? {}) as Data
      return {
        id: doc.id,
        name: text(data['displayName']) || text(data['slug']) || doc.id,
        fields: (Array.isArray(data['fields']) ? (data['fields'] as Data[]) : [])
          .map((field) => text(field?.['fieldName']))
          .filter(Boolean),
      }
    })
}

/**
 * The site's records a drafted automation may name. Stages are read only for
 * a workspace with the CRM, whose pipelines they are; a site without it has
 * no stage a condition could name. `only`, when given, names the kinds to
 * read, and every other kind is answered empty without a read.
 */
export async function readAiAutomationRecords(
  firestore: Firestore,
  input: { orgId: string; hostId: string; crm: boolean; only?: ReadonlyArray<keyof AiAutomationRecords> },
): Promise<AiAutomationRecords> {
  const host = firestore.collection('hosts').doc(input.hostId)
  const org = firestore.collection('orgs').doc(input.orgId)
  const wanted = (kind: keyof AiAutomationRecords) => !input.only || input.only.includes(kind)
  const none = Promise.resolve([] as AiAutomationNamedRecord[])
  const [forms, datasets, lists, campaigns, workflows, webhooks, stages] = await Promise.all([
    !wanted('forms') ? Promise.resolve([] as AiAutomationForm[]) : readForms(host),
    // The org's datasets shared with this site, as the data plugin indexes them.
    !wanted('datasets') ? none : indexed('dataset', { orgId: input.orgId, hostId: input.hostId }),
    !wanted('lists') ? none : named(org.collection('lists'), ['name', 'deletedAt'], live, (data) => text(data['name'])),
    // The org's campaigns placed on this site: the set the automation's
    // `assignCampaign` step accepts when it runs here. Read as the `campaign`
    // container kind, where its declaration says the containers are stored.
    !wanted('campaigns') ? none : placedCampaigns(firestore, input.orgId, input.hostId),
    !wanted('workflows') ? none : indexed('workflow', { hostId: input.hostId }),
    // Only a webhook that posts OUT is a step's target; an inbound one is an
    // endpoint that runs a workflow.
    !wanted('webhooks')
      ? none
      : indexed('webhook', { hostId: input.hostId }, (record) => record.facts['direction'] === 'outbound'),
    input.crm && wanted('stages') ? readStages(input.orgId, input.hostId) : none,
  ])
  return { forms, datasets, lists, campaigns, workflows, webhooks, stages }
}

/**
 * The WORKSPACE's records an org automation may name (AGL-3603): its lists,
 * and, with the CRM, its pipelines' stages; and the live campaigns and the
 * datasets shared with every site. The draft opens placed on every site, so
 * it names only what every site can use — the rule the Org automations
 * editor's own pickers keep (`scopeCovers`); anything else stays a
 * placeholder the person picks once the sites are chosen. Forms, workflows
 * and webhooks are one site's each, and an org automation names none of
 * them, so none are read.
 */
/** The placement an org automation's draft opens on: every site. */
const EVERY_SITE: readonly string[] = [ORG_SCOPE_TOKEN]

export async function readAiOrgAutomationRecords(
  firestore: Firestore,
  input: { orgId: string; crm: boolean },
): Promise<AiAutomationRecords> {
  const org = firestore.collection('orgs').doc(input.orgId)
  const [datasets, lists, campaigns, stages] = await Promise.all([
    indexed('dataset', { orgId: input.orgId, hostId: null }, (record) =>
      scopeCovers(record.facts['visibleTo'] as string[] | undefined, EVERY_SITE),
    ),
    named(org.collection('lists'), ['name', 'deletedAt'], live, (data) => text(data['name'])),
    listOrgContainers(firestore, 'campaign', input.orgId, AI_WORKFLOW_RECORDS_WINDOW).then((containers) =>
      containers
        .filter((container) => container.live && container.name && scopeCovers(container.visibleTo, EVERY_SITE))
        .map((container) => ({ id: container.id, name: container.name })),
    ),
    input.crm ? readStages(input.orgId, null) : Promise.resolve([] as AiAutomationNamedRecord[]),
  ])
  return { forms: [], datasets, lists, campaigns, workflows: [], webhooks: [], stages }
}

/**
 * The stages of the pipelines the site can see, asked of the plugin that keeps
 * pipelines (its `pipeline` record index), never read from its collection. No
 * index means no plugin keeps pipelines in this process: no stage to name.
 */
async function readStages(orgId: string, hostId: string | null): Promise<AiAutomationNamedRecord[]> {
  const pipelines = pluginRecordIndex('pipeline')
  if (!pipelines) return []
  const { records } = await pipelines.index.list({ orgId, hostId, limit: AI_WORKFLOW_PIPELINES_WINDOW })
  return records
    .flatMap((record) => (Array.isArray(record.facts['stages']) ? (record.facts['stages'] as Data[]) : []))
    .map((stage) => ({ id: text(stage?.['id']), name: text(stage?.['name']) }))
    .filter((stage) => stage.id && stage.name)
}

/** The site's functions, for a workflow outline that says which of its calls still resolve. */
export async function readAiWorkflowFunctions(
  firestore: Firestore,
  hostId: string,
): Promise<AiAutomationNamedRecord[]> {
  return named(
    firestore.collection('hosts').doc(hostId).collection('functions'),
    ['name', 'deletedAt'],
    live,
    (data) => text(data['name']),
  )
}

export type AiWorkflowTarget =
  | { type: 'action'; id: string; name: string; action: AiAutomation }
  | { type: 'workflow'; id: string; name: string; workflow: AiIndexedWorkflow }

/**
 * A saved automation of the site, read through the index of the plugin that
 * keeps it, or `null` for one that does not exist, was deleted, or that no
 * plugin here keeps.
 */
export async function readAiWorkflowTarget(
  input: { hostId: string; type: AiWorkflowTargetType; id: string },
): Promise<AiWorkflowTarget | null> {
  const owner = pluginRecordIndex(input.type)
  const record = owner ? await owner.index.get({ hostId: input.hostId, id: input.id }) : null
  if (!record) return null
  const stored = { name: record.name, ...record.facts }
  return input.type === 'action'
    ? { type: 'action', id: record.id, name: record.name, action: stored as unknown as AiAutomation }
    : { type: 'workflow', id: record.id, name: record.name, workflow: stored as unknown as AiIndexedWorkflow }
}

export type AiWorkflowRunRead =
  | { ok: true; run: AiRunRecord }
  | { ok: false; reason: 'gone' | 'not-failed' }

/**
 * One run of an automation, as the site's activity log recorded it: gone when
 * there is no such entry or it belongs to another automation, and refused
 * when it did not fail. Only what the run history shows is read — never the
 * event's payload.
 */
export async function readAiWorkflowRun(
  firestore: Firestore,
  input: { hostId: string; targetId: string; runId: string },
): Promise<AiWorkflowRunRead> {
  const snapshot = await firestore
    .collection('hosts')
    .doc(input.hostId)
    .collection('activity')
    .doc(input.runId)
    .get()
  const data = snapshot.exists ? ((snapshot.data() ?? {}) as Data) : null
  const target = data?.['target'] as { id?: unknown } | undefined
  if (!data || target?.id !== input.targetId) return { ok: false, reason: 'gone' }
  const run: AiRunRecord = {
    result: data['result'],
    trigger: data['trigger'],
    summary: data['summary'],
    action: data['action'],
    createdAt: data['createdAt'],
  }
  return actionRunResult(run as never) === 'failed' ? { ok: true, run } : { ok: false, reason: 'not-failed' }
}
