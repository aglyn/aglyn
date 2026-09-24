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

import { createHash } from 'crypto'

import {
  irbHasIptc,
  irbIim,
  readIim,
  readIrbIptc,
  replaceIrbIim,
  trimIimPadding,
  writeIim,
  writeIrbIptc,
} from './iptc'
import type { EmbeddedCandidate } from './types'

// Fixtures are built here, byte by byte, rather than committed as files.

const utf8 = (text: string) => Array.from(Buffer.from(text, 'utf8'))
const latin1 = (text: string) => Array.from(Buffer.from(text, 'latin1'))
const UTF8_CHARSET = [0x1b, 0x25, 0x47]

/** One IIM dataset; the extended length form past 32767 bytes. */
function ds(
  record: number,
  dataset: number,
  data: string | number[],
): number[] {
  const bytes = typeof data === 'string' ? utf8(data) : data
  const n = bytes.length
  const length =
    n > 0x7fff
      ? [
          0x80,
          0x04,
          (n >>> 24) & 0xff,
          (n >>> 16) & 0xff,
          (n >>> 8) & 0xff,
          n & 0xff,
        ]
      : [n >> 8, n & 0xff]
  return [0x1c, record, dataset, ...length, ...bytes]
}

function iim(...datasets: number[][]): Uint8Array {
  return Uint8Array.from(datasets.flat())
}

/** One Photoshop image resource: signature, id, Pascal name, size, data. */
function resource(id: number, data: number[], name = '', signature = '8BIM') {
  const pascal = [name.length, ...latin1(name)]
  if (pascal.length % 2) pascal.push(0)
  const n = data.length
  return [
    ...latin1(signature),
    id >> 8,
    id & 0xff,
    ...pascal,
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
    ...data,
    ...(n % 2 ? [0] : []),
  ]
}

function irb(...resources: number[][]): Uint8Array {
  return Uint8Array.from(resources.flat())
}

function fields(candidates: EmbeddedCandidate[]) {
  return Object.fromEntries(candidates.map((c) => [c.key, c.value]))
}

// Independent parsers, so the specs do not grade the module with itself.

function datasets(bytes: Uint8Array) {
  const out: Array<{ tag: string; raw: number[] }> = []
  let at = 0
  while (at < bytes.length && bytes[at] === 0x1c) {
    let size = ((bytes[at + 3] ?? 0) << 8) | (bytes[at + 4] ?? 0)
    let header = 5
    if (size & 0x8000) {
      const n = size & 0x7fff
      size = 0
      for (let i = 0; i < n; i++) size = size * 256 + (bytes[at + 5 + i] ?? 0)
      header += n
    }
    out.push({
      tag: `${bytes[at + 1]}:${bytes[at + 2]}`,
      raw: Array.from(bytes.subarray(at, at + header + size)),
    })
    at += header + size
  }
  return out
}

function resources(bytes: Uint8Array) {
  const out: Array<{ id: number; data: number[]; raw: number[] }> = []
  let at = 0
  while (at + 12 <= bytes.length) {
    const nameEnd = at + 6 + (((bytes[at + 6] ?? 0) + 2) & ~1)
    const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(nameEnd)
    const end = nameEnd + 4 + size + (size % 2)
    out.push({
      id: ((bytes[at + 4] ?? 0) << 8) | (bytes[at + 5] ?? 0),
      data: Array.from(bytes.subarray(nameEnd + 4, nameEnd + 4 + size)),
      raw: Array.from(bytes.subarray(at, end)),
    })
    at = end
  }
  return out
}

const md5 = (bytes: Uint8Array) =>
  Array.from(createHash('md5').update(bytes).digest())

const PHOTO = iim(
  ds(1, 0, [0, 4]),
  ds(1, 90, UTF8_CHARSET),
  ds(2, 0, [0, 4]),
  ds(2, 5, 'Harbor'),
  ds(2, 25, 'harbor'),
  ds(2, 25, 'dawn'),
  ds(2, 25, 'harbor'),
  ds(2, 40, 'Do not crop'),
  ds(2, 55, '20210503'),
  ds(2, 60, '101112+0200'),
  ds(2, 80, 'Ann Author'),
  ds(2, 80, 'Bob Builder'),
  ds(2, 90, 'Marseille'),
  ds(2, 95, 'Provence'),
  ds(2, 101, 'France'),
  ds(2, 103, 'JOB-42'),
  ds(2, 105, 'Dawn over the Vieux-Port'),
  ds(2, 110, 'Aglyn Photo'),
  ds(2, 115, 'Agency'),
  ds(2, 116, '© 2021 Ann Author'),
  ds(2, 120, 'A quiet harbor at dawn'),
)

