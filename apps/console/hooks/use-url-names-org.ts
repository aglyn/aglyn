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
'use client'

import type { UserOrgMembership } from '@aglyn/aglyn'
import { usePathname } from 'next/navigation'
import { useMemo } from 'react'
import {
  type NavSection,
  type NavSectionKind,
  resolveNavSection,
  segmentsOf,
  urlNamesOrg,
} from './nav-section'
import { useOrgScope } from './use-org-scope'

/**
 * The "does this URL name a workspace" predicate, split out of
 * `use-secondary-nav` (AGL-1937).
 *
 * It lives in its own module because the things that must ASK it now include
 * the two hooks the nav itself is built on — `use-release-flags` and the
 * console plugins gate — and `use-secondary-nav` imports the gate for
 * `useEnabledPluginIds`. Importing the predicate from there would close a
 * module cycle (gate → release flags → secondary nav → gate). Nothing here
 * imports anything that reads the plugin registry, so the cycle cannot come
 * back. `use-secondary-nav` re-exports all of it, so every existing import
 * site is unchanged.
 *
 * The pure path parsing moved on to `nav-section` (AGL-2486) so `use-org-scope`
 * can read the path without importing this module back; it is re-exported here
 * unchanged, so nothing that imports it from here or from `use-secondary-nav`
 * has to move.
 */
export {
  type NavSection,
  type NavSectionKind,
  resolveNavSection,
  segmentsOf,
  urlNamesOrg,
}

/** `urlNamesOrg` for the current route. */
export function useUrlNamesOrg(): boolean {
  const pathname = usePathname()
  const { orgSlug } = useOrgScope()
  return useMemo(
    () => urlNamesOrg(resolveNavSection(pathname), orgSlug),
    [pathname, orgSlug],
  )
}

/**
 * The workspace the URL names, ONLY when that is the one we resolved
 * (AGL-2486) — what anything that puts a workspace NAME on screen should ask.
 *
 * `useUrlNamesOrg()` answers "this route is about some workspace". That is the
 * right question for whether to render a workspace control at all, and the
 * wrong one for what to write in it, because the resolved org can be a
 * different workspace entirely: the scope falls back to a remembered selection
 * whenever its URL-derived candidates miss. Zach saw the two come apart on the
 * not-found boundary — `/aglyn-org/…` in the address bar, "Sale Test" in the
 * switcher, with Sale Test's plan badge next to it.
 *
 * `use-org-scope` no longer misses on that boundary, so this is the *guard*
 * rather than the fix: a mistyped `/gibberish` still parses as a leading
 * segment that names no real workspace, and the chain still falls through
 * behind it. Comparing the two is what makes a wrong NAME unrenderable
 * instead of merely unlikely.
 *
 * Returns `null` for three different situations that all mean "do not put a
 * name here": the route names no workspace, nothing has resolved yet, or the
 * resolved org is not the one named. Callers that must tell "org-less" from
 * "not that one" have `useUrlNamesOrg()` alongside — the switcher uses exactly
 * that pair to choose between rendering nothing and offering a neutral picker.
 *
 * Note it never answers "no workspace" merely because a read is in flight in
 * a way a caller could mistake for an org-less route: during the membership
 * load `currentOrg` is null, which is the same `null` the pre-resolution
 * chrome already renders as "no chip yet", not as "this page has no org".
 */
export function useUrlNamedOrg(): UserOrgMembership | null {
  const pathname = usePathname()
  const { orgSlug, currentOrg } = useOrgScope()
  return useMemo(() => {
    const section = resolveNavSection(pathname)
    if (!urlNamesOrg(section, orgSlug)) return null
    if (!currentOrg) return null
    // On a workspace subdomain the hostname IS the workspace, and a path slug
    // (when there is one) has to agree with it — `useOrgScope` resolves the
    // path first, so comparing against whichever the URL actually carries is
    // what keeps the two readings honest.
    const named = section.orgSlug ?? orgSlug
    // A membership with no slug yet can only be matched by id, and the URL
    // cannot name an id — so an unnamed match is not a match.
    return currentOrg.slug && currentOrg.slug === named ? currentOrg : null
  }, [pathname, orgSlug, currentOrg])
}
