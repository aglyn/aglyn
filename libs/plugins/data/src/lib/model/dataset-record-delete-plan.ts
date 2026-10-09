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

import type { DatasetModel } from './dataset-model-core'

/**
 * What deleting one record does to the datasets that reference it (AGL-180),
 * decided once for both writers: the console's Data card, which applies it as
 * a browser batch, and `/api/orgs/datasets` `delete-record`, which the native
 * apps call (AGL-3668). SDK-free: each writer runs the queries and the writes
 * with its own SDK, and asks this what they are.
 */

/** The fields of `model` that point into `datasetId`. */
export function referencingFieldIds(model: DatasetModel, datasetId: string): string[] {
  return (model.order ?? []).filter(
    (fieldId) =>
      model.fields?.[fieldId]?.type === 'reference' &&
      model.fields?.[fieldId]?.reference?.datasetId === datasetId,
  )
}

/** One record of a referencing dataset, as its `referencedIds` query returned it. */
export interface ReferenceHolder {
  id: string
  values: Record<string, unknown> | undefined
}

/** The verdict for one referencing dataset. */
export type ReferenceFixupPlan =
  /** Nothing in it points at the record. */
  | { kind: 'none' }
  /** A `restrict` field holds it: the delete is refused, and nothing is written. */
  | { kind: 'restricted'; holders: number }
  /** `setNull`: each holder's values with the record stripped out. */
  | { kind: 'strip'; updates: Array<{ id: string; values: Record<string, unknown> }> }

/**
 * The verdict for `holders` (the referencing dataset's records whose
 * `referencedIds` contain `recordId`) when `recordId` is deleted from
 * `datasetId`. `referencedIds` is the union across every reference field, so
 * a holder counts only when one of the fields that point into `datasetId`
 * holds the id.
 */
export function planReferenceFixups(
  model: DatasetModel,
  datasetId: string,
  recordId: string,
  holders: readonly ReferenceHolder[],
): ReferenceFixupPlan {
  const fields = referencingFieldIds(model, datasetId)
  if (!fields.length) return { kind: 'none' }
  const hits = holders.filter((holder) =>
    fields.some((fieldId) => {
      const stored = holder.values?.[fieldId]
      return Array.isArray(stored) ? stored.includes(recordId) : stored === recordId
    }),
  )
  if (!hits.length) return { kind: 'none' }
  if (fields.some((fieldId) => model.fields?.[fieldId]?.reference?.onDelete === 'restrict')) {
    return { kind: 'restricted', holders: hits.length }
  }
  return {
    kind: 'strip',
    updates: hits.map((hit) => {
      const values = { ...(hit.values ?? {}) }
      for (const fieldId of fields) {
        const stored = values[fieldId]
        if (Array.isArray(stored)) {
          values[fieldId] = stored.filter((id: unknown) => id !== recordId)
        } else if (stored === recordId) {
          delete values[fieldId]
        }
      }
      return { id: hit.id, values }
    }),
  }
}

/** The refusal a `restrict` reference gives, in the card's words. */
export function restrictedDeleteMessage(holders: number, datasetName: string): string {
  return `Cannot delete: referenced by ${holders} document${holders === 1 ? '' : 's'} in "${datasetName}"`
}
