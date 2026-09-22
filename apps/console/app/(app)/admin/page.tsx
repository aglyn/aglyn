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
import { buildRoute, Route } from '../../../constants/route-links'
import {
  sectionIndexTarget,
  type SearchParams,
} from '../../../utils/section-index-redirect'

/**
 * `/admin` is the staff console's index and renders nothing of its own
 * (AGL-3241).
 *
 * The area had a layout and a page per tab but nothing for the bare segment,
 * so typing the address a staff member actually types drew the tab strip —
 * which lives above the route boundary — over "This page isn't here". The
 * chrome said the console was there and the body said it was not.
 *
 * A SERVER component, like every other hub index (AGL-2501): the target is a
 * constant, so nothing here needs a bundle, a hydration or a client
 * navigation to arrive at a string that was known before the request was
 * answered.
 *
 * `redirect()` is a 307 — a temporary, non-cached hop. Deliberately not
 * `permanentRedirect`: which tab greets a staff member is a product decision
 * that may change, and a 308 is cached by the browser past the point where
 * changing it would help.
 *
 * The incoming query is carried across: a redirect that drops it silently
 * deletes whatever somebody else put in the URL.
 */
export default async function AdminIndex({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}): Promise<never> {
  redirect(
    sectionIndexTarget(buildRoute(Route.ADMIN_OVERVIEW), await searchParams),
  )
}
