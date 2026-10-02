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

import {
  checkQuota,
  datasetDisplayName,
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  describeDatasetRecordErrors,
  effectiveDatasetModel,
  ensureDeclaredCustomFieldTypes,
  prepareDatasetRecordWrite,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import type {
  ServerStepAnswer,
  ServerStepRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import {
  dataStorageRefusal,
  firebaseAdmin,
  orgDataCollectionForHost,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { DATASET_STEP_TYPES } from '../constants/bundle-common'
import { announceDatasetRecordChange } from './dataset-live-pages'
import { resolveDatasetDoc } from './resolve-dataset'

/**
 * THE TWO AUTOMATION STEPS THAT WRITE A DATASET RECORD (AGL-257, AGL-556,
 * AGL-2773), run for the automation engine through the platform's server-step
 * seam (`plugin-server-steps`, AGL-3080).
 *
 * `datasetAppend` adds a record; `updateDataset` merges into the record whose
 * `email` field equals the event's email and appends when none does. Both read
 * the event's fields that match a field of the dataset, held to its model.
 *
 * The engine runs the step's guard and keeps the run's history; this answers
 * what the step did. A refusal is ANSWERED as `error`, never thrown, and its
 * words are the line the run history carries — the same words the engine
 * wrote when these steps were its own.
 */

export type DatasetStepType = (typeof DATASET_STEP_TYPES)[number]

/**
 * A dataset step as it is stored: the dataset by id (AGL-261, rename-safe),
 * with its name kept as a display hint — and the name alone on a step from
 * before ids, which the lookup resolves either way.
 */
export interface DatasetStep {
  type: DatasetStepType
  datasetId?: string
  datasetName?: string
}

/**
 * Refresh the live pages showing the dataset this step just wrote to
 * (AGL-3113).
 *
 * An automation that appends a row is the same change to a visitor as a form
 * submission or a console edit: the pages repeating over the dataset go on
 * serving the rows they were built from. Announced from the step rather than
 * from the run, so a workflow whose steps write two different datasets
 * refreshes both — the announce coalesces repeats of the SAME dataset itself,
 * which is what a run hitting one dataset several times needs.
 *
 * Silent without an org: datasets are org-scoped, so a host with no resolvable
 * org has no dataset to have written to. Best effort, and never thrown: the
 * row is already stored.
 */
async function announceDatasetStepWrite(
  orgId: string | null,
  datasetId: string,
): Promise<void> {
  if (!orgId) return
  await announceDatasetRecordChange({
    firestore: firebaseAdmin.app().firestore(),
    orgId,
    datasetId,
  })
}

/**
 * Whether this dataset may take ANOTHER record, on the plan of the org that
 * owns the site — the row band and the byte band, in that order. Null when
 * the append may proceed; a reason string when it may not.
 *
 * ## Why an append needs a gate at all
 *
 * Every other door onto `datasets/{id}/records` already has one: the console
 * route re-checks `recordsPerDataset` inside the creating transaction, the
 * `/v1` record route checks it below its idempotency claim, and the public
 * form-submission leg checks the rows and the bytes. An automation step wrote
 * with no check of either — and it is the door a visitor drives hardest,
 * because an action fires per event on a published site. A cap enforced at
 * three of four doors is not a cap; it is the shape of the one that is left.
 *
 * ## What it does NOT do
 *
 * It refuses the WRITE, never the dataset. A dataset already holding more
 * rows than the plan includes keeps every row it has and keeps being read —
 * nothing here deletes, truncates, or hides anything, and nothing may be
 * added that does. What is refused is the next row, which is the same
 * boundary the other three doors draw, and the reason a plan change cannot
 * cost a customer data they already have.
 *
 * The update leg of `updateDataset` is deliberately NOT gated: merging fields
 * into a record that already exists adds no row, so refusing it would refuse
 * the state of being over rather than the raise.
 *
 * ## What it costs
 *
 * Nothing on the plans that sell the data store. The row count is read only
 * when `recordsPerDataset` is FINITE, so an uncapped plan pays nothing; and
 * `dataStorageRefusal` answers null with no read at all whenever the plan
 * carries an `extraDataGbMonthlyUsd` rate, which every metered plan does. The
 * reads are paid on the shapes that can actually refuse. The org document is
 * the one the run's gate already read, handed over with the step.
 */
async function datasetAppendRefusal(
  request: Pick<ServerStepRequest, 'org' | 'orgId'>,
  datasetRef: FirebaseFirestore.DocumentReference,
): Promise<string | null> {
  const limit = resolveOrgEntitlements(request.org as never).recordsPerDataset
  if (Number.isFinite(limit)) {
    const used = (
      await datasetRef.collection('records').count().get()
    ).data().count
    if (!checkQuota(request.org as never, 'recordsPerDataset', used).allowed) {
      return `dataset is full (${limit} records on this plan)`
    }
  }
  if (!request.orgId) return null
  const bytes = await dataStorageRefusal(
    request.org as never,
    firebaseAdmin.app().firestore().collection('orgs').doc(request.orgId),
  )
  if (!bytes) return null
  return `dataset storage is full (${bytes.includedMb} MB on this plan)`
}

/** `datasetAppend`: one record from the event's matching fields. */
async function appendDatasetRecord(
  request: ServerStepRequest,
  step: DatasetStep,
): Promise<ServerStepAnswer> {
  const { hostId, payload } = request
  // Id-first lookup (AGL-261/556); the name query is the legacy path.
  const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
  const datasetDoc = await resolveDatasetDoc(datasetsRef, step, hostId)
  if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
    return { error: `unknown dataset "${step.datasetName || step.datasetId}"` }
  }
  // Restrict to the model's field ids (AGL-556) — covers model-only
  // datasets whose flat v1 `fields` mirror is absent.
  const appendDataset = {
    model: datasetDoc.get('model'),
    fields: Array.isArray(datasetDoc.get('fields'))
      ? datasetDoc.get('fields')
      : [],
  }
  const appendModel = effectiveDatasetModel(appendDataset)
  // A plugin's field validator runs only once its plugin registered it.
  await ensureDeclaredCustomFieldTypes(appendModel)
  const write = prepareDatasetRecordWrite(appendDataset, payload)
  const values = write.values
  // Same name precedence `findDatasetByName` resolves in.
  const appendLabel = (
    datasetDisplayName({
      displayName: datasetDoc.get('displayName'),
      name: datasetDoc.get('name'),
    }) ||
    step.datasetName ||
    ''
  ).slice(0, 60)
  // No event field matched a field of the dataset, so there is nothing
  // to write. An error rather than a quiet success: a run history that
  // says `saved to Leads` while nothing saves is how a mismatched field
  // name goes unnoticed.
  if (!write.matched.length) {
    return {
      error: `no event field matches a field in dataset "${appendLabel || step.datasetId}"`,
    }
  }
  // Held to the model like every other record write (AGL-2773): a value
  // its field cannot hold refuses the whole record, and the run says
  // which field and why instead of `saved to Leads`.
  if (Object.keys(write.errors).length) {
    return {
      error: `record failed validation for dataset "${appendLabel || step.datasetId}": ${describeDatasetRecordErrors(write.errors)}`,
    }
  }
  if (!Object.keys(values).length) {
    return {
      error: `every event field matching dataset "${appendLabel || step.datasetId}" is empty`,
    }
  }
  const refusal = await datasetAppendRefusal(request, datasetDoc.ref)
  if (refusal) return { error: refusal }
  await datasetDoc.ref.collection('records').add({
    values,
    // The integrity index the console's delete check queries —
    // carried by every write that sets `values`, or the index
    // describes rows this one never held.
    ...datasetIntegrityFields(appendModel, values),
    createdAt: FieldValue.serverTimestamp(),
  })
  await announceDatasetStepWrite(request.orgId, datasetDoc.id)
  // `saved to Leads` beats `saved to dataset` (AGL-2171).
  return { detail: appendLabel }
}

/**
 * `updateDataset`: update-or-append (AGL-257). Matches the record whose
 * `email` field equals the payload's email; appends when nothing matches.
 */
async function updateDatasetRecord(
  request: ServerStepRequest,
  step: DatasetStep,
): Promise<ServerStepAnswer> {
  const { hostId, payload } = request
  const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
  const datasetDoc = await resolveDatasetDoc(datasetsRef, step, hostId)
  if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
    return { error: `unknown dataset "${step.datasetName || step.datasetId}"` }
  }
  const updateDataset = {
    model: datasetDoc.get('model'),
    fields: Array.isArray(datasetDoc.get('fields'))
      ? datasetDoc.get('fields')
      : [],
  }
  const updateModel = effectiveDatasetModel(updateDataset)
  await ensureDeclaredCustomFieldTypes(updateModel)
  const updateLabel = String(
    datasetDisplayName({
      displayName: datasetDoc.get('displayName'),
      name: datasetDoc.get('name'),
    }) ||
      step.datasetName ||
      step.datasetId ||
      '',
  ).slice(0, 60)
  // Checked before the lookup, as an append: the fields this write
  // supplies are held to the model whichever leg runs below, and a
  // refusal costs no read.
  const incoming = prepareDatasetRecordWrite(updateDataset, payload)
  // Nothing to merge or append — an error, for the reason the append
  // step gives.
  if (!incoming.matched.length) {
    return { error: `no event field matches a field in dataset "${updateLabel}"` }
  }
  if (!Object.keys(incoming.values).length) {
    return { error: `every event field matching dataset "${updateLabel}" is empty` }
  }
  const email = String(payload['email'] ?? '').trim()
  // `records.values` is exempt from indexing, so this lookup is served
  // only by the `values.email` field override in
  // cloud/firebase-firestore.indexes.json. Without that override
  // production refuses the query and neither leg below runs.
  const existing = email
    ? await datasetDoc.ref
        .collection('records')
        .where('values.email', '==', email)
        .limit(1)
        .get()
    : null
  if (existing && !existing.empty) {
    // A merge holds only the fields this write sent to the model: a row
    // stored as text before AGL-2773 is not refused for a legacy value
    // this run never touched.
    const write = prepareDatasetRecordWrite(updateDataset, payload, {
      existing: existing.docs[0].get('values') ?? {},
    })
    if (Object.keys(write.errors).length) {
      return {
        error: `record failed validation for dataset "${updateLabel}": ${describeDatasetRecordErrors(write.errors)}`,
      }
    }
    const merged = write.values
    await existing.docs[0].ref.set(
      {
        values: merged,
        // The merging form: an update that clears the last reference
        // has to REMOVE the index rather than omit it, or a stale
        // array refuses a delete nothing is holding.
        ...datasetIntegrityUpdate(updateModel, merged, FieldValue.delete()),
        updatedAt: FieldValue.serverTimestamp(),
      },
      // `mergeFields`, not `merge: true`: a merge would fold the new
      // `filterValues` map into the stored one key by key, and a value
      // cleared here would go on answering its old equality. Each named
      // field is replaced whole; `merged` already holds every value.
      {
        mergeFields: ['values', 'referencedIds', 'filterKeys', 'filterValues', 'updatedAt'],
      },
    )
  } else {
    // The APPEND leg of update-or-append, and the only one of the two
    // that adds a row — the merge above rewrites a record that already
    // counts against the band. A new row is held to the whole model,
    // required fields included, like any other append.
    if (Object.keys(incoming.errors).length) {
      return {
        error: `record failed validation for dataset "${updateLabel}": ${describeDatasetRecordErrors(incoming.errors)}`,
      }
    }
    const refusal = await datasetAppendRefusal(request, datasetDoc.ref)
    if (refusal) return { error: refusal }
    await datasetDoc.ref.collection('records').add({
      values: incoming.values,
      ...datasetIntegrityFields(updateModel, incoming.values),
      createdAt: FieldValue.serverTimestamp(),
    })
  }
  // Both legs changed a row, so both make the same pages stale — an edited
  // record reads no differently from a new one on a page that lists them.
  await announceDatasetStepWrite(request.orgId, datasetDoc.id)
  return {}
}

/** Runs one dataset step for the automation engine. */
export async function runDatasetStep(request: ServerStepRequest): Promise<ServerStepAnswer> {
  const step = request.step as unknown as DatasetStep
  if (step.type === 'datasetAppend') return appendDatasetRecord(request, step)
  if (step.type === 'updateDataset') return updateDatasetRecord(request, step)
  return { error: `"${String(step.type)}" is not a dataset step` }
}
