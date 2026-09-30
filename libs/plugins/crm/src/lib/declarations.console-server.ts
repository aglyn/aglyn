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

// The registry's own module, not the data layer's barrel: boot needs one
// registry, not the whole server surface.
import {
  type ApiV1ResourceHandler,
  registerApiV1Resource,
} from '@aglyn/tenant-data-admin/server/api-v1-resources'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The plan feature every CRM resource of `/v1` needs, and the sentence its
 * refusal says (AGL-2611, AGL-2851): the whole CRM is included from
 * Starter, so a Free workspace reads and changes none of it over the API. A
 * capture still records people on every plan; working them is the CRM.
 */
const CRM_SUITE = {
  feature: 'crm',
  message:
    'The CRM — contacts, leads, companies, deals, tasks, pipelines, ' +
    'activities and email templates — is not included in this organization’s plan',
} as const

/**
 * The CRM's resources on the customer REST API, each handler loaded with the
 * first request for it. In the order the API root lists them: the people
 * first, then the records a team keeps about them, then a site's leads
 * (`/v1/leads?siteId=`, a top-level path with the site as a parameter), then
 * the letters sent from a record (AGL-2658).
 */
const CRM_API_V1_RESOURCES: ReadonlyArray<readonly [string, ApiV1ResourceHandler]> = [
  ['contacts', async (...args) => (await import('./server/api-v1/contacts')).handleContacts(...args)],
  ['companies', async (...args) => (await import('./server/api-v1/crm-companies')).handleCompanies(...args)],
  ['pipelines', async (...args) => (await import('./server/api-v1/crm-pipelines')).handlePipelines(...args)],
  ['deals', async (...args) => (await import('./server/api-v1/crm-deals')).handleDeals(...args)],
  ['tasks', async (...args) => (await import('./server/api-v1/crm-tasks')).handleTasks(...args)],
  ['activities', async (...args) => (await import('./server/api-v1/crm-activities')).handleActivities(...args)],
  ['leads', async (...args) => (await import('./server/api-v1/crm-leads')).handleLeads(...args)],
  [
    'email-templates',
    async (...args) => (await import('./server/api-v1/crm-email-templates')).handleEmailTemplates(...args),
  ],
]

/**
 * The CRM's CONSOLE-ONLY server declarations, named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot.
 *
 * It serves the CRM's resources of `/v1` (AGL-2606): the console's router
 * owns the pipeline in front of them — the key, the plan's API access, the
 * quota, the rate limit, the error envelope — and hands every request under
 * `/v1/contacts`, `/v1/deals` and the rest to the CRM once the key is
 * authenticated and the organization's plan carries the CRM. The API is the
 * console's alone, so the tenant runtime does not register them.
 *
 * Light at boot: each resource's module is imported with its first request.
 * Registering again replaces this plugin's own entries, so a second call (a
 * hot reload, a spec) is harmless.
 */
export function registerCrmConsoleServerDeclarations(): void {
  for (const [resource, handle] of CRM_API_V1_RESOURCES) {
    registerApiV1Resource(resource, { handle, entitlement: CRM_SUITE }, { pluginId: BUNDLE_ID })
  }
}
