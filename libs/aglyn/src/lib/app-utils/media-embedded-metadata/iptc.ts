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

/**
 * IPTC IIM, and the Photoshop image resource block that carries it
 * (AGL-3331).
 *
 * ## IIM
 *
 * The IPTC Information Interchange Model (IIM 4.2) is a flat run of
 * datasets: `0x1C`, record, dataset, a 2-byte big-endian length, the data.
 * A length with its top bit set is the extended form (§1.5.4): the low 15
 * bits count the length bytes that follow. Record 2 is the "application
 * record" every photo tool writes; record 1:90 names the character set, and
 * `ESC % G` (ISO 2022) there means UTF-8. Without it the text is whatever
 * the writer used, so each value decodes as UTF-8 when it is valid UTF-8
 * and as Latin-1 otherwise.
 *
 * ## Photoshop image resources (IRB)
 *
 * In a JPEG (APP13 after `Photoshop 3.0\0`), a TIFF (tag 34377) and a PSD,
 * IIM travels inside an image resource block: a run of resources, each
 * `8BIM`, a 2-byte id, a Pascal name padded to even, a 4-byte size and the
 * data padded to even (Photoshop File Formats §"Image Resource Blocks").
 * Resource 0x0404 holds the IIM and 0x0425 its MD5, which Photoshop and the
 * Metadata Working Group use to notice IPTC edited behind their back, so
 * the digest is kept in step with every write.
 *
 * ## Writing
 *
 * {@link writeIim} syncs every mapped key in the patch — adding, replacing
 * or removing datasets, a list as one dataset per item — and leaves every
 * other dataset byte-identical and where it was. {@link writeIrbIptc}
 * rewrites 0x0404 (and 0x0425) and copies every other resource through
 * byte for byte, in order.
 */

import { createHash } from 'crypto'

import { decodeLegacyText, isUtf8 } from './exif'
import type { EmbeddedCandidate, EmbeddedPatch } from './types'

/** The record 2 datasets this module maps, IIM 4.2 §6. */
const FIELDS: ReadonlyArray<{
  key: string
  dataset: number
  repeatable?: boolean
}> = [
  { key: 'title', dataset: 5 }, // Object Name
  { key: 'keywords', dataset: 25, repeatable: true },
  { key: 'instructions', dataset: 40 }, // Special Instructions
  { key: 'creator', dataset: 80, repeatable: true }, // By-line
  { key: 'city', dataset: 90 },
  { key: 'state', dataset: 95 }, // Province/State
  { key: 'country', dataset: 101 }, // Country/Primary Location Name
  { key: 'headline', dataset: 105 },
  { key: 'credit', dataset: 110 },
  { key: 'source', dataset: 115 },
  { key: 'copyright', dataset: 116 }, // Copyright Notice
  { key: 'description', dataset: 120 }, // Caption/Abstract
]

const DATE_CREATED = 55
const TIME_CREATED = 60

/**
 * Record 2 datasets that are binary, not text, and so are never transcoded:
 * RecordVersion and the ObjectData preview (IIM 4.2 §6.2, 2:200–2:202).
 */
const BINARY_DATASETS: ReadonlySet<number> = new Set([0, 200, 201, 202])

/** 1:90 = `ESC % G`: UTF-8, ISO 2022 / ISO-IR 196. */
const UTF8_CHARSET = new Uint8Array([0x1b, 0x25, 0x47])

/** The 2-byte RecordVersion IIM 4 writes into 1:00 and 2:00. */
const RECORD_VERSION = new Uint8Array([0x00, 0x04])

const IRB_SIGNATURES: ReadonlySet<string> = new Set([
  '8BIM',
  'MeSa',
  'PHUT',
  'AgHg',
  'DCSR',
])
const IPTC_RESOURCE = 0x0404
const IPTC_DIGEST_RESOURCE = 0x0425

const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

const utf8Lenient = new TextDecoder('utf-8')
const encoder = new TextEncoder()

interface IimEntry {
  record: number
  dataset: number
  data: Uint8Array
  /** The dataset exactly as stored, header included; null when new. */
  raw: Uint8Array | null
}

function concat(parts: ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++)
    if (text.charCodeAt(i) > 0x7f) return false
  return true
}

/**
 * Datasets up to the first byte that does not start one. Whatever follows
 * (padding, a truncated dataset, junk) is `rest`.
 */
