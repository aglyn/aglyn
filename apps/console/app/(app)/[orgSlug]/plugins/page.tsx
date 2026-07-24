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

/**
 * The standalone "Plugins & add-ons" hub was folded into the Marketplace
 * (AGL-797): the first-party switchboard, per-plugin config, and install
 * pins all live under Marketplace › Installed now. The `Route.ORG_PLUGINS`
 * enum stays so older links and any in-console references still resolve —
 * this page just forwards them to the Installed tab.
 */
export default async function OrgPluginsRedirect({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  redirect(`${buildRoute(Route.ORG_MARKETPLACE, { orgSlug })}?tab=installed`)
}
