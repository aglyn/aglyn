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

import type { ScreenUid } from '../foundation'

/**
 * Route path of a host's root screen. The tenant matcher joins the catch-all
 * segments (`(params.slug || ['/']).join('/')`), so the root is `'/'` and
 * every other path is slash-joined segments WITHOUT a leading slash
 * (`about`, later `company/about`).
 */
export const SCREEN_ROOT_PATH = '/'

/**
 * Normalizes user slug input into the routing-map path format described on
 * {@link SCREEN_ROOT_PATH}. Empty input and `/` normalize to the root path;
 * anything else becomes a single lowercase url-safe segment. Returns
 * `undefined` when nothing survives sanitization (e.g. `'###'`), which
 * callers should treat as invalid rather than silently publishing.
 */
export function normalizeScreenSlug(
  input: string | null | undefined,
): string | undefined {
  const trimmed = (input ?? '').trim()
  if (!trimmed) return undefined
  if (trimmed === SCREEN_ROOT_PATH) return SCREEN_ROOT_PATH

  const segment = trimmed
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  return segment || undefined
}

/**
 * Looks up which screen currently owns a routing path, for sibling-slug
 * uniqueness checks before publishing.
 */
export function findScreenIdByRoutePath(
  screens: Record<ScreenUid, string> | null | undefined,
  path: string,
): ScreenUid | undefined {
  if (!screens) return undefined
  const entry = Object.entries(screens).find(([, value]) => value === path)
  return entry?.[0]
}

/** Human-facing URL for a routing-map path (`'/'` stays `/`, `about` → `/about`). */
export function screenRoutePathToUrl(path: string): string {
  return path === SCREEN_ROOT_PATH ? SCREEN_ROOT_PATH : `/${path}`
}
