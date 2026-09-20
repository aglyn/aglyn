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

import { FieldComponentType } from '@aglyn/aglyn'
import type {
  RepeatRowsAnswer,
  RepeatRowsRequest,
  RepeatSource,
} from '@aglyn/aglyn/app-utils/repeat-sources'
import { useFirestore, useOrgDataScope } from '@aglyn/tenant-feature-instance'
import { useEffect, useState } from 'react'
import { readDatasetRepeatRows } from './dataset-repeat-rows'

/**
 * The prop a repeat's dataset persists under (AGL-103). The published page's
 * composition expands every node that carries it, whatever its component, so
 * the Stack's stored repeats and any element's read as one shape. Persisted —
 * never rename.
 */
export const DATASET_REPEAT_KEY_PROP = 'repeatDataset'

/**
 * A dataset's rows for the canvas, read once per key and site while a canvas
 * element repeats over it.
 *
 * `missing` for a site with no organization: datasets belong to the
 * organization, so there is nothing such a site can repeat over.
 */
export function useDatasetRepeatRows(
  request: RepeatRowsRequest,
): RepeatRowsAnswer {
  const { hostId, key } = request
  const firestore = useFirestore()
  const { scope, ready } = useOrgDataScope({ hostId })
  const [answer, setAnswer] = useState<RepeatRowsAnswer>({ status: 'loading' })
  useEffect(() => {
    if (!ready) return undefined
    if (!scope) {
      setAnswer({ status: 'missing' })
      return undefined
    }
    let active = true
    setAnswer({ status: 'loading' })
    readDatasetRepeatRows({ firestore, scope, hostId, key }).then(
      (next) => {
        if (active) setAnswer(next)
      },
      (error) => {
        console.error(error)
        if (active) setAnswer({ status: 'error' })
      },
    )
    return () => {
      active = false
    }
  }, [firestore, scope, ready, hostId, key])
  return answer
}

/**
 * Datasets as a repeat source (AGL-3111): what any element can repeat over,
 * picked with the dataset picker and previewed on the canvas from the real
 * rows. Registered by {@link registerDataConsole}, the function the console's
 * plugin loader calls by name.
 */
export const DATASET_REPEAT_SOURCE: RepeatSource = {
  id: 'dataset',
  label: 'Dataset',
  keyProp: DATASET_REPEAT_KEY_PROP,
  keyAttribute: {
    component: FieldComponentType.DATASET_SELECT,
    label: 'Repeat over dataset',
    description:
      'Render this element once per record of a dataset on the published ' +
      'site. Use {{item.field}} for a record value. Stored by dataset id — ' +
      'renames never break the repeat.',
  },
  useRows: useDatasetRepeatRows,
}
