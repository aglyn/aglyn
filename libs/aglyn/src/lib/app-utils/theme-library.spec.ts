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

import type { HostTheme } from '@aglyn/shared-data-types'
import { diffOverride, overrideWriteValue } from './artifact-overrides'
import { resolveSiteTheme } from './site-theme'
import {
  hasThemeEdits,
  planThemeLibraryAction,
  readThemeSelection,
  THEME_FIELD_DELETE,
  THEME_LIBRARY_MAX_CUSTOM,
  type ThemeLibraryAction,
  type ThemeLibraryEntry,
  type ThemeLibraryEntryWrite,
  type ThemeLibraryHost,
} from './theme-library'

const bootstrap: HostTheme = {
  shape: { borderRadius: 6 },
  colorSchemes: { light: { primary: { main: '#0d6efd' } } },
}
const minimal: HostTheme = {
  shape: { borderRadius: 8 },
  colorSchemes: { light: { primary: { main: '#18181b' } } },
}

/** An override that sets `path` to `value` on top of `base`. */
function edit(base: HostTheme, patch: HostTheme, sha: string | null = null) {
  return overrideWriteValue(
    diffOverride(base, { ...base, ...patch }),
    sha,
  )
}

let ids = 0
const newId = () => `new-${++ids}`

function plan(
  host: ThemeLibraryHost,
  action: ThemeLibraryAction,
  entries: Record<string, ThemeLibraryEntry> = {},
) {
  const result = planThemeLibraryAction({ host, entries, action, newId })
  if (result.ok === false) throw new Error(result.error)
  return result
}

/** The host document after the plan's host writes. */
function apply(host: ThemeLibraryHost, fields: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...host }
  for (const [key, value] of Object.entries(fields)) {
    if (value === THEME_FIELD_DELETE) delete next[key]
    else next[key] = value
  }
  return next as ThemeLibraryHost
}

/** The library after the plan's entry writes. */
function applyEntries(
  entries: Record<string, ThemeLibraryEntry>,
  writes: ThemeLibraryEntryWrite[],
) {
  const next = { ...entries }
  for (const write of writes) {
    if (write.op === 'delete') {
      delete next[write.id]
      continue
    }
    const merged: Record<string, unknown> =
      write.op === 'create' ? {} : { ...next[write.id] }
    for (const [key, value] of Object.entries(write.data)) {
      if (value === THEME_FIELD_DELETE) delete merged[key]
      else merged[key] = value
    }
    next[write.id] = merged as unknown as ThemeLibraryEntry
  }
  return next
}

const preset = (id: string, theme: HostTheme, name = id) => ({
  action: 'select' as const,
  target: { kind: 'preset' as const, id, name, theme },
})

describe('readThemeSelection (AGL-3404)', () => {
  it('reads a pre-library site as what it already was', () => {
    expect(readThemeSelection({})).toEqual({
      kind: 'default',
      id: 'default',
      name: 'Platform default',
    })
    expect(readThemeSelection({ theme: bootstrap })).toEqual({
      kind: 'custom',
      id: 'site-theme',
      name: 'Site theme',
    })
    expect(
      readThemeSelection({
        theme: bootstrap,
        themeInstalledFrom: { listingId: 'L1', sha256: 'abc' },
      }),
    ).toMatchObject({ kind: 'installed', id: 'installed--L1' })
  })

  it('names the default by the constant, not by a name stored before AGL-3422', () => {
    expect(
      readThemeSelection({
        themeSelection: { kind: 'default', id: 'default', name: 'Material UI' },
      }).name,
    ).toBe('Platform default')
  })

  it('prefers the stored selection and ignores junk', () => {
    expect(
      readThemeSelection({
        themeSelection: { kind: 'preset', id: 'preset--x', name: 'X' },
      }),
    ).toEqual({ kind: 'preset', id: 'preset--x', name: 'X' })
    expect(readThemeSelection({ themeSelection: { kind: 'evil', id: 'a' } }).kind).toBe(
      'default',
    )
  })
})

