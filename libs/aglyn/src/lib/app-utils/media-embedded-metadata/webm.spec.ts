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

import {
  bytesReader,
  type EmbeddedByteReader,
  type EmbeddedCandidate,
} from './types'
import { readWebm } from './webm'

// ---------------------------------------------------------------------------
// EBML builders
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
const utf8 = (text: string) => new TextEncoder().encode(text)

/** Big-endian bytes of an ID, marker bits included, as written. */
const idBytes = (id: number) => {
  const out: number[] = []
  for (let value = id; value > 0; value = Math.floor(value / 256))
    out.unshift(value % 256)
  return out
}
/** The shortest size VINT for `length`, or a fixed width (RFC 8794 §4). */
const sizeBytes = (length: number, width?: number) => {
  let bytes = width ?? 1
  while (!width && length >= 2 ** (7 * bytes) - 1) bytes++
  const out = new Array<number>(bytes).fill(0)
  let value = length
  for (let index = bytes - 1; index >= 0; index--) {
    out[index] = value % 256
    value = Math.floor(value / 256)
  }
  out[0] = (out[0] ?? 0) | (0x80 >> (bytes - 1))
  return out
}
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

const element = (id: number, ...payload: Bytes[]) => {
  const body = concat(...payload)
  return concat(idBytes(id), sizeBytes(body.length), body)
}
const unknownSized = (id: number, ...payload: Bytes[]) =>
  concat(idBytes(id), UNKNOWN_SIZE, ...payload)
const uint = (id: number, value: number, width = 1) => {
  const out = new Array<number>(width).fill(0)
  let rest = value
  for (let index = width - 1; index >= 0; index--) {
    out[index] = rest % 256
    rest = Math.floor(rest / 256)
  }
  return element(id, out)
}
const string = (id: number, text: string) => element(id, utf8(text))
const dateUtc = (iso: string) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigInt64(
    0,
    BigInt(Date.parse(iso) - Date.UTC(2001, 0, 1)) * 1_000_000n,
  )
  return element(0x4461, bytes)
}

const ebmlHeader = (docType = 'webm') =>
  element(
    0x1a45dfa3,
    uint(0x4286, 1),
    uint(0x42f7, 1),
    uint(0x42f2, 4),
    uint(0x42f3, 8),
    string(0x4282, docType),
    uint(0x4287, 4),
    uint(0x4285, 2),
  )

const info = (...fields: Bytes[]) =>
  element(0x1549a966, uint(0x2ad7b1, 1_000_000, 3), ...fields)
const tracks = element(
  0x1654ae6b,
  element(0xae, uint(0xd7, 1), string(0x86, 'V_VP9')),
)
const cluster = (length: number) =>
  element(
    0x1f43b675,
    uint(0xe7, 0),
    element(0xa3, new Array(length).fill(0xee)),
  )
const simpleTag = (name: string, value: string) =>
  element(
    0x67c8,
    string(0x45a3, name),
    string(0x447a, 'und'),
    string(0x4487, value),
  )
const tag = (targets: Bytes[], ...simple: Bytes[]) =>
  element(0x7373, element(0x63c0, ...targets), ...simple)
const tags = (...list: Bytes[]) => element(0x1254c367, ...list)

/** A SeekHead with 8-byte positions, so its size does not depend on them. */
const seekHead = (entries: Array<[number, number]>) =>
  element(
    0x114d9b74,
    ...entries.map(([id, position]) =>
      element(0x4dbb, element(0x53ab, idBytes(id)), uint(0x53ac, position, 8)),
    ),
  )

interface Layout {
  file: Uint8Array
  /** Payload ranges of every Cluster. */
  clusters: Array<[number, number]>
}

/**
 * A Segment whose children are laid out in order, with a SeekHead first
 * that indexes the elements named in `index`.
 */
function film(
  children: Array<{ bytes: Uint8Array; id: number }>,
  options: { index?: number[]; docType?: string; unknownSize?: boolean } = {},
): Layout {
  const header = ebmlHeader(options.docType)
  const placeholder = seekHead((options.index ?? []).map((id) => [id, 0]))
  const positions = new Map<number, number>()
  let offset = options.index ? placeholder.length : 0
  for (const child of children) {
    if (!positions.has(child.id)) positions.set(child.id, offset)
    offset += child.bytes.length
  }
  const head = options.index
    ? seekHead(options.index.map((id) => [id, positions.get(id) ?? 0]))
    : new Uint8Array(0)
  const body = concat(head, ...children.map((child) => child.bytes))
  const segment = options.unknownSize
    ? unknownSized(0x18538067, body)
    : element(0x18538067, body)
  const file = concat(header, segment)
  const segmentData = header.length + (segment.length - body.length)
  const clusters: Array<[number, number]> = []
  let at = segmentData + head.length
  for (const child of children) {
    if (child.id === 0x1f43b675) {
      // A 4-byte ID, then a size VINT as long as its first byte says.
      const first = child.bytes[4] ?? 0
      let length = 1
      while (length < 8 && !(first & (0x80 >> (length - 1)))) length++
      clusters.push([at + 4 + length, at + child.bytes.length])
    }
    at += child.bytes.length
  }
  return { file, clusters }
}

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

