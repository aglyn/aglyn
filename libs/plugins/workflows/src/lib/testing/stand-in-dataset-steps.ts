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
  registerServerStepExecutor,
  type ServerStepRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-server-steps'

/** The dataset a step names, as the spec's own Firestore double holds it. */
interface DatasetDouble {
  exists: boolean
  get(field: string): unknown
}

/** Where the stand-in reads a dataset and writes its records: the spec's own double. */
export interface DatasetStepsDouble {
  dataset(request: ServerStepRequest, datasetId: string): Promise<DatasetDouble>
  append(request: ServerStepRequest, datasetId: string, record: { values: Record<string, string> }): Promise<unknown>
}

/**
 * The dataset steps the data plugin runs for this engine (AGL-3080), stood in
 * for this plugin's specs — this plugin may not load the data plugin. Over the
 * spec's own Firestore double it does what the owner's executor does for the
 * shapes these specs store: it finds the dataset the step names by id, writes
 * the event's fields the dataset has as text, and answers the dataset's name
 * as the run's detail — or the owner's words for a dataset it cannot find, or
 * for an event with no field the dataset has. Models, caps, merges and the
 * live-page refresh are the data plugin's own spec's
 * (`dataset-steps.server.spec.ts`), and the real pair runs together in
 * `apps/console/specs/dataset-automation-steps.spec.ts`.
 */
export function standInDatasetSteps(double: DatasetStepsDouble): () => void {
  return registerServerStepExecutor(
    ['datasetAppend', 'updateDataset'],
    async (request) => {
      const step = request.step as { type: string; datasetId?: string; datasetName?: string }
      const datasetId = String(step.datasetId ?? '')
      const dataset = await double.dataset(request, datasetId)
      if (!dataset.exists || dataset.get('deletedAt')) {
        return { error: `unknown dataset "${step.datasetName || step.datasetId}"` }
      }
      const label = String(dataset.get('displayName') ?? step.datasetName ?? '')
      const fields = (dataset.get('fields') as string[] | undefined) ?? []
      const values: Record<string, string> = {}
      for (const field of fields) {
        const value = request.payload[field]
        if (value != null && String(value) !== '') values[field] = String(value)
      }
      if (!Object.keys(values).length) {
        return { error: `no event field matches a field in dataset "${label}"` }
      }
      await double.append(request, datasetId, { values })
      return step.type === 'datasetAppend' ? { detail: label } : {}
    },
    { pluginId: 'data' },
  )
}