function parseIim(iim: Uint8Array): { datasets: IimEntry[]; rest: Uint8Array } {
  const datasets: IimEntry[] = []
  let at = 0
  while (at + 5 <= iim.length && iim[at] === 0x1c) {
    let size = ((iim[at + 3] ?? 0) << 8) | (iim[at + 4] ?? 0)
    let header = 5
    if (size & 0x8000) {
      // IIM 4.2 §1.5.4: the extended form counts its own length bytes.
      const bytes = size & 0x7fff
      if (bytes < 1 || bytes > 4 || at + 5 + bytes > iim.length) break
      size = 0
      for (let i = 0; i < bytes; i++) size = size * 256 + (iim[at + 5 + i] ?? 0)
      header += bytes
    }
    if (at + header + size > iim.length) break
    datasets.push({
      record: iim[at + 1] ?? 0,
      dataset: iim[at + 2] ?? 0,
      data: iim.subarray(at + header, at + header + size),
      raw: iim.subarray(at, at + header + size),
    })
    at += header + size
  }
  return { datasets, rest: iim.subarray(at) }
}

function encodeDataset(record: number, dataset: number, data: Uint8Array) {
  if (data.length <= 0x7fff) {
    return concat([
      [0x1c, record, dataset, data.length >> 8, data.length & 0xff],
      data,
    ])
  }
  const n = data.length
  return concat([
    [0x1c, record, dataset, 0x80, 0x04],
    [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff],
    data,
  ])
}

/** Whether 1:90 declares UTF-8: `ESC % G`, or ISO 2022's `ESC % / G|H|I`. */
function declaresUtf8(datasets: readonly IimEntry[]): boolean {
  const charset = datasets.find((d) => d.record === 1 && d.dataset === 90)
  const d = charset?.data
  if (!d || d[0] !== 0x1b || d[1] !== 0x25) return false
  return (
    d[2] === 0x47 || (d[2] === 0x2f && [0x47, 0x48, 0x49].includes(d[3] ?? 0))
  )
}

function iimEntryText(data: Uint8Array, utf8: boolean): string {
  const text = utf8 ? utf8Lenient.decode(data) : decodeLegacyText(data)
  const nul = text.indexOf('\0')
  return (nul >= 0 ? text.slice(0, nul) : text).trim()
}

/**
 * 2:55 "CCYYMMDD" and 2:60 "HHMMSS±HHMM" as ISO 8601. The zone is kept as
 * recorded; a time with none (some writers drop it) stays local.
 */
function iptcDate(date: string | null, time: string | null): string | null {
  const d = date ? /^(\d{4})(\d{2})(\d{2})$/.exec(date) : null
  if (!d) return null
  const [, year, month, day] = d
  if (!year || !month || !day || year === '0000') return null
  if (+month < 1 || +month > 12 || +day < 1 || +day > 31) return null
  const iso = `${year}-${month}-${day}`
  const t = time
    ? /^(\d{2}):?(\d{2}):?(\d{2})(?:([+-])(\d{2}):?(\d{2}))?$/.exec(time)
    : null
  if (!t) return iso
  const [, hour, minute, second, sign, zoneHour, zoneMinute] = t
  if (+(hour ?? 99) > 23 || +(minute ?? 99) > 59 || +(second ?? 99) > 60) {
    return iso
  }
  const zone = sign ? `${sign}${zoneHour}:${zoneMinute}` : ''
  return `${iso}T${hour}:${minute}:${second}${zone}`
}

/**
 * An IIM stream without the zero padding its container added after the
 * last dataset (a TIFF tag pads to four bytes). Zeros inside a dataset are
 * data and are kept, as is anything after the datasets that is not zero.
 */
export function trimIimPadding(iim: Uint8Array): Uint8Array {
  const { rest } = parseIim(iim)
  return rest.length && rest.every((byte) => byte === 0)
    ? iim.subarray(0, iim.length - rest.length)
    : iim
}

/** Read the mapped record 2 datasets of an IIM stream. Never throws. */
export function readIim(iim: Uint8Array): EmbeddedCandidate[] {
  try {
    const { datasets } = parseIim(iim)
    const utf8 = declaresUtf8(datasets)
    const texts = (dataset: number) =>
      datasets
        .filter((d) => d.record === 2 && d.dataset === dataset)
        .map((d) => iimEntryText(d.data, utf8))
        .filter(Boolean)
    const out: EmbeddedCandidate[] = []
    for (const field of FIELDS) {
      const [first, ...more] = texts(field.dataset)
      if (first === undefined) continue
      out.push({
        key: field.key,
        value: field.repeatable ? [...new Set([first, ...more])] : first,
        source: 'iptc',
      })
    }
    const created = iptcDate(
      texts(DATE_CREATED)[0] ?? null,
      texts(TIME_CREATED)[0] ?? null,
    )
    if (created) out.push({ key: 'createdAt', value: created, source: 'iptc' })
    return out
  } catch {
    return []
  }
}

/** A patch value as the list of dataset values it becomes. */
function iimEntryValues(
  value: string | string[] | null,
  repeatable: boolean,
): string[] {
  if (value === null) return []
  const items = (Array.isArray(value) ? value : [value])
    .map((item) => item.trim())
    .filter(Boolean)
  if (repeatable) return [...new Set(items)]
  return items.length ? [items.join(', ')] : []
}

