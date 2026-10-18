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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { datasetRecordPhotoSites } from '../model/dataset-image-field'

/** How a site's existence is asked: its host document, by id. */
export type SiteExists = (hostIds: readonly string[]) => Promise<ReadonlySet<string>>

/** The production answer: one batched read of the named host documents. */
const hostsThatExist: SiteExists = async (hostIds) => {
  const firestore = firebaseAdmin.app().firestore()
  const snapshots = await firestore.getAll(...hostIds.map((id) => firestore.collection('hosts').doc(id)))
  return new Set(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id))
}

/**
 * The sites, among those the records' photos are in the libraries of, that
 * no longer exist (AGL-3912). A dataset belongs to the organization, so a
 * record outlives the site whose library its photo was uploaded to, and that
 * library is deleted with the site: the gym's coaches, written by a start on
 * a site since deleted, showed four broken photos. The site rendering is
 * never asked about, and no read is made when no record holds a photo of
 * another site's. Fail-open: a read that fails answers none gone.
 */
export async function goneSitesOfRecords(
  hostId: string,
  records: ReadonlyArray<Readonly<Record<string, unknown>>>,
  exists: SiteExists = hostsThatExist,
): Promise<ReadonlySet<string>> {
  const named = new Set<string>()
  for (const record of records) {
    for (const site of datasetRecordPhotoSites(record)) if (site !== hostId) named.add(site)
  }
  if (!named.size) return new Set()
  try {
    const live = await exists([...named])
    return new Set([...named].filter((site) => !live.has(site)))
  } catch (error) {
    console.error('dataset photos: the sites they live in could not be read', error)
    return new Set()
  }
}
