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
  registerApiV1UsageFigures,
} from '@aglyn/tenant-data-admin/server/api-v1-resources'
import {
  listPluginMembershipDetachers,
  registerPluginMembershipDetacher,
} from '@aglyn/aglyn/plugin-manager/plugin-membership-detach'
import { registerPluginPersonRecordsEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCrmTransferResources } from './transfer/register'

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
 * authenticated and the organization's plan carries the CRM. Each resource
 * brings its description for the API's OpenAPI document, and the CRM's
 * records band and collection sizes join `GET /v1/usage`. The API is the
 * console's alone, so the tenant runtime does not register them.
 *
 * It registers the server half of the CRM's import and export resources
 * (`transfer/register.ts`).
 *
 * It also clears a removed container off the CRM's records: a campaign is
 * deleted from the console, and its owner asks every plugin's membership
 * detacher first (`server/container-detach.ts`).
 *
 * Light at boot: each resource's module is imported with its first request,
 * the descriptions when the document is first built, and the usage reader
 * with the first usage call.
 * Registering again replaces this plugin's own entries, so a second call (a
 * hot reload, a spec) is harmless.
 */
export function registerCrmConsoleServerDeclarations(): void {
  // The record system's share of a person erasure (AGL-2623, AGL-3080): it
  // names the person's contacts before anybody erases, and erases them, their
  // satellites and their lead after everybody else. Required, and loaded with
  // the first erasure.
  registerPluginPersonRecordsEraser(
    {
      locate: async (target) => (await import('./server/person-eraser')).crmPersonEraser().locate(target),
      erase: async (request) => (await import('./server/person-eraser')).crmPersonEraser().erase(request),
    },
    { pluginId: BUNDLE_ID },
  )
  for (const [resource, handle] of CRM_API_V1_RESOURCES) {
    registerApiV1Resource(
      resource,
      {
        handle,
        entitlement: CRM_SUITE,
        describe: async () =>
          (await import('./server/api-v1/openapi')).CRM_API_V1_DESCRIPTIONS[resource],
      },
      { pluginId: BUNDLE_ID },
    )
  }
  registerApiV1UsageFigures(
    async (ctx) => (await import('./server/api-v1/usage')).crmUsageFigures(ctx),
    { pluginId: BUNDLE_ID },
  )
  // What the CRM imports and exports (AGL-3527): each resource's module
  // loads with the first transfer that asks for it.
  registerCrmTransferResources(BUNDLE_ID)
  // A removed container — a deleted campaign — comes off every lead and every
  // contact facet naming it, before its owner removes it (AGL-3080).
  if (!listPluginMembershipDetachers().includes(BUNDLE_ID)) {
    registerPluginMembershipDetacher(
      async (request) => (await import('./server/container-detach')).crmContainerDetacher(request),
      { pluginId: BUNDLE_ID },
    )
  }
}