const values = (candidates: EmbeddedCandidate[] | undefined) =>
  Object.fromEntries(
    (candidates ?? []).map((candidate) => [candidate.key, candidate.value]),
  )

const ID = {
  info: 0x1549a966,
  tags: 0x1254c367,
  tracks: 0x1654ae6b,
  cluster: 0x1f43b675,
  seekHead: 0x114d9b74,
  void: 0xec,
}

const INFO = info(
  string(0x7ba9, 'Info title'),
  dateUtc('2023-02-03T04:05:06Z'),
  string(0x4d80, 'Lavf60.3.100'),
  string(0x5741, 'HandBrake 1.7.0'),
)
const TAGS = tags(
  tag(
    [uint(0x68ca, 50)],
    simpleTag('TITLE', 'Tag title'),
    simpleTag('ARTIST', 'Aglyn Studio'),
    simpleTag('DATE_RECORDED', '2024-06-07 08:09:10.5'),
    simpleTag('KEYWORDS', 'launch, film;teaser'),
    simpleTag('encoder', 'libvpx-vp9'),
    simpleTag('COMMENT', 'Director’s cut'),
    simpleTag('CATALOG_NUMBER', 'AG-001'),
  ),
  // A tag on one track describes the stream, not the file.
  tag(
    [uint(0x68ca, 30), uint(0x63c5, 1)],
    simpleTag('DURATION', '00:00:01.000000000'),
  ),
  // A collection-level title loses to the film's own.
  tag(
    [uint(0x68ca, 70)],
    simpleTag('TITLE', 'The series'),
    simpleTag('COPYRIGHT', '2024 Aglyn LLC'),
  ),
)

// ---------------------------------------------------------------------------

