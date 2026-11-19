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

import { normalizeScreenSlug, reservedScreenRouteSegment, SCREEN_ROOT_PATH } from './screen-route'

/** One sibling a new page's address must not take. */
export interface DraftScreenSlugRow {
  id?: string
  slug: string
  deleted: boolean
}

/**
 * A NEW, UNPUBLISHED PAGE'S ONE-SEGMENT ADDRESS (lifted from the AI plugin's
 * draft writer for AGL-4235, so the server's page create and the AI drafts
 * share one rule).
 *
 * The one asked for, else one from its name, never a reserved segment, and
 * never an address a live page keeps or the routing map already serves — so
 * a publish at it later takes nothing from a live page. The root is asked
 * for only while no page holds it.
 *
 * Except the placeholder home page a site is created with (AGL-3408), which
 * holds `/` only until a real home page is published there: the home page a
 * site drafts has to be able to ask for the root. Publishing it replaces the
 * placeholder in the same write.
 */
export function draftScreenSlug(
  requested: string | null | undefined,
  name: string,
  rows: ReadonlyArray<DraftScreenSlugRow>,
  routingMap: Record<string, unknown> | null | undefined,
  defaultHomeScreenId?: string | null,
): string {
  const placeholder = (id: string | undefined, path: unknown) =>
    Boolean(defaultHomeScreenId) && id === defaultHomeScreenId && path === SCREEN_ROOT_PATH
  const taken = new Set<string>([
    ...rows
      .filter((row) => !row.deleted && row.slug && !placeholder(row.id, row.slug))
      .map((row) => row.slug),
    ...Object.entries(routingMap ?? {})
      .filter(([id, path]) => typeof path === 'string' && !placeholder(id, path))
      .map(([, path]) => path as string),
  ])
  const usable = (value: string | undefined) =>
    value && !reservedScreenRouteSegment(value) && !(value === SCREEN_ROOT_PATH && taken.has(value))
      ? value
      : undefined
  const base = usable(normalizeScreenSlug(requested ?? undefined)) ?? usable(normalizeScreenSlug(name)) ?? 'page'
  if (base === SCREEN_ROOT_PATH) return base
  let slug = base
  let attempt = 2
  while (taken.has(slug)) slug = `${base}-${attempt++}`
  return slug
}
