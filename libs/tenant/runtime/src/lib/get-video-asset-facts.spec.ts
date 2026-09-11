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
 * What the composition is told about a placed film (AGL-2807).
 *
 * The reader decides WHETHER a page may know a film's facts, so it is pinned
 * against the verdict the CDN reaches for the same film: a page never
 * publishes the length or shape of a film its own URL refuses. The CDN's
 * scope rule is the real one here, not a restatement of it.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockGetAll = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  ...jest.requireActual('@aglyn/tenant-data-admin'),
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        doc: (path: string) => ({ path }),
        getAll: (...args: unknown[]) => mockGetAll(...args),
      }),
    }),
  },
}))

import { hostScopeToken } from '@aglyn/aglyn/server'
import getVideoAssetFacts, {
  VIDEO_ASSET_FACTS_PER_RENDER,
} from './get-video-asset-facts'

const RECORDS = {
  video: { durationMs: 3000, width: 480, height: 480 },
  poster: { width: 480, height: 480, variants: [] },
}
const ANSWER = { video: RECORDS.video, poster: RECORDS.poster }

const ref = (scope: string, mediaId = 'film') => ({ scope, mediaId })

/** The document references a call asked for, without its read options. */
const pathsRead = (call: unknown[]) =>
  call
    .filter((arg): arg is { path: string } =>
      typeof (arg as { path?: unknown })?.path === 'string',
    )
    .map((arg) => arg.path)

beforeEach(() => {
  mockDocs.clear()
  mockGetAll.mockReset()
  mockGetAll.mockImplementation(async (...args: unknown[]) =>
    pathsRead(args).map((path) => {
      const data = mockDocs.get(path)
      return { exists: data !== undefined, get: (field: string) => data?.[field] }
    }),
  )
})

describe('getVideoAssetFacts (AGL-2807)', () => {
  it('reads each film once, projected to the fields it decides from', async () => {
    mockDocs.set('orgs/acme/media/film', { ...RECORDS, visibleTo: ['org'] })
    const facts = await getVideoAssetFacts({
      hostId: 'site1',
      refs: [ref('org:acme'), ref('org:acme:site9')],
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    const call = mockGetAll.mock.calls[0]
    expect(pathsRead(call)).toEqual(['orgs/acme/media/film'])
    expect(call[call.length - 1]).toEqual({
      fieldMask: ['video', 'poster', 'deletedAt', 'private', 'visibleTo'],
    })
    // Every spelling that placed the film gets the one answer.
    expect(facts.get('org:acme/film')).toEqual(ANSWER)
    expect(facts.get('org:acme:site9/film')).toEqual(ANSWER)
  })

  it("reads a site-library film from that site's own library", async () => {
    mockDocs.set('hosts/site1/media/film', RECORDS)
    const facts = await getVideoAssetFacts({ hostId: 'site1', refs: [ref('site1')] })
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual(['hosts/site1/media/film'])
    expect(facts.get('site1/film')).toEqual(ANSWER)
  })

  it('answers nothing for a film that is gone, deleted or private', async () => {
    mockDocs.set('hosts/site1/media/deleted', { ...RECORDS, deletedAt: 1 })
    mockDocs.set('hosts/site1/media/private', { ...RECORDS, private: true })
    const facts = await getVideoAssetFacts({
      hostId: 'site1',
      refs: [ref('site1', 'missing'), ref('site1', 'deleted'), ref('site1', 'private')],
    })
    expect(facts.size).toBe(0)
  })

  it("answers only on the site the CDN would serve a restricted film to", async () => {
    mockDocs.set('orgs/acme/media/film', {
      ...RECORDS,
      visibleTo: [hostScopeToken('site9')],
    })
    // The URL a page renders names the rendering site, so the verdict follows
    // the page, not the scope the reference was stored with.
    const refused = await getVideoAssetFacts({
      hostId: 'site1',
      refs: [ref('org:acme:site9')],
    })
    expect(refused.size).toBe(0)
    const shared = await getVideoAssetFacts({ hostId: 'site9', refs: [ref('org:acme')] })
    expect(shared.get('org:acme/film')).toEqual(ANSWER)
  })

  it('refuses an org film with no scope at all, as the CDN does', async () => {
    mockDocs.set('orgs/acme/media/film', RECORDS)
    const facts = await getVideoAssetFacts({ hostId: 'site1', refs: [ref('org:acme')] })
    expect(facts.size).toBe(0)
  })

  it('fails open to the stored props when the read fails', async () => {
    mockGetAll.mockRejectedValue(new Error('unavailable'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const facts = await getVideoAssetFacts({ hostId: 'site1', refs: [ref('site1')] })
      expect(facts.size).toBe(0)
      expect(logged).toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })

  it('reads nothing when no reference names a readable scope', async () => {
    expect((await getVideoAssetFacts({ hostId: 'site1', refs: [] })).size).toBe(0)
    expect(
      (await getVideoAssetFacts({ hostId: 'site1', refs: [ref('not a scope')] })).size,
    ).toBe(0)
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('bounds the documents one composition reads', async () => {
    const refs = Array.from({ length: VIDEO_ASSET_FACTS_PER_RENDER + 5 }, (_, index) =>
      ref('site1', `film${index}`),
    )
    await getVideoAssetFacts({ hostId: 'site1', refs })
    expect(pathsRead(mockGetAll.mock.calls[0])).toHaveLength(
      VIDEO_ASSET_FACTS_PER_RENDER,
    )
  })
})
