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

import { deflateRawSync } from 'zlib'

import { EmbeddedWriteError } from './types'
import {
  crc32,
  findZipEntry,
  readZip,
  readZipEntry,
  rewriteZip,
  type ZipArchive,
} from './zip'

const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array | null) =>
  bytes === null ? null : new TextDecoder().decode(bytes)

interface EntrySpec {
  name: string
  content: string | Uint8Array
  method?: 0 | 8
  /** Bit 3: sizes and CRC zero in the local header, a descriptor after. */
  descriptor?: boolean
  encrypted?: boolean
  /** Sizes saturated, real values in a ZIP64 extra field. */
  zip64?: boolean
  utf8?: boolean
  /** Written into the local header's extra field. */
  localExtra?: Uint8Array
}

/** A ZIP written by hand, independent of the module's own writer. */
function buildZip(
  specs: EntrySpec[],
  options: {
    comment?: string
    prefix?: Uint8Array
    zip64Archive?: boolean
  } = {},
): Uint8Array {
  const parts: Uint8Array[] = []
  let position = 0
  const push = (bytes: Uint8Array) => {
    parts.push(bytes)
    position += bytes.length
  }
  if (options.prefix) push(options.prefix)
  const central: Uint8Array[] = []
  for (const spec of specs) {
    const content =
      typeof spec.content === 'string' ? encode(spec.content) : spec.content
    const method = spec.method ?? 8
    const data =
      method === 8 ? new Uint8Array(deflateRawSync(content)) : content
    const crc = crc32(content)
    const name = encode(spec.name)
    let flags = spec.utf8 ? 0x0800 : 0
    if (spec.descriptor) flags |= 0x0008
    if (spec.encrypted) flags |= 0x0001
    const zip64Extra = new Uint8Array(20)
    const zip64View = new DataView(zip64Extra.buffer)
    zip64View.setUint16(0, 0x0001, true)
    zip64View.setUint16(2, 16, true)
    zip64View.setUint32(4, content.length, true)
    zip64View.setUint32(12, data.length, true)
    const localExtra = spec.zip64
      ? zip64Extra
      : (spec.localExtra ?? new Uint8Array(0))

    const offset = position
    const local = new Uint8Array(30 + name.length + localExtra.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, spec.zip64 ? 45 : 20, true)
    lv.setUint16(6, flags, true)
    lv.setUint16(8, method, true)
    lv.setUint16(10, 0x6000, true)
    lv.setUint16(12, 0x5321, true)
    if (!spec.descriptor) {
      lv.setUint32(14, crc, true)
      lv.setUint32(18, spec.zip64 ? 0xffffffff : data.length, true)
      lv.setUint32(22, spec.zip64 ? 0xffffffff : content.length, true)
    }
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, localExtra.length, true)
    local.set(name, 30)
    local.set(localExtra, 30 + name.length)
    push(local)
    push(data)
    if (spec.descriptor) {
      const descriptor = new Uint8Array(16)
      const dv = new DataView(descriptor.buffer)
      dv.setUint32(0, 0x08074b50, true)
      dv.setUint32(4, crc, true)
      dv.setUint32(8, data.length, true)
      dv.setUint32(12, content.length, true)
      push(descriptor)
    }

    const centralExtra = spec.zip64 ? zip64Extra : new Uint8Array(0)
    const record = new Uint8Array(46 + name.length + centralExtra.length)
    const cv = new DataView(record.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 0x031e, true)
    cv.setUint16(6, spec.zip64 ? 45 : 20, true)
    cv.setUint16(8, flags, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, 0x6000, true)
    cv.setUint16(14, 0x5321, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, spec.zip64 ? 0xffffffff : data.length, true)
    cv.setUint32(24, spec.zip64 ? 0xffffffff : content.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint16(30, centralExtra.length, true)
    cv.setUint32(38, 0x81a40000, true)
    cv.setUint32(42, offset, true)
    record.set(name, 46)
    record.set(centralExtra, 46 + name.length)
    central.push(record)
  }
  const centralOffset = position
  for (const record of central) push(record)
  const centralSize = position - centralOffset
  if (options.zip64Archive) {
    const record = new Uint8Array(56)
    const rv = new DataView(record.buffer)
    rv.setUint32(0, 0x06064b50, true)
    rv.setUint32(4, 44, true)
    rv.setUint16(12, 45, true)
    rv.setUint16(14, 45, true)
    rv.setUint32(24, specs.length, true)
    rv.setUint32(32, specs.length, true)
    rv.setUint32(40, centralSize, true)
    rv.setUint32(48, centralOffset, true)
    const recordOffset = position
    push(record)
    const locator = new Uint8Array(20)
    const lv = new DataView(locator.buffer)
    lv.setUint32(0, 0x07064b50, true)
    lv.setUint32(8, recordOffset, true)
    lv.setUint32(16, 1, true)
    push(locator)
  }
  const comment = encode(options.comment ?? '')
  const eocd = new Uint8Array(22 + comment.length)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, options.zip64Archive ? 0xffff : specs.length, true)
  ev.setUint16(10, options.zip64Archive ? 0xffff : specs.length, true)
  ev.setUint32(12, options.zip64Archive ? 0xffffffff : centralSize, true)
  ev.setUint32(16, options.zip64Archive ? 0xffffffff : centralOffset, true)
  ev.setUint16(20, comment.length, true)
  eocd.set(comment, 22)
  push(eocd)
  const out = new Uint8Array(position)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** The bytes an entry owns: its local header up to the next entry or the directory. */
