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

import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { FieldValue } from 'firebase-admin/firestore'
import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  PluginSiteResourceGoing,
  PluginSiteResourcePreview,
  PluginSiteResourceRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-site-resources'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * A SITE'S OWN DATASETS GO WITH IT (AGL-4003).
 *
 * Datasets belong to the organization and name no site, so for a long time a
 * deleted site left behind every list it was given: a guided start makes its
 * site's datasets, and 53 of them outlived their test sites in one workspace
 * (2026-10-20). The sharing says whose a dataset is:
 *
 * - shared with this site alone, it is the site's, and is erased with its
 *   records, as the site's own Delete dataset would (`eraseScopeDenial`
 *   admits exactly this case);
 * - shared with this site and others, it stays, and this site comes off its
 *   sharing so it names no site that is gone;
 * - shared with every site (`['org']`), it does not name the site and is not
 *   read.
 *
 * Core reaches this through the site-resource seam
 * (`plugin-site-resources.ts`): the delete asks, the Delete site card shows
 * the preview first.
 */

/** Whether a dataset's sharing names this site and nothing else. */
export function datasetIsSiteOnly(visibleTo: unknown, hostId: string): boolean {
  const token = hostScopeToken(hostId)
  return (
    Array.isArray(visibleTo) &&
    visibleTo.length > 0 &&
    visibleTo.every((entry) => entry === token)
  )
}

export interface DatasetSiteErasureDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

const platformFirestore = () => firebaseAdmin.app().firestore() as unknown as Firestore

/** The datasets whose sharing names the site: its own, and the ones it shares. */
async function siteDatasets(
  request: PluginSiteResourceRequest,
  firestore: Firestore,
): Promise<{ only: QueryDocumentSnapshot[]; shared: QueryDocumentSnapshot[] }> {
  const rows = await firestore
    .collection('orgs')
    .doc(request.orgId)
    .collection('datasets')
    .where('visibleTo', 'array-contains', hostScopeToken(request.hostId))
    .get()
  const only = rows.docs.filter((doc) => datasetIsSiteOnly(doc.get('visibleTo'), request.hostId))
  const shared = rows.docs.filter((doc) => !datasetIsSiteOnly(doc.get('visibleTo'), request.hostId))
  return { only, shared }
}

/**
 * What deleting the site would do to its workspace's datasets: the ones
 * shared with it alone, each with its record count, by name, and how many
 * it shares with other sites. Reads only.
 */
export async function previewSiteDatasets(
  request: PluginSiteResourceRequest,
  deps: DatasetSiteErasureDeps = {},
): Promise<PluginSiteResourcePreview> {
  const { only, shared } = await siteDatasets(request, (deps.firestore ?? platformFirestore)())
  const going = await Promise.all(
    only.map(async (doc): Promise<PluginSiteResourceGoing> => {
      const items = await doc.ref
        .collection('records')
        .count()
        .get()
        .then((counted) => Number(counted.data().count) || 0)
        .catch(() => null)
      return { id: doc.id, name: String(doc.get('displayName') ?? '') || doc.id, items }
    }),
  )
  going.sort((a, b) => a.name.localeCompare(b.name))
  return {
    noun: ['dataset', 'datasets'],
    itemNoun: ['record', 'records'],
    going,
    staying: shared.length,
  }
}

/**
 * Erases the datasets shared with the site alone, records included, and
 * takes the site off the sharing of the ones it shares with others. Per
 * dataset, so one failure leaves the rest done. Answers how many it erased.
 */
export async function eraseSiteDatasets(
  request: PluginSiteResourceRequest,
  deps: DatasetSiteErasureDeps = {},
): Promise<number> {
  const firestore = (deps.firestore ?? platformFirestore)()
  const { only, shared } = await siteDatasets(request, firestore)
  let erased = 0
  for (const doc of only) {
    try {
      await firestore.recursiveDelete(doc.ref)
      erased += 1
    } catch (error) {
      console.error(`[data] dataset ${doc.id} was not erased with site ${request.hostId}`, error)
    }
  }
  for (const doc of shared) {
    await doc.ref
      .update({ visibleTo: FieldValue.arrayRemove(hostScopeToken(request.hostId)) })
      .catch((error: unknown) => {
        console.error(`[data] dataset ${doc.id} still names deleted site ${request.hostId}`, error)
      })
  }
  return erased
}
