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
import {
  diffOverride,
  isEmptyOverride,
  overrideWriteValue,
  readArtifactOverride,
  resolveOverride,
} from './artifact-overrides'
import {
  resolveSiteTheme,
  themeArtifactContent,
  type ThemeHostDocument,
} from './site-theme'

/**
 * A site's theme library (AGL-3404): the themes a site can switch between,
 * and the rule that switching, editing and saving never destroy one.
 *
 * ## Three layers, one of them picked
 *
 * The site renders `theme ⊕ themeOverride` (`resolveSiteTheme`), exactly as
 * it did before there was a library. What the library adds is WHERE `theme`
 * came from, named by `themeSelection`:
 *
 * - `default` — the platform default. `theme` is empty.
 * - `preset` — a built-in theme a plugin contributes. `theme` is a copy.
 * - `custom` — one of the site's own saved themes, kept in the library.
 * - `installed` — a marketplace theme, kept in the library with the
 *   provenance an update needs.
 *
 * Every edit is an override patch over the picked theme and never a write to
 * it, so "Restore" is deleting the patch and the theme it restores to is
 * still exactly the one that was picked. "Save as custom theme" copies the
 * resolved result into a new library entry; the theme it started from stays
 * as it was.
 *
 * ## Switching keeps each theme's own edits
 *
 * Leaving a theme stashes its override on its library entry, and coming back
 * restores it — so trying another theme is not a way to lose work. A preset
 * or the default has no content to keep, so its entry holds only the stash.
 *
 * ## The site's own settings travel with the site
 *
 * `darkScheme` is a decision about the site's content, not about a design
 * (`THEME_ARTIFACT_FIELDS` says the same for publishing), so it survives every
 * switch, save and restore: whichever theme is picked, a site that switched
 * dark off stays light.
 *
 * Pure: the console route and the marketplace install route both plan here
 * and write the plan in their own transaction, so neither can file a switch
 * differently from the other.
 */

/** The host subcollection the library lives in. */
export const THEME_LIBRARY_COLLECTION = 'themes'

/**
 * The most custom themes one site keeps. A client can read the library, so an
 * unbounded one is an unbounded read on every visit to the theme page.
 */
export const THEME_LIBRARY_MAX_CUSTOM = 25

/** The longest name a saved theme takes. */
export const THEME_NAME_MAX = 60

export type ThemeLibraryKind = 'default' | 'preset' | 'custom' | 'installed'

const KINDS: readonly ThemeLibraryKind[] = [
  'default',
  'preset',
  'custom',
  'installed',
]

/** What `themeSelection` on a host names. */
export interface HostThemeSelection {
  kind: ThemeLibraryKind
  /** The library entry id (or the preset's entry id). */
  id: string
  /** Shown in the picker; a copy, so a renamed entry renames the selection too. */
  name: string
}

/** A document in `hosts/{hostId}/themes`. */
export interface ThemeLibraryEntry {
  kind: ThemeLibraryKind
  name: string
  /** The theme itself, for `custom` and `installed`. Never edited in place by the editor. */
  theme?: HostTheme | null
  /** The override stashed while this theme is not the picked one. */
  override?: unknown
  /** Marketplace provenance, for `installed` — what `themeInstalledFrom` is restored from. */
  installedFrom?: Record<string, unknown> | null
  createdAt?: unknown
  updatedAt?: unknown
}

/** The entry id the platform default's stash lives under. */
export const DEFAULT_THEME_ENTRY_ID = 'default'

/**
 * The entry id a pre-library site's own theme is filed under when it first
 * leaves it. Before the library a site had exactly one theme of its own, so
 * a fixed id cannot collide with another.
 */
export const SITE_THEME_ENTRY_ID = 'site-theme'

/**
 * The default's name, wherever the library names it.
 *
 * Not "Material UI": the platform default keeps MUI's palette but draws it in
 * the platform's own type and component defaults, and stock Material UI is a
 * built-in theme of its own (AGL-3422). A console shows the operator's brand
 * name in its place.
 */
export const DEFAULT_THEME_NAME = 'Platform default'

