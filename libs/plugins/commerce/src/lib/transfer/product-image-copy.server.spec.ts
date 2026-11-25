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
 *
 * @jest-environment node
 */

/*
 * Copying a product file's photos (AGL-4245): the fetch through the SSRF
 * primitives with a fake resolver and transport (no request leaves the
 * process), and the copier against a fake media library door.
 */

import type { PluginMediaIngest, PluginMediaIngestRequest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import {
  fetchProductImage,
  productImageCopier,
  productImageKey,
  type ProductImageFetchDeps,
  type ProductImageFetchResult,
} from './product-image-copy.server'
import { PRODUCT_IMPORT_FOLDER_NAME, PRODUCT_IMPORT_IMAGE_SLOT_MS } from './product-images'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

/** A resolver and a transport answering from tables. */
function fakeNet(
  addresses: Record<string, string | null>,
  answers: Record<string, () => Response>,
): ProductImageFetchDeps & { asked: string[]; closed: number } {
  const net = {
    asked: [] as string[],
    closed: 0,
    resolvePublicIp: async (hostname: string) => addresses[hostname] ?? null,
    createPinnedDispatcher: () => ({
      close: async () => {
        net.closed += 1
      },
    }),
    fetch: async (url: string, init: Record<string, unknown>) => {
      net.asked.push(url)
      expect(init['redirect']).toBe('manual')
      expect(init['dispatcher']).toBeDefined()
      const answer = answers[url]
      if (!answer) throw new Error(`no answer for ${url}`)
      return answer()
    },
  }
  return net
}

const image = (body: Uint8Array, type = 'image/png', headers: Record<string, string> = {}) => () =>
  new Response(body as unknown as BodyInit, { status: 200, headers: { 'content-type': type, ...headers } })
const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } })

describe('fetching a photo', () => {
  it('reads a public https photo through the pinned address', async () => {
    const net = fakeNet({ 'cdn.shop.test': '203.0.113.10' }, { 'https://cdn.shop.test/a.png': image(PNG) })
    const result = await fetchProductImage('https://cdn.shop.test/a.png', {}, net)
    expect(result).toMatchObject({ ok: true, contentType: 'image/png', refusal: null })
    expect([...(result.data ?? [])]).toEqual([...PNG])
    expect(net.closed).toBe(1)
  })

  it('refuses http, credentials, another port, and a name that resolves to a private address', async () => {
    const net = fakeNet({ 'cdn.shop.test': '203.0.113.10', 'inside.test': null }, {})
    expect((await fetchProductImage('http://cdn.shop.test/a.png', {}, net)).refusal).toBe('refused-url')
    expect((await fetchProductImage('https://u:p@cdn.shop.test/a.png', {}, net)).refusal).toBe('refused-url')
    expect((await fetchProductImage('https://cdn.shop.test:8080/a.png', {}, net)).refusal).toBe('refused-url')
    expect((await fetchProductImage('https://inside.test/a.png', {}, net)).refusal).toBe('private-address')
    expect(net.asked).toEqual([])
  })

  it('checks every redirect again, so a public address cannot hand the fetch to a private one', async () => {
    const net = fakeNet(
      { 'cdn.shop.test': '203.0.113.10', 'img.shop.test': '203.0.113.11', metadata: null },
      {
        'https://cdn.shop.test/a.png': redirect('https://img.shop.test/a.png'),
        'https://img.shop.test/a.png': image(PNG),
        'https://cdn.shop.test/evil.png': redirect('https://metadata/computeMetadata'),
        'https://cdn.shop.test/down.png': redirect('http://img.shop.test/a.png'),
        'https://cdn.shop.test/loop.png': redirect('https://cdn.shop.test/loop.png'),
      },
    )
    expect(await fetchProductImage('https://cdn.shop.test/a.png', {}, net)).toMatchObject({ ok: true })
    expect((await fetchProductImage('https://cdn.shop.test/evil.png', {}, net)).refusal).toBe('private-address')
    expect((await fetchProductImage('https://cdn.shop.test/down.png', {}, net)).refusal).toBe('refused-url')
    expect((await fetchProductImage('https://cdn.shop.test/loop.png', {}, net)).refusal).toBe('too-many-redirects')
    expect(net.asked).not.toContain('https://metadata/computeMetadata')
  })

  it('takes only photos, only under the size limit, and says why it read nothing', async () => {
    const net = fakeNet(
      { 'cdn.shop.test': '203.0.113.10' },
      {
        'https://cdn.shop.test/page': image(new TextEncoder().encode('<html>'), 'text/html'),
        'https://cdn.shop.test/vector.svg': image(PNG, 'image/svg+xml'),
        'https://cdn.shop.test/big.png': image(PNG, 'image/png', { 'content-length': '999999999' }),
        'https://cdn.shop.test/long.png': image(new Uint8Array(64), 'image/png'),
        'https://cdn.shop.test/gone.png': () => new Response('missing', { status: 404 }),
        'https://cdn.shop.test/reset.png': () => {
          throw new Error('socket hang up')
        },
      },
    )
    expect((await fetchProductImage('https://cdn.shop.test/page', {}, net)).refusal).toBe('content-type')
    expect((await fetchProductImage('https://cdn.shop.test/vector.svg', {}, net)).refusal).toBe('content-type')
    expect((await fetchProductImage('https://cdn.shop.test/big.png', {}, net)).refusal).toBe('too-large')
    expect((await fetchProductImage('https://cdn.shop.test/long.png', { maxBytes: 16 }, net)).refusal).toBe('too-large')
    expect(await fetchProductImage('https://cdn.shop.test/gone.png', {}, net)).toMatchObject({ refusal: 'http-status', status: 404 })
    expect((await fetchProductImage('https://cdn.shop.test/reset.png', {}, net)).refusal).toBe('network')
  })
})

