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

import type { PluginRecordRouteContext } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { useParams } from 'next/navigation'

/**
 * Where this console is — the organization and the site — for asking the
 * record-route registry for a link, or `null` until the route params settle
 * (AGL-2608).
 *
 * Both are already in the URL, so no document is read to build a link. What
 * the Inbox does NOT know is the address itself: the plugin that keeps people
 * publishes where a lead or a contact is read, and the Inbox asks
 * `pluginRecordHref('lead', context, id)`. It lists leads; wherever they are
 * worked is that plugin's to say, and a workspace without one gets text
 * instead of a link.
 */
export function useRecordRouteContext(): PluginRecordRouteContext | null {
  const params = useParams<{ orgSlug: string; host: string }>()
  const orgSlug = params?.orgSlug
  const host = params?.host
  if (!orgSlug || !host) return null
  return { orgSlug, host }
}

export default useRecordRouteContext