/** A preset's entry id, which holds only its stash. */
export function presetEntryId(presetId: string): string {
  return `preset--${presetId.replace(/[/]/g, '_')}`
}

/** A marketplace theme's entry id: one per listing, so reinstalling updates it. */
export function installedEntryId(listingId: string): string {
  return `installed--${listingId.replace(/[/]/g, '_')}`
}

/** A host document as the library reads it. */
export interface ThemeLibraryHost extends ThemeHostDocument {
  themeSelection?: unknown
  themeInstalledFrom?:
    | ({ sha256?: string | null; listingId?: string; name?: string } & Record<
        string,
        unknown
      >)
    | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasContent(theme: HostTheme | null | undefined): theme is HostTheme {
  return Boolean(theme && Object.keys(theme).length)
}

/**
 * The theme a site has picked.
 *
 * A site from before the library has no `themeSelection`, and reads as what
 * it was: a marketplace theme, its own theme, or the default. That is what
 * lets the library ship without touching a single existing host document.
 */
export function readThemeSelection(
  host: ThemeLibraryHost | null | undefined,
): HostThemeSelection {
  const stored = host?.themeSelection
  if (
    isRecord(stored) &&
    KINDS.includes(stored['kind'] as ThemeLibraryKind) &&
    typeof stored['id'] === 'string' &&
    stored['id']
  ) {
    return {
      kind: stored['kind'] as ThemeLibraryKind,
      id: stored['id'],
      // The default is always named by the constant: a selection stored
      // before AGL-3422 calls it "Material UI", which is now another theme.
      name:
        stored['kind'] === 'default'
          ? DEFAULT_THEME_NAME
          : typeof stored['name'] === 'string' && stored['name']
            ? stored['name']
            : 'Theme',
    }
  }
  const listingId = host?.themeInstalledFrom?.listingId
  if (listingId) {
    const name = host?.themeInstalledFrom?.name
    return {
      kind: 'installed',
      id: installedEntryId(listingId),
      name: typeof name === 'string' && name ? name : 'Marketplace theme',
    }
  }
  if (hasContent(host?.theme)) {
    return { kind: 'custom', id: SITE_THEME_ENTRY_ID, name: 'Site theme' }
  }
  return {
    kind: 'default',
    id: DEFAULT_THEME_ENTRY_ID,
    name: DEFAULT_THEME_NAME,
  }
}

/** A name as stored: trimmed, bounded, and never empty. */
export function normalizeThemeName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const trimmed = name.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return trimmed.slice(0, THEME_NAME_MAX)
}

/** Marks a field for deletion; the route writing the plan maps it to its store's delete. */
export const THEME_FIELD_DELETE = '__aglynThemeFieldDelete'

export type ThemeLibraryEntryWrite =
  | { id: string; op: 'create'; data: ThemeLibraryEntry }
  | { id: string; op: 'update'; data: Record<string, unknown> }
  | { id: string; op: 'delete' }

export type ThemeLibraryPlan =
  | {
      ok: true
      /**
       * Host fields to replace WHOLESALE (`update`, never a deep merge: a
       * merged override is the union of two patches, and a merged theme keeps
       * the tokens of the one it replaced).
       */
      host: Record<string, unknown>
      entries: ThemeLibraryEntryWrite[]
      /** The theme picked once the plan is written. */
      selection: HostThemeSelection
    }
  | { ok: false; status: number; error: string }

export type ThemeLibraryTarget =
  | { kind: 'default' }
  /** A plugin's theme, sent by the console that listed it. */
  | { kind: 'preset'; id: string; name: string; theme: HostTheme }
  | { kind: 'custom' | 'installed'; id: string }

export type ThemeLibraryAction =
  | { action: 'select'; target: ThemeLibraryTarget }
  | { action: 'save-as'; name: string }
  | { action: 'update' }
  | { action: 'restore' }
  | { action: 'rename'; id: string; name: string }
  | { action: 'delete'; id: string }
  | {
      action: 'install'
      listingId: string
      name: string
      theme: HostTheme
      installedFrom: Record<string, unknown>
    }

/**
 * The override to store for a theme showing `edited` over `base`, or the
 * delete marker when they are the same.
 */
