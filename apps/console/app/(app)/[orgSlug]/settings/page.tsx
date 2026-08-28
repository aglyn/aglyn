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
import { buildRoute, Route } from '../../../../constants/route-links'
import {
  sectionIndexTarget,
  type SearchParams,
} from '../../../../utils/section-index-redirect'

/**
 * `/settings` is the section index and renders nothing of its own (AGL-693).
 *
 * A SERVER component, deliberately (AGL-693). This was a client page that
 * returned `null`, waited for hydration, resolved the org slug from a hook and
 * then client-navigated — load the index chunk, hydrate, resolve, navigate,
 * load the target chunk, render. Every step of that was a blank main area in
 * front of the reader. The slug is in `params`, so the redirect can be issued
 * before any JavaScript ships.
 *
 * The incoming query is carried across: a redirect that drops it silently
 * deletes whatever somebody else put in the URL.
 *
 * `redirect()` is a 307 — a temporary, non-cached hop. Deliberately not
 * `permanentRedirect`: which section is the default is a product decision that
 * may change, and a 308 is cached by the browser past the point where changing
 * it would help.
 */
export default async function OrgSettingsIndex({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>
  searchParams: Promise<SearchParams>
}): Promise<never> {
  const { orgSlug } = await params
  redirect(
    sectionIndexTarget(
      buildRoute(Route.ORG_SETTINGS_GENERAL, { orgSlug }),
      await searchParams,
    ),
  )
}
