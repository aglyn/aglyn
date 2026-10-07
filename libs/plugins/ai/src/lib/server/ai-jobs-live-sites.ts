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
 * A JOB WHOSE SITE IS GONE IS NOT LISTED (AGL-3596).
 *
 * Deleting a site deletes the AI jobs that name it — `aiJobs` is declared in
 * this plugin's `orgCollections` with `siteField: "hostId"`, and `eraseHost`
 * sweeps every such declaration. That sweep is best effort, and a job written
 * before it existed was never swept, so the list route is the second half:
 * a job naming a site whose document no longer exists is left out of every
 * list it serves. The top-bar indicator, the Assist launcher's badge, the
 * jobs drawer and every card that reads the latest job all read that route,
 * so none of them shows a chip, a count or a row for a site nobody can open.
 *
 * One batched read of the distinct sites a page of jobs names — a workspace's
 * page names a handful — and none for jobs that name no site.
 */

const HOSTS_COLLECTION = 'hosts'

/** The fields a job is filtered by: its stored form and its wire form both carry it. */
export interface AiJobSiteSource {
  hostId?: string | null
}

/**
 * `jobs` without the ones naming a site whose document does not exist, in
 * the order given. A read that fails answers `jobs` unchanged: a stale row is
 * the lesser fault next to hiding every job a workspace has running.
 */
export async function withoutErasedSites<T extends AiJobSiteSource>(
  firestore: FirebaseFirestore.Firestore,
  jobs: readonly T[],
): Promise<T[]> {
  const hostIds = [
    ...new Set(
      jobs
        .map((job) => (typeof job.hostId === 'string' ? job.hostId.trim() : ''))
        .filter(Boolean),
    ),
  ]
  if (!hostIds.length) return [...jobs]
  let erased: Set<string>
  try {
    const snapshots = await firestore.getAll(
      ...hostIds.map((hostId) => firestore.collection(HOSTS_COLLECTION).doc(hostId)),
    )
    erased = new Set(
      snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.id),
    )
  } catch (error) {
    console.error('ai jobs: reading the sites a list names failed', error)
    return [...jobs]
  }
  if (!erased.size) return [...jobs]
  return jobs.filter((job) => !(job.hostId && erased.has(job.hostId.trim())))
}
