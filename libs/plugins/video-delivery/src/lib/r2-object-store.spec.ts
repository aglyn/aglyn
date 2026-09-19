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

import { createR2ObjectStore, deleteR2Prefix, r2CredentialsUsable } from './r2-object-store'
import { createFakeR2Endpoint } from './testing/fake-r2-endpoint'

/**
 * The four S3 calls the copy flow makes against R2 (AGL-2824), driven
 * against an in-memory bucket that recomputes every request's signature. No
 * network is involved anywhere in this file.
 */

const CREDENTIALS = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucket: 'video-test',
  accessKeyId: 'test-access-key',
  secretAccessKey: 'test-secret-access-key',
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

describe('the R2 object store (AGL-2824)', () => {
  it('puts a streamed body, signed, under its exact key and type', async () => {
    const endpoint = createFakeR2Endpoint({ ...CREDENTIALS })
    const store = createR2ObjectStore(CREDENTIALS, { fetch: endpoint.fetch })
    await store.putObject({
      key: 'hosts/host-1/med-film/0123456789abcdef/master/0123456789abcdef',
      body: streamOf('FILM-', 'BYTES'),
      contentLength: 10,
      contentType: 'video/mp4',
    })
    const stored = endpoint.objects.get(
      'hosts/host-1/med-film/0123456789abcdef/master/0123456789abcdef',
    )
    expect(text(stored?.bytes)).toBe('FILM-BYTES')
    expect(stored?.contentType).toBe('video/mp4')
  })

  it('fails a put whose announced length is not what it sends', async () => {
    const endpoint = createFakeR2Endpoint({ ...CREDENTIALS })
    const store = createR2ObjectStore(CREDENTIALS, { fetch: endpoint.fetch })
    await expect(
      store.putObject({
        key: 'hosts/host-1/med-film/a/master/b',
        body: streamOf('SHORT'),
        contentLength: 99,
        contentType: 'video/mp4',
      }),
    ).rejects.toThrow(/put failed: 400 IncompleteBody/)
  })

  it('is refused by the bucket when signed with another secret', async () => {
    const endpoint = createFakeR2Endpoint({ ...CREDENTIALS })
    const store = createR2ObjectStore(
      { ...CREDENTIALS, secretAccessKey: 'not-the-secret' },
      { fetch: endpoint.fetch },
    )
    await expect(store.deleteObject('hosts/host-1/x/y')).rejects.toThrow(
      /403 SignatureDoesNotMatch/,
    )
  })

  it('heads, deletes, and deletes a missing key without complaint', async () => {
    const endpoint = createFakeR2Endpoint({ ...CREDENTIALS })
    const store = createR2ObjectStore(CREDENTIALS, { fetch: endpoint.fetch })
    await store.putObject({
      key: 'orgs/acme/film/h/master/h',
      body: new TextEncoder().encode('BYTES'),
      contentLength: 5,
      contentType: 'video/webm',
    })
    expect(await store.headObject('orgs/acme/film/h/master/h')).toEqual({
      size: 5,
      contentType: 'video/webm',
    })
    await store.deleteObject('orgs/acme/film/h/master/h')
    expect(await store.headObject('orgs/acme/film/h/master/h')).toBeNull()
    await expect(store.deleteObject('orgs/acme/film/h/master/h')).resolves.toBeUndefined()
  })

  it('lists and deletes everything under a prefix across pages, and nothing outside it', async () => {
    const endpoint = createFakeR2Endpoint({ ...CREDENTIALS, pageSize: 2 })
    const store = createR2ObjectStore(CREDENTIALS, { fetch: endpoint.fetch })
    const put = (key: string) =>
      store.putObject({
        key,
        body: new TextEncoder().encode('x'),
        contentLength: 1,
        contentType: 'video/mp4',
      })
    for (const key of [
      'hosts/host-1/film/a/master/a',
      'hosts/host-1/film/a/r-720p/b',
      'hosts/host-1/other/c/master/c',
      'hosts/host-10/film/d/master/d',
      'orgs/acme/film/e/master/e',
    ]) {
      await put(key)
    }
    expect(await deleteR2Prefix(store, 'hosts/host-1/')).toBe(3)
    // `hosts/host-1/` is not a prefix of `hosts/host-10/`: the slash is why
    // every prefix ends in one.
    expect([...endpoint.objects.keys()].sort()).toEqual([
      'hosts/host-10/film/d/master/d',
      'orgs/acme/film/e/master/e',
    ])
  })

  it('refuses a prefix that could reach beyond one library', async () => {
    const store = createR2ObjectStore(CREDENTIALS, {
      fetch: createFakeR2Endpoint({ ...CREDENTIALS }).fetch,
    })
    for (const prefix of ['', '/', 'hosts/', 'hosts', 'hosts/host-1']) {
      await expect(deleteR2Prefix(store, prefix)).rejects.toThrow(/Refusing/)
    }
  })

  it('accepts only an account id and bucket that can form an endpoint', () => {
    expect(r2CredentialsUsable(CREDENTIALS)).toBe(true)
    expect(r2CredentialsUsable({ ...CREDENTIALS, accountId: 'evil.example/x' })).toBe(false)
    expect(r2CredentialsUsable({ ...CREDENTIALS, bucket: 'Bad_Bucket' })).toBe(false)
    expect(r2CredentialsUsable({ ...CREDENTIALS, secretAccessKey: '' })).toBe(false)
    expect(() => createR2ObjectStore({ ...CREDENTIALS, accountId: 'nope' })).toThrow()
  })
})
