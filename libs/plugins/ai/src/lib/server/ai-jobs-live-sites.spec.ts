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

import { pluginOrgCollection } from '@aglyn/aglyn/plugin-manager/plugin-host-collections'
import { AI_PLUGIN_ID } from '../constants'
import { withoutErasedSites } from './ai-jobs-live-sites'

/**
 * A deleted site's AI jobs (AGL-3596): erased with the site, and never listed
 * after it.
 */

function fakeFirestore(hosts: readonly string[], options: { fail?: boolean } = {}) {
  const getAll = jest.fn(async (...refs: Array<{ id: string }>) => {
    if (options.fail) throw new Error('unavailable')
    return refs.map((ref) => ({ id: ref.id, exists: hosts.includes(ref.id) }))
  })
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({ id, path: `${name}/${id}` }),
    }),
    getAll,
  }
  return { firestore: firestore as unknown as FirebaseFirestore.Firestore, getAll }
}

describe('withoutErasedSites', () => {
  const jobs = [
    { id: 'a', hostId: 'gone' },
    { id: 'b', hostId: 'live' },
    { id: 'c', hostId: null },
    { id: 'd', hostId: 'gone' },
    { id: 'e' },
  ]

  it('drops every job naming a site whose document is gone, keeping the order', async () => {
    const { firestore, getAll } = fakeFirestore(['live'])
    const kept = await withoutErasedSites(firestore, jobs)
    expect(kept.map((job) => job.id)).toEqual(['b', 'c', 'e'])
    // One batched read of the distinct sites, not one per job.
    expect(getAll).toHaveBeenCalledTimes(1)
    expect(getAll.mock.calls[0].map((ref) => ref.id)).toEqual(['gone', 'live'])
  })

  it('reads nothing for a page whose jobs name no site', async () => {
    const { firestore, getAll } = fakeFirestore([])
    const kept = await withoutErasedSites(firestore, [{ id: 'c', hostId: null }, { id: 'e' }])
    expect(kept.map((job) => job.id)).toEqual(['c', 'e'])
    expect(getAll).not.toHaveBeenCalled()
  })

  it('lists every job when the read fails, rather than hiding work still running', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const { firestore } = fakeFirestore([], { fail: true })
    const kept = await withoutErasedSites(firestore, jobs)
    expect(kept.map((job) => job.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('deleting a site deletes its AI jobs', () => {
  it('declares `aiJobs` as documents a site owns, by the field a job names its site in', () => {
    // `eraseHost` deletes, for each declaration with a `siteField`, every
    // document under `orgs/{orgId}/{name}` whose field names the site. The
    // machine writes a job's site as `hostId`.
    expect(pluginOrgCollection('aiJobs')).toMatchObject({
      pluginId: AI_PLUGIN_ID,
      siteField: 'hostId',
      mediaScan: 'none',
    })
  })
})
