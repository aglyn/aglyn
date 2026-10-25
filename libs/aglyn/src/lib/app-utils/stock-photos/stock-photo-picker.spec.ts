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

import { STOCK_PHOTO_QUERY_MAX_CHARS } from '../../plugin-manager/stock-photo-provider'
import {
  createStockPhotoPickerClient,
  normalizeStockPhotoQuery,
  stockPhotoHitRefOf,
  stockPhotoOrientationOf,
  stockPhotoPickerMediaOf,
  stockPhotoSafeLink,
  stockPhotoTargetOf,
} from './stock-photo-picker'

/**
 * The wire of the media picker's Stock photos tab (AGL-4066): what the
 * server accepts from a browser, and what the browser's client makes of
 * every answer, the friendly ones included.
 */

describe('what the server accepts from the Stock photos tab', () => {
  it('takes plain search words, up to the library limit', () => {
    expect(normalizeStockPhotoQuery('  coffee \n shop\tcounter ')).toBe('coffee shop counter')
    expect(normalizeStockPhotoQuery('a'.repeat(STOCK_PHOTO_QUERY_MAX_CHARS))).toHaveLength(STOCK_PHOTO_QUERY_MAX_CHARS)
    expect(normalizeStockPhotoQuery('a'.repeat(STOCK_PHOTO_QUERY_MAX_CHARS + 1))).toBeNull()
    expect(normalizeStockPhotoQuery('   ')).toBeNull()
    expect(normalizeStockPhotoQuery(42)).toBeNull()
  })

  it('offers three shapes and reads anything else as any', () => {
    expect(stockPhotoOrientationOf('vertical')).toBe('vertical')
    expect(stockPhotoOrientationOf('horizontal')).toBe('horizontal')
    expect(stockPhotoOrientationOf('square')).toBe('any')
    expect(stockPhotoOrientationOf(undefined)).toBe('any')
  })

  it('names exactly one library, by a document id', () => {
    expect(stockPhotoTargetOf({ hostId: 'host-1' })).toEqual({ hostId: 'host-1' })
    expect(stockPhotoTargetOf({ orgId: 'org-1' })).toEqual({ orgId: 'org-1' })
    expect(stockPhotoTargetOf({ hostId: 'host-1', orgId: 'org-1' })).toBeNull()
    expect(stockPhotoTargetOf({})).toBeNull()
    expect(stockPhotoTargetOf({ hostId: 'hosts/other' })).toBeNull()
    expect(stockPhotoTargetOf({ orgId: 7 })).toBeNull()
  })

  it('reads a photo back by its search and id alone', () => {
    expect(stockPhotoHitRefOf({ query: ' yoga ', orientation: 'vertical', id: '7101001', credit: 'forged' })).toEqual({
      query: 'yoga',
      orientation: 'vertical',
      id: '7101001',
    })
    expect(stockPhotoHitRefOf({ query: 'yoga', id: '../../x' })).toBeNull()
    expect(stockPhotoHitRefOf({ query: '', id: '1' })).toBeNull()
    expect(stockPhotoHitRefOf(null)).toBeNull()
  })

  it('links only https addresses', () => {
    expect(stockPhotoSafeLink('https://pixabay.com/photos/yoga-1/')).toBe('https://pixabay.com/photos/yoga-1/')
    expect(stockPhotoSafeLink('javascript:alert(1)')).toBeUndefined()
    expect(stockPhotoSafeLink('http://example.com/')).toBeUndefined()
    expect(stockPhotoSafeLink('https://user:pass@example.com/')).toBeUndefined()
  })

  it('hands on the media document fields a library pick does, and nothing else', () => {
    expect(
      stockPhotoPickerMediaOf('m1', {
        fileName: 'pixabay-7101001.jpg',
        contentType: 'image/jpeg',
        url: 'https://storage.example/m1',
        cdnPath: '/api/media/cdn/host-1/m1',
        width: 1280,
        height: 853,
        variants: [320, 640, 'x'],
        folderId: null,
        description: 'Photo by StudioLight on Pixabay.',
        uploadedBy: 'member-1',
        createdAt: { seconds: 1 },
      }),
    ).toEqual({
      $id: 'm1',
      fileName: 'pixabay-7101001.jpg',
      contentType: 'image/jpeg',
      url: 'https://storage.example/m1',
      cdnPath: '/api/media/cdn/host-1/m1',
      width: 1280,
      height: 853,
      variants: [320, 640],
      folderId: null,
      description: 'Photo by StudioLight on Pixabay.',
    })
  })
})