function span(archive: ZipArchive, name: string): Uint8Array {
  const ordered = [...archive.entries].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset,
  )
  const index = ordered.findIndex((entry) => entry.name === name)
  const entry = ordered[index]
  if (!entry) throw new Error(`no ${name}`)
  const end =
    ordered[index + 1]?.localHeaderOffset ?? archive.centralDirectoryOffset
  return archive.bytes.subarray(entry.localHeaderOffset, end)
}

function contentOf(archive: ZipArchive, name: string): string | null {
  const entry = findZipEntry(archive, name)
  return entry ? decode(readZipEntry(archive, entry)) : null
}

const FIXTURE: EntrySpec[] = [
  { name: 'mimetype', content: 'application/test', method: 0 },
  {
    name: 'word/document.xml',
    content: '<w:document>' + 'x'.repeat(5000) + '</w:document>',
  },
  { name: 'docProps/core.xml', content: '<core>old</core>', descriptor: true },
  {
    name: 'media/é.png',
    content: new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    method: 0,
    utf8: true,
  },
  {
    name: 'streamed.bin',
    content: 'streamed with a descriptor',
    descriptor: true,
  },
]

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(encode('The quick brown fox jumps over the lazy dog'))).toBe(
      0x414fa339,
    )
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('continues a running checksum from a seed', () => {
    const whole = crc32(encode('123456789'))
    expect(crc32(encode('6789'), crc32(encode('12345')))).toBe(whole)
  })
})

describe('readZip', () => {
  const bytes = buildZip(FIXTURE, { comment: 'an archive comment' })

  it('lists entries in directory order with their fields', () => {
    const archive = readZip(bytes)
    expect(archive?.entries.map((entry) => entry.name)).toEqual(
      FIXTURE.map((spec) => spec.name),
    )
    expect(archive?.zip64).toBe(false)
    expect(decode(archive?.comment ?? null)).toBe('an archive comment')
    const streamed = archive && findZipEntry(archive, 'streamed.bin')
    expect((streamed?.flags ?? 0) & 0x0008).toBe(0x0008)
  })

  it('reads stored, deflated, descriptor and UTF-8-named entries', () => {
    const archive = readZip(bytes)
    if (!archive) throw new Error('unreadable')
    expect(contentOf(archive, 'mimetype')).toBe('application/test')
    expect(contentOf(archive, 'word/document.xml')).toContain(
      'xxxx</w:document>',
    )
    expect(contentOf(archive, 'docProps/core.xml')).toBe('<core>old</core>')
    expect(contentOf(archive, 'streamed.bin')).toBe(
      'streamed with a descriptor',
    )
    const png = findZipEntry(archive, 'media/é.png')
    expect(png && Array.from(readZipEntry(archive, png) ?? [])).toEqual([
      137, 80, 78, 71, 1, 2, 3,
    ])
  })

  it('finds the end record behind a comment that contains its signature', () => {
    const fake = String.fromCharCode(0x50, 0x4b, 0x05, 0x06) + 'tail'
    const archive = readZip(buildZip(FIXTURE.slice(0, 2), { comment: fake }))
    expect(archive?.entries).toHaveLength(2)
  })

  it('tolerates junk appended after the archive', () => {
    const base = buildZip(FIXTURE.slice(0, 2))
    const junk = new Uint8Array(base.length + 10)
    junk.set(base)
    expect(readZip(junk)?.entries).toHaveLength(2)
  })

  it('keeps absolute offsets when a stub precedes the archive', () => {
    const archive = readZip(
      buildZip(FIXTURE.slice(0, 2), {
        prefix: encode('#!/bin/sh self-extracting stub\n'),
      }),
    )
    expect(archive && contentOf(archive, 'mimetype')).toBe('application/test')
  })

  it('reads a ZIP64 entry and a ZIP64 end record', () => {
    const archive = readZip(
      buildZip([{ name: 'big.xml', content: '<big/>', zip64: true }], {
        zip64Archive: true,
      }),
    )
    expect(archive?.zip64).toBe(true)
    expect(archive?.entries[0]?.zip64).toBe(true)
    expect(archive && contentOf(archive, 'big.xml')).toBe('<big/>')
  })

  it('refuses what is not a single-disk archive with a clean directory', () => {
    expect(readZip(new Uint8Array(0))).toBeNull()
    expect(
      readZip(encode('not a zip at all, just text that runs on')),
    ).toBeNull()
    // Directory offset past the end record.
    const broken = bytes.slice()
    const view = new DataView(broken.buffer)
    const eocd = broken.length - 22 - 'an archive comment'.length
    view.setUint32(eocd + 16, broken.length, true)
    expect(readZip(broken)).toBeNull()
    // More entries promised than the directory holds.
    const short = bytes.slice()
    new DataView(short.buffer).setUint16(eocd + 10, 99, true)
    new DataView(short.buffer).setUint16(eocd + 8, 99, true)
    expect(readZip(short)).toBeNull()
    // A spanned archive.
    const spanned = bytes.slice()
    new DataView(spanned.buffer).setUint16(eocd + 4, 1, true)
    expect(readZip(spanned)).toBeNull()
  })
})

