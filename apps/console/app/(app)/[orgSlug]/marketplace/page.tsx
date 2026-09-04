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
  DEFAULT_MARKETPLACE_SECTION_ID,
  MARKETPLACE_RETURN_SECTIONS,
  marketplaceSections,
} from '../../../../constants/marketplace-sections'
import {
  sectionIndexTarget,
  type SearchParams,
} from '../../../../utils/section-index-redirect'

/**
 * `/marketplace` is the section index and renders nothing of its own
 * (AGL-2501).
 *
 * A SERVER component. This was a client page that returned `null`, waited for
 * hydration, resolved the org slug from a hook and then client-navigated, and
 * every step of that was a blank main area in front of the reader. The slug is
 * in `params`, so the redirect is issued before any JavaScript ships.
 *
 * No `?tab=` compatibility map, for the reason the settings sections have
 * none: nothing shipped holds a `?tab=` link into this hub, and a map kept
 * "just in case" is a second set of names for the same eight pages.
 *
 * `?connect=` and `?purchase=` are the opposite case and ARE honored. Stripe
 * bakes them into onboarding links and checkout sessions, so they are held
 * externally by a third party rather than by us — see
 * `MARKETPLACE_RETURN_SECTIONS`. Each is sent to the section it is about
 * rather than to the default: a seller returning from Connect onboarding wants
 * Payouts, and a buyer returning from checkout wants what they now own. The
 * whole query is carried across either way, so a marker nothing routes on
 * still survives the hop.
 */
export default async function OrgMarketplaceIndex({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<SearchParams>
}): Promise<never> {
  const { orgSlug } = await params
  const query = await searchParams
  const sections = marketplaceSections(orgSlug)
  const returning = Object.keys(MARKETPLACE_RETURN_SECTIONS).find(
    (key) => query[key] !== undefined,
  )
  const targetId = returning
    ? MARKETPLACE_RETURN_SECTIONS[returning]
    : DEFAULT_MARKETPLACE_SECTION_ID
  const target =
    sections.find((section) => section.id === targetId) ?? sections[0]
  redirect(sectionIndexTarget(target.href, query))
}
