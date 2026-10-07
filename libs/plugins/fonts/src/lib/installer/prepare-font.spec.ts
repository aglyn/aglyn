/**
 * @jest-environment ./jest-environment-node-shared.cjs
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fontverter from 'fontverter'
import { fontContainer, readFontFile } from '../font-file/read-font-file'
import { FONT_UPLOAD_MAX_BYTES } from './constants'
import { FontPrepareError, guessFontCategory, prepareFontFile, storedFontFileName } from './prepare-font'
import { describeScripts, mergeUnicodeRanges, parseUnicodeRange, planFontSubset } from './unicode-ranges'

/** Inter Regular (SIL OFL 1.1), subset to the space, a–z and A. */
const INTER = new Uint8Array(readFileSync(join(__dirname, '../font-file/__fixtures__/inter-regular-latin-sample.ttf')))

/** A copy of the fixture with OS/2 `fsType` set. */
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

async function refusal(input: Uint8Array): Promise<FontPrepareError> {
  try {
    await prepareFontFile(input)
  } catch (error) {
    if (error instanceof FontPrepareError) return error
    throw error
  }
  throw new Error('expected a refusal')
}

describe('prepareFontFile (AGL-3656)', () => {
  it('converts a TrueType file to a WOFF2 subset to the scripts it covers', async () => {
    const { face, woff2 } = await prepareFontFile(INTER)
    expect(fontContainer(woff2)).toBe('woff2')
    expect(face).toMatchObject({
      family: 'Inter',
      subfamily: 'Regular',
      weight: 400,
      style: 'normal',
      category: 'sans-serif',
      sourceFormat: 'truetype',
      scripts: ['latin'],
      license: { embedding: 'installable', fsType: 0, noSubsetting: false },
      metrics: { unitsPerEm: 2048, ascent: 1984, descent: -494, lineGap: 0 },
      fileName: 'Inter-400.woff2',
      warnings: [],
      bytesIn: INTER.length,
      bytesOut: woff2.length,
    })
    expect(face.unicodeRange).toContain('U+0000-00FF')
    expect(face.contentHash).toMatch(/^[0-9a-f]{16}$/)
    expect(face.bytesOut).toBeLessThan(face.bytesIn)
    // The stored file still draws the text it was kept for.
    const back = readFontFile(await fontverter.convert(Buffer.from(woff2), 'truetype'))
    expect(back.family).toBe('Inter')
    expect(back.hasCodePoint('a'.codePointAt(0) as number)).toBe(true)
  })

  it('unwraps a WOFF2 or WOFF upload to read it, and stores the same face', async () => {
    const asWoff2 = new Uint8Array(await fontverter.convert(Buffer.from(INTER), 'woff2'))
    const asWoff = new Uint8Array(await fontverter.convert(Buffer.from(INTER), 'woff'))
    for (const [input, format] of [
      [asWoff2, 'woff2'],
      [asWoff, 'woff'],
    ] as const) {
      const { face } = await prepareFontFile(input)
      expect(face).toMatchObject({ family: 'Inter', weight: 400, sourceFormat: format, scripts: ['latin'] })
    }
  })

  it('refuses a license that forbids embedding, in plain words', async () => {
    const restricted = await refusal(withFsType(0x0002))
    expect(restricted).toMatchObject({ status: 422, code: 'license-restricted' })
    expect(restricted.message).toMatch(/not embeddable/)
    expect(await refusal(withFsType(0x0200))).toMatchObject({ status: 422, code: 'license-bitmap-only' })
  })

  it('installs a preview-and-print font with a warning to check the license', async () => {
    const { face } = await prepareFontFile(withFsType(0x0004))
    expect(face.license.embedding).toBe('preview-print')
    expect(face.warnings.join(' ')).toMatch(/web use/)
  })

  it('converts a font whose license forbids subsetting without trimming it', async () => {
    const { face } = await prepareFontFile(withFsType(0x0100))
    expect(face.scripts).toEqual([])
    expect(face.unicodeRange).toBeUndefined()
    expect(face.warnings.join(' ')).toMatch(/embedded whole/)
  })

  it('refuses a collection, a file that is not a font, an empty file and an oversized one', async () => {
    expect(await refusal(new TextEncoder().encode('ttcf\u0000\u0001\u0000\u0000'))).toMatchObject({
      status: 415,
      code: 'collection',
    })
    expect(await refusal(new TextEncoder().encode('<html><body>hello</body></html>'))).toMatchObject({
      status: 415,
      code: 'not-a-font',
    })
    expect(await refusal(new Uint8Array())).toMatchObject({ status: 400, code: 'empty' })
    const huge = new Uint8Array(FONT_UPLOAD_MAX_BYTES + 1)
    huge.set(INTER.slice(0, 4))
    expect(await refusal(huge)).toMatchObject({ status: 413, code: 'too-large' })
  })

  it('refuses a damaged font rather than storing it', async () => {
    expect(await refusal(INTER.slice(0, 400))).toMatchObject({ status: 422 })
  })
})

describe('planFontSubset (AGL-3656)', () => {
  const drawing = (ranges: Array<[number, number]>) => (codePoint: number) =>
    ranges.some(([from, to]) => codePoint >= from && codePoint <= to)

  it('keeps the scripts a font draws, and only the code points it draws inside them', () => {
    const plan = planFontSubset(
      drawing([
        [0x20, 0x7e],
        [0x0410, 0x044f],
        [0x05d0, 0x05ea], // Hebrew: drawn, but no script of ours
      ]),
    )
    expect(plan.scripts).toEqual(['cyrillic', 'latin'])
    expect(plan.text).toContain('Ж')
    expect(plan.text).toContain('a')
    expect(plan.text).not.toContain('א')
    expect(plan.unicodeRange).toContain('U+0400-045F')
    expect(describeScripts(plan.scripts)).toBe('Latin and Cyrillic')
  })

  it('does not count a stray letter as a script', () => {
    // Latin plus the micro sign and one Greek capital from a math block.
    const plan = planFontSubset(drawing([[0x20, 0x7e], [0xb5, 0xb5], [0x03a9, 0x03a9]]))
    expect(plan.scripts).toEqual(['latin'])
  })

  it('leaves a font of none of the scripts whole', () => {
    expect(planFontSubset(drawing([[0x05d0, 0x05ea]]))).toEqual({ scripts: [], text: '', unicodeRange: '' })
  })

  it('reads and merges unicode ranges', () => {
    expect(parseUnicodeRange('U+0000-00FF, U+0131, junk')).toEqual([
      [0, 255],
      [0x131, 0x131],
    ])
    expect(mergeUnicodeRanges(['U+0000-00FF, U+0131', 'U+0100-0130'])).toBe('U+0000-0131')
  })
})

describe('naming (AGL-3656)', () => {
  it('guesses a category from the name, sans-serif when nothing says otherwise', () => {
    expect(guessFontCategory('JetBrains Mono')).toBe('monospace')
    expect(guessFontCategory('Source Serif 4')).toBe('serif')
    expect(guessFontCategory('Source Sans 3')).toBe('sans-serif')
    expect(guessFontCategory('Dancing Script')).toBe('handwriting')
    expect(guessFontCategory('Acme')).toBe('sans-serif')
  })

  it('names the stored file by family, weight and style', () => {
    expect(storedFontFileName({ family: 'Acme Sans', weight: 700, style: 'italic' })).toBe('Acme-Sans-700-italic.woff2')
    expect(storedFontFileName({ family: 'Acme Flex', weight: 100, weightMax: 900, style: 'normal' })).toBe(
      'Acme-Flex-100-900.woff2',
    )
  })
})