describe('readZipEntry', () => {
  it('returns null on a CRC mismatch', () => {
    const bytes = buildZip([{ name: 'a.txt', content: 'hello', method: 0 }])
    const tampered = bytes.slice()
    tampered[30 + 'a.txt'.length] = 'j'.charCodeAt(0)
    const archive = readZip(tampered)
    const entry = archive && findZipEntry(archive, 'a.txt')
    expect(archive && entry && readZipEntry(archive, entry)).toBeNull()
  })

  it('stops a deflate bomb at the declared size', () => {
    const bomb = new Uint8Array(4 * 1024 * 1024)
    const bytes = buildZip([{ name: 'bomb.xml', content: bomb }])
    const lied = bytes.slice()
    const archive = readZip(lied)
    const entry = archive && findZipEntry(archive, 'bomb.xml')
    if (!archive || !entry) throw new Error('unreadable')
    // Claim a tiny uncompressed size: inflation must stop there, not at 4 MB.
    expect(
      readZipEntry(archive, { ...entry, uncompressedSize: 100 }),
    ).toBeNull()
    // And a size over the cap is not inflated at all.
    expect(readZipEntry(archive, entry, 1024)).toBeNull()
    expect(readZipEntry(archive, entry)?.length).toBe(bomb.length)
  })

  it('does not read encrypted or unknown-method entries', () => {
    const archive = readZip(
      buildZip([
        { name: 'secret.xml', content: 'x', encrypted: true },
        { name: 'odd.xml', content: 'y', method: 0 },
      ]),
    )
    if (!archive) throw new Error('unreadable')
    const secret = findZipEntry(archive, 'secret.xml')
    const odd = findZipEntry(archive, 'odd.xml')
    expect(secret && readZipEntry(archive, secret)).toBeNull()
    expect(odd && readZipEntry(archive, { ...odd, method: 12 })).toBeNull()
  })
})