const PHOTO_FIELDS = {
  title: 'Harbor',
  keywords: ['harbor', 'dawn'],
  instructions: 'Do not crop',
  creator: ['Ann Author', 'Bob Builder'],
  city: 'Marseille',
  state: 'Provence',
  country: 'France',
  headline: 'Dawn over the Vieux-Port',
  credit: 'Aglyn Photo',
  source: 'Agency',
  copyright: '© 2021 Ann Author',
  description: 'A quiet harbor at dawn',
  createdAt: '2021-05-03T10:11:12+02:00',
}

describe('readIim', () => {
  it('maps record 2 onto canonical keys, lists as arrays', () => {
    const candidates = readIim(PHOTO)
    expect(fields(candidates)).toEqual(PHOTO_FIELDS)
    expect(candidates.every((c) => c.source === 'iptc')).toBe(true)
  })

  it('decodes UTF-8 when declared, and otherwise per value', () => {
    const read = (...list: number[][]) => fields(readIim(iim(...list)))
    expect(read(ds(1, 90, UTF8_CHARSET), ds(2, 90, 'Zürich'))).toEqual({
      city: 'Zürich',
    })
    expect(read(ds(2, 90, 'Zürich'), ds(2, 101, latin1('Österreich')))).toEqual(
      {
        city: 'Zürich',
        country: 'Österreich',
      },
    )
    // ISO 2022's "UTF-8 level 3" designation says the same thing.
    expect(
      read(ds(1, 90, [0x1b, 0x25, 0x2f, 0x49]), ds(2, 90, 'Zürich')),
    ).toEqual({ city: 'Zürich' })
    expect(read(ds(2, 120, [...utf8('  caption '), 0, 0]))).toEqual({
      description: 'caption',
    })
    expect(read(ds(2, 120, '   '))).toEqual({})
  })

  it('reads the creation date and time as ISO', () => {
    const created = (...list: number[][]) =>
      fields(readIim(iim(...list)))['createdAt']
    expect(created(ds(2, 55, '20210503'))).toBe('2021-05-03')
    expect(created(ds(2, 55, '20210503'), ds(2, 60, '101112'))).toBe(
      '2021-05-03T10:11:12',
    )
    expect(created(ds(2, 55, '20210503'), ds(2, 60, '101112-0530'))).toBe(
      '2021-05-03T10:11:12-05:30',
    )
    expect(created(ds(2, 55, '20210503'), ds(2, 60, '10:11:12+00:00'))).toBe(
      '2021-05-03T10:11:12+00:00',
    )
    expect(created(ds(2, 55, '20210503'), ds(2, 60, '991112'))).toBe(
      '2021-05-03',
    )
    expect(created(ds(2, 55, '00000000'))).toBeUndefined()
    expect(created(ds(2, 55, '20211301'))).toBeUndefined()
    expect(created(ds(2, 60, '101112'))).toBeUndefined()
  })

  it('reads the extended length form', () => {
    const caption = 'x'.repeat(40000)
    expect(fields(readIim(iim(ds(2, 5, 'T'), ds(2, 120, caption))))).toEqual({
      title: 'T',
      description: caption,
    })
  })

  it('keeps what it read before damage, and never throws', () => {
    expect(readIim(new Uint8Array())).toEqual([])
    expect(readIim(Uint8Array.from([1, 2, 3, 4, 5, 6]))).toEqual([])
    // A dataset whose length runs past the end ends the stream.
    expect(
      fields(readIim(iim(ds(2, 5, 'Kept'), [0x1c, 2, 120, 0x10, 0]))),
    ).toEqual({
      title: 'Kept',
    })
    // An extended length that claims five length bytes is refused.
    expect(
      fields(
        readIim(
          iim(ds(2, 5, 'Kept'), [0x1c, 2, 120, 0x80, 0x05, 0, 0, 0, 0, 1]),
        ),
      ),
    ).toEqual({ title: 'Kept' })
    for (let n = 0; n <= PHOTO.length; n++) {
      expect(() => readIim(PHOTO.subarray(0, n))).not.toThrow()
    }
    let seed = 7
    for (let run = 0; run < 500; run++) {
      const bytes = PHOTO.slice()
      for (let i = 0; i < 3; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        bytes[seed % bytes.length] = seed & 0xff
      }
      expect(() => readIim(bytes)).not.toThrow()
      expect(() =>
        writeIim(bytes, { title: 'Ünïcode', keywords: ['a'] }),
      ).not.toThrow()
    }
  })
})

