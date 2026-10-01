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

import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'

/**
 * The record routes of the plugins a contact's captured history points back
 * at — the inbox's `formSubmission`, commerce's `order`, bookings' `booking`
 * (AGL-3080) — stood in for this plugin's specs, which may not load those
 * plugins. Each answers what its owner publishes, at a site; what each owner
 * publishes is held in its own `*-record-routes.spec.ts`. Registered under
 * the owners' ids, so a spec asking what happens where one is not loaded
 * unregisters that plugin's services.
 */
export function standInSiteRecordRoutes(): void {
  const site = (orgSlug: string, host: string | null) => (host ? `/${orgSlug}/hosts/${host}` : null)
  const query = (key: string, value: string) => new URLSearchParams({ [key]: value }).toString()
  registerPluginRecordRoute(
    'formSubmission',
    {
      list: ({ orgSlug, host }) => `${site(orgSlug, host) ?? `/${orgSlug}`}/inbox/submissions`,
      record: ({ orgSlug, host }, id) =>
        host ? `${site(orgSlug, host)}/inbox/submissions?${query('submission', id)}` : null,
    },
    { pluginId: 'inbox' },
  )
  registerPluginRecordRoute(
    'order',
    {
      list: ({ orgSlug, host }) => (host ? `${site(orgSlug, host)}/products/orders` : null),
      record: ({ orgSlug, host }, id) =>
        host ? `${site(orgSlug, host)}/products/orders?${query('order', id)}` : null,
      byEmail: ({ orgSlug, host }, email) =>
        host ? `${site(orgSlug, host)}/products/orders?${query('email', email)}` : null,
    },
    { pluginId: 'commerce' },
  )
  registerPluginRecordRoute(
    'booking',
    {
      list: ({ orgSlug, host }) => (host ? `${site(orgSlug, host)}/bookings` : null),
      record: ({ orgSlug, host }) => (host ? `${site(orgSlug, host)}/bookings` : null),
      byEmail: ({ orgSlug, host }, email) =>
        host ? `${site(orgSlug, host)}/bookings?${query('email', email)}` : null,
    },
    { pluginId: 'bookings' },
  )
}
