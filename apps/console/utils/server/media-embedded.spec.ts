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
})
