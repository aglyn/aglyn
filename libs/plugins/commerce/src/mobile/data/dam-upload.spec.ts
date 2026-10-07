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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createApiDouble, firestoreDouble as double } from '../testing/firestore-double'
import { DAM_SIGNED_UPLOAD_THRESHOLD_BYTES, mediaForAddress, replaceMedia, uploadMedia } from './dam-upload'

jest.mock('firebase/firestore', () => require('../testing/firestore-double').firestoreDouble.module)

beforeEach(() => double.reset())

const small = { uri: 'file:///a.jpg', fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1000, base64: 'QUJD' }
const large = { ...small, sizeBytes: DAM_SIGNED_UPLOAD_THRESHOLD_BYTES + 1, base64: null }

const transport = (respond: (path: string, init: any) => unknown) => {
  const api = createApiDouble(respond)
  const puts: unknown[] = []
  return {
    api,
    puts,
    transport: {
      api: api.client,
      putFile: async (...args: unknown[]) => void puts.push(args),
      readBase64: async () => 'READ',
    },
  }
}

it('holds the threshold to the console library', () => {
  const limits = readFileSync(join(__dirname, '../../../../../../apps/console/utils/media-upload-limits.ts'), 'utf8')
  expect(limits).toMatch(/SIGNED_UPLOAD_THRESHOLD_BYTES = 3 \* MB/)
  expect(limits).toMatch(/MB = 1024 \* 1024/)
  expect(DAM_SIGNED_UPLOAD_THRESHOLD_BYTES).toBe(3 * 1024 * 1024)
})

it('uploads a small photo as base64 and keeps its CDN path', async () => {
  double.setDoc('hosts/h1/media/m1', { cdnPath: 'https://cdn.example/h1/m1', url: 'https://storage/x' })
  const t = transport(() => ({ mediaId: 'm1', url: 'https://storage/x' }))
  const asset = await uploadMedia(t.transport, double.db, { hostId: 'h1', file: small })
  expect(asset).toEqual({ mediaId: 'm1', url: 'https://cdn.example/h1/m1' })
  expect(t.api.calls).toEqual([
    {
      path: 'media/upload',
      init: { method: 'POST', body: { hostId: 'h1', fileName: 'a.jpg', contentType: 'image/jpeg', folderId: null, data: 'QUJD' } },
    },
  ])
})

it('mints, PUTs and finalizes a large photo', async () => {
  const t = transport((path, init) =>
    init.method === 'POST' ? { mediaId: 'm2', uploadUrl: 'https://signed', contentType: 'image/jpeg' } : { mediaId: 'm2', url: 'https://storage/m2' },
  )
  const asset = await uploadMedia(t.transport, double.db, { hostId: 'h1', file: large })
  expect(asset).toEqual({ mediaId: 'm2', url: 'https://storage/m2' })
  expect(t.api.calls.map((call) => `${call.init.method} ${call.path}`)).toEqual(['POST media/upload-url', 'PATCH media/upload-url'])
  expect(t.puts).toEqual([['https://signed', 'file:///a.jpg', 'image/jpeg']])
})

it('replaces in place with the precondition, never uploading a new asset', async () => {
  const t = transport(() => ({ replaced: true }))
  await replaceMedia(t.transport, { hostId: 'h1', mediaId: 'm1', file: { ...small, base64: null }, expectedUpdatedAtMs: 5 })
  expect(t.api.calls).toEqual([
    {
      path: 'media/replace',
      init: {
        method: 'POST',
        body: { hostId: 'h1', mediaId: 'm1', contentType: 'image/jpeg', fileName: 'a.jpg', data: 'READ', expectedUpdatedAtMs: 5 },
      },
    },
  ])
  const big = transport(() => ({ uploadUrl: 'https://signed' }))
  await replaceMedia(big.transport, { hostId: 'h1', mediaId: 'm1', file: large })
  expect(big.api.calls.map((call) => `${call.init.method} ${call.path}`)).toEqual(['PUT media/replace', 'PATCH media/replace'])
  expect(big.api.calls.some((call) => call.path.startsWith('media/upload'))).toBe(false)
})

it('finds the asset a product address names', async () => {
  double.setCollection('hosts/h1/media', [{ id: 'm1', data: { cdnPath: 'https://cdn.example/h1/m1', updatedAt: { seconds: 7 } } }])
  expect(await mediaForAddress(double.db, 'h1', 'https://cdn.example/h1/m1')).toEqual({ mediaId: 'm1', updatedAtMs: 7000 })
  expect(await mediaForAddress(double.db, 'h1', '')).toBeNull()
})
