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
  ARTIFACT_OVERRIDE_FIELD,
  OVERRIDE_DELETE,
  arrayKeyField,
  canOverrideArtifact,
  diffOverride,
  isEmptyOverride,
  isKeyedArrayPatch,
  overrideConflicts,
  overridePaths,
  overrideWriteValue,
  readArtifactOverride,
  resolveArtifactContent,
  resolveOverride,
} from './marketplace-overrides'
import type { ResolvedProvenance } from './marketplace-provenance'

/** A theme, the first consumer (AGL-1020/1021). */
const theme = () => ({
  palette: {
    primary: { main: '#1976d2', contrastText: '#fff' },
    secondary: { main: '#9c27b0' },
  },
  typography: { fontFamily: 'Inter', h1: { fontSize: 48 } },
  fontStack: ['Inter', 'system-ui', 'sans-serif'],
})

describe('resolveOverride — base ⊕ patch (AGL-1019)', () => {
  it('overrides one leaf and leaves every sibling alone', () => {
    const resolved = resolveOverride(theme(), {
      palette: { primary: { main: '#ff0000' } },
    })
    expect(resolved).toEqual({
      ...theme(),
      palette: {
        primary: { main: '#ff0000', contrastText: '#fff' },
        secondary: { main: '#9c27b0' },
      },
    })
  })

  it('adds a path the base never had', () => {
    expect(resolveOverride({ a: 1 }, { b: { c: 2 } })).toEqual({
      a: 1,
      b: { c: 2 },
    })
  })

  it('never mutates the base — the same base resolves twice, differently', () => {
    const base = theme()
    const first = resolveOverride<any>(base, { palette: { primary: { main: '#a' } } })
    const second = resolveOverride<any>(base, { palette: { primary: { main: '#b' } } })
    expect(base.palette.primary.main).toBe('#1976d2')
    expect(first.palette.primary.main).toBe('#a')
    expect(second.palette.primary.main).toBe('#b')
  })

  it('returns the base untouched for an undefined patch', () => {
    const base = theme()
    expect(resolveOverride(base, undefined)).toBe(base)
  })
})

describe('deletion needs an explicit sentinel (AGL-1226 is why)', () => {
  it('removes the path the sentinel names', () => {
    expect(
      resolveOverride({ a: 1, b: 2 }, { b: OVERRIDE_DELETE }),
    ).toEqual({ a: 1 })
  })

  it('removes a nested path without disturbing its siblings', () => {
    const resolved = resolveOverride<any>(theme(), {
      palette: { primary: { contrastText: OVERRIDE_DELETE } },
    })
    expect(resolved.palette.primary).toEqual({ main: '#1976d2' })
    expect(resolved.palette.secondary).toEqual({ main: '#9c27b0' })
  })

  it('keeps null as a VALUE, not a removal — the besigner convention that took /product/* down', () => {
    const resolved = resolveOverride<any>({ a: 1, b: 2 }, { b: null })
    expect(resolved).toEqual({ a: 1, b: null })
    expect('b' in resolved).toBe(true)
  })

  it('keeps an empty string, a zero and a false as values', () => {
    expect(resolveOverride({ a: 'x', b: 1, c: true }, { a: '', b: 0, c: false })).toEqual(
      { a: '', b: 0, c: false },
    )
  })

  it('deleting a path the base never had is a no-op, not an undefined member', () => {
    const resolved = resolveOverride<any>({ a: 1 }, { missing: OVERRIDE_DELETE })
    expect(resolved).toEqual({ a: 1 })
    expect('missing' in resolved).toBe(false)
  })

  it('never leaks the sentinel into resolved output when the base is not an object', () => {
    expect(resolveOverride(null, { a: OVERRIDE_DELETE, b: 1 })).toEqual({ b: 1 })
  })
})