function overrideValue(
  base: HostTheme,
  edited: HostTheme,
  baseSha256: string | null,
): unknown {
  const patch = diffOverride(base, edited)
  const value = overrideWriteValue(patch, baseSha256)
  return value && !isEmptyOverride(value.patch) ? value : THEME_FIELD_DELETE
}

/** The site's own setting carried onto another theme. */
function withSiteSettings(theme: HostTheme, from: HostTheme | undefined): HostTheme {
  const next = { ...theme }
  if (from?.darkScheme === 'off') next.darkScheme = 'off'
  else delete next.darkScheme
  return next
}

/** A stash as it resolves over the theme it belongs to. */
function resolveStash(base: HostTheme, stash: unknown): HostTheme {
  const read = readArtifactOverride({ overrides: stash })
  return read ? resolveOverride<HostTheme>(base, read.patch) : base
}

function sha(installedFrom: unknown): string | null {
  return isRecord(installedFrom) && typeof installedFrom['sha256'] === 'string'
    ? installedFrom['sha256']
    : null
}

/**
 * Files the theme being left: its override goes onto its entry, and a theme
 * that exists nowhere but on the host (a pre-library site's own theme, or a
 * marketplace install from before the library) gets an entry of its own
 * first, so it is still in the list to come back to.
 *
 * `override` is what to stash — the live one when switching, none when the
 * edits have just moved into a new theme.
 */
function fileCurrent(
  host: ThemeLibraryHost,
  current: HostThemeSelection,
  entries: Readonly<Record<string, ThemeLibraryEntry>>,
  override: unknown,
): ThemeLibraryEntryWrite[] {
  const stash = override === undefined ? THEME_FIELD_DELETE : override
  if (entries[current.id]) {
    return [{ id: current.id, op: 'update', data: { override: stash } }]
  }
  // The default and a preset have no content to keep, so with nothing to
  // stash there is nothing to file.
  if (
    stash === THEME_FIELD_DELETE &&
    (current.kind === 'default' || current.kind === 'preset')
  ) {
    return []
  }
  const entry: ThemeLibraryEntry = { kind: current.kind, name: current.name }
  if (current.kind === 'custom' || current.kind === 'installed') {
    entry.theme = themeArtifactContent(host.theme)
  }
  if (current.kind === 'installed' && host.themeInstalledFrom) {
    entry.installedFrom = host.themeInstalledFrom
  }
  if (stash !== THEME_FIELD_DELETE) entry.override = stash
  return [{ id: current.id, op: 'create', data: entry }]
}

/** Host fields that point the site at `selection` over `base`. */
function pointAt(
  selection: HostThemeSelection,
  base: HostTheme,
  override: unknown,
  installedFrom: unknown,
): Record<string, unknown> {
  return {
    theme: hasContent(base) ? base : THEME_FIELD_DELETE,
    themeOverride: override,
    themeSelection: selection,
    themeInstalledFrom:
      selection.kind === 'installed' && installedFrom
        ? installedFrom
        : THEME_FIELD_DELETE,
    // The library is the way back now: every theme a site has left is in it,
    // edits included. A `themeReplaced` left behind would offer a second,
    // older "previous theme" that restores around the library.
    themeReplaced: THEME_FIELD_DELETE,
  }
}

/**
 * Plans one library action against the host document and its library as
 * read in the same transaction.
 *
 * `newId` mints a library entry id for a new custom theme.
 */