describe('rewriteZip', () => {
  const original = buildZip(FIXTURE, {
    comment: 'kept comment',
    prefix: encode('STUB'),
  })
  const archive = readZip(original)
  if (!archive) throw new Error('fixture unreadable')

  it('replaces one entry and copies every other entry byte for byte', () => {
    const out = rewriteZip(
      archive,
      new Map([
        ['docProps/core.xml', encode('<core>new, longer value</core>')],
      ]),
    )
    const rewritten = readZip(out)
    if (!rewritten) throw new Error('output unreadable')
    expect(contentOf(rewritten, 'docProps/core.xml')).toBe(
      '<core>new, longer value</core>',
    )
    for (const spec of FIXTURE) {
      if (spec.name === 'docProps/core.xml') continue
      expect(
        Buffer.from(span(rewritten, spec.name)).equals(
          Buffer.from(span(archive, spec.name)),
        ),
      ).toBe(true)
      expect(contentOf(rewritten, spec.name)).toBe(
        contentOf(archive, spec.name),
      )
    }
    // The stub, the order and the comment survive.
    expect(decode(out.subarray(0, 4))).toBe('STUB')
    expect(rewritten.entries.map((entry) => entry.name)).toEqual(
      FIXTURE.map((spec) => spec.name),
    )
    expect(decode(rewritten.comment)).toBe('kept comment')
  })

  it('gives a replaced entry a fresh header: deflate, real sizes, no descriptor', () => {
    const out = rewriteZip(
      archive,
      new Map([['docProps/core.xml', encode('<core>v2</core>')]]),
    )
    const rewritten = readZip(out)
    const entry = rewritten && findZipEntry(rewritten, 'docProps/core.xml')
    if (!rewritten || !entry) throw new Error('output unreadable')
    expect(entry.method).toBe(8)
    expect(entry.flags & 0x0008).toBe(0)
    const local = new DataView(
      out.buffer,
      out.byteOffset + entry.localHeaderOffset,
    )
    expect(local.getUint16(6, true) & 0x0008).toBe(0)
    expect(local.getUint32(14, true)).toBe(crc32(encode('<core>v2</core>')))
    expect(local.getUint32(18, true)).toBe(entry.compressedSize)
    expect(local.getUint32(22, true)).toBe('<core>v2</core>'.length)
    // Its central record keeps everything the move did not force.
    const before = findZipEntry(archive, 'docProps/core.xml')?.centralRecord
    const after = entry.centralRecord
    if (!before) throw new Error('missing')
    expect(
      Buffer.from(after.subarray(46)).equals(Buffer.from(before.subarray(46))),
    ).toBe(true)
    expect(
      Buffer.from(after.subarray(12, 16)).equals(
        Buffer.from(before.subarray(12, 16)),
      ),
    ).toBe(true)
    expect(
      Buffer.from(after.subarray(32, 42)).equals(
        Buffer.from(before.subarray(32, 42)),
      ),
    ).toBe(true)
  })

  it('keeps the UTF-8 name flag of a replaced entry', () => {
    const out = rewriteZip(
      archive,
      new Map([['media/é.png', new Uint8Array([9, 9])]]),
    )
    const entry = findZipEntry(readZip(out) as ZipArchive, 'media/é.png')
    expect(entry?.flags).toBe(0x0800)
  })

  it('appends a new entry after the last one', () => {
    const out = rewriteZip(
      archive,
      new Map([['docProps/custom.xml', encode('<custom/>')]]),
      { now: new Date(Date.UTC(2026, 8, 24, 13, 45, 30)) },
    )
    const rewritten = readZip(out)
    if (!rewritten) throw new Error('output unreadable')
    expect(rewritten.entries.map((entry) => entry.name)).toEqual([
      ...FIXTURE.map((spec) => spec.name),
      'docProps/custom.xml',
    ])
    expect(contentOf(rewritten, 'docProps/custom.xml')).toBe('<custom/>')
    for (const spec of FIXTURE) {
      expect(
        Buffer.from(span(rewritten, spec.name)).equals(
          Buffer.from(span(archive, spec.name)),
        ),
      ).toBe(true)
    }
    const record = new DataView(
      rewritten.entries.at(-1)?.centralRecord.slice().buffer ??
        new ArrayBuffer(46),
    )
    // 13:45:30 and 2026-09-24 in MS-DOS form.
    expect(record.getUint16(12, true)).toBe((13 << 11) | (45 << 5) | 15)
    expect(record.getUint16(14, true)).toBe(
      ((2026 - 1980) << 9) | (9 << 5) | 24,
    )
  })

  it('moves the offset of an entry whose offset lives in a ZIP64 extra', () => {
    const bytes = buildZip([
      { name: 'first.xml', content: '<a/>' },
      { name: 'second.xml', content: '<b/>' },
    ])
    const plain = readZip(bytes)
    if (!plain) throw new Error('unreadable')
    // Rewrite second's central record to carry its offset in a ZIP64 extra.
    const second = plain.entries[1]
    if (!second) throw new Error('missing')
    const record = new Uint8Array(second.centralRecord.length + 12)
    record.set(second.centralRecord)
    const view = new DataView(record.buffer)
    view.setUint16(30, 12, true)
    view.setUint32(42, 0xffffffff, true)
    view.setUint16(46 + 'second.xml'.length, 0x0001, true)
    view.setUint16(48 + 'second.xml'.length, 8, true)
    view.setUint32(50 + 'second.xml'.length, second.localHeaderOffset, true)
    const centralStart = plain.centralDirectoryOffset
    const firstRecord = plain.entries[0]?.centralRecord ?? new Uint8Array(0)
    const rebuilt = new Uint8Array(
      centralStart + firstRecord.length + record.length + 22,
    )
    rebuilt.set(bytes.subarray(0, centralStart))
    rebuilt.set(firstRecord, centralStart)
    rebuilt.set(record, centralStart + firstRecord.length)
    const eocd = new DataView(
      rebuilt.buffer,
      centralStart + firstRecord.length + record.length,
    )
    eocd.setUint32(0, 0x06054b50, true)
    eocd.setUint16(8, 2, true)
    eocd.setUint16(10, 2, true)
    eocd.setUint32(12, firstRecord.length + record.length, true)
    eocd.setUint32(16, centralStart, true)
    const source = readZip(rebuilt)
    if (!source) throw new Error('unreadable')
    expect(source.entries[1]?.zip64).toBe(true)
    const out = readZip(
      rewriteZip(
        source,
        new Map([['first.xml', encode('<a>much longer</a>')]]),
      ),
    )
    if (!out) throw new Error('output unreadable')
    expect(contentOf(out, 'second.xml')).toBe('<b/>')
    expect(contentOf(out, 'first.xml')).toBe('<a>much longer</a>')
  })

  it('refuses what it cannot write safely', () => {
    const refuse = (bytes: Uint8Array, name: string) => {
      const source = readZip(bytes)
      if (!source) throw new Error('unreadable')
      return () => rewriteZip(source, new Map([[name, encode('x')]]))
    }
    expect(
      refuse(
        buildZip([{ name: 'a.xml', content: 'x', encrypted: true }]),
        'a.xml',
      ),
    ).toThrow(EmbeddedWriteError)
    expect(
      refuse(buildZip([{ name: 'a.xml', content: 'x', zip64: true }]), 'a.xml'),
    ).toThrow(EmbeddedWriteError)
    expect(
      refuse(
        buildZip([{ name: 'a.xml', content: 'x' }], { zip64Archive: true }),
        'a.xml',
      ),
    ).toThrow(EmbeddedWriteError)
    expect(
      refuse(
        buildZip([
          { name: 'a.xml', content: 'x' },
          { name: 'a.xml', content: 'y' },
        ]),
        'a.xml',
      ),
    ).toThrow(EmbeddedWriteError)
    // Two central records pointing at one local header overlap.
    const overlapping = buildZip([
      { name: 'a.xml', content: 'x' },
      { name: 'b.xml', content: 'y' },
    ])
    const source = readZip(overlapping)
    if (!source) throw new Error('unreadable')
    const second = source.entries[1]
    if (!second) throw new Error('missing')
    new DataView(
      overlapping.buffer,
      overlapping.byteOffset +
        source.centralDirectoryOffset +
        (source.entries[0]?.centralRecord.length ?? 0),
    ).setUint32(42, 0, true)
    expect(refuse(overlapping, 'a.xml')).toThrow(EmbeddedWriteError)
  })

  it('an encrypted entry that is NOT a target is copied through', () => {
    const bytes = buildZip([
      { name: 'a.xml', content: 'x' },
      { name: 'locked.bin', content: 'ciphertext', encrypted: true },
    ])
    const source = readZip(bytes)
    if (!source) throw new Error('unreadable')
    const out = readZip(
      rewriteZip(source, new Map([['a.xml', encode('<a/>')]])),
    )
    if (!out) throw new Error('output unreadable')
    expect(
      Buffer.from(span(out, 'locked.bin')).equals(
        Buffer.from(span(source, 'locked.bin')),
      ),
    ).toBe(true)
  })
})

describe('hostile input', () => {
  it('never throws while reading a mutated archive', () => {
    const base = buildZip(FIXTURE, { comment: 'c' })
    let seed = 7
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 400; round++) {
      const bytes = base.slice(
        0,
        round % 3 === 0 ? random() % base.length : base.length,
      )
      for (let flips = 0; flips < 1 + (round % 6); flips++) {
        if (bytes.length) bytes[random() % bytes.length] = random() & 0xff
      }
      expect(() => {
        const archive = readZip(bytes)
        for (const entry of archive?.entries ?? [])
          readZipEntry(archive as ZipArchive, entry)
      }).not.toThrow()
    }
  })
})
