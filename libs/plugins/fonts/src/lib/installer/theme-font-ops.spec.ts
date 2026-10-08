import type { HostTheme } from '@aglyn/shared-data-types'
import {
  applyFontOp,
  fontOpWrites,
  listInstalledFonts,
  planOf,
  readFontOp,
  type FontOp,
  type InstallableFace,
} from './theme-font-ops'

const face = (over: Partial<InstallableFace> = {}): InstallableFace => ({
  family: 'Acme Sans',
  weight: 400,
  style: 'normal',
  category: 'sans-serif',
  metrics: { unitsPerEm: 1000, ascent: 900, descent: -200, lineGap: 0, xWidthAvg: 500 },
  ...over,
})

const install = (over: Partial<InstallableFace> = {}, mediaId = 'm1'): FontOp => ({
  op: 'install',
  face: face(over),
  mediaId,
  version: 'aaaa',
})

describe('the fonts door (AGL-3668)', () => {
  it('reads each operation and refuses what is malformed', () => {
    expect(readFontOp({ op: 'list' })).toEqual({ op: 'list' })
    expect(readFontOp({ op: 'install', face: face(), mediaId: 'm1', version: 'aaaa' })).toEqual(install())
    expect(readFontOp({ op: 'role', family: 'Acme Sans', role: 'body' })).toEqual({
      op: 'role',
      family: 'Acme Sans',
      role: 'body',
    })
    expect(readFontOp({ op: 'category', family: 'Acme Sans', category: 'serif' })).toEqual({
      op: 'category',
      family: 'Acme Sans',
      category: 'serif',
    })
    expect(readFontOp({ op: 'remove-family', family: 'Acme Sans' })).toEqual({ op: 'remove-family', family: 'Acme Sans' })
    expect(readFontOp({ op: 'remove-face', family: 'Acme Sans', face: { weight: 700, style: 'italic' } })).toEqual({
      op: 'remove-face',
      family: 'Acme Sans',
      face: { weight: 700, style: 'italic' },
    })
    for (const bad of [
      null,
      [],
      { op: 'nope' },
      { op: 'install', face: face(), mediaId: '../x', version: 'aaaa' },
      { op: 'install', face: face(), mediaId: 'm1', version: '' },
      { op: 'install', face: { ...face(), weight: 0 }, mediaId: 'm1', version: 'aaaa' },
      { op: 'install', face: { ...face(), style: 'oblique' }, mediaId: 'm1', version: 'aaaa' },
      { op: 'install', face: { ...face(), category: 'comic' }, mediaId: 'm1', version: 'aaaa' },
      { op: 'install', face: { ...face(), weightMax: 300 }, mediaId: 'm1', version: 'aaaa' },
      { op: 'install', face: { ...face(), metrics: { unitsPerEm: 0 } }, mediaId: 'm1', version: 'aaaa' },
      { op: 'role', family: 'Acme Sans', role: 'footer' },
      { op: 'category', family: '', category: 'serif' },
      { op: 'remove-face', family: 'Acme Sans', face: { style: 'normal' } },
    ]) {
      expect(typeof readFontOp(bad)).toBe('string')
    }
  })

  it('keeps only the facts a theme records', () => {
    const read = readFontOp({ op: 'plan', face: { ...face(), subfamily: 'Regular', bytesIn: 4, license: { embedding: 'x' } } })
    expect(read).toEqual({ op: 'plan', face: face() })
  })

  it('installs a face, then lists it with the media file it points at', () => {
    const theme = applyFontOp({}, install(), 'h1')
    expect(listInstalledFonts(theme, 'h1')).toEqual([
      {
        family: 'Acme Sans',
        category: 'sans-serif',
        roles: [],
        faces: [{ weight: 400, style: 'normal', label: '400', mediaId: 'm1' }],
      },
    ])
    // Another site's library is not this site's file.
    expect(listInstalledFonts(theme, 'h2')[0]?.faces[0]?.mediaId).toBeUndefined()
  })

  it('plans a replace for a slot the theme already holds and an upload otherwise', () => {
    const theme = applyFontOp({}, install(), 'h1')
    expect(planOf(theme, { op: 'plan', face: face() }, 'h1')).toEqual({ mode: 'replace', mediaId: 'm1', scope: 'h1' })
    expect(planOf(theme, { op: 'plan', face: face({ weight: 700 }) }, 'h1')).toEqual({ mode: 'upload' })
    expect(planOf(theme, { op: 'plan', face: face() }, 'h2')).toEqual({ mode: 'upload' })
  })

  it('sets a role and a category, and removes a face and then the family', () => {
    let theme: HostTheme = applyFontOp({}, install(), 'h1')
    theme = applyFontOp(theme, install({ weight: 700 }, 'm2'), 'h1')
    theme = applyFontOp(theme, { op: 'role', family: 'Acme Sans', role: 'headings' }, 'h1')
    expect(listInstalledFonts(theme, 'h1')[0]?.roles).toEqual(['headings'])
    theme = applyFontOp(theme, { op: 'category', family: 'Acme Sans', category: 'serif' }, 'h1')
    expect(listInstalledFonts(theme, 'h1')[0]?.category).toBe('serif')
    expect(theme.typography?.variants?.h1?.fontFamily).toBe('"Acme Sans", serif')
    theme = applyFontOp(theme, { op: 'remove-face', family: 'Acme Sans', face: { weight: 700, style: 'normal' } }, 'h1')
    expect(listInstalledFonts(theme, 'h1')[0]?.faces).toHaveLength(1)
    theme = applyFontOp(theme, { op: 'remove-family', family: 'Acme Sans' }, 'h1')
    expect(listInstalledFonts(theme, 'h1')).toEqual([])
    expect(theme.typography?.variants).toBeUndefined()
  })

  it('writes the theme for every operation but a list and a plan', () => {
    expect(fontOpWrites({ op: 'list' })).toBe(false)
    expect(fontOpWrites({ op: 'plan', face: face() })).toBe(false)
    expect(fontOpWrites(install())).toBe(true)
    expect(fontOpWrites({ op: 'remove-family', family: 'x' })).toBe(true)
  })

  it('leaves the theme alone when the media reference cannot be made', () => {
    const theme: HostTheme = {}
    expect(applyFontOp(theme, { ...(install() as Extract<FontOp, { op: 'install' }>), mediaId: 'bad id' }, 'h1')).toBe(theme)
  })
})