describe('arrays are never merged by index', () => {
  it('replaces an unkeyed array wholesale', () => {
    expect(
      resolveOverride<any>(theme(), { fontStack: ['Georgia', 'serif'] }).fontStack,
    ).toEqual(['Georgia', 'serif'])
  })

  it('does not merge element-wise — a shorter array truncates', () => {
    expect(resolveOverride({ a: [1, 2, 3] }, { a: [9] })).toEqual({ a: [9] })
  })

  it('detects the identity field, and refuses a duplicated or missing key', () => {
    expect(arrayKeyField([{ id: 'a' }, { id: 'b' }])).toBe('id')
    expect(arrayKeyField([{ slug: 'a' }, { slug: 'b' }])).toBe('slug')
    expect(arrayKeyField([{ id: 'a' }, { id: 'a' }])).toBeNull()
    expect(arrayKeyField([{ id: 'a' }, { label: 'b' }])).toBeNull()
    expect(arrayKeyField(['a', 'b'])).toBeNull()
    expect(arrayKeyField([])).toBeNull()
  })
})

describe('keyed arrays — a publisher insert must not collide with a user edit', () => {
  const links = () => [
    { id: 'home', label: 'Home', href: '/' },
    { id: 'docs', label: 'Docs', href: '/docs' },
  ]

  it('edits one element by key and passes the rest through', () => {
    const resolved = resolveOverride<any[]>(links(), {
      keyedBy: 'id',
      entries: { docs: { label: 'Documentation' } },
    })
    expect(resolved).toEqual([
      { id: 'home', label: 'Home', href: '/' },
      { id: 'docs', label: 'Documentation', href: '/docs' },
    ])
  })

  it('survives a publisher inserting an element BEFORE the one the user edited', () => {
    const patch = diffOverride(links(), [
      links()[0],
      { ...links()[1], label: 'Documentation' },
    ])
    // The publisher's v2 puts a new item first and renames nothing the user touched.
    const updatedBase = [
      { id: 'blog', label: 'Blog', href: '/blog' },
      ...links(),
    ]
    expect(resolveOverride(updatedBase, patch)).toEqual([
      { id: 'blog', label: 'Blog', href: '/blog' },
      { id: 'home', label: 'Home', href: '/' },
      { id: 'docs', label: 'Documentation', href: '/docs' },
    ])
  })

  it('removes an element by key', () => {
    expect(
      resolveOverride<any[]>(links(), {
        keyedBy: 'id',
        entries: { home: OVERRIDE_DELETE },
      }),
    ).toEqual([{ id: 'docs', label: 'Docs', href: '/docs' }])
  })

  it('appends an element the base does not hold', () => {
    expect(
      resolveOverride<any[]>(links(), {
        keyedBy: 'id',
        entries: { api: { id: 'api', label: 'API', href: '/api' } },
      }),
    ).toEqual([...links(), { id: 'api', label: 'API', href: '/api' }])
  })

  it('pins the order when one is stored, and tolerates a key that has since gone', () => {
    expect(
      resolveOverride<any[]>(links(), {
        keyedBy: 'id',
        entries: {},
        order: ['gone', 'docs', 'home'],
      }),
    ).toEqual([links()[1], links()[0]])
  })

  it('keeps an element the patch cannot address rather than dropping it', () => {
    const withStray = [...links(), { label: 'Unkeyed' }]
    expect(
      resolveOverride<any[]>(withStray, {
        keyedBy: 'id',
        entries: { home: { label: 'Start' } },
      }),
    ).toEqual([
      { id: 'home', label: 'Start', href: '/' },
      links()[1],
      { label: 'Unkeyed' },
    ])
  })

  it('resolves a keyed patch against a non-array base without throwing', () => {
    expect(
      resolveOverride(null, { keyedBy: 'id', entries: { a: { id: 'a' } } }),
    ).toEqual([{ id: 'a' }])
  })
})