describe('picking a theme never loses one (AGL-3404)', () => {
  it('points a default site at a preset without filing an empty default', () => {
    const result = plan({}, preset('bootstrap', bootstrap, 'Bootstrap'))
    expect(result.host).toEqual({
      theme: bootstrap,
      themeOverride: THEME_FIELD_DELETE,
      themeSelection: { kind: 'preset', id: 'preset--bootstrap', name: 'Bootstrap' },
      themeInstalledFrom: THEME_FIELD_DELETE,
      themeReplaced: THEME_FIELD_DELETE,
    })
    expect(result.entries).toEqual([])
  })

  it('keeps a preset’s edits on its entry while away, and brings them back', () => {
    const edited = edit(bootstrap, { spacing: 10 })
    let host: ThemeLibraryHost = {
      theme: bootstrap,
      themeOverride: edited,
      themeSelection: { kind: 'preset', id: 'preset--bootstrap', name: 'Bootstrap' },
    }
    let entries: Record<string, ThemeLibraryEntry> = {}

    const away = plan(host, preset('minimal', minimal), entries)
    host = apply(host, away.host)
    entries = applyEntries(entries, away.entries)
    expect(resolveSiteTheme(host)).toEqual(minimal)
    expect(entries['preset--bootstrap']).toEqual({
      kind: 'preset',
      name: 'Bootstrap',
      override: edited,
    })

    const back = plan(host, preset('bootstrap', bootstrap, 'Bootstrap'), entries)
    host = apply(host, back.host)
    entries = applyEntries(entries, back.entries)
    expect(resolveSiteTheme(host)).toEqual({ ...bootstrap, spacing: 10 })
    // The stash is live again, so the entry no longer holds a copy.
    expect(entries['preset--bootstrap'].override).toBeUndefined()
  })

  it('files a pre-library site theme, edits and all, the first time it is left', () => {
    const host: ThemeLibraryHost = { theme: minimal }
    const result = plan(host, { action: 'select', target: { kind: 'default' } })
    expect(result.entries).toEqual([
      {
        id: 'site-theme',
        op: 'create',
        data: { kind: 'custom', name: 'Site theme', theme: minimal },
      },
    ])
    expect(result.host['theme']).toBe(THEME_FIELD_DELETE)
  })

  it('carries the site’s dark-scheme setting onto the theme it switches to', () => {
    const host: ThemeLibraryHost = {
      theme: bootstrap,
      themeOverride: edit(bootstrap, { darkScheme: 'off' }),
      themeSelection: { kind: 'preset', id: 'preset--bootstrap', name: 'Bootstrap' },
    }
    const result = plan(host, preset('minimal', minimal))
    const next = apply(host, result.host)
    expect(resolveSiteTheme(next)).toEqual({ ...minimal, darkScheme: 'off' })
    // …and a dark-scheme-only override is not an edit to the theme.
    expect(hasThemeEdits(next)).toBe(false)
  })

  it('refuses a library theme the site does not have', () => {
    const result = planThemeLibraryAction({
      host: {},
      entries: {},
      action: { action: 'select', target: { kind: 'custom', id: 'nope' } },
      newId,
    })
    expect(result).toMatchObject({ ok: false, status: 404 })
  })

  it('restores an installed theme’s override with the hash it was written against', () => {
    const stash = edit(bootstrap, { spacing: 4 }, 'sha-1')
    const entries: Record<string, ThemeLibraryEntry> = {
      'installed--L1': {
        kind: 'installed',
        name: 'Nice',
        theme: bootstrap,
        installedFrom: { listingId: 'L1', sha256: 'sha-1' },
        override: stash,
      },
    }
    const result = plan(
      {},
      { action: 'select', target: { kind: 'installed', id: 'installed--L1' } },
      entries,
    )
    expect(result.host['themeInstalledFrom']).toEqual({ listingId: 'L1', sha256: 'sha-1' })
    expect((result.host['themeOverride'] as { baseSha256: string }).baseSha256).toBe('sha-1')
  })
})

describe('save as, update and restore leave the original theme alone (AGL-3404)', () => {
  const editedPreset: ThemeLibraryHost = {
    theme: bootstrap,
    themeOverride: edit(bootstrap, { spacing: 10, darkScheme: 'off' }),
    themeSelection: { kind: 'preset', id: 'preset--bootstrap', name: 'Bootstrap' },
  }

  it('saves the resolved theme as a new custom theme and picks it', () => {
    const entries: Record<string, ThemeLibraryEntry> = {
      'preset--bootstrap': { kind: 'preset', name: 'Bootstrap' },
    }
    const result = plan(editedPreset, { action: 'save-as', name: '  Brand  ' }, entries)
    const created = result.entries.find((write) => write.op === 'create')
    expect(created).toEqual({
      id: result.selection.id,
      op: 'create',
      data: { kind: 'custom', name: 'Brand', theme: { ...bootstrap, spacing: 10 } },
    })
    // The preset's stash is cleared: the edits moved into the new theme.
    expect(result.entries).toContainEqual({
      id: 'preset--bootstrap',
      op: 'update',
      data: { override: THEME_FIELD_DELETE },
    })
    const next = apply(editedPreset, result.host)
    expect(resolveSiteTheme(next)).toEqual({
      ...bootstrap,
      spacing: 10,
      darkScheme: 'off',
    })
    expect(hasThemeEdits(next)).toBe(false)
  })

  it('refuses a nameless theme and a full library', () => {
    expect(
      planThemeLibraryAction({
        host: editedPreset,
        entries: {},
        action: { action: 'save-as', name: '   ' },
        newId,
      }),
    ).toMatchObject({ ok: false, status: 400 })
    const full = Object.fromEntries(
      Array.from({ length: THEME_LIBRARY_MAX_CUSTOM }, (_, index) => [
        `c${index}`,
        { kind: 'custom', name: `c${index}` } as ThemeLibraryEntry,
      ]),
    )
    expect(
      planThemeLibraryAction({
        host: editedPreset,
        entries: full,
        action: { action: 'save-as', name: 'One more' },
        newId,
      }),
    ).toMatchObject({ ok: false, status: 409 })
  })

  it('restores the picked theme and keeps the dark-scheme setting', () => {
    const result = plan(editedPreset, { action: 'restore' })
    const next = apply(editedPreset, result.host)
    expect(resolveSiteTheme(next)).toEqual({ ...bootstrap, darkScheme: 'off' })
    expect(next.theme).toEqual(bootstrap)
  })

  it('updates only a custom theme', () => {
    expect(
      planThemeLibraryAction({
        host: editedPreset,
        entries: {},
        action: { action: 'update' },
        newId,
      }),
    ).toMatchObject({ ok: false, status: 409 })

    const host: ThemeLibraryHost = {
      theme: minimal,
      themeOverride: edit(minimal, { spacing: 6 }),
      themeSelection: { kind: 'custom', id: 'c1', name: 'Mine' },
    }
    const result = plan(host, { action: 'update' }, {
      c1: { kind: 'custom', name: 'Mine', theme: minimal },
    })
    expect(result.entries).toEqual([
      { id: 'c1', op: 'update', data: { theme: { ...minimal, spacing: 6 } } },
    ])
    expect(result.host['themeOverride']).toBe(THEME_FIELD_DELETE)
  })
})

