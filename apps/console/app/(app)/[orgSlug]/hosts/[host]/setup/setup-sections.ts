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

import { buildRoute, Route } from '../../../../../../constants/route-links'

export type SetupSectionId = 'details' | 'seo' | 'tracking' | 'theme' | 'emails'

export interface SetupSection {
  id: SetupSectionId
  label: string
  href: string
  /** The form schema this section renders, when it renders one. */
  schemaId?: 'hostDetails' | 'hostSeo' | 'hostTracking'
}

/** Section metadata in rail order. Hrefs are added per site below. */
const SECTIONS: ReadonlyArray<{
  id: SetupSectionId
  label: string
  route: Route
  schemaId?: SetupSection['schemaId']
}> = [
  {
    id: 'details',
    label: 'Basic details',
    route: Route.HOST_SETUP_DETAILS,
    schemaId: 'hostDetails',
  },
  { id: 'seo', label: 'SEO', route: Route.HOST_SETUP_SEO, schemaId: 'hostSeo' },
  {
    id: 'tracking',
    label: 'Tracking',
    route: Route.HOST_SETUP_TRACKING,
    schemaId: 'hostTracking',
  },
  { id: 'theme', label: 'Theme', route: Route.HOST_SETUP_THEME },
  { id: 'emails', label: 'Emails', route: Route.HOST_SETUP_EMAILS },
]

/**
 * The Setup hub's sections for one site, in rail order (AGL-2501).
 *
 * One list, read by everything that has to agree about it: the layout draws
 * the rail from it, `useActiveSection` resolves the breadcrumb's last crumb
 * against the same array, and the index redirect lands on its first entry.
 * Separate copies are how a section comes to be listed under one name, linked
 * under another, and missing from the trail entirely.
 */
export function setupSections(orgSlug: string, host: string): SetupSection[] {
  return SECTIONS.map(({ id, label, route, schemaId }) => ({
    id,
    label,
    schemaId,
    href: buildRoute(route as never, { orgSlug, host } as never),
  }))
}

/**
 * Where a `?tab=` link lands (AGL-2501).
 *
 * Kept, unlike the settings and marketplace hubs which dropped theirs. Those
 * had no shipped links holding an id; these demonstrably do — the site
 * dashboard links `?tab=activity`, the email besigner links `?tab=emails` and
 * the theme editor links `?tab=theme`, all built in this repo, and a bookmark
 * on the most-visited page in the console is a link somebody is holding right
 * now.
 *
 * `activity` maps to Basic details deliberately: the Activity tab was removed
 * before this conversion, so that link was already landing on the fallback.
 * Preserving where it lands is preserving today's behaviour, not reviving a
 * tab.
 *
 * An id NOT on this list falls back to the first section rather than 404ing. A
 * query parameter is not a path segment: it names a preference about a page
 * that exists, so a stale one is answered with the page, exactly as
 * `useTabParam` answered it before.
 */
export const SETUP_TAB_SECTIONS: Readonly<Record<string, SetupSectionId>> = {
  hostDetails: 'details',
  hostSeo: 'seo',
  hostTracking: 'tracking',
  theme: 'theme',
  emails: 'emails',
  activity: 'details',
}

/** Where `/setup` lands when nothing names a section. */
export const DEFAULT_SETUP_SECTION: SetupSectionId = 'details'
