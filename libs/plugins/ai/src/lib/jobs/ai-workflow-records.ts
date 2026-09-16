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

import type { HostAction } from '@aglyn/aglyn/app-utils/actions'
import { actionRunResult } from '@aglyn/aglyn/app-utils/activity-presenter'
import { datasetDisplayName } from '@aglyn/aglyn/app-utils/datasets'
import { isFormArchived } from '@aglyn/aglyn/app-utils/forms'
import type { HostWorkflow } from '@aglyn/aglyn/app-utils/workflows'
import { scopedToHost } from '@aglyn/tenant-data-admin/server/organizations'
import type {
  AiAutomationForm,
  AiAutomationNamedRecord,
  AiAutomationRecords,
} from '../model/ai-automation-draft'
import type { AiRunRecord } from '../model/ai-automation-outline'
import type { AiWorkflowTargetType } from '../model/ai-workflow-job'

/**
 * What a `workflow` job reads (AGL-2919), through the Admin SDK and scoped to
 * the job's own site and org: the records a drafted automation's words are
 * looked up among, the automation an explanation reads, and the run it
 * explains. Every read is a projection of the fields named here, windowed the
 * way the Actions editor's pickers are, so a lookup never reads more than the
 * editor would offer.
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
    !wanted('datasets')
      ? none
      : named(
          scopedToHost(org.collection('datasets'), input.hostId),
          ['displayName', 'name', 'deletedAt'],
          live,
          (data, id) => datasetDisplayName(data) || id,
        ),
    !wanted('lists') ? none : named(org.collection('lists'), ['name', 'deletedAt'], live, (data) => text(data['name'])),
    !wanted('campaigns')
      ? none
      : named(host.collection('emailCampaigns'), ['name', 'deletedAt'], live, (data) => text(data['name'])),
    !wanted('workflows')
      ? none
      : named(host.collection('workflows'), ['name', 'deletedAt'], live, (data) => text(data['name'])),
    !wanted('webhooks')
      ? none
      : named(
          host.collection('webhooks'),
          ['name', 'direction', 'deletedAt'],
          (data) => live(data) && data['direction'] === 'outbound',
          (data) => text(data['name']),
        ),
    input.crm && wanted('stages')
      ? scopedToHost(org.collection('pipelines'), input.hostId)
          .select('stages', 'archivedAt')
          .limit(AI_WORKFLOW_PIPELINES_WINDOW)
          .get()
          .then((snapshot) =>
            snapshot.docs
              .filter((doc) => !(Number(doc.get('archivedAt')) > 0))
              .flatMap((doc) => (Array.isArray(doc.get('stages')) ? (doc.get('stages') as Data[]) : []))
              .map((stage) => ({ id: text(stage?.['id']), name: text(stage?.['name']) }))
              .filter((stage) => stage.id && stage.name),
          )
      : none,
  ])
  return { forms, datasets, lists, campaigns, workflows, webhooks, stages }
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
  | { type: 'action'; id: string; name: string; action: HostAction }
  | { type: 'workflow'; id: string; name: string; workflow: HostWorkflow }

/** A saved automation of the site, or `null` for one that does not exist or was deleted. */
export async function readAiWorkflowTarget(
  firestore: Firestore,
  input: { hostId: string; type: AiWorkflowTargetType; id: string },
): Promise<AiWorkflowTarget | null> {
  const collection = input.type === 'action' ? 'actions' : 'workflows'
  const snapshot = await firestore.collection('hosts').doc(input.hostId).collection(collection).doc(input.id).get()
  const data = snapshot.exists ? ((snapshot.data() ?? {}) as Data) : null
  if (!data || data['deletedAt'] != null) return null
  const name = text(data['name']) || input.id
  return input.type === 'action'
    ? { type: 'action', id: snapshot.id, name, action: data as unknown as HostAction }
    : { type: 'workflow', id: snapshot.id, name, workflow: data as unknown as HostWorkflow }
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
