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

/**
 * The CRM's resource keys, as `plugins.config.json` declares them
 * (AGL-3527, AGL-3528).
 *
 * A module of their own (AGL-4047): the plugin registers each resource's
 * wizard label when it loads (`transfer/ui.ts`), and reading the keys from
 * `fields.ts` put every field table in it, about 9 KB, into the bytes the
 * console pays the moment CRM loads. `fields.ts` re-exports them.
 */
export const CRM_CONTACTS_RESOURCE = 'crm.contacts'
export const CRM_COMPANIES_RESOURCE = 'crm.companies'
export const CRM_LEADS_RESOURCE = 'crm.leads'
export const CRM_DEALS_RESOURCE = 'crm.deals'
export const CRM_TASKS_RESOURCE = 'crm.tasks'
export const CRM_ACTIVITIES_RESOURCE = 'crm.activities'
export const CRM_PIPELINES_RESOURCE = 'crm.pipelines'
export const CRM_FIELDS_RESOURCE = 'crm.fields'
