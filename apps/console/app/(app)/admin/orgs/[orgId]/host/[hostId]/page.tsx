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
import { buildRoute, Route } from '../../../../../../../constants/route-links'

/**
 * The site's staff page moved out from under its organization (AGL-3378): a
 * site is looked up by its own id, from the Sites list as often as from its
 * organization, and the organization is on the page. Old links keep working.
 */
export default async function AdminOrgHostRedirect({
  params,
}: {
  params: Promise<{ orgId: string; hostId: string }>
}) {
  const { hostId } = await params
  redirect(buildRoute(Route.ADMIN_SITE_DETAIL, { hostId }))
}
