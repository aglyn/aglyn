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

import { MP4_MOOV_MAX_BYTES, parseIso6709, readMp4 } from './mp4'
import {
  bytesReader,
  type EmbeddedByteReader,
  type EmbeddedCandidate,
} from './types'

// ---------------------------------------------------------------------------
// Box builders
// ---------------------------------------------------------------------------

type Bytes = Uint8Array | number[]

const concat = (...parts: Bytes[]) => {
  const arrays = parts.map((part) =>
    part instanceof Uint8Array ? part : Uint8Array.from(part),
  )
  const out = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of arrays) {
    out.set(part, at)
    at += part.length
  }
  return out
}
const u16 = (value: number) => [value >> 8, value & 0xff]
const u32 = (value: number) => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
]
const u64 = (value: number) => [
  ...u32(Math.floor(value / 0x100000000)),
  ...u32(value >>> 0),
]
/** One byte per character: `©` is 0xA9, as in a box type. */
const latin1 = (text: string) =>
  Uint8Array.from(text, (char) => char.charCodeAt(0))
const utf8 = (text: string) => new TextEncoder().encode(text)

const box = (type: string, ...payload: Bytes[]) => {
  const body = concat(...payload)
  return concat(u32(8 + body.length), latin1(type), body)
}
const fullBox = (type: string, ...payload: Bytes[]) =>
  box(type, [0, 0, 0, 0], ...payload)
/** A box whose size is written as a 64-bit `largesize`. */
const largeBox = (type: string, ...payload: Bytes[]) => {
  const body = concat(...payload)
  return concat(u32(1), latin1(type), u64(16 + body.length), body)
}

const data = (type: number, value: Bytes) =>
  box('data', u32(type), u32(0), value)
const textItem = (name: string, text: string) => box(name, data(1, utf8(text)))
/** QuickTime user-data text: 16-bit length, 16-bit language, text. */
const userText = (name: string, text: Bytes, language = 0x55c4) => {
  const bytes = text instanceof Uint8Array ? text : Uint8Array.from(text)
  return box(name, u16(bytes.length), u16(language), bytes)
}
const hdlr = (handler: string) =>
  fullBox('hdlr', u32(0), latin1(handler), u32(0), u32(0), u32(0), [0])

/** Seconds since 1904-01-01, the ISO BMFF epoch. */
const since1904 = (iso: string) => Date.parse(iso) / 1000 + 2082844800
const mvhd = (created: number, version: 0 | 1 = 0) =>
  version === 1
    ? box(
        'mvhd',
        [1, 0, 0, 0],
        u64(created),
        u64(created),
        u32(1000),
        u64(5000),
        new Array(80).fill(0),
      )
    : box(
        'mvhd',
        [0, 0, 0, 0],
        u32(created),
        u32(created),
        u32(1000),
        u32(5000),
        new Array(80).fill(0),
      )

const XMP_UUID = [
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91,
  0xe3, 0xaf, 0xac,
]
const XMP =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>'

const ftyp = (brand = 'isom') =>
  box('ftyp', latin1(brand), u32(512), latin1(brand), latin1('mp41'))
const mdat = (length: number) => box('mdat', new Array(length).fill(0xee))

/** An iTunes-style film: `moov/udta/meta` as a full box, with `ilst`. */
const ITUNES_MOOV = box(
  'moov',
  mvhd(since1904('2020-01-01T00:00:00Z')),
  box(
    'udta',
    fullBox(
      'meta',
      hdlr('mdir'),
      box(
        'ilst',
        textItem('©nam', 'Launch film'),
        textItem('©ART', 'Aglyn Studio'),
        textItem('desc', 'Short description'),
        textItem('ldes', 'The long description wins'),
        textItem('©cmt', 'Cut 3'),
        textItem('©day', '2024-03-04T05:06:07Z'),
        textItem('cprt', '© 2024 Aglyn LLC'),
        textItem('©too', 'Lavf60.3.100'),
        textItem('keyw', 'launch, product; film'),
        textItem('©alb', 'Campaign'),
        box('tmpo', data(21, u16(120))),
        box('stik', data(21, [9])),
        box('covr', data(13, [0xff, 0xd8, 0xff])),
        box(
          '----',
          fullBox('mean', utf8('com.apple.iTunes')),
          fullBox('name', utf8('ENCODER_SETTINGS')),
          data(1, utf8('crf=18')),
        ),
      ),
    ),
    userText('©xyz', utf8('+48.8584+002.2945/')),
  ),
)