describe('writeIim', () => {
  it('replaces a value where it was and leaves every other dataset byte-identical', () => {
    const out = writeIim(PHOTO, { description: 'A calmer caption' })
    const before = datasets(PHOTO)
    const after = datasets(out)
    expect(after.map((d) => d.tag)).toEqual(before.map((d) => d.tag))
    after.forEach((d, i) => {
      if (d.tag !== '2:120') expect(d.raw).toEqual(before[i]?.raw)
    })
    expect(fields(readIim(out))).toEqual({
      ...PHOTO_FIELDS,
      description: 'A calmer caption',
    })
  })

  it('adds a dataset in record:dataset order and removes one on null', () => {
    const source = iim(
      ds(2, 0, [0, 4]),
      ds(2, 5, 'Title'),
      ds(2, 120, 'Caption'),
    )
    const added = writeIim(source, { city: 'Lyon', headline: 'Big news' })
    expect(datasets(added).map((d) => d.tag)).toEqual([
      '2:0',
      '2:5',
      '2:90',
      '2:105',
      '2:120',
    ])
    const removed = writeIim(added, { title: null, city: null })
    expect(datasets(removed).map((d) => d.tag)).toEqual([
      '2:0',
      '2:105',
      '2:120',
    ])
    expect(fields(readIim(removed))).toEqual({
      headline: 'Big news',
      description: 'Caption',
    })
  })

  it('writes a list as one dataset per item, where the first one was', () => {
    const source = iim(
      ds(2, 0, [0, 4]),
      ds(2, 25, 'old one'),
      ds(2, 80, 'Ann'),
      ds(2, 25, 'old two'),
      ds(2, 120, 'Caption'),
    )
    const out = writeIim(source, {
      keywords: ['sea', 'boats', 'sea', ' dawn '],
    })
    expect(datasets(out).map((d) => d.tag)).toEqual([
      '2:0',
      '2:25',
      '2:25',
      '2:25',
      '2:80',
      '2:120',
    ])
    expect(fields(readIim(out))['keywords']).toEqual(['sea', 'boats', 'dawn'])
  })

  it('keeps unmapped datasets, 2:00 included, byte-identical and in order', () => {
    const preview = Array.from({ length: 300 }, (_, i) => i & 0xff)
    const source = iim(
      ds(1, 0, [0, 4]),
      ds(1, 20, 'svc'),
      ds(2, 0, [0, 2]),
      ds(2, 103, 'JOB-42'),
      ds(2, 120, 'Caption'),
      ds(2, 200, [0, 11]),
      ds(2, 202, preview),
      ds(3, 20, 'record three'),
    )
    const out = writeIim(source, {
      description: 'New caption',
      title: 'New title',
    })
    const kept = (bytes: Uint8Array) =>
      datasets(bytes).filter((d) => !['2:5', '2:120'].includes(d.tag))
    expect(kept(out)).toEqual(kept(source))
    expect(datasets(out).map((d) => d.tag)).toEqual([
      '1:0',
      '1:20',
      '2:0',
      '2:5',
      '2:103',
      '2:120',
      '2:200',
      '2:202',
      '3:20',
    ])
  })

  it('uses the extended length form past 32767 bytes', () => {
    const caption = '0123456789'.repeat(4000)
    const out = writeIim(PHOTO, { description: caption })
    const dataset = datasets(out).find((d) => d.tag === '2:120')
    expect(dataset?.raw.slice(3, 9)).toEqual([0x80, 0x04, 0, 0, 0x9c, 0x40])
    expect(fields(readIim(out))['description']).toBe(caption)
  })

  it('declares UTF-8 for non-ASCII text and transcodes Latin-1 so it survives', () => {
    const preview = [0xe9, 0xff, 0x00, 0xc3]
    const source = iim(
      ds(2, 0, [0, 4]),
      ds(2, 5, latin1('Café')),
      ds(2, 90, 'Zürich'),
      ds(2, 101, latin1('Österreich')),
      ds(2, 202, preview),
    )
    const out = writeIim(source, { creator: ['Zoë'] })
    const list = datasets(out)
    expect(list.map((d) => d.tag)).toEqual([
      '1:0',
      '1:90',
      '2:0',
      '2:5',
      '2:80',
      '2:90',
      '2:101',
      '2:202',
    ])
    expect(list.find((d) => d.tag === '1:90')?.raw.slice(5)).toEqual(
      UTF8_CHARSET,
    )
    // Binary data is left alone; text that was already UTF-8 is untouched.
    expect(list.find((d) => d.tag === '2:202')?.raw.slice(5)).toEqual(preview)
    expect(list.find((d) => d.tag === '2:90')?.raw).toEqual(ds(2, 90, 'Zürich'))
    expect(list.find((d) => d.tag === '2:5')?.raw).toEqual(ds(2, 5, 'Café'))
    expect(fields(readIim(out))).toEqual({
      title: 'Café',
      creator: ['Zoë'],
      city: 'Zürich',
      country: 'Österreich',
    })
  })

  it('replaces a non-UTF-8 charset declaration, and leaves ASCII edits alone', () => {
    const latinDeclared = iim(ds(1, 90, [0x1b, 0x2e, 0x41]), ds(2, 5, 'x'))
    const out = writeIim(latinDeclared, { title: 'Crème' })
    expect(datasets(out).map((d) => d.raw)).toEqual([
      ds(1, 90, UTF8_CHARSET),
      ds(2, 0, [0, 4]),
      ds(2, 5, 'Crème'),
    ])
    const ascii = writeIim(iim(ds(2, 0, [0, 4]), ds(2, 5, 'x')), {
      title: 'Plain',
    })
    expect(datasets(ascii).map((d) => d.tag)).toEqual(['2:0', '2:5'])
  })

  it('writes the creation date and time, and removes both on null', () => {
    const created = (value: string | null) => {
      const out = writeIim(PHOTO, { createdAt: value })
      return {
        read: fields(readIim(out))['createdAt'],
        raw: datasets(out)
          .filter((d) => d.tag === '2:55' || d.tag === '2:60')
          .map((d) => Buffer.from(d.raw.slice(5)).toString()),
      }
    }
    expect(created('2024-06-01T05:30:00-04:00')).toEqual({
      read: '2024-06-01T05:30:00-04:00',
      raw: ['20240601', '053000-0400'],
    })
    expect(created('2024-06-01T05:30:00Z')).toEqual({
      read: '2024-06-01T05:30:00+00:00',
      raw: ['20240601', '053000+0000'],
    })
    expect(created('2024-06-01T05:30')).toEqual({
      read: '2024-06-01T05:30:00',
      raw: ['20240601', '053000'],
    })
    expect(created('2024-06-01')).toEqual({
      read: '2024-06-01',
      raw: ['20240601'],
    })
    expect(created(null)).toEqual({ read: undefined, raw: [] })
    expect(writeIim(PHOTO, { createdAt: 'not a date' })).toBe(PHOTO)
  })

  it('returns the same bytes when nothing changes', () => {
    expect(writeIim(PHOTO, {})).toBe(PHOTO)
    expect(writeIim(PHOTO, { gps: null, make: 'Canon' })).toBe(PHOTO)
    expect(
      writeIim(PHOTO, {
        title: 'Harbor',
        creator: ['Ann Author', 'Bob Builder'],
        createdAt: '2021-05-03T10:11:12+02:00',
      }),
    ).toBe(PHOTO)
  })

  it('drops zero padding after the last dataset and keeps anything else', () => {
    const padded = iim(ds(2, 0, [0, 4]), ds(2, 5, 'x'), [0, 0, 0])
    expect(Array.from(writeIim(padded, { title: 'y' }))).toEqual([
      ...ds(2, 0, [0, 4]),
      ...ds(2, 5, 'y'),
    ])
    const junk = iim(ds(2, 5, 'x'), [0x42, 0x43])
    expect(Array.from(writeIim(junk, { title: 'y' })).slice(-2)).toEqual([
      0x42, 0x43,
    ])
  })

  it('trims a container’s padding but never a dataset’s own zeros', () => {
    const endsInZeros = iim(ds(2, 0, [0, 4]), ds(2, 202, [7, 0, 0]))
    expect(trimIimPadding(endsInZeros)).toBe(endsInZeros)
    const padded = iim(ds(2, 0, [0, 4]), ds(2, 202, [7, 0, 0]), [0, 0, 0])
    expect(Array.from(trimIimPadding(padded))).toEqual(Array.from(endsInZeros))
    const junk = iim(ds(2, 5, 'x'), [0, 0x42])
    expect(trimIimPadding(junk)).toBe(junk)
  })

  it('builds a stream from nothing', () => {
    const out = writeIim(new Uint8Array(), { title: 'First' })
    expect(datasets(out).map((d) => d.tag)).toEqual(['2:0', '2:5'])
    expect(fields(readIim(out))).toEqual({ title: 'First' })
  })
})