describe('readWebm', () => {
  it('reads Info and Tags, preferring film-level tags', async () => {
    const { file } = film(
      [
        { id: ID.void, bytes: element(0xec, new Array(12).fill(0)) },
        { id: ID.info, bytes: INFO },
        { id: ID.tracks, bytes: tracks },
        { id: ID.cluster, bytes: cluster(256) },
        { id: ID.tags, bytes: TAGS },
      ],
      { index: [ID.info, ID.tags] },
    )
    const read = await readWebm(bytesReader(file))
    expect(values(read?.candidates)).toEqual({
      title: 'Tag title',
      creator: ['Aglyn Studio'],
      createdAt: '2024-06-07T08:09:10.5',
      keywords: ['launch', 'film', 'teaser'],
      encoder: 'libvpx-vp9',
      comment: 'Director’s cut',
      'webm|CATALOG_NUMBER': 'AG-001',
      copyright: '2024 Aglyn LLC',
      'webm|MuxingApp': 'Lavf60.3.100',
    })
    expect(
      read?.candidates.every((candidate) => candidate.editable === false),
    ).toBe(true)
    expect(
      read?.candidates.every((candidate) => candidate.source === 'webm'),
    ).toBe(true)
    const catalog = read?.candidates.find(
      (candidate) => candidate.key === 'webm|CATALOG_NUMBER',
    )
    expect(catalog?.label).toBe('CATALOG_NUMBER')
  })

  it('reaches Tags past the media through the SeekHead, never reading a Cluster', async () => {
    const layout = film(
      [
        { id: ID.info, bytes: INFO },
        { id: ID.tracks, bytes: tracks },
        { id: ID.cluster, bytes: cluster(5000) },
        { id: ID.cluster, bytes: cluster(5000) },
        { id: ID.tags, bytes: TAGS },
      ],
      { index: [ID.info, ID.tags] },
    )
    const reader = countingReader(layout.file)
    const read = await readWebm(reader)
    expect(values(read?.candidates)['title']).toBe('Tag title')
    expect(layout.clusters).toHaveLength(2)
    for (const [start, end] of reader.reads) {
      for (const [payloadStart, payloadEnd] of layout.clusters) {
        expect(end <= payloadStart || start >= payloadEnd).toBe(true)
      }
    }
    expect(reader.reads.length).toBeLessThan(30)
  })

  it('follows a SeekHead that points to a second SeekHead', async () => {
    // Outer index -> Info, Cluster, inner index -> Tags. Only the outer
    // index is ahead of the media; only the inner one knows the Tags.
    const outerLength = seekHead([[ID.seekHead, 0]]).length
    const media = cluster(64)
    const innerAt = outerLength + INFO.length + media.length
    const inner = seekHead([[ID.tags, 0]])
    const tagsAt = innerAt + inner.length
    const body = concat(
      seekHead([[ID.seekHead, innerAt]]),
      INFO,
      media,
      seekHead([[ID.tags, tagsAt]]),
      TAGS,
    )
    const file = concat(ebmlHeader(), element(0x18538067, body))
    const read = await readWebm(bytesReader(file))
    expect(values(read?.candidates)['title']).toBe('Tag title')
  })

  it('reads a browser recording: unknown-size Segment and Cluster, no index', async () => {
    const media = unknownSized(
      0x1f43b675,
      uint(0xe7, 0),
      element(0xa3, new Array(3000).fill(0xee)),
    )
    const recording = concat(
      ebmlHeader('webm'),
      unknownSized(
        0x18538067,
        info(string(0x4d80, 'Chrome'), string(0x5741, 'Chrome')),
        tracks,
        media,
      ),
    )
    const reader = countingReader(recording)
    const read = await readWebm(reader)
    expect(values(read?.candidates)).toEqual({ encoder: 'Chrome' })
    // Nothing past the Cluster's 4-byte ID and 8-byte size is asked for.
    const payloadStart = recording.length - media.length + 12
    for (const [, end] of reader.reads)
      expect(end).toBeLessThanOrEqual(payloadStart)
  })

  it('counts SeekHead positions from the payload of an unknown-size Segment', async () => {
    const { file } = film(
      [
        { id: ID.info, bytes: INFO },
        { id: ID.cluster, bytes: cluster(128) },
        { id: ID.tags, bytes: TAGS },
      ],
      { index: [ID.info, ID.tags], unknownSize: true },
    )
    expect(
      values((await readWebm(bytesReader(file)))?.candidates)['creator'],
    ).toEqual(['Aglyn Studio'])
  })

  it('uses DateUTC when no tag gives a recording date', async () => {
    const { file } = film([{ id: ID.info, bytes: INFO }])
    expect(values((await readWebm(bytesReader(file)))?.candidates)).toEqual({
      title: 'Info title',
      createdAt: '2023-02-03T04:05:06Z',
      encoder: 'HandBrake 1.7.0',
      'webm|MuxingApp': 'Lavf60.3.100',
    })
  })

  it('accepts matroska and refuses any other DocType', async () => {
    const mkv = film([{ id: ID.info, bytes: INFO }], { docType: 'matroska' })
    expect(
      values((await readWebm(bytesReader(mkv.file)))?.candidates)['title'],
    ).toBe('Info title')
    const other = film([{ id: ID.info, bytes: INFO }], { docType: 'notwebm' })
    expect(await readWebm(bytesReader(other.file))).toBeNull()
  })

  it('ignores a SeekHead entry that points at the wrong element', async () => {
    const children = [
      { id: ID.info, bytes: INFO },
      { id: ID.cluster, bytes: cluster(32) },
      { id: ID.tags, bytes: TAGS },
    ]
    const body = concat(
      seekHead([[ID.tags, 0]]),
      ...children.map((child) => child.bytes),
    )
    const file = concat(ebmlHeader(), element(0x18538067, body))
    const read = await readWebm(bytesReader(file))
    expect(values(read?.candidates)['title']).toBe('Info title')
  })

  it('is null for what is not EBML, and empty for a header with no Segment', async () => {
    expect(await readWebm(bytesReader(new Uint8Array(0)))).toBeNull()
    expect(
      await readWebm(bytesReader(utf8('RIFF....WEBPVP8 not matroska'))),
    ).toBeNull()
    expect(
      await readWebm(
        bytesReader(concat([0x1a, 0x45, 0xdf, 0xa3], UNKNOWN_SIZE)),
      ),
    ).toBeNull()
    expect(await readWebm(bytesReader(ebmlHeader()))).toEqual({
      candidates: [],
    })
  })

  it('never throws on mutated input', async () => {
    const { file } = film(
      [
        { id: ID.info, bytes: INFO },
        { id: ID.cluster, bytes: cluster(64) },
        { id: ID.tags, bytes: TAGS },
      ],
      { index: [ID.info, ID.tags] },
    )
    let seed = 9
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }
    for (let round = 0; round < 400; round++) {
      const bytes = file.slice(
        0,
        round % 3 === 0 ? random() % file.length : file.length,
      )
      for (let flips = 0; flips < 1 + (round % 6); flips++) {
        if (bytes.length) bytes[random() % bytes.length] = random() & 0xff
      }
      await expect(readWebm(bytesReader(bytes))).resolves.not.toThrow()
    }
  })
})