describe('diffOverride — "what did I change" IS the patch', () => {
  it('is undefined when nothing changed, so an unedited artifact stores nothing', () => {
    expect(diffOverride(theme(), theme())).toBeUndefined()
  })

  it('is sparse — one changed leaf produces one path', () => {
    const edited = theme()
    edited.palette.primary.main = '#ff0000'
    expect(diffOverride(theme(), edited)).toEqual({
      palette: { primary: { main: '#ff0000' } },
    })
  })

  it('spells a removal with the sentinel', () => {
    expect(diffOverride({ a: 1, b: 2 }, { a: 1 })).toEqual({ b: OVERRIDE_DELETE })
  })

  it('emits a keyed patch for a keyed array, not the whole array', () => {
    const before = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    const after = [{ id: 'a', label: 'A!' }, { id: 'b', label: 'B' }]
    const patch = diffOverride(before, after)
    expect(isKeyedArrayPatch(patch)).toBe(true)
    expect(patch).toEqual({ keyedBy: 'id', entries: { a: { label: 'A!' } } })
  })

  it('stores no order for an append, so a publisher insert still lands', () => {
    const before = [{ id: 'a' }, { id: 'b' }]
    const after = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(diffOverride(before, after)).toEqual({
      keyedBy: 'id',
      entries: { c: { id: 'c' } },
    })
  })

  it('stores the order for a genuine reorder', () => {
    const before = [{ id: 'a' }, { id: 'b' }]
    const after = [{ id: 'b' }, { id: 'a' }]
    expect(diffOverride(before, after)).toEqual({
      keyedBy: 'id',
      entries: {},
      order: ['b', 'a'],
    })
  })

  it('falls back to a wholesale array when the elements are not keyed', () => {
    expect(diffOverride({ a: [1, 2] }, { a: [2, 1] })).toEqual({ a: [2, 1] })
  })
})

describe('the round trip is the whole contract', () => {
  const cases: Array<[string, unknown, unknown]> = [
    ['a leaf edit', theme(), { ...theme(), typography: { fontFamily: 'Georgia', h1: { fontSize: 48 } } }],
    ['a removal', { a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2 } }],
    ['an addition', { a: 1 }, { a: 1, b: { c: [1, 2] } }],
    ['a null written over an object', { a: { b: 1 } }, { a: null }],
    ['an object written over a null', { a: null }, { a: { b: 1 } }],
    ['an array replacing an object', { a: { b: 1 } }, { a: [1, 2] }],
    ['an object replacing an array', { a: [1, 2] }, { a: { b: 1 } }],
    ['a scalar type change', { a: 1 }, { a: 'one' }],
    ['emptying an object', { a: { b: 1 } }, { a: {} }],
    ['emptying an array', { a: [1, 2] }, { a: [] }],
    ['a keyed array value edit', [{ id: 'a', n: 1 }], [{ id: 'a', n: 2 }]],
    ['a keyed array removal', [{ id: 'a' }, { id: 'b' }], [{ id: 'a' }]],
    ['a keyed array append', [{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]],
    ['a keyed array prepend', [{ id: 'a' }], [{ id: 'b' }, { id: 'a' }]],
    ['a keyed array mid-list insert', [{ id: 'a' }, { id: 'c' }], [{ id: 'a' }, { id: 'b' }, { id: 'c' }]],
    ['a keyed array reorder', [{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }]],
    ['a keyed array emptied', [{ id: 'a' }], []],
    ['a keyed array losing its keys', [{ id: 'a' }], [{ label: 'a' }]],
    ['a besigner node tree', { rootId: 'r', nodes: { r: { id: 'r', type: 'Box', props: {}, childIds: ['a'] }, a: { id: 'a', type: 'Text', props: { text: 'Hi' }, childIds: [] } } }, { rootId: 'r', nodes: { r: { id: 'r', type: 'Box', props: {}, childIds: ['a', 'b'] }, a: { id: 'a', type: 'Text', props: { text: 'Hello' }, childIds: [] }, b: { id: 'b', type: 'Text', props: { text: 'New' }, childIds: [] } } }],
    ['a deeply nested removal', { a: { b: { c: { d: 1, e: 2 } } } }, { a: { b: { c: { e: 2 } } } }],
    ['replacing the whole artifact', { a: 1 }, { z: 9 }],
  ]

  it.each(cases)('round-trips %s', (_label, base, edited) => {
    const patch = diffOverride(base, edited)
    expect(resolveOverride(base, patch)).toEqual(edited)
  })

  it('round-trips through a JSON transit, as a stored patch must', () => {
    const base = theme()
    const edited = theme()
    edited.palette.secondary.main = '#00ff00'
    delete (edited.typography as any).h1
    const patch = JSON.parse(JSON.stringify(diffOverride(base, edited)))
    expect(resolveOverride(base, patch)).toEqual(edited)
  })
})

