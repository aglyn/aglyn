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
 * What the composition is told about a placed image or film (AGL-2807,
 * AGL-2833).
 *
 * The reader decides WHETHER a page may know an asset's facts, so it is pinned
 * against the verdict the CDN reaches for the same asset: a page never
 * publishes the shape of a file its own URL refuses. The CDN's scope rule is
 * the real one here, not a restatement of it.
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
import getMediaAssetFacts, {
  MEDIA_ASSET_FACTS_PER_RENDER,
} from './get-media-asset-facts'
import { getVideoAssetFacts, VIDEO_ASSET_FACTS_PER_RENDER } from './get-video-asset-facts'

const FILM = {
  video: { durationMs: 3000, width: 480, height: 480 },
  poster: { width: 480, height: 480, variants: [] },
}
const PHOTO = { width: 1200, height: 630 }

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

describe('getMediaAssetFacts (AGL-2807, AGL-2833)', () => {
  it('reads each document once, projected to the fields it decides from', async () => {
    mockDocs.set('orgs/acme/media/film', { ...FILM, visibleTo: ['org'] })
    const facts = await getMediaAssetFacts({
      hostId: 'site1',
      refs: [ref('org:acme'), ref('org:acme:site9')],
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    const call = mockGetAll.mock.calls[0]
    expect(pathsRead(call)).toEqual(['orgs/acme/media/film'])
    expect(call[call.length - 1]).toEqual({
      fieldMask: ['width', 'height', 'video', 'poster', 'deletedAt', 'private', 'visibleTo'],
    })
    // Every spelling that placed the film gets the one answer.
    expect(facts.get('org:acme/film')).toEqual(FILM)
    expect(facts.get('org:acme:site9/film')).toEqual(FILM)
  })

  it('answers every placed film and image in ONE call', async () => {
    mockDocs.set('hosts/site1/media/film', FILM)
    mockDocs.set('hosts/site1/media/photo', PHOTO)
    mockDocs.set('orgs/acme/media/logo', { width: 290, height: 88, visibleTo: ['org'] })
    const facts = await getMediaAssetFacts({
      hostId: 'site1',
      refs: [ref('site1'), ref('site1', 'photo'), ref('org:acme', 'logo')],
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual([
      'hosts/site1/media/film',
      'hosts/site1/media/photo',
      'orgs/acme/media/logo',
    ])
    expect(facts.get('site1/film')).toEqual(FILM)
    expect(facts.get('site1/photo')).toEqual(PHOTO)
    expect(facts.get('org:acme/logo')).toEqual({ width: 290, height: 88 })
  })

  it("reads a site-library asset from that site's own library", async () => {
    mockDocs.set('hosts/site1/media/photo', PHOTO)
    const facts = await getMediaAssetFacts({
      hostId: 'site1',
      refs: [ref('site1', 'photo')],
    })
    expect(pathsRead(mockGetAll.mock.calls[0])).toEqual(['hosts/site1/media/photo'])
    expect(facts.get('site1/photo')).toEqual(PHOTO)
  })

  it('answers nothing for an asset that is gone, deleted or private', async () => {
    mockDocs.set('hosts/site1/media/deleted', { ...PHOTO, deletedAt: 1 })
    mockDocs.set('hosts/site1/media/private', { ...PHOTO, private: true })
    const facts = await getMediaAssetFacts({
      hostId: 'site1',
      refs: [ref('site1', 'missing'), ref('site1', 'deleted'), ref('site1', 'private')],
    })
    expect(facts.size).toBe(0)
  })

  it('answers only on the site the CDN would serve a restricted asset to', async () => {
    mockDocs.set('orgs/acme/media/photo', {
      ...PHOTO,
      visibleTo: [hostScopeToken('site9')],
    })
    // The URL a page renders names the rendering site, so the verdict follows
    // the page, not the scope the reference was stored with.
    const refused = await getMediaAssetFacts({
      hostId: 'site1',
      refs: [ref('org:acme:site9', 'photo')],
    })
    expect(refused.size).toBe(0)
    const shared = await getMediaAssetFacts({
      hostId: 'site9',
      refs: [ref('org:acme', 'photo')],
    })
    expect(shared.get('org:acme/photo')).toEqual(PHOTO)
  })

  it('refuses an org asset with no scope at all, as the CDN does', async () => {
    mockDocs.set('orgs/acme/media/photo', PHOTO)
    const facts = await getMediaAssetFacts({
      hostId: 'site1',
      refs: [ref('org:acme', 'photo')],
    })
    expect(facts.size).toBe(0)
  })

  it('fails open to the stored props when the read fails', async () => {
    mockGetAll.mockRejectedValue(new Error('unavailable'))
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const facts = await getMediaAssetFacts({
        hostId: 'site1',
        refs: [ref('site1'), ref('site1', 'photo')],
      })
      expect(facts.size).toBe(0)
      expect(logged).toHaveBeenCalled()
    } finally {
      logged.mockRestore()
    }
  })

  it('reads nothing when no reference names a readable scope', async () => {
    expect((await getMediaAssetFacts({ hostId: 'site1', refs: [] })).size).toBe(0)
    expect(
      (await getMediaAssetFacts({ hostId: 'site1', refs: [ref('not a scope')] })).size,
    ).toBe(0)
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('reads the first documents it is handed, up to the cap, and answers only those', async () => {
    const refs = Array.from({ length: MEDIA_ASSET_FACTS_PER_RENDER + 5 }, (_, index) =>
      ref('site1', `photo${index}`),
    )
    refs.forEach((placed) => mockDocs.set(`hosts/site1/media/${placed.mediaId}`, PHOTO))
    const facts = await getMediaAssetFacts({ hostId: 'site1', refs })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    const read = pathsRead(mockGetAll.mock.calls[0])
    expect(read).toEqual(
      refs.slice(0, MEDIA_ASSET_FACTS_PER_RENDER).map((placed) => `hosts/site1/media/${placed.mediaId}`),
    )
    expect(facts.size).toBe(MEDIA_ASSET_FACTS_PER_RENDER)
    expect(facts.has(`site1/photo${MEDIA_ASSET_FACTS_PER_RENDER - 1}`)).toBe(true)
    expect(facts.has(`site1/photo${MEDIA_ASSET_FACTS_PER_RENDER}`)).toBe(false)
  })

  it('answers a film under its film name with the same read', async () => {
    mockDocs.set('hosts/site1/media/film', FILM)
    expect(VIDEO_ASSET_FACTS_PER_RENDER).toBe(MEDIA_ASSET_FACTS_PER_RENDER)
    const facts = await getVideoAssetFacts({ hostId: 'site1', refs: [ref('site1')] })
    expect(facts.get('site1/film')).toEqual(FILM)
  })
})