describe('rename and delete (AGL-3404)', () => {
  const entries: Record<string, ThemeLibraryEntry> = {
    c1: { kind: 'custom', name: 'Mine', theme: minimal },
    'preset--bootstrap': { kind: 'preset', name: 'Bootstrap' },
  }
  const host: ThemeLibraryHost = {
    theme: minimal,
    themeSelection: { kind: 'custom', id: 'c1', name: 'Mine' },
  }

  it('renames a custom theme and the selection naming it', () => {
    const result = plan(host, { action: 'rename', id: 'c1', name: 'Ours' }, entries)
    expect(result.entries).toEqual([{ id: 'c1', op: 'update', data: { name: 'Ours' } }])
    expect(result.host['themeSelection']).toEqual({ kind: 'custom', id: 'c1', name: 'Ours' })
  })

  it('refuses to rename a preset, or to delete the theme in use', () => {
    expect(
      planThemeLibraryAction({
        host,
        entries,
        action: { action: 'rename', id: 'preset--bootstrap', name: 'X' },
        newId,
      }),
    ).toMatchObject({ ok: false, status: 404 })
    expect(
      planThemeLibraryAction({ host, entries, action: { action: 'delete', id: 'c1' }, newId }),
    ).toMatchObject({ ok: false, status: 409 })
  })

  it('deletes a custom theme that is not in use', () => {
    const result = plan({}, { action: 'delete', id: 'c1' }, entries)
    expect(result.entries).toEqual([{ id: 'c1', op: 'delete' }])
  })
})

describe('a marketplace install joins the library (AGL-3404)', () => {
  const installedFrom = { listingId: 'L1', sha256: 'sha-2', version: '2.0.0' }

  it('keeps the override, hash and all, when the installed theme is updated', () => {
    const stored = edit(bootstrap, { spacing: 3 }, 'sha-1')
    const host: ThemeLibraryHost = {
      theme: bootstrap,
      themeOverride: stored,
      themeInstalledFrom: { listingId: 'L1', sha256: 'sha-1' },
    }
    const result = plan(host, {
      action: 'install',
      listingId: 'L1',
      name: 'Nice',
      theme: minimal,
      installedFrom,
    })
    expect(result.host).toEqual({
      theme: minimal,
      themeInstalledFrom: installedFrom,
      themeSelection: { kind: 'installed', id: 'installed--L1', name: 'Nice' },
    })
    expect(result.entries).toEqual([
      {
        id: 'installed--L1',
        op: 'create',
        data: { kind: 'installed', name: 'Nice', theme: minimal, installedFrom },
      },
    ])
  })

  it('files the theme it replaces, so it stays in the list', () => {
    const host: ThemeLibraryHost = {
      theme: bootstrap,
      themeOverride: edit(bootstrap, { spacing: 12 }),
      themeSelection: { kind: 'preset', id: 'preset--bootstrap', name: 'Bootstrap' },
    }
    const result = plan(host, {
      action: 'install',
      listingId: 'L1',
      name: 'Nice',
      theme: minimal,
      installedFrom,
    })
    expect(result.entries[0]).toMatchObject({
      id: 'preset--bootstrap',
      op: 'create',
      data: { kind: 'preset', name: 'Bootstrap' },
    })
    expect(result.host['theme']).toEqual(minimal)
    expect(result.host['themeOverride']).toBe(THEME_FIELD_DELETE)
  })
})
