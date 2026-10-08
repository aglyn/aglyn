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

import { aiBusinessProfilePrefiller, aiBusinessProfileStartValues } from '../jobs/ai-business-profile-prefill'
import type { AiJob } from '../model/ai-jobs.types'
import {
  prefillAiBusinessProfile,
  readAiSiteContext,
  rememberAiSitePreferences,
} from './site-context'

type Data = Record<string, unknown>

/**
 * A path-keyed Firestore with the calls these functions make: doc get/set,
 * a collection read with a limit, a transaction and a batch.
 */
function memoryFirestore(seed: Record<string, Data> = {}) {
  const docs = new Map<string, Data>(Object.entries(seed))
  const docRef = (path: string): Record<string, unknown> => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => collectionRef(`${path}/${name}`),
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
  })
  const collectionRef = (path: string) => {
    const query = (limit = Infinity) => ({
      limit: (n: number) => query(n),
      get: async () => ({
        docs: [...docs.entries()]
          .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
          .slice(0, limit)
          .map(([key, data]) => ({ id: key.split('/').pop(), data: () => data })),
      }),
    })
    return { doc: (id: string) => docRef(`${path}/${id}`), ...query() }
  }
  const firestore = {
    collection: (name: string) => collectionRef(name),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: (ref: { path: string }, data: Data) => docs.set(ref.path, data),
      }),
    batch: () => {
      const ops: Array<() => void> = []
      return {
        set: (ref: { path: string }, data: Data) => ops.push(() => docs.set(ref.path, data)),
        delete: (ref: { path: string }) => ops.push(() => docs.delete(ref.path)),
        commit: async () => ops.forEach((op) => op()),
      }
    },
  }
  return { firestore: firestore as unknown as FirebaseFirestore.Firestore, docs }
}

const HOST = {
  orgId: 'org-1',
  displayName: 'Paws & Co',
  subdomain: 'paws',
  screens: { a: '/' },
}

describe('readAiSiteContext (AGL-3661)', () => {
  it('reads the profile, the workspace defaults, the status and the memory together', async () => {
    const { firestore } = memoryFirestore({
      'hosts/h1': HOST,
      'hosts/h1/businessProfile/profile': { audience: 'Dog owners', sources: { audience: 'start' } },
      'orgs/org-1/businessProfile/defaults': { tone: 'plain' },
      'hosts/h1/aiMemory/copy-short': { text: 'Prefers short, concise copy', group: 'length', count: 2 },
    })
    const context = await readAiSiteContext(firestore, { orgId: 'org-1', hostId: 'h1' })
    expect(context?.profile?.name?.value).toBe('Paws & Co')
    expect(context?.profile?.audience).toEqual({ value: 'Dog owners', origin: 'start' })
    expect(context?.profile?.tone).toEqual({ value: 'plain', origin: 'workspace' })
    expect(context?.publish?.published).toBe(true)
    expect(context?.preferences).toEqual(['Prefers short, concise copy'])
  })

  it('never describes a site of another workspace', async () => {
    const { firestore } = memoryFirestore({ 'hosts/h1': HOST })
    expect(await readAiSiteContext(firestore, { orgId: 'org-2', hostId: 'h1' })).toBeNull()
  })

  it('answers null for no site, and for a read that failed', async () => {
    const { firestore } = memoryFirestore()
    expect(await readAiSiteContext(firestore, { orgId: 'org-1', hostId: '' })).toBeNull()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = { collection: () => { throw new Error('unavailable') } } as unknown as FirebaseFirestore.Firestore
    expect(await readAiSiteContext(broken, { orgId: 'org-1', hostId: 'h1' })).toBeNull()
  })
})

describe('prefillAiBusinessProfile (AGL-3661)', () => {
  it("fills what is empty and leaves the owner's words alone", async () => {
    const { firestore, docs } = memoryFirestore({
      'hosts/h1/businessProfile/profile': { audience: 'Mine', sources: { audience: 'owner' } },
    })
    const now = new Date(1_000)
    expect(await prefillAiBusinessProfile(firestore, 'h1', { audience: 'Theirs', serviceArea: 'Austin' }, 'start', now)).toBe(true)
    expect(docs.get('hosts/h1/businessProfile/profile')).toEqual({
      audience: 'Mine',
      serviceArea: 'Austin',
      sources: { audience: 'owner', serviceArea: 'start' },
      updatedAt: now,
      updatedBy: null,
    })
    expect(await prefillAiBusinessProfile(firestore, 'h1', { serviceArea: 'Austin' }, 'start', now)).toBe(false)
  })
})

