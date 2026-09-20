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

import type { RepeatableDataset } from '@aglyn/aglyn/app-utils/expand-repeatables'
import type { DatasetModel } from '@aglyn/aglyn/app-utils/dataset-models'
import { createContext } from 'react'

/**
 * The record the canvas nodes below this point are DRAWING (AGL-3111).
 *
 * Set by a repeating element around the template an author edits, so its
 * `{{item.*}}` tokens render the first record's values the way the published
 * page will. Nothing under it is changed — it decides render copies only.
 *
 * ABSENT everywhere else, which is the ordinary case: an element outside any
 * repeat shows its props as written.
 */
export interface RepeatRecordContextValue {
  /** The record's value map, with `$id` (AGL-180 hops resolve through it). */
  record: Record<string, unknown>
  /** Model of the repeated rows; a reference hop needs its field configs. */
  model?: DatasetModel
  /** Rows by key, so `{{item.author.name}}` resolves on the canvas too. */
  datasetsByKey?: Record<string, RepeatableDataset | undefined>
}

export const RepeatRecordContext = createContext<
  RepeatRecordContextValue | undefined
>(undefined)
RepeatRecordContext.displayName = 'RepeatRecordContext'

export default RepeatRecordContext