/** A media library door that stores in memory and finds by key. */
function fakeLibrary(options: { refuse?: string; folder?: string | null } = {}) {
  const stored: Array<PluginMediaIngestRequest & { mediaId: string }> = []
  const folders: string[] = []
  const ingest: PluginMediaIngest = {
    ingest: async (request) => {
      if (options.refuse) return { ok: false, status: 507, reason: options.refuse }
      const mediaId = `m${stored.length + 1}`
      stored.push({ ...request, mediaId })
      return { ok: true, mediaId, src: `media:${request.hostId}/${mediaId}` }
    },
    findStockPhoto: async () => null,
    findImportedPhoto: async ({ sourceKey }) => {
      const held = stored.find((entry) => entry.importedFrom?.key === sourceKey)
      return held ? { mediaId: held.mediaId, src: `media:${held.hostId}/${held.mediaId}` } : null
    },
    ensureFolder: async ({ name }) => {
      folders.push(name)
      return options.folder === undefined ? 'folder-1' : options.folder
    },
  }
  return { ingest, stored, folders }
}

const fetched = (): ProductImageFetchResult => ({ ok: true, data: PNG, contentType: 'image/png', refusal: null })

describe('copying photos into the library', () => {
  it('stores each address once, in the Imported products folder, keyed so it is found again', async () => {
    const library = fakeLibrary()
    const asked: string[] = []
    const copier = productImageCopier(
      { hostId: 'h1', uid: 'uid-1' },
      { ingest: library.ingest, fetch: async (url) => (asked.push(url), fetched()) },
    )
    const urls = ['https://cdn.shop.test/a.png', 'https://cdn.shop.test/b.png', 'https://cdn.shop.test/a.png']
    expect(await copier.copy(urls, Date.now() + 60_000)).toBe(true)
    expect(asked.sort()).toEqual(['https://cdn.shop.test/a.png', 'https://cdn.shop.test/b.png'])
    expect(library.folders).toEqual([PRODUCT_IMPORT_FOLDER_NAME])
    expect(library.stored.map((entry) => [entry.folderId, entry.importedFrom, entry.contentType, entry.fileName])).toEqual(
      expect.arrayContaining([
        ['folder-1', { key: productImageKey('https://cdn.shop.test/a.png'), url: 'https://cdn.shop.test/a.png', domain: 'cdn.shop.test' }, 'image/png', 'a.png'],
      ]),
    )
    expect(copier.result('https://cdn.shop.test/a.png')).toMatchObject({ ok: true, created: true, src: expect.stringMatching(/^media:h1\//) })

    // A second import of the same file finds what the first stored.
    const again = productImageCopier({ hostId: 'h1', uid: 'uid-1' }, { ingest: library.ingest, fetch: async () => fetched() })
    await again.copy(['https://cdn.shop.test/a.png'], Date.now() + 60_000)
    expect(again.result('https://cdn.shop.test/a.png')).toMatchObject({ ok: true, created: false })
    expect(library.stored).toHaveLength(2)
  })

  it('answers a failure for a photo, never a throw, and stores nothing without a folder', async () => {
    const refused = fakeLibrary({ refuse: 'Storage limit reached (500 MB)' })
    const copier = productImageCopier({ hostId: 'h1', uid: 'uid-1' }, { ingest: refused.ingest, fetch: async () => fetched() })
    await copier.copy(['https://cdn.shop.test/a.png'], Date.now() + 60_000)
    expect(copier.result('https://cdn.shop.test/a.png')).toEqual({
      ok: false,
      reason: 'your media library did not take it (Storage limit reached (500 MB))',
    })

    const gone = productImageCopier(
      { hostId: 'h1', uid: 'uid-1' },
      { ingest: fakeLibrary().ingest, fetch: async () => ({ ok: false, contentType: '', refusal: 'http-status', status: 404 }) },
    )
    await gone.copy(['https://cdn.shop.test/a.png'], Date.now() + 60_000)
    expect(gone.result('https://cdn.shop.test/a.png')).toEqual({ ok: false, reason: 'the old store no longer has it' })

    const noFolder = fakeLibrary({ folder: null })
    const unfiled = productImageCopier({ hostId: 'h1', uid: 'uid-1' }, { ingest: noFolder.ingest, fetch: async () => fetched() })
    await unfiled.copy(['https://cdn.shop.test/a.png'], Date.now() + 60_000)
    expect(unfiled.result('https://cdn.shop.test/a.png')).toMatchObject({ ok: false, reason: expect.stringMatching(/folder could not be made/) })
    expect(noFolder.stored).toEqual([])

    const noDoor = productImageCopier({ hostId: 'h1', uid: 'uid-1' }, { ingest: null })
    await noDoor.copy(['https://cdn.shop.test/a.png'], Date.now() + 60_000)
    expect(noDoor.result('https://cdn.shop.test/a.png')).toMatchObject({ ok: false })
  })

  it('starts no photo that could not finish before the deadline, and finishes on the next pass', async () => {
    let clock = 1_000_000
    const library = fakeLibrary()
    const copier = productImageCopier(
      { hostId: 'h1', uid: 'uid-1' },
      {
        ingest: library.ingest,
        now: () => clock,
        fetch: async () => {
          clock += PRODUCT_IMPORT_IMAGE_SLOT_MS
          return fetched()
        },
      },
    )
    const urls = ['https://cdn.shop.test/1.png', 'https://cdn.shop.test/2.png', 'https://cdn.shop.test/3.png', 'https://cdn.shop.test/4.png', 'https://cdn.shop.test/5.png']
    const finished = await copier.copy(urls, clock + PRODUCT_IMPORT_IMAGE_SLOT_MS + 1)
    expect(finished).toBe(false)
    expect(copier.pending(urls).length).toBeGreaterThan(0)
    expect(copier.pending(urls).length).toBeLessThan(urls.length)
    expect(await copier.copy(urls, clock + 10 * PRODUCT_IMPORT_IMAGE_SLOT_MS * urls.length)).toBe(true)
    expect(library.stored).toHaveLength(5)
  })
})