describe('the Stock photos client', () => {
  const answering = (status: number, body: unknown, type = 'application/json') =>
    jest.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } }))

  it('posts every request for its one library', async () => {
    const post = answering(200, { status: 'ready', library: { label: 'Pixabay' } })
    const client = createStockPhotoPickerClient(post, { hostId: 'host-1' })
    expect(await client.status()).toEqual({ status: 'ready', library: { label: 'Pixabay' } })
    await client.search('yoga', 'vertical')
    await client.importPhoto({ query: 'yoga', orientation: 'vertical', id: '1' }, { folderId: 'f1' })
    expect(post.mock.calls.map(([body]) => body)).toEqual([
      { action: 'status', hostId: 'host-1' },
      { action: 'search', hostId: 'host-1', query: 'yoga', orientation: 'vertical' },
      { action: 'import', hostId: 'host-1', ref: { query: 'yoga', orientation: 'vertical', id: '1' }, folderId: 'f1' },
    ])
    const org = createStockPhotoPickerClient(post, { orgId: 'org-1' })
    await org.status()
    expect(post.mock.calls[3][0]).toEqual({ action: 'status', orgId: 'org-1' })
  })

  it("says a refusal in the route's own words", async () => {
    const client = createStockPhotoPickerClient(
      answering(423, { error: 'This workspace is locked, so nothing can be added.' }),
      { hostId: 'host-1' },
    )
    expect(await client.search('yoga', 'any')).toEqual({
      status: 'refused',
      message: 'This workspace is locked, so nothing can be added.',
    })
  })

  it('passes the friendly answers through as they are', async () => {
    const client = createStockPhotoPickerClient(
      answering(200, { status: 'busy', message: 'Pixabay is busy right now. Try again in a minute.' }),
      { hostId: 'host-1' },
    )
    expect(await client.search('yoga', 'any')).toEqual({ status: 'busy', message: 'Pixabay is busy right now. Try again in a minute.' })
    const gone = createStockPhotoPickerClient(answering(404, { status: 'gone', message: 'gone' }), { hostId: 'host-1' })
    expect(await gone.importPhoto({ query: 'yoga', orientation: 'any', id: '1' })).toEqual({ status: 'refused', message: 'gone' })
  })

  it('says the connection failed when nothing answered', async () => {
    const client = createStockPhotoPickerClient(
      jest.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
      { hostId: 'host-1' },
    )
    expect(await client.status()).toEqual({ status: 'refused', message: expect.stringMatching(/could not be reached/) })
    expect(await client.preview({ query: 'yoga', orientation: 'any', id: '1' })).toBeNull()
  })

  it('takes a preview only when it is an image', async () => {
    const ref = { query: 'yoga', orientation: 'any' as const, id: '1' }
    const image = createStockPhotoPickerClient(
      jest.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } })),
      { hostId: 'host-1' },
    )
    expect((await image.preview(ref))?.type).toBe('image/jpeg')
    const none = createStockPhotoPickerClient(jest.fn(async () => new Response(null, { status: 204 })), { hostId: 'host-1' })
    expect(await none.preview(ref)).toBeNull()
    const page = createStockPhotoPickerClient(answering(200, '<html></html>', 'text/html'), { hostId: 'host-1' })
    expect(await page.preview(ref)).toBeNull()
  })
})
