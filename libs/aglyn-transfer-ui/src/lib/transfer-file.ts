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

/*==========================================
 * READING A FILE IN THE BROWSER — enough of it to show the person how it reads.
 *
 * The upload step decodes the file, guesses its format, encoding, cell
 * separator and whether the first line names the columns, and shows the
 * first rows read that way. Every guess is shown and can be changed; the
 * server reads the file again under the settings the person confirmed.
 *=========================================*/

import type { TransferFormat } from '@aglyn/aglyn/data-transfer'

import type {
  TransferDelimiter,
  TransferEncoding,
  TransferFileSettings,
} from './transfer-client'

export const TRANSFER_DELIMITERS: readonly {
  value: TransferDelimiter
  label: string
}[] = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Vertical bar' },
]

export const TRANSFER_ENCODINGS: readonly {
  value: TransferEncoding
  label: string
}[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 (little-endian)' },
  { value: 'utf-16be', label: 'UTF-16 (big-endian)' },
  { value: 'windows-1252', label: 'Western (Windows-1252)' },
]

/** The encoding a byte-order mark names, or a strict UTF-8 read, or Windows-1252. */
export function detectEncoding(bytes: Uint8Array): TransferEncoding {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'utf-8'
  } catch {
    return 'windows-1252'
  }
}

/** The bytes as text in `encoding`, with any byte-order mark dropped. */
export function decodeBytes(
  bytes: Uint8Array,
  encoding: TransferEncoding,
): string {
  const text = new TextDecoder(encoding).decode(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** A file's bytes; `Blob.arrayBuffer` where the platform has it, else a reader. */
export function readFileBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () =>
      reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsArrayBuffer(file)
  })
}

/** The format a file name or its text says it is. */
export function detectFormat(fileName: string, text: string): TransferFormat {
  const name = String(fileName ?? '').toLowerCase()
  if (name.endsWith('.ndjson') || name.endsWith('.jsonl')) return 'ndjson'
  if (name.endsWith('.json')) return 'json'
  const start = text.trimStart()
  if (start.startsWith('[')) return 'json'
  if (start.startsWith('{')) {
    const lines = start.split(/\r?\n/).filter((line) => line.trim())
    return lines.length > 1 &&
      lines.every((line) => line.trim().startsWith('{'))
      ? 'ndjson'
      : 'json'
  }
  return 'csv'
}

/** Separators counted per line, outside quotes, over the first lines. */
function separatorCounts(
  text: string,
  delimiter: string,
  lines = 10,
): number[] {
  const counts: number[] = []
  let count = 0
  let quoted = false
  for (let at = 0; at < text.length && counts.length < lines; at += 1) {
    const char = text[at]
    if (char === '"') quoted = !quoted
    else if (!quoted && char === delimiter) count += 1
    else if (!quoted && char === '\n') {
      counts.push(count)
      count = 0
    }
  }
  if (counts.length < lines && count > 0) counts.push(count)
  return counts
}

/**
 * The separator the lines agree on: the one found on every sampled line the
 * same number of times, the most of them; else the most frequent; else a comma.
 */
export function detectDelimiter(text: string): TransferDelimiter {
  let best: { delimiter: TransferDelimiter; score: number } = {
    delimiter: ',',
    score: 0,
  }
  for (const { value } of TRANSFER_DELIMITERS) {
    const counts = separatorCounts(text, value)
    if (!counts.length || counts[0] === 0) continue
    const steady = counts.every((count) => count === counts[0])
    const score = (steady ? 1000 : 0) + (counts[0] as number)
    if (score > best.score) best = { delimiter: value, score }
  }
  return best.delimiter
}

/** Delimited text as rows of cells (quotes, doubled quotes and line breaks inside quotes). */
export function parseDelimited(
  text: string,
  delimiter: TransferDelimiter = ',',
): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        cell += '"'
        at += 1
      } else if (char === '"') quoted = false
      else cell += char
      continue
    }
    if (char === '"' && cell === '') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[at + 1] === '\n') at += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''))
}

const DATA_LIKE =
  /^[-+]?[\d.,\s$€£%]+$|@|^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$|^(?:true|false)$/i

/**
 * Whether the first line names the columns: every cell filled, no two
 * alike, none that looks like data (a number, an email, a date) while a
 * later line has data in that column.
 */
export function detectHeaderRow(rows: readonly (readonly string[])[]): boolean {
  const first = rows[0]
  if (!first?.length) return false
  const cells = first.map((cell) => cell.trim())
  if (cells.some((cell) => !cell)) return false
  if (new Set(cells.map((cell) => cell.toLowerCase())).size !== cells.length)
    return false
  if (cells.some((cell) => DATA_LIKE.test(cell))) return false
  return true
}

/** A JSON or NDJSON file's records, and the keys they use in first-seen order. */
export function parseJsonRecords(
  text: string,
  format: 'json' | 'ndjson',
): { headers: string[]; records: Record<string, unknown>[] } {
  let records: unknown[]
  if (format === 'ndjson') {
    records = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as unknown)
  } else {
    const parsed = JSON.parse(text) as unknown
    records = Array.isArray(parsed) ? parsed : [parsed]
  }
  const headers: string[] = []
  const objects = records.filter(
    (record): record is Record<string, unknown> =>
      Boolean(record) && typeof record === 'object' && !Array.isArray(record),
  )
  for (const record of objects)
    for (const key of Object.keys(record))
      if (!headers.includes(key)) headers.push(key)
  return { headers, records: objects }
}

/** A file read under settings: its column names and rows. */
export interface ParsedTransferFile {
  headers: string[]
  rows: unknown[][]
  /** Why the file could not be read under these settings. */
  error?: string
}

/** The text under the settings, as headers and rows. */
export function parseTransferText(
  text: string,
  settings: Pick<TransferFileSettings, 'format' | 'delimiter' | 'headerRow'>,
): ParsedTransferFile {
  if (settings.format === 'json' || settings.format === 'ndjson') {
    try {
      const { headers, records } = parseJsonRecords(text, settings.format)
      return {
        headers,
        rows: records.map((record) =>
          headers.map((header) => record[header] ?? ''),
        ),
      }
    } catch {
      return {
        headers: [],
        rows: [],
        error: `This is not valid ${settings.format === 'json' ? 'JSON' : 'NDJSON'}.`,
      }
    }
  }
  const lines = parseDelimited(text, settings.delimiter)
  const width = lines.reduce((most, line) => Math.max(most, line.length), 0)
  const headers = settings.headerRow
    ? Array.from(
        { length: width },
        (_, column) =>
          (lines[0]?.[column] ?? '').trim() || `Column ${column + 1}`,
      )
    : Array.from({ length: width }, (_, column) => `Column ${column + 1}`)
  return { headers, rows: settings.headerRow ? lines.slice(1) : lines }
}

/** Every guess at once, for a file just chosen or pasted. */
export function detectTransferFileSettings(
  fileName: string,
  text: string,
  encoding: TransferEncoding = 'utf-8',
): TransferFileSettings {
  const format = detectFormat(fileName, text)
  if (format !== 'csv')
    return { format, encoding, delimiter: ',', headerRow: true }
  const delimiter = detectDelimiter(text)
  return {
    format,
    encoding,
    delimiter,
    headerRow: detectHeaderRow(
      parseDelimited(text.slice(0, 20_000), delimiter),
    ),
  }
}

/** A byte count as a person reads it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