describe('the patch outlives an update — the point of the whole layer', () => {
  it('re-applies to a NEW base the user never saw', () => {
    const v1 = theme()
    const customised = theme()
    customised.palette.primary.main = '#ff0000'
    const patch = diffOverride(v1, customised)

    // v2: the publisher fixes dark-mode contrast and adds a field.
    const v2 = { ...theme(), palette: { ...theme().palette, primary: { main: '#1976d2', contrastText: '#101010' } }, mode: 'dark' }

    const resolved = resolveOverride<any>(v2, patch)
    expect(resolved.palette.primary.main).toBe('#ff0000') // the user's colour survived
    expect(resolved.palette.primary.contrastText).toBe('#101010') // their fix was taken
    expect(resolved.mode).toBe('dark') // and so was their new field
  })

  it('resets to the publisher’s version when the patch is dropped', () => {
    const v2 = { ...theme(), mode: 'dark' }
    expect(resolveOverride(v2, undefined)).toEqual(v2)
  })
})

describe('overrideConflicts — narrow by construction', () => {
  const base = theme()
  const customised = theme()
  customised.palette.primary.main = '#ff0000'
  const patch = diffOverride(base, customised)

  it('is empty when the publisher rewrote everything EXCEPT the overridden path', () => {
    const incoming = { ...theme(), typography: { fontFamily: 'Georgia', h1: { fontSize: 72 } }, fontStack: ['Georgia'] }
    expect(overrideConflicts(base, patch, incoming)).toEqual([])
  })

  it('names only the contested path when the publisher changed it too', () => {
    const incoming = theme()
    incoming.palette.primary.main = '#00ff00'
    incoming.typography.fontFamily = 'Georgia'
    expect(overrideConflicts(base, patch, incoming)).toEqual([
      'palette.primary.main',
    ])
  })

  it('is not a conflict when the publisher adopted the user’s value', () => {
    const incoming = theme()
    incoming.palette.primary.main = '#ff0000'
    expect(overrideConflicts(base, patch, incoming)).toEqual([])
  })

  it('reports a path the user deleted and the publisher changed', () => {
    const deleted = diffOverride({ a: 1, b: 2 }, { a: 1 })
    expect(overrideConflicts({ a: 1, b: 2 }, deleted, { a: 1, b: 3 })).toEqual(['b'])
    expect(overrideConflicts({ a: 1, b: 2 }, deleted, { a: 1, b: 2 })).toEqual([])
  })

  it('addresses a keyed array element by key, never by index', () => {
    const links = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    const edited = [{ id: 'a', label: 'A' }, { id: 'b', label: 'Bee' }]
    const linkPatch = diffOverride(links, edited)
    expect(overridePaths(linkPatch)).toEqual(['[b].label'])
    // The publisher inserts an element ahead of it and changes nothing else.
    const incoming = [{ id: 'z', label: 'Z' }, ...links]
    expect(overrideConflicts(links, linkPatch, incoming)).toEqual([])
  })
})

describe('overridePaths', () => {
  it('lists every changed leaf, dotted', () => {
    expect(
      overridePaths({
        palette: { primary: { main: '#f00' }, secondary: OVERRIDE_DELETE },
        mode: 'dark',
      }).sort(),
    ).toEqual(['mode', 'palette.primary.main', 'palette.secondary'])
  })

  it('says nothing for an empty patch', () => {
    expect(overridePaths(undefined)).toEqual([])
    expect(overridePaths({})).toEqual([])
  })
})

describe('isEmptyOverride', () => {
  it.each([
    [undefined, true],
    // `null` is a VALUE, not an absence — calling it empty would discard
    // "set this field to null" on every save (AGL-1226's shape).
    [null, false],
    [{}, true],
    [{ a: {} }, true],
    [{ keyedBy: 'id', entries: {} }, true],
    [{ a: OVERRIDE_DELETE }, false],
    [{ a: null }, false],
    [{ a: '' }, false],
    [{ a: 0 }, false],
    [{ keyedBy: 'id', entries: {}, order: ['a'] }, false],
  ])('%p → %p', (patch, expected) => {
    expect(isEmptyOverride(patch)).toBe(expected)
  })
})

