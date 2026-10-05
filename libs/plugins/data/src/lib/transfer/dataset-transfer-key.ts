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

/**
 * The transfer resource a dataset's records move as (AGL-3530): declared once
 * in `plugins.config.json` as `data.dataset` with `instances`, and reached
 * per dataset as `data.dataset:<datasetId>` — so a job, a person's remembered
 * export fields and the one-running-import rule each belong to one dataset.
 *
 * Its own module so the Data card can name a dataset's resource without
 * loading the transfer core: the key is the core's instance key
 * (`transferResourceInstanceKey` in `@aglyn/aglyn/data-transfer`), spelled out
 * here, and `dataset-transfer-key.spec.ts` holds the two to the same answer.
 */
export const DATASET_TRANSFER_RESOURCE = 'data.dataset'

/** The resource key a dataset's records are imported and exported under. */
export function datasetTransferResourceKey(datasetId: string): string {
  return `${DATASET_TRANSFER_RESOURCE}:${datasetId}`
}
