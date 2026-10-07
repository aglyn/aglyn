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
  fontContainer,
  fontEmbeddingVerdict,
  FontFileError,
  readFontFile,
} from './read-font-file'

/**
 * Inter Regular (SIL OFL 1.1), subset to the space, a–z and A by HarfBuzz:
 * a real font, small enough to keep in the repository.
 */
const INTER = new Uint8Array(readFileSync(join(__dirname, '__fixtures__/inter-regular-latin-sample.ttf')))

/** A copy of the fixture with OS/2 `fsType` set, to read each license. */
function withFsType(fsType: number): Uint8Array {
  const bytes = INTER.slice()
  const view = new DataView(bytes.buffer)
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = String.fromCharCode(...bytes.slice(at, at + 4))
    if (tag === 'OS/2') view.setUint16(view.getUint32(at + 8) + 8, fsType)
  }
  return bytes
}

describe('readFontFile (AGL-3656)', () => {
  it('reads the family, style, weight and the metrics a fallback is sized to', () => {
    const facts = readFontFile(INTER)
    expect(facts).toMatchObject({
      container: 'truetype',
      family: 'Inter',
      subfamily: 'Regular',
      weight: 400,
      style: 'normal',
      metrics: { unitsPerEm: 2048, ascent: 1984, descent: -494, lineGap: 0, xWidthAvg: 967 },
      axes: [],
    })
    expect(facts.embedding.allowed).toBe(true)
    expect(facts.hasCodePoint('a'.codePointAt(0) as number)).toBe(true)
    expect(facts.hasCodePoint('Z'.codePointAt(0) as number)).toBe(false)
  })

  it('reads the license in OS/2 fsType', () => {
    expect(readFontFile(withFsType(0x0002)).embedding).toMatchObject({ embedding: 'restricted', allowed: false })
    expect(readFontFile(withFsType(0x0004)).embedding).toMatchObject({ embedding: 'preview-print', allowed: true })
    expect(readFontFile(withFsType(0x0008)).embedding).toMatchObject({ embedding: 'editable', allowed: true })
    expect(readFontFile(withFsType(0x0200)).embedding).toMatchObject({ embedding: 'bitmap-only', allowed: false })
    expect(readFontFile(withFsType(0x0100)).embedding).toMatchObject({ allowed: true, noSubsetting: true })
  })

  it('takes the least restrictive bit a font sets, as the OpenType spec says', () => {
    expect(fontEmbeddingVerdict(0x0002 | 0x0004).embedding).toBe('preview-print')
    expect(fontEmbeddingVerdict(0x0002 | 0x0008).embedding).toBe('editable')
  })

  it('names a container it does not read, and refuses what is not a font', () => {
    expect(fontContainer(new TextEncoder().encode('wOF2xxxx'))).toBe('woff2')
    expect(fontContainer(new TextEncoder().encode('wOFFxxxx'))).toBe('woff')
    expect(fontContainer(new TextEncoder().encode('OTTOxxxx'))).toBe('opentype')
    expect(() => readFontFile(new TextEncoder().encode('wOF2xxxxxxxxxxxx'))).toThrow(FontFileError)
    expect(() => readFontFile(new TextEncoder().encode('ttcfxxxxxxxxxxxx'))).toThrow(/collection/)
    expect(() => readFontFile(new TextEncoder().encode('<html>not a font'))).toThrow(/not a font/)
  })

  it('refuses a file whose tables run past its end', () => {
    expect(() => readFontFile(INTER.slice(0, 400))).toThrow(FontFileError)
  })
})