describe('rememberAiSitePreferences (AGL-3661)', () => {
  it('counts a repeat, and forgets the other preference of the same group', async () => {
    const { firestore, docs } = memoryFirestore({
      'hosts/h1/aiMemory/tone-formal': { text: 'Prefers a formal, professional tone', group: 'tone', count: 4 },
      'hosts/h1/aiMemory/copy-short': { text: 'Prefers short, concise copy', group: 'length', count: 1 },
    })
    await rememberAiSitePreferences(
      firestore,
      'h1',
      [
        { id: 'tone-casual', group: 'tone', text: 'Prefers a casual, friendly tone' },
        { id: 'copy-short', group: 'length', text: 'Prefers short, concise copy' },
      ],
      new Date(5),
    )
    expect(docs.has('hosts/h1/aiMemory/tone-formal')).toBe(false)
    expect(docs.get('hosts/h1/aiMemory/tone-casual')).toMatchObject({ count: 1, lastSeenAtMs: 5 })
    expect(docs.get('hosts/h1/aiMemory/copy-short')).toMatchObject({ count: 2 })
  })

  it('keeps at most twelve, dropping the least repeated', async () => {
    const seed: Record<string, Data> = {}
    for (let i = 0; i < 12; i += 1) {
      seed[`hosts/h1/aiMemory/removes-${i}`] = { text: `Removes ${i}`, group: `removes-${i}`, count: i === 0 ? 1 : 2, lastSeenAtMs: 1 }
    }
    const { firestore, docs } = memoryFirestore(seed)
    await rememberAiSitePreferences(firestore, 'h1', [{ id: 'new', group: 'new', text: 'New' }], new Date(9))
    const left = [...docs.keys()].filter((key) => key.startsWith('hosts/h1/aiMemory/'))
    expect(left).toHaveLength(12)
    expect(docs.has('hosts/h1/aiMemory/removes-0')).toBe(false)
    expect(docs.has('hosts/h1/aiMemory/new')).toBe(true)
  })
})

describe('the site job prefill (AGL-3661)', () => {
  const job = (overrides: Partial<AiJob> = {}): AiJob =>
    ({
      $id: 'j1',
      orgId: 'org-1',
      hostId: 'h1',
      kind: 'site',
      inputs: { businessType: 'a local dog groomer', audience: 'busy dog owners', city: 'Austin' },
      plan: { screens: [{ slug: '/', seoDescription: 'Calm, gentle dog grooming in Austin.' }] },
      ...overrides,
    }) as unknown as AiJob

  it("reads the start's answers as the owner's words given elsewhere", () => {
    expect(aiBusinessProfileStartValues(job())).toEqual({
      whatYouDo: 'A local dog groomer',
      audience: 'busy dog owners',
      serviceArea: 'Austin',
    })
    expect(aiBusinessProfileStartValues(job({ kind: 'page' }))).toBeNull()
  })

  it("writes the start's answers, and the plan's line only where the start said nothing", async () => {
    const { firestore, docs } = memoryFirestore()
    await aiBusinessProfilePrefiller(() => firestore)({ job: job(), to: 'done' })
    expect(docs.get('hosts/h1/businessProfile/profile')).toMatchObject({
      whatYouDo: 'A local dog groomer',
      sources: { whatYouDo: 'start', audience: 'start', serviceArea: 'start' },
    })
    const bare = memoryFirestore()
    await aiBusinessProfilePrefiller(() => bare.firestore)({ job: job({ inputs: {} }), to: 'done' })
    expect(bare.docs.get('hosts/h1/businessProfile/profile')).toMatchObject({
      whatYouDo: 'Calm, gentle dog grooming in Austin.',
      sources: { whatYouDo: 'ai' },
    })
  })

  it('writes nothing for a failed job or another kind, and never throws', async () => {
    const { firestore, docs } = memoryFirestore()
    await aiBusinessProfilePrefiller(() => firestore)({ job: job(), to: 'failed' })
    await aiBusinessProfilePrefiller(() => firestore)({ job: job({ kind: 'page' }), to: 'done' })
    expect(docs.size).toBe(0)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(
      aiBusinessProfilePrefiller(() => {
        throw new Error('unavailable')
      })({ job: job(), to: 'done' }),
    ).resolves.toBeUndefined()
  })
})
