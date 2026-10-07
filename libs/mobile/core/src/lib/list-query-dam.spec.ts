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

const calls: unknown[][] = []
jest.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => ({ collection: args.slice(1) }),
  doc: (...args: unknown[]) => ({ doc: args.slice(1) }),
  documentId: () => '__id__',
  getDoc: async () => ({ data: () => ({ cdnPath: '/cdn/m1.jpg' }) }),
  getDocs: async () => ({ docs: [] }),
  limit: (n: number) => ({ limit: n }),
  orderBy: (path: string, direction: string) => ({ orderBy: [path, direction] }),
  query: (...args: unknown[]) => args,
  Timestamp: { fromDate: (date: Date) => ({ seconds: Math.floor(date.getTime() / 1000) }) },
  where: (...args: unknown[]) => {
    calls.push(args)
    return { where: args }
  },
}))

import { DAM_SIGNED_UPLOAD_THRESHOLD_BYTES, replaceMedia, uploadMedia, type DamTransport } from './dam-upload'
import { listQueryConstraints, listWindowLimit, listWindowRows, searchWords } from './list-query'

describe('the native list window', () => {
  it('asks one probe row past the window and says whether there is more', () => {
    expect(listWindowLimit(1, 25)).toBe(26)
    expect(listWindowLimit(3, 10)).toBe(31)
    expect(listWindowRows([1, 2, 3], 1, 2)).toEqual({ rows: [1, 2], hasMore: true })
    expect(listWindowRows([1, 2], 1, 2)).toEqual({ rows: [1, 2], hasMore: false })
  })

  it('puts every planned predicate on the query, then its one order', () => {
    const at = new Date('2026-10-01T00:00:00Z')
    const constraints = listQueryConstraints({
      filters: [
        { path: 'status', op: '==', value: 'new' },
        { path: 'createdAt', op: '>=', value: at },
        { path: '__name__', op: 'in', value: ['a', 'b'] },
      ],
      orderBy: { path: 'createdAt', direction: 'desc' },
    } as never)
    expect(constraints).toEqual([
      { where: ['status', '==', 'new'] },
      { where: ['createdAt', '>=', { seconds: at.getTime() / 1000 }] },
      { where: ['__id__', 'in', ['a', 'b']] },
      { orderBy: ['createdAt', 'desc'] },
    ])
  })

  it('splits the search box into words', () => {
    expect(searchWords('  ada   lovelace ')).toEqual(['ada', 'lovelace'])
  })
})

describe('the DAM upload', () => {
  const transport = (): DamTransport & { sent: Array<[string, unknown]> } => {
    const sent: Array<[string, unknown]> = []
    return {
      sent,
      api: {
        request: async (path: string, init?: { method?: string; body?: unknown }) => {
          sent.push([`${init?.method ?? 'GET'} ${path}`, init?.body])
          return { mediaId: 'm1', url: 'https://x/m1.jpg', uploadUrl: 'https://signed' } as never
        },
      },
      putFile: async (url) => {
        sent.push([`PUT-FILE ${url}`, null])
      },
      readBase64: async () => 'QUJD',
    }
  }

  it('sends a small photo as base64 to the upload route and keeps its CDN path', async () => {
    const t = transport()
    const asset = await uploadMedia(t, {} as never, {
      scope: { hostId: 'h1' },
      file: { uri: 'file:///a.jpg', fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 },
    })
    expect(asset).toEqual({ mediaId: 'm1', url: '/cdn/m1.jpg' })
    expect(t.sent).toEqual([
      ['POST /api/media/upload', { hostId: 'h1', fileName: 'a.jpg', contentType: 'image/jpeg', folderId: null, data: 'QUJD' }],
    ])
  })

  it('mints, puts and finalizes a large one', async () => {
    const t = transport()
    await uploadMedia(t, {} as never, {
      scope: { orgId: 'o1' },
      file: { uri: 'file:///v.mov', fileName: 'v.mov', contentType: 'video/quicktime', sizeBytes: DAM_SIGNED_UPLOAD_THRESHOLD_BYTES + 1 },
    })
    expect(t.sent.map(([what]) => what)).toEqual([
      'POST /api/media/upload-url',
      'PUT-FILE https://signed',
      'PATCH /api/media/upload-url',
    ])
    expect((t.sent[0][1] as { orgId: string }).orgId).toBe('o1')
  })

  it('replaces in place with the precondition, never a second upload', async () => {
    const t = transport()
    await replaceMedia(t, {
      scope: { hostId: 'h1' },
      mediaId: 'm1',
      file: { uri: 'file:///a.jpg', fileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10, base64: 'Zg==' },
      expectedUpdatedAtMs: 42,
    })
    expect(t.sent).toEqual([
      [
        'POST /api/media/replace',
        { hostId: 'h1', mediaId: 'm1', contentType: 'image/jpeg', fileName: 'a.jpg', data: 'Zg==', expectedUpdatedAtMs: 42 },
      ],
    ])
  })
})