const values = (candidates: EmbeddedCandidate[] | undefined) =>
  Object.fromEntries(
    (candidates ?? []).map((candidate) => [candidate.key, candidate.value]),
  )

/** Records every range asked for. */
function countingReader(
  bytes: Uint8Array,
): EmbeddedByteReader & { reads: Array<[number, number]> } {
  const inner = bytesReader(bytes)
  const reads: Array<[number, number]> = []
  return {
    size: inner.size,
    reads,
    read: (start, end) => {
      reads.push([start, end])
      return inner.read(start, end)
    },
  }
}

/** A file of any size, zeros everywhere but the given prefix. */
function sparseReader(
  prefix: Uint8Array,
  size: number,
): EmbeddedByteReader & { requested: number } {
  const reader = {
    size,
    requested: 0,
    read: async (start: number, end: number) => {
      const from = Math.max(0, start)
      const to = Math.min(size, end)
      reader.requested += to - from
      const out = new Uint8Array(Math.max(0, to - from))
      if (from < prefix.length)
        out.set(prefix.subarray(from, Math.min(prefix.length, to)))
      return out
    },
  }
  return reader
}

// ---------------------------------------------------------------------------

describe('parseIso6709', () => {
  it('reads degrees, degrees-minutes and degrees-minutes-seconds', () => {
    expect(parseIso6709('+37.7749-122.4194+010.000/')).toBe(
      '37.774900,-122.419400',
    )
    expect(parseIso6709('+3746.494-12225.164/')).toBe('37.774900,-122.419400')
    expect(parseIso6709('+374629.64-1222509.84/')).toBe('37.774900,-122.419400')
    expect(parseIso6709('-33.8688+151.2093/')).toBe('-33.868800,151.209300')
    expect(parseIso6709('+00.0000-000.0000/')).toBe('0.000000,0.000000')
  })

  it('refuses what is not a point on Earth', () => {
    expect(parseIso6709('+95.0000+000.0000/')).toBeNull()
    expect(parseIso6709('+45.0000+190.0000/')).toBeNull()
    expect(parseIso6709('+123.0000+000.0000/')).toBeNull()
    expect(parseIso6709('somewhere')).toBeNull()
    expect(parseIso6709('')).toBeNull()
  })
})

