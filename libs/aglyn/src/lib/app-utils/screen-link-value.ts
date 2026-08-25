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
 * What a stored link VALUE means, with no React attached (AGL-703).
 *
 * Split out of `screen-link-context.ts`, which calls `createContext` at module
 * scope and is therefore excluded from the `@aglyn/aglyn/server` barrel by
 * design (AGL-405). The parsing is not client-only, though, and the where-used
 * scan runs on the server: without this split the API route would have had to
 * re-spell `'screen:'` and its own trimming rules, which is exactly how two
 * readers start disagreeing about what a link points at.
 *
 * `screen-link-context.ts` re-exports every name here, so existing importers —
 * all of which reach these through the `@aglyn/aglyn` barrel — are unaffected.
 */

/**
 * Prefix marking a stored link value as a screen REFERENCE rather than a
 * literal href (AGL-1335).
 *
 * A `Link`-typed component prop stores its value in the same string slot
 * whichever way it was authored, and every value written before the picker
 * existed is a raw path (`/pricing`). A bare screen id is indistinguishable
 * from a relative path that happens to have no slash, so the id-carrying
 * shape is the one that gets the marker: a legacy string keeps meaning
 * exactly what it always meant, and only newly picked values indirect
 * through the routing map.
 */
export const SCREEN_LINK_VALUE_PREFIX = 'screen:'

/** Wraps a screen id as a stored link value — see {@link SCREEN_LINK_VALUE_PREFIX}. */
export function formatScreenLinkValue(screenId: string): string {
  return `${SCREEN_LINK_VALUE_PREFIX}${screenId}`
}

/**
 * The screen id a stored link value references, or `undefined` when the
 * value is a literal href (legacy raw string, external URL, or unset).
 */
export function parseScreenLinkValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith(SCREEN_LINK_VALUE_PREFIX)) return undefined
  const id = trimmed.slice(SCREEN_LINK_VALUE_PREFIX.length).trim()
  return id || undefined
}

/**
 * Whether a stored node tree links to a given screen (AGL-703).
 *
 * DEEP, unlike {@link nodesReferenceComponent} which reads `props.refId` at
 * one known key. A screen id can sit almost anywhere in a prop bag: the
 * `screenId`/`href` pair every linking element declares, a `Link`-typed
 * component prop the author bound to either slot, and — the case a shallow
 * walk would miss entirely — the ITEM ARRAYS a nav strip, a tab set, or a
 * mega menu store their targets in. Those arrays are where a site's
 * navigation actually lives, so a scan that skipped them would report the
 * home page as linked from nowhere.
 *
 * Two accepted spellings, matching {@link splitLinkValue}'s own rules:
 *
 * - `screen:<id>` — the marked form every picked value has written since
 *   AGL-1335;
 * - a bare `<id>` — the legacy form, still live on anything authored before
 *   the picker.
 *
 * The bare form is the one that could over-match, and it is allowed to. A
 * screen id is a generated 10-character token, so a prop holding that exact
 * string for some unrelated reason is a theoretical case; and this answers
 * "what might I break", where naming one extra document costs a second look
 * and missing one costs a dead link on a live site.
 */
export function nodesReferenceScreen(
  nodes: Record<string, unknown> | null | undefined,
  screenId: string,
): boolean {
  if (!nodes || !screenId) return false
  const matches = (value: unknown): boolean => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return (
        trimmed === screenId ||
        parseScreenLinkValue(trimmed) === screenId
      )
    }
    if (Array.isArray(value)) return value.some(matches)
    if (value && typeof value === 'object') {
      return Object.values(value as Record<string, unknown>).some(matches)
    }
    return false
  }
  for (const node of Object.values(nodes)) {
    const props = (node as { props?: unknown } | undefined)?.props
    if (props && matches(props)) return true
  }
  return false
}
