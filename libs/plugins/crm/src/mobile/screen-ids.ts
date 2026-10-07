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

/** The CRM plugin's mobile ids (AGL-3622): `<pluginId>.<name>`, as `plugins.config.json` declares them. */

import type { CrmListKind } from './crm-lists'

/** The CRM tab's root: the four lists behind one switcher. */
export const CRM_HOME_SCREEN = 'crm.home'

/** Each list on its own, for a link to the console's list page. */
export const CRM_LIST_SCREENS: Readonly<Record<CrmListKind, string>> = {
  leads: 'crm.leads',
  contacts: 'crm.contacts',
  companies: 'crm.companies',
  deals: 'crm.deals',
}

/** One record of each kind, pushed from a list on a phone and opened by a link. */
export const CRM_RECORD_SCREENS: Readonly<Record<CrmListKind, string>> = {
  leads: 'crm.lead',
  contacts: 'crm.contact',
  companies: 'crm.company',
  deals: 'crm.deal',
}

export const CRM_TAB = 'crm.tab'
export const CRM_OPEN_LEADS_WIDGET = 'crm.openLeads'
export const CRM_LEADS_ACTION = 'crm.leadsAction'
export const CRM_DEALS_ACTION = 'crm.dealsAction'
