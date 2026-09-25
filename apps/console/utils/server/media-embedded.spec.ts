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

import { MEDIA_EMBEDDED_METADATA_VERSION } from '@aglyn/aglyn/app-utils/media-embedded-fields'
import { crc32 } from 'zlib'
import {
  embeddedMetadataAtIngress,
  embeddedMetadataIsCurrent,
  storageObjectReader,
} from './media-embedded'

describe('storageObjectReader (AGL-3331)', () => {
  const bytes = Buffer.from('0123456789')
  const calls: Array<{ start: number; end: number }> = []
  const file = {
    download: async ({ start, end }: { start: number; end: number }) => {
      calls.push({ start, end })
      return [bytes.subarray(start, end + 1)] as [Buffer]
    },
  }

  beforeEach(() => {
    calls.length = 0
  })

  it('turns the exclusive end into GCS inclusive one', async () => {
    const reader = storageObjectReader(file, bytes.length)
    expect(Buffer.from(await reader.read(2, 5)).toString()).toBe('234')
    expect(calls).toEqual([{ start: 2, end: 4 }])
  })

  it('clamps to the object and never asks for an empty range', async () => {
    const reader = storageObjectReader(file, bytes.length)
    expect(Buffer.from(await reader.read(8, 99)).toString()).toBe('89')
    expect((await reader.read(5, 5)).length).toBe(0)
    expect((await reader.read(20, 30)).length).toBe(0)
    expect(calls).toEqual([{ start: 8, end: 9 }])
  })
})

describe('embeddedMetadataIsCurrent', () => {
  const record = {
    version: MEDIA_EMBEDDED_METADATA_VERSION,
    format: 'jpeg',
    fields: [],
    writable: true,
    contentSha256: 'abc',
  }

  it('trusts a record read from the bytes the document names', () => {
    expect(embeddedMetadataIsCurrent(record, 'abc')).toBe(true)
  })

  it('re-reads after a replace and after the reader changes shape', () => {
    expect(embeddedMetadataIsCurrent(record, 'def')).toBe(false)
    expect(embeddedMetadataIsCurrent({ ...record, version: 0 }, 'abc')).toBe(false)
    expect(embeddedMetadataIsCurrent(undefined, 'abc')).toBe(false)
    expect(embeddedMetadataIsCurrent({ ...record, fields: 'x' }, 'abc')).toBe(false)
  })

  it('accepts any record for a legacy asset with no digest', () => {
    expect(embeddedMetadataIsCurrent(record, undefined)).toBe(true)
  })
})

describe('embeddedMetadataAtIngress', () => {
  it('gives up at its budget rather than holding the upload', async () => {
    const stalled = {
      size: 10,
      read: () => new Promise<Uint8Array>(() => undefined),
    }
    await expect(
      embeddedMetadataAtIngress({
        contentType: 'image/jpeg',
        reader: stalled,
        budgetMs: 20,
      }),
    ).resolves.toBeNull()
  })

  it('answers null, not a throw, when the read fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = {
      size: 10,
      read: () => Promise.reject(new Error('storage down')),
    }
    await expect(
      embeddedMetadataAtIngress({ contentType: 'image/jpeg', reader: failing }),
    ).resolves.toBeNull()
    warn.mockRestore()
  })

  /** A 1×1 PNG carrying a `tEXt` title — enough for the real reader. */
  const titledPng = (title: string) => {
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
      const length = Buffer.alloc(4)
      length.writeUInt32BE(data.length)
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(body))
      return Buffer.concat([length, body, crc])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(1, 0)
    header.writeUInt32BE(1, 4)
    header[8] = 8
    header[9] = 2
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('tEXt', Buffer.from(`Title\0${title}`, 'latin1')),
        chunk('IEND', Buffer.alloc(0)),
      ]),
    )
  }

  it('reads bytes the route is already holding', async () => {
    const record = await embeddedMetadataAtIngress({
      contentType: 'image/png',
      bytes: titledPng('Harbor'),
      contentSha256: 'sha-1',
    })
    expect(record?.format).toBe('png')
    expect(record?.contentSha256).toBe('sha-1')
    expect(record?.fields.find((field) => field.key === 'title')?.value).toBe(
      'Harbor',
    )
  })

  it('answers null when there is nothing to read', async () => {
    await expect(
      embeddedMetadataAtIngress({ contentType: 'image/png' }),
    ).resolves.toBeNull()
  })

  it('answers null, not a throw, when the reader cannot even be built', async () => {
    // A server barrel without the reader — what a route spec's fake of
    // `@aglyn/aglyn/server` is. The route must still finish its write.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    let ingress: typeof embeddedMetadataAtIngress | undefined
    jest.isolateModules(() => {
      jest.doMock('@aglyn/aglyn/server', () => ({}))
      ingress = require('./media-embedded').embeddedMetadataAtIngress
    })
    await expect(
      (ingress as typeof embeddedMetadataAtIngress)({
        contentType: 'image/png',
        bytes: titledPng('Harbor'),
      }),
    ).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