describe('readMp4', () => {
  it('reads iTunes-style items from udta/meta/ilst', async () => {
    const file = concat(ftyp(), ITUNES_MOOV, mdat(64))
    const read = await readMp4(bytesReader(file))
    expect(values(read?.candidates)).toEqual({
      title: 'Launch film',
      creator: ['Aglyn Studio'],
      description: 'The long description wins',
      comment: 'Cut 3',
      createdAt: '2024-03-04T05:06:07Z',
      copyright: '© 2024 Aglyn LLC',
      encoder: 'Lavf60.3.100',
      keywords: ['launch', 'product', 'film'],
      gps: '48.858400,2.294500',
      'mp4|©alb': 'Campaign',
      'mp4|tmpo': '120',
      'mp4|ENCODER_SETTINGS': 'crf=18',
    })
    expect(
      read?.candidates.every((candidate) => candidate.editable === false),
    ).toBe(true)
    expect(
      read?.candidates.every((candidate) => candidate.source === 'mp4'),
    ).toBe(true)
    const album = read?.candidates.find(
      (candidate) => candidate.key === 'mp4|©alb',
    )
    expect(album?.label).toBe('Album')
    expect(read?.xmp).toBeNull()
  })

  it('never requests a byte of mdat when moov comes after it', async () => {
    const media = largeBox('mdat', new Array(4096).fill(0xee))
    const head = concat(ftyp(), box('free', [0, 0, 0, 0]))
    const file = concat(head, media, ITUNES_MOOV)
    const reader = countingReader(file)
    const read = await readMp4(reader)
    expect(values(read?.candidates)['title']).toBe('Launch film')
    // The largesize header is 16 bytes; nothing past it may be asked for.
    const payloadStart = head.length + 16
    const payloadEnd = head.length + media.length
    for (const [start, end] of reader.reads) {
      expect(end <= payloadStart || start >= payloadEnd).toBe(true)
    }
    expect(reader.reads.length).toBeLessThan(10)
  })

  it('reads a moov that comes first and an mdat that runs to the end (size 0)', async () => {
    const file = concat(
      ftyp(),
      ITUNES_MOOV,
      u32(0),
      latin1('mdat'),
      new Array(100).fill(1),
    )
    const read = await readMp4(bytesReader(file))
    expect(values(read?.candidates)['creator']).toEqual(['Aglyn Studio'])
  })

  it('reads a QuickTime film: plain meta with mdta keys, and udta text atoms', async () => {
    const keys = [
      'com.apple.quicktime.make',
      'com.apple.quicktime.model',
      'com.apple.quicktime.software',
      'com.apple.quicktime.creationdate',
      'com.apple.quicktime.location.ISO6709',
      'com.apple.quicktime.title',
      'com.apple.quicktime.keywords',
      'com.apple.quicktime.content.identifier',
      'com.apple.quicktime.live-photo.vitality-score',
    ]
    const keysBox = fullBox(
      'keys',
      u32(keys.length),
      ...keys.map((key) =>
        concat(u32(8 + utf8(key).length), latin1('mdta'), utf8(key)),
      ),
    )
    const indexed = (index: number, value: Bytes, type = 1) =>
      concat(
        u32(8 + 8 + 8 + concat(value).length),
        u32(index),
        data(type, value),
      )
    const float = new Uint8Array(4)
    new DataView(float.buffer).setFloat32(0, 0.5)
    const moov = box(
      'moov',
      mvhd(since1904('2019-01-01T00:00:00Z')),
      // QuickTime: meta is NOT a full box.
      box(
        'meta',
        hdlr('mdta'),
        keysBox,
        box(
          'ilst',
          indexed(1, utf8('Apple')),
          indexed(2, utf8('iPhone 15 Pro')),
          indexed(3, utf8('17.4')),
          indexed(4, utf8('2024-05-06T07:08:09-0700')),
          indexed(5, utf8('+37.7749-122.4194+010.000/')),
          indexed(6, utf8('Golden hour')),
          indexed(7, utf8('sunset,bridge')),
          indexed(8, utf8('A1B2')),
          indexed(9, float, 23),
          // An index past the keys is ignored.
          indexed(42, utf8('orphan')),
        ),
      ),
      box(
        'udta',
        // Mac OS Roman: 0x8E is "é". Language 0 is Macintosh English.
        userText('©mak', [0x43, 0x61, 0x6d, 0x8e, 0x72, 0x61], 0),
        userText('©mod', utf8('Model from udta')),
        userText('©swr', utf8('QuickTime 7.7')),
        userText('©enc', utf8('Someone')),
        box('XMP_', utf8(XMP)),
      ),
    )
    const file = concat(ftyp('qt  '), box('wide'), mdat(32), moov)
    const read = await readMp4(bytesReader(file))
    expect(values(read?.candidates)).toEqual({
      make: 'Apple',
      model: 'iPhone 15 Pro',
      software: '17.4',
      createdAt: '2024-05-06T07:08:09-07:00',
      gps: '37.774900,-122.419400',
      title: 'Golden hour',
      keywords: ['sunset', 'bridge'],
      'mp4|com.apple.quicktime.content.identifier': 'A1B2',
      'mp4|com.apple.quicktime.live-photo.vitality-score': '0.5',
      encoder: 'QuickTime 7.7',
      'mp4|©enc': 'Someone',
    })
    expect(read?.xmp).toBe(XMP)
  })

  it('drops an item whose atom name is not printable', async () => {
    const noise = data(1, utf8('noise'))
    const junk = concat(u32(8 + noise.length), [0x01, 0x02, 0x03, 0x04], noise)
    const moov = box(
      'moov',
      box(
        'udta',
        fullBox(
          'meta',
          hdlr('mdir'),
          box('ilst', junk, textItem('©nam', 'Kept')),
        ),
      ),
    )
    const read = await readMp4(bytesReader(concat(ftyp(), moov)))
    expect(values(read?.candidates)).toEqual({ title: 'Kept' })
  })

  it('decodes a Mac OS Roman user-data atom when nothing outranks it', async () => {
    const moov = box(
      'moov',
      box('udta', userText('©mak', [0x43, 0x61, 0x6d, 0x8e, 0x72, 0x61], 0)),
    )
    const read = await readMp4(bytesReader(concat(ftyp('qt  '), moov)))
    expect(values(read?.candidates)['make']).toBe('Caméra')
  })

  it('reads 3GPP asset boxes', async () => {
    const asset = (type: string, text: Bytes) =>
      fullBox(type, u16(0x15c7), text, [0])
    const moov = box(
      'moov',
      box(
        'udta',
        asset('titl', utf8('3GPP title')),
        asset('perf', utf8('A performer, outranked by the author')),
        asset('auth', [0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]),
        asset('cprt', utf8('3GPP rights')),
      ),
    )
    const read = await readMp4(bytesReader(concat(ftyp('3gp6'), moov)))
    expect(values(read?.candidates)).toEqual({
      title: '3GPP title',
      creator: ['AB'],
      copyright: '3GPP rights',
    })
  })

  it('takes the performer as the creator when there is no author', async () => {
    const moov = box(
      'moov',
      box('udta', fullBox('perf', u16(0x55c4), utf8('iTunes Artist'), [0])),
    )
    const read = await readMp4(bytesReader(concat(ftyp('mp42'), moov)))
    expect(values(read?.candidates)).toEqual({ creator: ['iTunes Artist'] })
  })

  it('falls back to the mvhd creation time, and ignores an unset one', async () => {
    const v0 = await readMp4(
      bytesReader(
        concat(ftyp(), box('moov', mvhd(since1904('2023-07-08T09:10:11Z')))),
      ),
    )
    expect(values(v0?.candidates)).toEqual({
      createdAt: '2023-07-08T09:10:11Z',
    })
    const v1 = await readMp4(
      bytesReader(
        concat(ftyp(), box('moov', mvhd(since1904('2031-02-03T04:05:06Z'), 1))),
      ),
    )
    expect(values(v1?.candidates)).toEqual({
      createdAt: '2031-02-03T04:05:06Z',
    })
    const unset = await readMp4(
      bytesReader(concat(ftyp(), box('moov', mvhd(0)))),
    )
    expect(unset).toEqual({ candidates: [], xmp: null })
  })

  it('returns XMP from a top-level uuid box, and from one inside udta', async () => {
    const top = await readMp4(
      bytesReader(
        concat(ftyp(), box('uuid', XMP_UUID, utf8(XMP)), box('moov', mvhd(0))),
      ),
    )
    expect(top?.xmp).toBe(XMP)
    const inner = await readMp4(
      bytesReader(
        concat(
          ftyp(),
          box('moov', box('udta', box('uuid', XMP_UUID, utf8(XMP)))),
        ),
      ),
    )
    expect(inner?.xmp).toBe(XMP)
    const other = await readMp4(
      bytesReader(
        concat(
          ftyp(),
          box('uuid', new Array(16).fill(1), utf8(XMP)),
          box('moov'),
        ),
      ),
    )
    expect(other?.xmp).toBeNull()
  })

  it('stops at the first fragment once moov is found', async () => {
    const fragments = Array.from({ length: 50 }, () =>
      concat(box('moof', [0]), mdat(8)),
    )
    const reader = countingReader(concat(ftyp(), ITUNES_MOOV, ...fragments))
    const read = await readMp4(reader)
    expect(values(read?.candidates)['title']).toBe('Launch film')
    expect(reader.reads.length).toBeLessThan(6)
  })

  it('refuses a moov over the cap without reading it', async () => {
    const size = MP4_MOOV_MAX_BYTES + 1024
    const head = concat(ftyp(), u32(size), latin1('moov'))
    const reader = sparseReader(head, head.length - 8 + size)
    expect(await readMp4(reader)).toBeNull()
    expect(reader.requested).toBeLessThan(64)
  })

  it('is null for what is not an ISO BMFF file, or has no moov', async () => {
    expect(await readMp4(bytesReader(new Uint8Array(0)))).toBeNull()
    expect(
      await readMp4(bytesReader(utf8('this is plainly just text, no boxes'))),
    ).toBeNull()
    expect(
      await readMp4(bytesReader(concat(u32(4), latin1('ftyp')))),
    ).toBeNull()
    expect(await readMp4(bytesReader(concat(ftyp(), mdat(16))))).toBeNull()
  })

  it('reads what it can from a truncated moov', async () => {
    const file = concat(ftyp(), ITUNES_MOOV)
    const cut = file.subarray(0, file.length - 200)
    await expect(readMp4(bytesReader(cut))).resolves.not.toBeNull()
  })

  it('never throws on mutated input', async () => {
    const base = concat(ftyp(), ITUNES_MOOV, mdat(16))
    let seed = 5
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
      await expect(readMp4(bytesReader(bytes))).resolves.not.toThrow()
    }
  })
})
