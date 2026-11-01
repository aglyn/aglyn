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
  readSiteBrandMissed,
  saveSiteBrandFiles,
  siteBrandFileAccept,
  siteBrandFileRefusal,
  siteBrandFileType,
  siteBrandMissedNotice,
  type SiteBrandFields,
} from './site-brand-files'

const MB = 1024 * 1024
const file = (name: string, type = 'image/png', size = 2048) => {
  const made = new File(['x'], name, { type })
  Object.defineProperty(made, 'size', { value: size })
  return made
}
const stored = (id: string) =>
  `https://firebasestorage.googleapis.com/v0/b/bucket/o/hosts%2Fh1%2Fmedia%2F${id}?alt=media&token=t`

describe('what the fields take (AGL-4119)', () => {
  it('offers a favicon an ICO, and a logo none', () => {
    expect(siteBrandFileAccept('logo')).toContain('image/svg+xml')
    expect(siteBrandFileAccept('logo')).not.toContain('.ico')
    expect(siteBrandFileAccept('favicon')).toContain('.ico')
  })

  it('reads a type a browser left empty off the file name', () => {
    expect(siteBrandFileType(file('mark.SVG', ''), 'logo')).toBe('image/svg+xml')
    expect(siteBrandFileType(file('icon.ico', ''), 'favicon')).toBe('image/x-icon')
    expect(siteBrandFileType(file('notes.txt', ''), 'logo')).toBeNull()
  })

  it('folds a browser’s other spelling of a type to the stored one', () => {
    expect(siteBrandFileType(file('photo.jpg', 'image/jpg'), 'logo')).toBe('image/jpeg')
  })

  it('says on the field what the upload route would refuse', () => {
    expect(siteBrandFileRefusal(file('logo.png'), 'logo', 15 * MB)).toBeNull()
    expect(siteBrandFileRefusal(file('logo.tiff', 'image/tiff'), 'logo', 15 * MB)).toBe(
      'Use a PNG, JPEG, WebP or SVG file.',
    )
    expect(siteBrandFileRefusal(file('icon.ico', 'image/x-icon'), 'logo', 15 * MB)).toBe(
      'Use a PNG, JPEG, WebP or SVG file.',
    )
    expect(siteBrandFileRefusal(file('icon.bmp', 'image/bmp'), 'favicon', 15 * MB)).toBe(
      'Use a PNG, JPEG, WebP, SVG or ICO file.',
    )
    expect(siteBrandFileRefusal(file('big.png', 'image/png', 16 * MB), 'logo', 15 * MB)).toBe(
      'That file is over 15 MB.',
    )
    expect(siteBrandFileRefusal(file('empty.png', 'image/png', 0), 'logo', 15 * MB)).toBe('That file is empty.')
  })
})

