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

import { permanentRedirect } from 'next/navigation'
import { buildRoute, Route } from '../../../../../../constants/route-links'

// /[orgSlug]/hosts/[host]/layouts has no page of its own — redirect to the
// layout list, matching the sibling `screens` route (AGL-1174). Without this
// the bare path rendered the generic not-found, whose copy blames a missing
// plugin and sends people to Plugins looking for a problem that isn't there.
export default async function LayoutsIndex({
  params,
}: {
  params: Promise<{ orgSlug: string; host: string }>
}) {
  const { orgSlug, host } = await params
  permanentRedirect(buildRoute(Route.LAYOUT_LIST, { orgSlug, host }))
}
