/**
 * @jest-environment node
 */
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

import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'
import { waiversFiles, waiversStorageBucket } from './db'
import { waiversBucket } from './person-eraser'

/*
 * The waivers file store and the erasure's bucket, through the REAL
 * firebase-admin Storage of an app initialized the way the server's admin app
 * is: with no `storageBucket`. A bare `bucket()` on that app throws "Bucket
 * name not specified or invalid", which is what every drawn signature, paper
 * photo and signature read hit; only the object I/O is faked here, never the
 * bucket resolution.
 */

let mockApp: App
jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ storage: () => jest.requireActual('firebase-admin/storage').getStorage(mockApp) }) },
}))

const BUCKET = 'waivers-spec.firebasestorage.app'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const saved: Array<{ bucket: string; path: string; bytes: Buffer; contentType: string }> = []
const previousBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET

beforeAll(() => {
  mockApp = initializeApp({ projectId: 'waivers-spec' }, 'waivers-bucket-spec')
  // The Bucket class of the SDK's own storage client (not imported: it is a
  // transitive dependency of firebase-admin).
  const bucketPrototype = Object.getPrototypeOf(getStorage(mockApp).bucket('prototype-only')) as { file(path: string): unknown }
  jest.spyOn(bucketPrototype, 'file').mockImplementation(function (this: { name: string }, path: string) {
    const bucket = this.name
    return {
      save: async (bytes: Buffer, options: { contentType: string }) => {
        saved.push({ bucket, path, bytes, contentType: options.contentType })
      },
      exists: async () => [saved.some((entry) => entry.bucket === bucket && entry.path === path)],
      download: async () => [saved.find((entry) => entry.bucket === bucket && entry.path === path)?.bytes],
    } as never
  })
})

afterAll(async () => {
  jest.restoreAllMocks()
  await deleteApp(mockApp)
  if (previousBucket === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  else process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = previousBucket
})

beforeEach(() => {
  saved.length = 0
  process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = BUCKET
})

describe('waivers storage bucket', () => {
  it('is the app without a default bucket the server runs (a bare bucket() throws)', () => {
    expect(() => getStorage(mockApp).bucket()).toThrow(/Bucket name not specified/)
  })

  it('names the configured bucket', () => {
    expect(waiversStorageBucket().name).toBe(BUCKET)
  })

  it('saves a drawn signature into the configured bucket and reads it back', async () => {
    const path = 'orgs/org-1/waiverSignatures/sig-1/signature.png'
    await waiversFiles().save(path, new Uint8Array(PNG), 'image/png')
    expect(saved).toEqual([expect.objectContaining({ bucket: BUCKET, path, contentType: 'image/png' })])
    expect(Buffer.from((await waiversFiles().read(path)) ?? [])).toEqual(PNG)
  })

  it('gives the erasure and the retention job a bucket to delete from', () => {
    expect(waiversBucket()).toEqual(expect.objectContaining({ name: BUCKET }))
  })
})
