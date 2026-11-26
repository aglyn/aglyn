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
 * "Which pages does it show on": a list of site paths, each exact
 * (`/contact`) or a section (`/shop/*`), with every page, only the listed
 * ones, or every page but the listed ones. Live chat asked it first
 * (AGL-3698); the AI site chat (AGL-4250) asks the same question, so the
 * answer is the platform's.
 */

export type SitePathListMode = 'all' | 'only' | 'except'

export const SITE_PATH_LIST_MODES: readonly SitePathListMode[] = ['all', 'only', 'except']

/** What an author may type as one entry. */
export const SITE_PATH_PATTERN = /^\/[A-Za-z0-9\-._~%!$&'()+,;=:@/]*(\/\*)?$/

/** One leading slash, no doubled or trailing ones; `/x/*` keeps its wildcard. */
export function normalizeSitePathPattern(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  const wildcard = trimmed.endsWith('/*')
  const base = (wildcard ? trimmed.slice(0, -2) : trimmed)
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
  const path = base.startsWith('/') ? base : `/${base}`
  if (wildcard) return path === '/' ? '/*' : `${path}/*`
  return path || '/'
}

/** Whether one entry covers `path`; a section covers its own root too. */
export function sitePathPatternMatches(pattern: string, path: string): boolean {
  const target = normalizeSitePathPattern(path || '/')
  const normalized = normalizeSitePathPattern(pattern)
  if (normalized === '/*') return true
  if (normalized.endsWith('/*')) {
    const base = normalized.slice(0, -2)
    return target === base || target.startsWith(`${base}/`)
  }
  return target === normalized
}

/**
 * Whether a list shows on `path`. A page whose path is unknown (a 404) is
 * shown only under `all`: neither a listed nor an unlisted page can be told.
 */
export function sitePathListShows(
  list: { pages: SitePathListMode; paths: readonly string[] },
  path: string,
  pathUnknown = false,
): boolean {
  if (list.pages === 'all') return true
  if (pathUnknown) return false
  const listed = list.paths.some((pattern) => sitePathPatternMatches(pattern, path))
  return list.pages === 'only' ? listed : !listed
}

export type SitePathListResult =
  | { pages: SitePathListMode; paths: string[] }
  | { error: string }

/**
 * An author's list, checked and normalized: each entry a page address,
 * duplicates dropped, at most `maxPaths` of at most `maxLength` characters.
 * `noun` names the thing in the errors: "the chat".
 */
export function normalizeSitePathList(
  input: { pages: unknown; paths: unknown },
  options: { noun: string; maxPaths: number; maxLength: number },
): SitePathListResult {
  const pages = SITE_PATH_LIST_MODES.includes(input.pages as SitePathListMode)
    ? (input.pages as SitePathListMode)
    : null
  if (!pages) return { error: `Choose which pages show ${options.noun}.` }
  const rawPaths = Array.isArray(input.paths) ? input.paths : []
  const paths: string[] = []
  for (const entry of rawPaths) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const text = entry.trim()
    if (text.length > options.maxLength) {
      return { error: `“${text.slice(0, 40)}…” is longer than ${options.maxLength} characters.` }
    }
    const candidate = text.startsWith('/') ? text : `/${text}`
    if (!SITE_PATH_PATTERN.test(candidate)) {
      return {
        error: `“${text}” is not a page address. Use a path such as /contact, or /shop/* for a section.`,
      }
    }
    const normalized = normalizeSitePathPattern(candidate)
    if (!paths.includes(normalized)) paths.push(normalized)
  }
  if (paths.length > options.maxPaths) return { error: `List at most ${options.maxPaths} pages.` }
  if (pages === 'only' && !paths.length) {
    return { error: `List the pages ${options.noun} shows on, or choose every page.` }
  }
  return { pages, paths: pages === 'all' ? [] : paths }
}