/** The index of the first dataset that sorts after record:dataset. */
function sortedIndex(
  list: readonly IimEntry[],
  record: number,
  dataset: number,
) {
  const index = list.findIndex(
    (d) => d.record > record || (d.record === record && d.dataset > dataset),
  )
  return index < 0 ? list.length : index
}

/**
 * Sync the mapped keys of `patch` into an IIM stream: every key present is
 * made to hold exactly the patched value(s), `null` removing its datasets.
 * Datasets this module does not map (2:00 RecordVersion included) keep
 * their bytes and their order; new ones go where record:dataset order puts
 * them. Returns `iim` itself when nothing changed.
 *
 * Text is written as UTF-8. When a value is not ASCII and 1:90 does not
 * already say UTF-8, 1:90 is set to `ESC % G` and the other record 2 text
 * is transcoded from Latin-1 so it does not turn to mojibake under the new
 * declaration. IIM's per-dataset length limits (64 bytes for a keyword,
 * 2000 for a caption) are not enforced: every current reader ignores them,
 * and truncating someone's caption is worse than exceeding a 1999 limit.
 */
export function writeIim(iim: Uint8Array, patch: EmbeddedPatch): Uint8Array {
  const { datasets, rest } = parseIim(iim)
  const patched = (key: string) =>
    Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined
  const edits = new Map<number, string[]>()
  for (const field of FIELDS) {
    const value = patch[field.key]
    if (patched(field.key) && value !== undefined) {
      edits.set(field.dataset, iimEntryValues(value, Boolean(field.repeatable)))
    }
  }
  if (patched('createdAt')) {
    const value = patch['createdAt']
    const iso = typeof value === 'string' ? ISO_DATE.exec(value.trim()) : null
    if (value === null) {
      edits.set(DATE_CREATED, [])
      edits.set(TIME_CREATED, [])
    } else if (iso) {
      const [, year, month, day, hour, minute, second, zone] = iso
      edits.set(DATE_CREATED, [`${year}${month}${day}`])
      // No zone recorded, none invented: the time is written without one.
      const offset = zone === 'Z' ? '+0000' : (zone?.replace(':', '') ?? '')
      edits.set(
        TIME_CREATED,
        hour ? [`${hour}${minute}${second ?? '00'}${offset}`] : [],
      )
    }
  }
  if (!edits.size) return iim

  let list = datasets.slice()
  const values = [...edits.values()].flat()
  if (!declaresUtf8(list) && values.some((v) => !isAscii(v))) {
    list = list.map((d) =>
      d.record === 2 &&
      !BINARY_DATASETS.has(d.dataset) &&
      !edits.has(d.dataset) &&
      !isUtf8(d.data)
        ? { ...d, data: encoder.encode(decodeLegacyText(d.data)), raw: null }
        : d,
    )
    const charset: IimEntry = {
      record: 1,
      dataset: 90,
      data: UTF8_CHARSET,
      raw: null,
    }
    const existing = list.findIndex((d) => d.record === 1 && d.dataset === 90)
    if (existing >= 0) {
      list[existing] = charset
    } else {
      if (!list.some((d) => d.record === 1)) {
        // IIM 4.2 §5: 1:00 ModelVersion is mandatory in the envelope.
        list.splice(sortedIndex(list, 1, 0), 0, {
          record: 1,
          dataset: 0,
          data: RECORD_VERSION,
          raw: null,
        })
      }
      list.splice(sortedIndex(list, 1, 90), 0, charset)
    }
  }

  for (const [dataset, texts] of [...edits].sort((a, b) => a[0] - b[0])) {
    const first = list.findIndex((d) => d.record === 2 && d.dataset === dataset)
    const kept = list.filter((d) => !(d.record === 2 && d.dataset === dataset))
    const fresh = texts.map((text): IimEntry => ({
      record: 2,
      dataset,
      data: encoder.encode(text),
      raw: null,
    }))
    kept.splice(first >= 0 ? first : sortedIndex(kept, 2, dataset), 0, ...fresh)
    list = kept
  }
  if (values.length && !list.some((d) => d.record === 2 && d.dataset === 0)) {
    // IIM 4.2 §6: 2:00 RecordVersion is mandatory in the application record.
    list.splice(sortedIndex(list, 2, 0), 0, {
      record: 2,
      dataset: 0,
      data: RECORD_VERSION,
      raw: null,
    })
  }

  // Zero padding after the last dataset is dropped (a container pads again
  // as it needs to); anything else there is kept as found.
  const tail = rest.some((byte) => byte !== 0) ? rest : new Uint8Array()
  const out = concat([
    ...list.map((d) => d.raw ?? encodeDataset(d.record, d.dataset, d.data)),
    tail,
  ])
  return sameBytes(out, iim) ? iim : out
}