describe('image resource blocks', () => {
  const resolution = resource(
    0x03ed,
    [0, 72, 0, 0, 0, 1, 0, 1, 0, 72, 0, 0, 0, 1, 0, 1],
  )
  const named = resource(0x0bb7, [1, 2, 3], 'Odd')
  const foreign = resource(0x1000, [9, 9], '', 'MeSa')

  function photoshop(withDigest = true) {
    return irb(
      resolution,
      named,
      resource(0x0404, Array.from(PHOTO)),
      ...(withDigest ? [resource(0x0425, md5(PHOTO))] : []),
      foreign,
    )
  }

  it('finds and reads the IIM in resource 0x0404', () => {
    const block = photoshop()
    expect(irbHasIptc(block)).toBe(true)
    expect(Array.from(irbIim(block) ?? [])).toEqual(Array.from(PHOTO))
    expect(fields(readIrbIptc(block))).toEqual(PHOTO_FIELDS)
    expect(irbHasIptc(irb(resolution, named))).toBe(false)
    expect(readIrbIptc(irb(resolution))).toEqual([])
  })

  it('rewrites 0x0404, updates the digest, and copies every other resource as is', () => {
    const block = photoshop()
    const out = writeIrbIptc(block, { title: 'Nouveau titre', city: 'Nice' })
    const before = resources(block)
    const after = resources(out)
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id))
    after.forEach((r, i) => {
      if (r.id !== 0x0404 && r.id !== 0x0425)
        expect(r.raw).toEqual(before[i]?.raw)
    })
    const iimAfter = Uint8Array.from(
      after.find((r) => r.id === 0x0404)?.data ?? [],
    )
    expect(after.find((r) => r.id === 0x0425)?.data).toEqual(md5(iimAfter))
    expect(fields(readIrbIptc(out))).toEqual({
      ...PHOTO_FIELDS,
      title: 'Nouveau titre',
      city: 'Nice',
    })
  })

  it('adds no digest where there was none', () => {
    const out = writeIrbIptc(photoshop(false), { title: 'X' })
    expect(resources(out).map((r) => r.id)).toEqual([
      0x03ed, 0x0bb7, 0x0404, 0x1000,
    ])
  })

  it('leaves a block without IPTC alone, and a no-op edit too', () => {
    const noIptc = irb(resolution, named)
    expect(writeIrbIptc(noIptc, { title: 'X' })).toBe(noIptc)
    const block = photoshop()
    expect(writeIrbIptc(block, { title: 'Harbor' })).toBe(block)
  })

  it('removes the IIM and its digest, or appends an IIM where there was none', () => {
    const removed = replaceIrbIim(photoshop(), null)
    expect(resources(removed).map((r) => r.raw)).toEqual([
      resolution,
      named,
      foreign,
    ])
    const added = replaceIrbIim(irb(resolution), PHOTO)
    expect(resources(added).map((r) => r.id)).toEqual([0x03ed, 0x0404])
    expect(fields(readIrbIptc(added))).toEqual(PHOTO_FIELDS)
  })

  it('pads an odd-length IIM to even inside the resource', () => {
    const odd = iim(ds(2, 5, 'odd'))
    expect(odd.length % 2).toBe(0)
    const oddIim = iim(ds(2, 5, 'odd!'))
    expect(oddIim.length % 2).toBe(1)
    const out = replaceIrbIim(photoshop(), oddIim)
    expect(out.length % 2).toBe(0)
    expect(resources(out).map((r) => r.id)).toEqual([
      0x03ed, 0x0bb7, 0x0404, 0x0425, 0x1000,
    ])
    expect(fields(readIrbIptc(out))).toEqual({ title: 'odd!' })
  })

  it('never throws on damaged blocks', () => {
    const block = photoshop()
    for (let n = 0; n <= block.length; n++) {
      const part = block.subarray(0, n)
      expect(() => readIrbIptc(part)).not.toThrow()
      expect(() => irbHasIptc(part)).not.toThrow()
      expect(() => writeIrbIptc(part, { title: 'x' })).not.toThrow()
    }
    // An unknown signature ends the block; what follows is kept verbatim.
    const tail = [0x58, 0x58, 0x58, 0x58, 1, 2, 3]
    const odd = irb(resolution, resource(0x0404, Array.from(PHOTO)), tail)
    expect(
      Array.from(writeIrbIptc(odd, { title: 'x' })).slice(-tail.length),
    ).toEqual(tail)
  })
})
