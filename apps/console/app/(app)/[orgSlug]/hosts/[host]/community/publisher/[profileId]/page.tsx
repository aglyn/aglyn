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
import { buildRoute, Route } from '../../../../../../../../constants/route-links'

/**
 * The per-site publisher page was retired with the community tab (AGL-775).
 * There is no org-scope publisher route yet, so old links land on the org
 * marketplace; a dedicated org publisher profile is future work (AGL-776).
 */
export default async function HostCommunityPublisherRedirect({
  params,
}: {
  params: Promise<{ orgSlug: string; host: string; profileId: string }>
}) {
  const { orgSlug } = await params
  redirect(buildRoute(Route.ORG_MARKETPLACE, { orgSlug }))
}