export function planThemeLibraryAction(input: {
  host: ThemeLibraryHost | null | undefined
  entries: Readonly<Record<string, ThemeLibraryEntry>>
  action: ThemeLibraryAction
  newId: () => string
}): ThemeLibraryPlan {
  const host: ThemeLibraryHost = input.host ?? {}
  const { entries, action } = input
  const current = readThemeSelection(host)
  const resolved = resolveSiteTheme(host) ?? {}

  switch (action.action) {
    case 'select':
      return planSelect(host, current, resolved, entries, action.target)

    case 'install': {
      const id = installedEntryId(action.listingId)
      const name = normalizeThemeName(action.name) ?? 'Marketplace theme'
      const theme = themeArtifactContent(action.theme)
      const selection: HostThemeSelection = { kind: 'installed', id, name }
      if (current.kind === 'installed' && current.id === id) {
        // An update of the theme already picked. The override stays exactly
        // as stored — including the hash it was written against, which is
        // how the editor knows to say an override predates this version.
        return {
          ok: true,
          host: {
            theme,
            themeInstalledFrom: action.installedFrom,
            themeSelection: selection,
          },
          entries: [
            entries[id]
              ? {
                  id,
                  op: 'update',
                  data: { theme, installedFrom: action.installedFrom, name },
                }
              : {
                  id,
                  op: 'create',
                  data: {
                    kind: 'installed',
                    name,
                    theme,
                    installedFrom: action.installedFrom,
                  },
                },
          ],
          selection,
        }
      }
      const stash = entries[id]?.override
      const edited = withSiteSettings(resolveStash(theme, stash), resolved)
      return {
        ok: true,
        host: pointAt(
          selection,
          theme,
          overrideValue(theme, edited, sha(action.installedFrom)),
          action.installedFrom,
        ),
        entries: [
          ...fileCurrent(host, current, entries, host.themeOverride),
          entries[id]
            ? {
                id,
                op: 'update',
                data: {
                  theme,
                  installedFrom: action.installedFrom,
                  name,
                  override: THEME_FIELD_DELETE,
                },
              }
            : {
                id,
                op: 'create',
                data: {
                  kind: 'installed',
                  name,
                  theme,
                  installedFrom: action.installedFrom,
                },
              },
        ],
        selection,
      }
    }

    case 'save-as': {
      const name = normalizeThemeName(action.name)
      if (!name) {
        return { ok: false, status: 400, error: 'Give the theme a name.' }
      }
      const customCount = Object.values(entries).filter(
        (entry) => entry.kind === 'custom',
      ).length
      if (customCount >= THEME_LIBRARY_MAX_CUSTOM) {
        return {
          ok: false,
          status: 409,
          error:
            `A site keeps up to ${THEME_LIBRARY_MAX_CUSTOM} custom themes. ` +
            'Delete one you no longer use first.',
        }
      }
      const id = input.newId()
      const theme = themeArtifactContent(resolved)
      const selection: HostThemeSelection = { kind: 'custom', id, name }
      return {
        ok: true,
        host: pointAt(
          selection,
          theme,
          overrideValue(theme, withSiteSettings(theme, resolved), null),
          null,
        ),
        entries: [
          // The theme this started from stays as it was picked: the edits
          // now live in the new theme, not on top of the old one.
          ...fileCurrent(host, current, entries, undefined),
          { id, op: 'create', data: { kind: 'custom', name, theme } },
        ],
        selection,
      }
    }

    case 'update': {
      if (current.kind !== 'custom') {
        return {
          ok: false,
          status: 409,
          error:
            'Only your own themes can be updated. Save your changes as a ' +
            'custom theme instead.',
        }
      }
      const theme = themeArtifactContent(resolved)
      const override = overrideValue(
        theme,
        withSiteSettings(theme, resolved),
        null,
      )
      return {
        ok: true,
        host: {
          theme: hasContent(theme) ? theme : THEME_FIELD_DELETE,
          themeOverride: override,
          themeSelection: current,
        },
        entries: [
          entries[current.id]
            ? { id: current.id, op: 'update', data: { theme } }
            : {
                id: current.id,
                op: 'create',
                data: { kind: 'custom', name: current.name, theme },
              },
        ],
        selection: current,
      }
    }

    case 'restore': {
      const base = host.theme ?? {}
      return {
        ok: true,
        host: {
          themeOverride: overrideValue(
            base,
            withSiteSettings(base, resolved),
            current.kind === 'installed' ? sha(host.themeInstalledFrom) : null,
          ),
        },
        entries: [],
        selection: current,
      }
    }

    case 'rename': {
      const name = normalizeThemeName(action.name)
      if (!name) {
        return { ok: false, status: 400, error: 'Give the theme a name.' }
      }
      const isLegacySiteTheme =
        action.id === SITE_THEME_ENTRY_ID &&
        current.id === SITE_THEME_ENTRY_ID &&
        !entries[SITE_THEME_ENTRY_ID]
      const entry = entries[action.id]
      if (!isLegacySiteTheme && entry?.kind !== 'custom') {
        return { ok: false, status: 404, error: 'Only your own themes can be renamed.' }
      }
      const renamedSelection =
        current.id === action.id ? { ...current, name } : null
      return {
        ok: true,
        host: renamedSelection ? { themeSelection: renamedSelection } : {},
        entries: isLegacySiteTheme
          ? [
              {
                id: action.id,
                op: 'create',
                data: {
                  kind: 'custom',
                  name,
                  theme: themeArtifactContent(host.theme),
                },
              },
            ]
          : [{ id: action.id, op: 'update', data: { name } }],
        selection: renamedSelection ?? current,
      }
    }

    case 'delete': {
      const entry = entries[action.id]
      if (!entry || (entry.kind !== 'custom' && entry.kind !== 'installed')) {
        return { ok: false, status: 404, error: 'There is no such theme to delete.' }
      }
      if (current.id === action.id) {
        return {
          ok: false,
          status: 409,
          error: 'This theme is in use. Pick another theme first, then delete it.',
        }
      }
      return {
        ok: true,
        host: {},
        entries: [{ id: action.id, op: 'delete' }],
        selection: current,
      }
    }
  }
}