// ---------------------------------------------------------------------------
// Photoshop image resources
// ---------------------------------------------------------------------------

interface Resource {
  signature: string
  id: number
  /** The Pascal name as stored: length byte, text, pad to even. */
  name: Uint8Array
  data: Uint8Array
  /** The whole resource as stored, padding included. */
  raw: Uint8Array
}

function parseIrb(irb: Uint8Array): {
  resources: Resource[]
  rest: Uint8Array
} {
  const resources: Resource[] = []
  let at = 0
  while (at + 12 <= irb.length) {
    const signature = String.fromCharCode(...irb.subarray(at, at + 4))
    if (!IRB_SIGNATURES.has(signature)) break
    const nameLength = irb[at + 6] ?? 0
    const nameEnd = at + 6 + ((nameLength + 2) & ~1)
    if (nameEnd + 4 > irb.length) break
    const size =
      (irb[nameEnd] ?? 0) * 0x1000000 +
      (((irb[nameEnd + 1] ?? 0) << 16) |
        ((irb[nameEnd + 2] ?? 0) << 8) |
        (irb[nameEnd + 3] ?? 0))
    const dataAt = nameEnd + 4
    if (dataAt + size > irb.length) break
    const end = Math.min(dataAt + size + (size % 2), irb.length)
    resources.push({
      signature,
      id: ((irb[at + 4] ?? 0) << 8) | (irb[at + 5] ?? 0),
      name: irb.subarray(at + 6, nameEnd),
      data: irb.subarray(dataAt, dataAt + size),
      raw: irb.subarray(at, end),
    })
    at = end
  }
  return { resources, rest: irb.subarray(at) }
}

function encodeResource(
  resource: Pick<Resource, 'signature' | 'id' | 'name'>,
  data: Uint8Array,
): Uint8Array {
  const n = data.length
  return concat([
    [...resource.signature].map((c) => c.charCodeAt(0)),
    [resource.id >> 8, resource.id & 0xff],
    resource.name,
    [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff],
    data,
    n % 2 ? [0] : [],
  ])
}

const isIptcResource = (r: Resource) =>
  r.signature === '8BIM' && r.id === IPTC_RESOURCE

/** The IIM held in an image resource block (resource 0x0404), or null. */
export function irbIim(irb: Uint8Array): Uint8Array | null {
  try {
    return parseIrb(irb).resources.find(isIptcResource)?.data ?? null
  } catch {
    return null
  }
}

/** Whether an image resource block holds IPTC (resource 0x0404). */
export function irbHasIptc(irb: Uint8Array): boolean {
  return irbIim(irb) !== null
}

/** Read the IPTC of an image resource block. Never throws. */
export function readIrbIptc(irb: Uint8Array): EmbeddedCandidate[] {
  const iim = irbIim(irb)
  return iim ? readIim(iim) : []
}

/**
 * Put `iim` in resource 0x0404, or take the resource out when `iim` is
 * null, and bring the 0x0425 digest in step (set to the new IIM's MD5, or
 * removed with it). A block without 0x0404 gets one at the end. Every other
 * resource, and anything after the last one, is copied byte for byte.
 */
export function replaceIrbIim(
  irb: Uint8Array,
  iim: Uint8Array | null,
): Uint8Array {
  const { resources, rest } = parseIrb(irb)
  const digest = iim
    ? new Uint8Array(createHash('md5').update(iim).digest())
    : null
  const parts: Uint8Array[] = []
  let replaced = false
  for (const resource of resources) {
    if (isIptcResource(resource) && !replaced) {
      replaced = true
      if (iim) parts.push(encodeResource(resource, iim))
    } else if (
      resource.signature === '8BIM' &&
      resource.id === IPTC_DIGEST_RESOURCE
    ) {
      if (digest) parts.push(encodeResource(resource, digest))
    } else {
      parts.push(resource.raw)
    }
  }
  if (!replaced && iim) {
    parts.push(
      encodeResource(
        { signature: '8BIM', id: IPTC_RESOURCE, name: new Uint8Array(2) },
        iim,
      ),
    )
  }
  const out = concat([...parts, rest])
  return sameBytes(out, irb) ? irb : out
}

/**
 * Write a patch into the IPTC of an image resource block. A block without
 * IPTC is returned as is: new values go to XMP, never into a new IIM (the
 * Metadata Working Group's rule).
 */
export function writeIrbIptc(
  irb: Uint8Array,
  patch: EmbeddedPatch,
): Uint8Array {
  const iim = irbIim(irb)
  if (!iim) return irb
  const next = writeIim(iim, patch)
  return next === iim ? irb : replaceIrbIim(irb, next)
}
