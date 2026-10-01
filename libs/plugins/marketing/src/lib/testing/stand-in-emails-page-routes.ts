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
 * The Emails page's record routes, as the email plugin publishes them
 * (AGL-3080), stood in for this plugin's specs — a campaign links each
 * message's report and the template it was built from, and this plugin may
 * not load the email plugin that registers the real routes. What that plugin
 * publishes is held in its own `email-record-routes.spec.ts`.
 *
 * Registered under the owner's id, `email`, so a spec asking what happens
 * where it is not loaded unregisters that plugin's services.
 */
export function standInEmailsPageRoutes(): void {
  const hub = (orgSlug: string, host: string | null) =>
    host ? `/${orgSlug}/hosts/${host}/emails` : `/${orgSlug}/emails`
  registerPluginRecordRoute(
    'emailMessage',
    {
      list: ({ orgSlug, host }) => `${hub(orgSlug, host)}/messages`,
      record: ({ orgSlug, host }, id) => `${hub(orgSlug, host)}/messages/${encodeURIComponent(id)}`,
    },
    { pluginId: 'email' },
  )
  registerPluginRecordRoute(
    'emailTemplate',
    {
      list: ({ orgSlug, host }) => (host ? `${hub(orgSlug, host)}/templates` : null),
      record: ({ orgSlug, host }, id) =>
        host ? `${hub(orgSlug, host)}/templates/${encodeURIComponent(id)}` : null,
    },
    { pluginId: 'email' },
  )
}
