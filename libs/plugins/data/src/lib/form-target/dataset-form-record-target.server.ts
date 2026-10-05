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

import { checkQuota, ensureDeclaredCustomFieldTypes } from '@aglyn/aglyn/server'
import type {
  FormRecordWriteOutcome,
  FormRecordWriteRequest,
} from '@aglyn/aglyn/plugin-manager/submission-record-target'
import {
  dataStorageRefusal,
  firebaseAdmin,
  orgDataCollectionForHost,
} from '@aglyn/tenant-data-admin'
import { announceDatasetRecordChange } from '../server/dataset-live-pages'
import { resolveDatasetDoc } from '../server/resolve-dataset'
import { FieldValue } from 'firebase-admin/firestore'
import { verifyFormDatasetBinding } from './form-dataset-binding-token'
import { FORM_DATASET_BINDING_FIELD } from './stamp-form-dataset-bindings'
import { datasetIntegrityFields, effectiveDatasetModel } from '../model/dataset-models'
import { prepareDatasetRecordWrite } from '../model/datasets'

/**
 * THE DATASET A SUBMISSION ALSO WRITES A RECORD TO (AGL-141/556), decided on
 * the server — this plugin's answer to the platform's contract
 * (`plugin-manager/submission-record-target.ts`), asked by the submit route
 * after the submission itself is stored.
 *
 * The body is public and unauthenticated, so nothing in it may choose where a
 * record lands: a dataset id or field map taken from it let anyone add rows to
 * any dataset the site can see and send any submitted value into any of its
 * fields. The binding is the one the page's compose read off this form and
 * signed (`stampFormDatasetBindings`): for this site only, and exactly what the
 * form's own props and fields declare, so a form writes where it always wrote.
 * Without a valid signature there is no record. The Inbox copy is canonical
 * either way.
 *
 * What it answers is the submission's `routing`: `dataset` — where the record
 * went — or `datasetRefused` — which values the dataset could not hold. Both
 * are read by the Inbox.
 *
 * Best-effort: a missing dataset or a full record quota never fails the
 * submission, and never claims a row that was not written.
 */
export async function writeFormSubmissionRecord(
  request: FormRecordWriteRequest,
): Promise<FormRecordWriteOutcome> {
  const { hostId, orgId, fields } = request
  const orgBilling = request.orgBilling as Record<string, unknown> | undefined
  const binding = verifyFormDatasetBinding(
    hostId,
    request.body[FORM_DATASET_BINDING_FIELD],
  )
  if (!binding) return {}
  try {
    const firestore = firebaseAdmin.app().firestore()
    // Org-scoped datasets (AGL-237): the form's dataset resolves against the
    // org so every host shares it.
    const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
    const datasetDoc = await resolveDatasetDoc(
      datasetsRef,
      { datasetId: binding.datasetId, datasetName: binding.datasetName },
      hostId,
    )
    if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) return {}
    const bound = {
      model: datasetDoc.get('model'),
      fields: Array.isArray(datasetDoc.get('fields'))
        ? datasetDoc.get('fields')
        : [],
    }
    const boundModel = effectiveDatasetModel(bound)
    // `displayName` first, then the legacy `name`, then the name the form was
    // bound by — the same precedence `findDatasetByName` resolves in. Reading
    // only `name` would leave every modern dataset's chip unnamed.
    const datasetLabel = String(
      datasetDoc.get('displayName') ??
        datasetDoc.get('name') ??
        binding.datasetName ??
        '',
    ).slice(0, 60)
    /*
     * CHECKED AGAINST THE MODEL (AGL-2773, option B). Each value is coerced to
     * its field's type and held to the field's rules, the same pair the
     * console and `/v1` run, custom field types included — so a plugin's
     * validator has to be registered first.
     *
     * A refused record is not written, and the submission is kept: the Inbox
     * copy is the visitor's, and a value the dataset cannot hold is no reason
     * to lose it. The refusal is noted on the submission, per field, so the
     * Inbox can say why the row is missing instead of leaving the owner to
     * guess.
     */
    await ensureDeclaredCustomFieldTypes(boundModel)
    const write = prepareDatasetRecordWrite(bound, fields, {
      fieldMap: binding.fieldMap,
    })
    if (Object.keys(write.errors).length) {
      return {
        routing: {
          datasetRefused: {
            id: datasetDoc.id,
            name: datasetLabel,
            errors: write.errors,
          },
        },
      }
    }
    const values = write.values
    if (!Object.keys(values).length) return {}
    const recordCount = (
      await datasetDoc.ref.collection('records').count().get()
    ).data().count
    if (
      !checkQuota(orgBilling as never, 'recordsPerDataset', recordCount).allowed
    ) {
      return {}
    }
    /*
     * BYTES, not just rows (AGL-2253). This leg checked `recordsPerDataset`
     * and never `dataStorageMbPerOrg`, so a public form wired to a dataset
     * wrote past a byte band the console route hard-blocks at — the one
     * dataset-writing path a visitor can drive without an account, and
     * therefore the one where the volume is not the customer's to control.
     *
     * Costs nothing on a metered plan: `dataStorageRefusal` answers `null`
     * with no read whenever the plan carries an `extraDataGbMonthlyUsd` rate,
     * which is every plan that sells the data store. The read is paid only on
     * the two unmetered shapes.
     *
     * Refused like the row quota above — the submission still lands in the
     * Inbox, and `routing.dataset` is not stamped. A lost lead is the worse
     * error here.
     */
    if (
      orgId &&
      (await dataStorageRefusal(
        orgBilling as never,
        firestore.collection('orgs').doc(orgId),
      ))
    ) {
      return {}
    }
    const recordRef = await datasetDoc.ref.collection('records').add({
      values,
      // The integrity index the console's delete check queries. A submission
      // can land in a reference field through a bound form, so this leg
      // carries it like every other write that sets `values`.
      ...datasetIntegrityFields(boundModel, values),
      createdAt: FieldValue.serverTimestamp(),
    })
    /*
     * The pages repeating over the dataset are refreshed (AGL-3113).
     *
     * This is the path the Datasets page's own claim rests on — bind an
     * element to a dataset, publish, and a record written later shows within
     * seconds. Best effort: a refusal from the cache must never turn a stored
     * lead into a lost one.
     */
    if (orgId) {
      await announceDatasetRecordChange({
        firestore,
        orgId,
        datasetId: datasetDoc.id,
      })
    }
    /*
     * Provenance (AGL-2168). `/product/forms`'s hero mockup shows the detail
     * pane carrying `Added to "Leads" dataset` under the fields, so the record
     * is named on the submission — only on this path, where a record was
     * really created. A chip claiming a row that a deleted dataset or a full
     * quota refused would be worse than the silence it replaced.
     */
    return {
      routing: {
        dataset: {
          id: datasetDoc.id,
          name: datasetLabel,
          recordId: recordRef.id,
        },
      },
    }
  } catch (error) {
    console.error('form dataset append failed', error)
    return {}
  }
}