describe('canOverrideArtifact — provenance-aware', () => {
  const provenance = (over: Partial<ResolvedProvenance>): ResolvedProvenance => ({
    state: 'recorded',
    listingId: 'listing-1',
    version: '2',
    sha256: 'abc',
    artifactType: 'component',
    publisherOrgId: 'org-1',
    updatable: true,
    ...over,
  })

  it('allows an artifact with a recorded base', () => {
    expect(canOverrideArtifact(provenance({}))).toEqual({ ok: true })
  })

  it('refuses an artifact with no base, and says why', () => {
    const result = canOverrideArtifact(provenance({ state: 'inferred', updatable: false }))
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/before update tracking/)
  })

  it('refuses something that never came from the marketplace', () => {
    const result = canOverrideArtifact(provenance({ state: 'unknown', updatable: false }))
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not installed from the marketplace/)
  })

  it('refuses a missing provenance rather than assuming one', () => {
    expect(canOverrideArtifact(null).ok).toBe(false)
    expect(canOverrideArtifact(undefined).ok).toBe(false)
  })
})

describe('storage — beside the base, never inside it', () => {
  it('writes null for an empty patch, which reads as "reset to the publisher’s"', () => {
    expect(overrideWriteValue(undefined, 'abc')).toBeNull()
    expect(overrideWriteValue({}, 'abc')).toBeNull()
  })

  it('refuses a scalar root — a stored top-level null would blank the artifact', () => {
    expect(overrideWriteValue(null, 'abc')).toBeNull()
    expect(overrideWriteValue('text', 'abc')).toBeNull()
    expect(overrideWriteValue([1, 2], 'abc')).toBeNull()
    expect(readArtifactOverride({ [ARTIFACT_OVERRIDE_FIELD]: { patch: null } })).toBeUndefined()
  })

  it('still keeps a NESTED null, which is a value the user chose', () => {
    const stored = overrideWriteValue({ palette: { primary: null } }, 'abc')
    expect(stored).not.toBeNull()
    expect(resolveOverride<any>(theme(), stored?.patch).palette.primary).toBeNull()
  })

  it('records the base it was authored against', () => {
    expect(overrideWriteValue({ a: 1 }, 'abc', { updatedBy: 'user-1' })).toEqual({
      patch: { a: 1 },
      baseSha256: 'abc',
      updatedBy: 'user-1',
    })
  })

  it('tolerates a null sha rather than inventing one', () => {
    expect(overrideWriteValue({ a: 1 }, null)).toEqual({
      patch: { a: 1 },
      baseSha256: null,
    })
  })

  it('reads a stored override back off a document', () => {
    expect(
      readArtifactOverride({
        [ARTIFACT_OVERRIDE_FIELD]: { patch: { a: 1 }, baseSha256: 'abc' },
      }),
    ).toEqual({ patch: { a: 1 }, baseSha256: 'abc' })
  })

  it('treats junk in a client-writable field as no override', () => {
    expect(readArtifactOverride(null)).toBeUndefined()
    expect(readArtifactOverride({})).toBeUndefined()
    expect(readArtifactOverride({ [ARTIFACT_OVERRIDE_FIELD]: 'nonsense' })).toBeUndefined()
    expect(readArtifactOverride({ [ARTIFACT_OVERRIDE_FIELD]: { patch: {} } })).toBeUndefined()
    expect(
      readArtifactOverride({ [ARTIFACT_OVERRIDE_FIELD]: { patch: { a: 1 }, baseSha256: 7 } }),
    ).toEqual({ patch: { a: 1 }, baseSha256: null })
  })

  it('resolves content through a document in one call', () => {
    const doc = {
      [ARTIFACT_OVERRIDE_FIELD]: overrideWriteValue(
        { palette: { primary: { main: '#f00' } } },
        'abc',
      ),
    }
    expect(resolveArtifactContent<any>(theme(), doc).palette.primary).toEqual({
      main: '#f00',
      contrastText: '#fff',
    })
  })

  it('returns the publisher’s content untouched when there is no override', () => {
    const content = theme()
    expect(resolveArtifactContent(content, {})).toBe(content)
    expect(resolveArtifactContent(content, null)).toBe(content)
  })

  it('the sentinel is a field VALUE, never a field name Firestore would reject', () => {
    expect(OVERRIDE_DELETE).not.toMatch(/^__.*__$/)
  })
})
