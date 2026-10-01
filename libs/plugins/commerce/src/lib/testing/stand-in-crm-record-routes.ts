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

import {
  registerPluginRecordRoute,
  type PluginRecordRoute,
  type PluginRecordRouteContext,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'

/**
 * The CRM's `contact`, `lead` and `company` record routes (AGL-3080), stood in
 * for this plugin's specs, which may not load the CRM. They answer what the
 * CRM publishes — a record's page under the site's hub or the organization's,
 * and the Contacts list opened on one address — and what it publishes is held
 * in its own `crm-record-routes.spec.ts`. Registered under the owner's id,
 * `crm`, so a spec asking what happens where it is not loaded unregisters it.
 */
export function standInCrmRecordRoutes(): void {
  const hub = ({ orgSlug, host }: PluginRecordRouteContext) =>
    host ? `/${orgSlug}/hosts/${host}/crm` : `/${orgSlug}/crm`
  const sectionRoute = (section: string): PluginRecordRoute => ({
    list: (context) => `${hub(context)}/${section}`,
    record: (context, id) => `${hub(context)}/${section}/${encodeURIComponent(id)}`,
  })
  registerPluginRecordRoute(
    'contact',
    {
      ...sectionRoute('contacts'),
      byEmail: (context, email) =>
        `${hub(context)}/contacts?${new URLSearchParams({ email }).toString()}`,
    },
    { pluginId: 'crm' },
  )
  registerPluginRecordRoute('lead', sectionRoute('leads'), { pluginId: 'crm' })
  registerPluginRecordRoute('company', sectionRoute('companies'), { pluginId: 'crm' })
}
