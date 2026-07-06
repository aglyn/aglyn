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

/** Minimal screen shape the hierarchy helpers need. */
export interface ScreenRouteNode {
  slug?: string
  parentId?: ScreenUid
}

/** Defensive cap: parent chains deeper than this are treated as invalid. */
const MAX_SCREEN_DEPTH = 32

/**
 * Composes a screen's routing-map path from its own slug plus its ancestor
 * chain: parent `company` + own `about` → `company/about`. Root (`'/'`)
 * segments contribute nothing, so children of the home screen sit at the
 * top level. Returns `undefined` when the screen (or any ancestor) has no
 * slug, when the screen's own slug is `'/'` while it has a parent, or when
 * the chain has a cycle / exceeds {@link MAX_SCREEN_DEPTH}.
 */
export function composeScreenRoutePath(
  screenId: ScreenUid,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
): string | undefined {
  const segments: string[] = []
  const visited = new Set<ScreenUid>()
  let currentId: ScreenUid | undefined = screenId

  while (currentId) {
    if (visited.has(currentId) || visited.size >= MAX_SCREEN_DEPTH) {
      return undefined
    }
    visited.add(currentId)
    const screen = screensById[currentId]
    if (!screen?.slug) return undefined
    if (screen.slug === SCREEN_ROOT_PATH) {
      // The home screen's segment is empty (children of home sit at the top
      // level), but a screen can't itself be the home page AND have a parent.
      if (currentId === screenId && screen.parentId) return undefined
    } else {
      segments.unshift(screen.slug)
    }
    currentId = screen.parentId
  }

  if (!segments.length) {
    return screensById[screenId]?.slug === SCREEN_ROOT_PATH
      ? SCREEN_ROOT_PATH
      : undefined
  }
  return segments.join('/')
}

/**
 * All screens whose parent chain passes through `screenId` (children,
 * grandchildren, …). Used to cascade routing-map rewrites when a screen's
 * slug or parent changes.
 */
export function collectScreenDescendantIds(
  screenId: ScreenUid,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
): ScreenUid[] {
  const childrenByParent = new Map<ScreenUid, ScreenUid[]>()
  for (const [id, screen] of Object.entries(screensById)) {
    if (!screen?.parentId) continue
    const siblings = childrenByParent.get(screen.parentId) ?? []
    siblings.push(id)
    childrenByParent.set(screen.parentId, siblings)
  }
  const result: ScreenUid[] = []
  const queue = [...(childrenByParent.get(screenId) ?? [])]
  while (queue.length) {
    const id = queue.shift() as ScreenUid
    if (result.includes(id)) continue
    result.push(id)
    queue.push(...(childrenByParent.get(id) ?? []))
  }
  return result
}

/**
 * True when making `nextParentId` the parent of `screenId` would create a
 * loop — i.e. the candidate parent is the screen itself or one of its own
 * descendants.
 */
export function wouldCreateScreenCycle(
  screenId: ScreenUid,
  nextParentId: ScreenUid | undefined,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
): boolean {
  if (!nextParentId) return false
  if (nextParentId === screenId) return true
  return collectScreenDescendantIds(screenId, screensById).includes(
    nextParentId,
  )
}

/**
 * Routing-map entries for a screen plus all its descendants under a
 * candidate screens map: a composed path sets the entry, `null` marks an
 * existing entry whose chain no longer resolves for removal. Callers apply
 * the result in one write so slug/parent changes cascade atomically.
 */
export function buildScreenRouteEntries(
  screenId: ScreenUid,
  screensById: Record<ScreenUid, ScreenRouteNode | undefined>,
  routingMap: Record<ScreenUid, string> | null | undefined,
): Record<ScreenUid, string | null> {
  const entries: Record<ScreenUid, string | null> = {}
  const ids = [screenId, ...collectScreenDescendantIds(screenId, screensById)]
  for (const id of ids) {
    const path = composeScreenRoutePath(id, screensById)
    if (path) entries[id] = path
    else if (routingMap?.[id] !== undefined) entries[id] = null
  }
  return entries
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
