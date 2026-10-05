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
 * The type and content hash behind a site's derived icons (AGL-3484): one
 * projected read, gated exactly as the CDN gates the bytes, and a hash that
 * moves when a DAM Replace changes the file — which is what moves every
 * derived icon's URL with it.
 */

const mockDocs = new Map<string, Record<string, unknown>>()
const mockGetAll = jest.fn()

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        doc: (path: string) => ({ path }),
        getAll: (...args: unknown[]) => mockGetAll(...args),
      }),
    }),
  },
}))

import { siteIconSrc } from '@aglyn/aglyn/app-utils/site-icon-set'
import getSiteIconFacts from './get-site-icon-facts'

const FAVICON = '/api/media/cdn/org:acme:site1/fav'
const APP_ICON = '/api/media/cdn/org:acme:site1/app'

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

describe('getSiteIconFacts (AGL-3484)', () => {
  it('reads each source once, projected, and answers by src', async () => {
    mockDocs.set('orgs/acme/media/fav', {
      visibleTo: ['org'],
      contentType: 'image/png',
      contentHash: 'h1',
    })
    const facts = await getSiteIconFacts({
      hostId: 'site1',
      srcs: [FAVICON, FAVICON, undefined],
    })
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    const call = mockGetAll.mock.calls[0]
    expect(pathsRead(call)).toEqual(['orgs/acme/media/fav'])
    expect(call[call.length - 1].fieldMask).toEqual(
      expect.arrayContaining(['contentType', 'contentHash', 'visibleTo', 'private']),
    )
    expect(facts.get(FAVICON)).toEqual({ contentType: 'image/png', contentHash: 'h1' })
  })

  it('moves the derived icon URL when a Replace changes the hash', async () => {
    mockDocs.set('orgs/acme/media/app', {
      visibleTo: ['org'],
      contentType: 'image/png',
      contentHash: 'before',
    })
    const urlNow = async () => {
      const facts = await getSiteIconFacts({ hostId: 'site1', srcs: [APP_ICON] })
      return siteIconSrc(APP_ICON, { plate: 'ico' }, {
        version: facts.get(APP_ICON)?.contentHash,
      })
    }
    const before = await urlNow()
    mockDocs.set('orgs/acme/media/app', {
      visibleTo: ['org'],
      contentType: 'image/png',
      contentHash: 'after',
    })
    const after = await urlNow()
    expect(before).toBe(`${APP_ICON}?icon=ico&v=before`)
    expect(after).toBe(`${APP_ICON}?icon=ico&v=after`)
  })

  it('answers nothing for an asset the CDN would refuse', async () => {
    mockDocs.set('orgs/acme/media/fav', {
      visibleTo: ['org'],
      private: true,
      contentType: 'image/png',
      contentHash: 'h1',
    })
    mockDocs.set('orgs/acme/media/app', {
      visibleTo: ['org'],
      deletedAt: 1,
      contentType: 'image/png',
    })
    const facts = await getSiteIconFacts({
      hostId: 'site1',
      srcs: [FAVICON, APP_ICON],
    })
    expect(facts.size).toBe(0)
  })

  it('reads nothing for a source that is not ours, or with no site', async () => {
    expect(
      (
        await getSiteIconFacts({
          hostId: 'site1',
          srcs: ['https://cdn.example.com/icon.png', 'data:,'],
        })
      ).size,
    ).toBe(0)
    expect((await getSiteIconFacts({ hostId: undefined, srcs: [FAVICON] })).size).toBe(0)
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('fails open to no facts when the read fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGetAll.mockRejectedValue(new Error('unavailable'))
    const facts = await getSiteIconFacts({ hostId: 'site1', srcs: [FAVICON] })
    expect(facts.size).toBe(0)
  })
})
