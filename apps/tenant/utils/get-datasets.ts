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

import * as Aglyn from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Fetches the host's datasets with their records for repeatable expansion
 * (AGL-103), keyed by BOTH dataset id and display name (editors type the
 * friendly name into the Repeat attribute). Records are editor-ordered and
 * capped at the repeat bound. Fail-open: on error an empty map is returned
 * and repeatable containers render their template untouched.
 */
export async function getDatasets(options: {
  hostId: string
}): Promise<Record<string, Aglyn.RepeatableDataset>> {
  const datasets: Record<string, Aglyn.RepeatableDataset> = {}
  try {
    const firestore = firebaseAdmin.app().firestore()
    const snapshot = await firestore
      .collection('hosts')
      .doc(options.hostId)
      .collection('datasets')
      .limit(50)
      .get()
    await Promise.all(
      snapshot.docs.map(async (docSnapshot) => {
        const recordsSnapshot = await docSnapshot.ref
          .collection('records')
          .limit(Aglyn.REPEAT_MAX_RECORDS)
          .get()
        const records = Aglyn.sortDatasetRecords(
          recordsSnapshot.docs.map((recordSnapshot) => ({
            $id: recordSnapshot.id,
            ...(recordSnapshot.data() as Aglyn.HostDatasetRecord),
          })),
        ).map((record) => record.values ?? {})
        const dataset: Aglyn.RepeatableDataset = { records }
        datasets[docSnapshot.id] = dataset
        const displayName = docSnapshot.get('displayName')
        if (typeof displayName === 'string' && displayName.trim()) {
          datasets[displayName.trim()] = dataset
        }
      }),
    )
  } catch (error) {
    console.error(error)
  }
  return datasets
}

export default getDatasets