function planSelect(
  host: ThemeLibraryHost,
  current: HostThemeSelection,
  resolved: HostTheme,
  entries: Readonly<Record<string, ThemeLibraryEntry>>,
  target: ThemeLibraryTarget,
): ThemeLibraryPlan {
  let selection: HostThemeSelection
  let base: HostTheme
  let installedFrom: unknown = null
  if (target.kind === 'default') {
    selection = {
      kind: 'default',
      id: DEFAULT_THEME_ENTRY_ID,
      name: DEFAULT_THEME_NAME,
    }
    base = {}
  } else if (target.kind === 'preset') {
    const name = normalizeThemeName(target.name)
    if (!target.id || !name || !isRecord(target.theme)) {
      return { ok: false, status: 400, error: 'That theme could not be read.' }
    }
    selection = { kind: 'preset', id: presetEntryId(target.id), name }
    base = themeArtifactContent(target.theme)
  } else {
    const entry = entries[target.id]
    if (!entry || entry.kind !== target.kind) {
      return { ok: false, status: 404, error: 'That theme is not in this site’s library.' }
    }
    selection = { kind: entry.kind, id: target.id, name: entry.name }
    base = themeArtifactContent(entry.theme ?? {})
    installedFrom = entry.installedFrom ?? null
  }
  if (selection.id === current.id && selection.kind === current.kind) {
    return { ok: true, host: {}, entries: [], selection: current }
  }

  const stash = entries[selection.id]?.override
  const edited = withSiteSettings(resolveStash(base, stash), resolved)
  const writes: ThemeLibraryEntryWrite[] = fileCurrent(
    host,
    current,
    entries,
    host.themeOverride,
  )
  // Its stash is live again, so the entry stops holding a second copy.
  if (entries[selection.id]?.override !== undefined) {
    writes.push({
      id: selection.id,
      op: 'update',
      data: { override: THEME_FIELD_DELETE },
    })
  }
  return {
    ok: true,
    host: pointAt(
      selection,
      base,
      overrideValue(
        base,
        edited,
        selection.kind === 'installed' ? sha(installedFrom) : null,
      ),
      installedFrom,
    ),
    entries: writes,
    selection,
  }
}

/**
 * Whether the picked theme carries edits of this site's own — what "Restore"
 * and "Update" act on. The site's dark-scheme setting is not an edit to the
 * theme, so an override holding only that does not count.
 */
export function hasThemeEdits(host: ThemeLibraryHost | null | undefined): boolean {
  const read = readArtifactOverride({ overrides: host?.themeOverride })
  if (!read || isEmptyOverride(read.patch)) return false
  if (!isRecord(read.patch)) return true
  return Object.keys(read.patch).some((key) => key !== 'darkScheme')
}
