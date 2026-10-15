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
import {
  detectFormat,
  detectHeaderRow,
  detectDelimiter,
  detectTransferFileSettings,
  formatBytes,
  parseDelimited,
  parseTransferText,
} from '@aglyn/aglyn-transfer-ui/transfer-file'
import type { TransferEncoding, TransferFileSettings } from '@aglyn/aglyn-transfer-ui/transfer-client'

/**
 * The native import upload reads a chosen or pasted file the way the console's Upload step does (AGL-3671): the same guesses
 * for the format, the separator and whether the first row names the columns, the same quoted-cell reading, the same preview
 * rows. The Swift and Kotlin ports replay `libs/native/contracts/transfer-file-cases.json` (AglynCoreTests, native-core
 * desktopTest); this replays it against the console's own `transfer-file.ts`, so a change there fails here until the ports and
 * the cases follow.
 */
const root = join(__dirname, '../../..')
const cases = JSON.parse(readFileSync(join(root, 'libs/native/contracts/transfer-file-cases.json'), 'utf8')) as {
  texts: Record<string, string>
  detectFormat: Array<{ fileName: string; text: string; result: string }>
  detectDelimiter: Array<{ text: string; result: string }>
  parseDelimited: Array<{ text: string; delimiter: string; result: string[][] }>
  detectHeaderRow: Array<{ text: string; delimiter: string; result: boolean }>
  parse: Array<{ text: string; settings: TransferFileSettings; result: unknown }>
  detectSettings: Array<{ fileName: string; text: string; encoding: TransferEncoding; result: unknown }>
  formatBytes: Array<{ bytes: number; result: string }>
}
const texts = cases.texts

describe('native import upload reading', () => {
  it('guesses the format, the separator and the header row as the console does', () => {
    for (const one of cases.detectFormat) expect([one.fileName, one.text, detectFormat(one.fileName, texts[one.text] as string)]).toEqual([one.fileName, one.text, one.result])
    for (const one of cases.detectDelimiter) expect([one.text, detectDelimiter(texts[one.text] as string)]).toEqual([one.text, one.result])
    for (const one of cases.detectHeaderRow) {
      expect([one.text, detectHeaderRow(parseDelimited(texts[one.text] as string, one.delimiter as never))]).toEqual([one.text, one.result])
    }
    for (const one of cases.detectSettings) {
      expect([one.fileName, one.text, detectTransferFileSettings(one.fileName, texts[one.text] as string, one.encoding)]).toEqual([one.fileName, one.text, one.result])
    }
  })

  it('reads cells and records, and sizes, as the console does', () => {
    for (const one of cases.parseDelimited) expect([one.text, one.delimiter, parseDelimited(texts[one.text] as string, one.delimiter as never)]).toEqual([one.text, one.delimiter, one.result])
    for (const one of cases.parse) expect([one.text, one.settings, parseTransferText(texts[one.text] as string, one.settings)]).toEqual([one.text, one.settings, one.result])
    for (const one of cases.formatBytes) expect([one.bytes, formatBytes(one.bytes)]).toEqual([one.bytes, one.result])
    expect(cases.parse.length).toBeGreaterThan(30)
  })
})
