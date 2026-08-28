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

import { redirect } from 'next/navigation'
import {
  sectionIndexTarget,
  type SearchParams,
} from '../../../../../../utils/section-index-redirect'
import {
  DEFAULT_SETUP_SECTION,
  SETUP_TAB_SECTIONS,
  setupSections,
} from './setup-sections'

/**
 * `/setup` is the section index and renders nothing of its own (AGL-693).
 *
 * A SERVER component, so the redirect is issued before any JavaScript ships —
 * both segments it needs are in `params`.
 *
 * `?tab=` IS honored here, unlike the settings and marketplace hubs which
 * dropped their maps. Those had nothing holding an id; this one demonstrably
 * does. Three links built in this repo carry one — the site dashboard's
 * `?tab=activity`, the email besigner's `?tab=emails`, the theme editor's
 * `?tab=theme` — and Setup is the most-visited page in the console, so
 * bookmarks are held by people as well as by code.
 *
 * An id NOT on the map falls back to the first section rather than 404ing. A
 * query parameter is not a path segment: it names a preference about a page
 * that exists, so a stale one is answered with the page, exactly as
 * `useTabParam` answered it before.
 *
 * The whole query is carried across, so a marker nothing routes on still
 * survives the hop.
 */
export default async function HostSetupIndex({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; host: string }>
  searchParams: Promise<SearchParams>
}): Promise<never> {
  const { orgSlug, host } = await params
  const query = await searchParams
  const requested = query.tab
  const tab = Array.isArray(requested) ? requested[0] : requested
  const targetId = (tab && SETUP_TAB_SECTIONS[tab]) || DEFAULT_SETUP_SECTION
  const sections = setupSections(orgSlug, host)
  const target =
    sections.find((section) => section.id === targetId) ?? sections[0]
  redirect(sectionIndexTarget(target.href, query))
}
