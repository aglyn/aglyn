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
 * THE YEAR FOUNDED IS A PROFILE FACT (AGL-4092). The 2026-10-28 Rut Runners
 * Racing start was told "founded: 2019", and the site's business profile kept
 * only what it does, who it is for and where. So the About page an Assist
 * build later planned for it had no year to read, and named "[year founded]"
 * on its plan card.
 *
 * The guided start's year now fills the profile's Founded field, recorded as
 * the start's words, and every job that reads the profile is told it.
 * Offline: an in-memory Firestore, no model.
 */

import {
  BUSINESS_PROFILE_FIELDS,
  businessProfileFoundedProblem,
  businessProfileOwnerWrite,
  resolveBusinessProfile,
  type BusinessProfileDoc,
} from '@aglyn/aglyn/app-utils/business-profile'
import type { AiJob } from '../model/ai-jobs.types'
import { aiSiteContextBlock } from '../model/ai-site-context'
import { aiBusinessProfilePrefiller, aiBusinessProfileStartValues } from './ai-business-profile-prefill'
import { RUT_1028_INPUTS } from './fixtures/ai-site-agl4092-datasets'

type Data = Record<string, unknown>

/** Just enough Firestore for the prefill's one transaction. */
function memoryFirestore() {
  const docs = new Map<string, Data>()
  const docRef = (path: string): Record<string, unknown> => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => docRef(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  })
  const firestore = {
    collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: (ref: { path: string }, data: Data) => docs.set(ref.path, data),
      }),
  }
  return { firestore: firestore as unknown as FirebaseFirestore.Firestore, docs }
}

const job = (inputs: Record<string, unknown> = RUT_1028_INPUTS): AiJob =>
  ({ $id: 'j1', orgId: 'org-1', hostId: 'h1', kind: 'site', inputs, plan: { screens: [] } }) as unknown as AiJob

const NOW = new Date('2026-10-28T12:00:00.000Z')

describe('the year a business was founded (AGL-4092)', () => {
  it('is a field the profile stores', () => {
    expect(BUSINESS_PROFILE_FIELDS).toContain('founded')
  })

  it('is read from the guided start’s answers', () => {
    expect(aiBusinessProfileStartValues(job())).toMatchObject({ founded: '2019' })
    // A year the start would refuse never reaches the profile.
    expect(aiBusinessProfileStartValues(job({ ...RUT_1028_INPUTS, founded: 'long ago' }))).not.toHaveProperty('founded')
  })

  it('is written to the site’s profile as the start’s words', async () => {
    const { firestore, docs } = memoryFirestore()
    await aiBusinessProfilePrefiller(() => firestore)({ job: job(), to: 'done' })
    const stored = docs.get('hosts/h1/businessProfile/profile') as BusinessProfileDoc
    expect(stored).toMatchObject({ founded: '2019', sources: { founded: 'start' } })
  })

  it('is told to every job that reads the profile', async () => {
    const { firestore, docs } = memoryFirestore()
    await aiBusinessProfilePrefiller(() => firestore)({ job: job(), to: 'done' })
    const profile = resolveBusinessProfile({
      host: { displayName: 'Rut Runners Racing' },
      site: docs.get('hosts/h1/businessProfile/profile') as BusinessProfileDoc,
    })
    expect(profile.founded).toEqual({ value: '2019', origin: 'start' })
    expect(aiSiteContextBlock({ profile }).split('\n')).toContain('Founded: 2019')
  })

  it('is the owner’s once they change it, and held to four digits no later than this year', () => {
    const stored: BusinessProfileDoc = { founded: '2019', sources: { founded: 'start' } }
    const next = businessProfileOwnerWrite(stored, { founded: '2018' })
    expect(next.founded).toBe('2018')
    expect(next.sources.founded).toBe('owner')
    expect(businessProfileOwnerWrite(stored, {}).sources.founded).toBe('start')
    expect(businessProfileFoundedProblem('2019', NOW)).toBeNull()
    expect(businessProfileFoundedProblem('', NOW)).toBeNull()
    expect(businessProfileFoundedProblem('19', NOW)).toBe('Enter the year as four digits, like 2016.')
    expect(businessProfileFoundedProblem('2031', NOW)).toBe('Enter the year as four digits, like 2016.')
  })
})