describe('saving what a form holds (AGL-4119)', () => {
  const run = async (
    files: Parameters<typeof saveSiteBrandFiles>[0],
    options: { refuse?: string[]; saveFails?: boolean } = {},
  ) => {
    const uploaded: string[] = []
    const writes: SiteBrandFields[] = []
    const outcome = await saveSiteBrandFiles(files, {
      upload: async (chosen) => {
        if (options.refuse?.includes(chosen.name)) throw new Error('Storage limit reached')
        uploaded.push(chosen.name)
        return { url: stored(chosen.name.split('.')[0]) }
      },
      save: async (fields) => {
        if (options.saveFails) throw new Error('Save failed (403)')
        writes.push(fields)
      },
    })
    return { outcome, uploaded, writes }
  }
  const ref = (id: string) => expect.stringContaining(`media:${id}`.slice(0, 6))

  it('writes nothing with no logo and no favicon', async () => {
    const { outcome, uploaded, writes } = await run({})
    expect(outcome).toEqual({ saved: null, missed: [] })
    expect(uploaded).toEqual([])
    expect(writes).toEqual([])
  })

  it('writes a logo as a media reference, and uses it as the favicon when that is blank', async () => {
    const { outcome, uploaded, writes } = await run({ logo: file('logo.png') })
    expect(uploaded).toEqual(['logo.png'])
    expect(writes).toHaveLength(1)
    expect(writes[0].logoUrl).toEqual(ref('logo'))
    expect(writes[0].favicon).toBe(writes[0].logoUrl)
    expect(outcome.missed).toEqual([])
  })

  it('keeps a favicon of its own over the logo, and a dark logo beside it', async () => {
    const { writes } = await run({
      logo: file('logo.png'),
      logoDark: file('dark.png'),
      favicon: file('icon.png'),
    })
    expect(writes[0].logoDarkUrl).toContain('dark')
    expect(writes[0].favicon).toContain('icon')
    expect(writes[0].logoUrl).toContain('logo')
  })

  it('writes a favicon alone, and no logo fields, with no logo', async () => {
    const { writes } = await run({ favicon: file('icon.png') })
    expect(Object.keys(writes[0])).toEqual(['favicon'])
  })

  it('uploads one at a time, in field order', async () => {
    const { uploaded } = await run({
      favicon: file('icon.png'),
      logoDark: file('dark.png'),
      logo: file('logo.png'),
    })
    expect(uploaded).toEqual(['logo.png', 'dark.png', 'icon.png'])
  })

  it('keeps what uploaded when one file is refused, and names the one that was', async () => {
    const { outcome, writes } = await run(
      { logo: file('logo.png'), logoDark: file('dark.png') },
      { refuse: ['dark.png'] },
    )
    expect(outcome.missed).toEqual(['logoDark'])
    expect(writes[0].logoUrl).toContain('logo')
    expect(writes[0].logoDarkUrl).toBeUndefined()
  })

  it('falls back to the logo for a favicon that was refused, and still names it', async () => {
    const { outcome, writes } = await run(
      { logo: file('logo.png'), favicon: file('icon.png') },
      { refuse: ['icon.png'] },
    )
    expect(outcome.missed).toEqual(['favicon'])
    expect(writes[0].favicon).toBe(writes[0].logoUrl)
  })

  it('writes no favicon from a logo that was refused', async () => {
    const { outcome, writes } = await run({ logo: file('logo.png') }, { refuse: ['logo.png'] })
    expect(outcome).toEqual({ saved: null, missed: ['logo'] })
    expect(writes).toEqual([])
  })

  it('counts an upload that answers no address as missed', async () => {
    const outcome = await saveSiteBrandFiles(
      { logo: file('logo.png') },
      { upload: async () => ({}), save: async () => undefined },
    )
    expect(outcome).toEqual({ saved: null, missed: ['logo'] })
  })

  it('never rejects: a write that fails names every file it carried', async () => {
    const { outcome } = await run({ logo: file('logo.png'), favicon: file('icon.png') }, { saveFails: true })
    expect(outcome).toEqual({ saved: null, missed: ['logo', 'favicon'] })
  })
})

describe('saying what did not make it (AGL-4119)', () => {
  it('says nothing when everything did', () => {
    expect(siteBrandMissedNotice([])).toBeNull()
  })

  it('names the field and where to add it, in one line', () => {
    expect(siteBrandMissedNotice(['favicon'])).toBe(
      'Your site is ready, but your favicon didn’t upload. Add it in Site settings.',
    )
    expect(siteBrandMissedNotice(['favicon', 'logo'])).toBe(
      'Your site is ready, but your logo and favicon didn’t upload. Add them in Site settings.',
    )
    expect(siteBrandMissedNotice(['logo', 'logoDark', 'favicon'])).toBe(
      'Your site is ready, but your logo, dark logo and favicon didn’t upload. Add them in Site settings.',
    )
  })

  it('reads only field names back off a landing', () => {
    expect(readSiteBrandMissed('logo,favicon,<script>')).toEqual(['logo', 'favicon'])
    expect(readSiteBrandMissed(null)).toEqual([])
  })
})
