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
 * THE ONE BOX: SWITCHING AND SEARCH IN ONE PLACE (AGL-3943, Zach 2026-10-18).
 *
 * ⌘K in the native apps opens one box that finds workspaces, sites, pages,
 * orders, contacts, emails, components, layouts, templates and every plugin's
 * records together, plus the app's own screens and settings ("billing" finds
 * Plan). The apps ask `GET /api/search` (`ONE_BOX_SEARCH_PATH`) with the
 * person's ID token and get grouped rows back; this module is that payload,
 * the paging rules, and the screens-and-settings group, which comes from the
 * nav manifest and so needs no read at all.
 *
 * Request query: `q` (at least two characters), `orgId` and `hostId` (the
 * scope the person stands in; both optional), `limit` (rows per group,
 * default 5, at most 25), and `group` + `cursor` to page one group further
 * ("Show more"). Who may see what is decided by the route, never by these.
 *
 * Imports only the plain modules beside it, so the native apps read the
 * types and the screens-and-settings answers through the generated contracts.
 */

import { compareScored, isSearchableQuery, scoreMatch } from './name-match'
import { resolveNavList, type NativeNavListId } from './native-nav'

/** The console route the apps call. */
export const ONE_BOX_SEARCH_PATH = '/api/search'

/** Rows per group when the request names no `limit`. */
export const ONE_BOX_ROWS_DEFAULT = 5

/** The most rows one group answers in one response. */
export const ONE_BOX_ROWS_MAX = 25

/** The longest query the route reads; the rest is dropped. */
export const ONE_BOX_QUERY_MAX = 100

/** The group of workspaces the person belongs to: the switcher's half. */
export const ONE_BOX_WORKSPACES_GROUP = 'workspaces'

/** The group of the app's own screens and settings, from the nav manifest. */
export const ONE_BOX_SCREENS_GROUP = 'appScreens'

/** One result. */
export interface OneBoxRow {
  /** The group it came from (`workspaces`, `sites`, `screens`, `orders`, `contacts`, …). */
  group: string
  /** The workspace id, site id, nav row id or record id. */
  id: string
  label: string
  /** One line under it: a slug, a buyer, the list a setting is in. */
  detail?: string
  /** The workspace it belongs to; a workspace row's own id. */
  orgId?: string
  /** The site it belongs to; a site row's own id. */
  hostId?: string
  /**
   * The console path it opens at. The apps resolve it through their deep-link
   * grammar, as they resolve a notification's link, so a record opens on its
   * native screen and a Besigner page in the in-app Besigner.
   */
  link?: string
  /** For a screens-and-settings row: the native screen and its params. */
  screen?: string
  params?: Record<string, string>
}

/** One kind of result. */
export interface OneBoxGroup {
  group: string
  /** The heading above its rows. */
  heading: string
  /** The kind in a sentence ("pages"). */
  noun: string
  rows: OneBoxRow[]
  /** How many matched in what was searched, of which `rows` is a page. */
  matched: number
  /** How many records were matched against. */
  searched: number
  /** The group filled its window, so it may hold matches that were not read. */
  truncated: boolean
  /** The group could not be read. Never the same as matching nothing. */
  failed: boolean
  /** Pass back as `cursor` with `group` for the next page, absent at the end. */
  nextCursor?: number
}

export interface OneBoxResponse {
  /** The query as it was read. */
  query: string
  orgId?: string
  hostId?: string
  /** Groups in the order they are shown. */
  groups: OneBoxGroup[]
}

/** How many rows a request asked for, within bounds. */
export function oneBoxLimit(raw: unknown): number {
  const asked = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  if (!Number.isFinite(asked) || asked < 1) return ONE_BOX_ROWS_DEFAULT
  return Math.min(ONE_BOX_ROWS_MAX, Math.floor(asked))
}

/** Where a page starts, within bounds. */
export function oneBoxCursor(raw: unknown): number {
  const asked = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
  return Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : 0
}

/** The query as the route reads it: trimmed, capped, or null when too short to run. */
export function oneBoxQuery(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim().slice(0, ONE_BOX_QUERY_MAX) : ''
  return isSearchableQuery(text) ? text : null
}

/** A matched row before paging, with its score. */
export interface OneBoxScored {
  row: OneBoxRow
  score: number
}

/**
 * One group's page: every match ranked the console's way (score, then the
 * shorter name, then A to Z), cut at `cursor` for `limit` rows.
 */
export function pageOneBoxGroup(
  meta: Pick<OneBoxGroup, 'group' | 'heading' | 'noun' | 'searched' | 'truncated' | 'failed'>,
  scored: readonly OneBoxScored[],
  cursor: number,
  limit: number,
): OneBoxGroup {
  const ranked = [...scored].sort((a, b) =>
    compareScored({ score: a.score, label: a.row.label }, { score: b.score, label: b.row.label }),
  )
  const end = cursor + limit
  return {
    ...meta,
    rows: ranked.slice(cursor, end).map((entry) => entry.row),
    matched: ranked.length,
    ...(end < ranked.length ? { nextCursor: end } : {}),
  }
}

const LIST_HEADINGS: Record<NativeNavListId, string> = {
  workspace: 'Workspace',
  site: 'Site',
  workspaceSettings: 'Workspace settings',
  siteSettings: 'Site settings',
}

/**
 * The screens-and-settings matches for where the person stands: the
 * workspace's lists with no site, the site's lists (and the workspace
 * settings) with one. `enabledPluginIds` is the effective set for that
 * scope, so a screen of a plugin that is off is never offered.
 */
export function searchNavScreens(
  text: string,
  scope: 'account' | 'workspace' | 'site',
  enabledPluginIds: readonly string[],
  hostAdmin: boolean,
): OneBoxScored[] {
  if (!isSearchableQuery(text) || scope === 'account') return []
  const lists: NativeNavListId[] =
    scope === 'site' ? ['site', 'siteSettings', 'workspaceSettings'] : ['workspace', 'workspaceSettings']
  const seen = new Set<string>()
  const out: OneBoxScored[] = []
  for (const listId of lists) {
    const list = resolveNavList(listId, enabledPluginIds, hostAdmin)
    for (const group of list.groups) {
      for (const row of group.rows) {
        const where = group.label ? `${LIST_HEADINGS[listId]} · ${group.label}` : LIST_HEADINGS[listId]
        const entries = [
          {
            id: `${listId}.${row.id}`,
            label: row.label,
            screen: row.screen,
            params: row.params,
            keywords: [...(row.keywords ?? []), group.label ?? ''],
          },
          ...(row.sections ?? [])
            .filter((section) => section.label !== row.label)
            .map((section) => ({
              id: `${listId}.${row.id}.${section.id}`,
              label: section.label,
              screen: section.screen,
              params: section.params,
              keywords: [row.label, group.label ?? ''],
            })),
        ]
        for (const entry of entries) {
          // The same screen reached from two lists is one result.
          const key = `${entry.screen}|${JSON.stringify(entry.params ?? {})}`
          if (seen.has(key) || entry.screen === 'shell.home') continue
          const score = scoreMatch({ name: entry.label, extra: entry.keywords }, text)
          if (score === null) continue
          seen.add(key)
          out.push({
            score,
            row: {
              group: ONE_BOX_SCREENS_GROUP,
              id: entry.id,
              label: entry.label,
              detail: entry.label === row.label ? where : `${where} · ${row.label}`,
              screen: entry.screen,
              ...(entry.params ? { params: entry.params } : {}),
            },
          })
        }
      }
    }
  }
  return out
}
