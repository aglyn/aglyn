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
 * The CRM plugin's mobile surface (AGL-3622): a CRM tab over leads,
 * contacts, companies and deals on the console's own queries, each
 * record's page with its status controls and activity, an Open leads
 * widget, and the console's CRM addresses — and the links its
 * notifications carry — opening natively. Reached only through the
 * generated mobile manifest, never from `src/index.ts`.
 */

import {
  registerMobileDashboardWidget,
  registerMobileDeepLink,
  registerMobileQuickAction,
  registerMobileScreen,
  registerMobileTab,
} from '@aglyn/mobile-plugin-host'
import { CRM_LIST_KINDS, CRM_LIST_LABELS, type CrmListKind } from './crm-lists'
import {
  CRM_DEALS_ACTION,
  CRM_HOME_SCREEN,
  CRM_LEADS_ACTION,
  CRM_LIST_SCREENS,
  CRM_OPEN_LEADS_WIDGET,
  CRM_RECORD_SCREENS,
  CRM_TAB,
} from './screen-ids'

export { CRM_HOME_SCREEN, CRM_LIST_SCREENS, CRM_RECORD_SCREENS }

const PLUGIN = 'crm'

const RECORD_TITLES: Readonly<Record<CrmListKind, string>> = {
  leads: 'Lead',
  contacts: 'Contact',
  companies: 'Company',
  deals: 'Deal',
}

const listScreen = (kind: CrmListKind) => () =>
  import('./crm-home-screen').then((module) => ({
    default: {
      leads: module.LeadsScreen,
      contacts: module.ContactsScreen,
      companies: module.CompaniesScreen,
      deals: module.DealsScreen,
    }[kind],
  }))

const recordScreen = (kind: CrmListKind) => () =>
  import('./crm-record-screen').then((module) => ({
    default: {
      leads: module.LeadScreen,
      contacts: module.ContactScreen,
      companies: module.CompanyScreen,
      deals: module.DealScreen,
    }[kind],
  }))

/** The console's record address segment for each list, as `crmRoutes` builds it. */
const RECORD_PARAM = 'recordId'

export function registerCrmMobile(): void {
  registerMobileScreen({
    pluginId: PLUGIN,
    id: CRM_HOME_SCREEN,
    title: 'CRM',
    load: () => import('./crm-home-screen'),
  })
  for (const kind of CRM_LIST_KINDS) {
    registerMobileScreen({ pluginId: PLUGIN, id: CRM_LIST_SCREENS[kind], title: CRM_LIST_LABELS[kind], load: listScreen(kind) })
    registerMobileScreen({ pluginId: PLUGIN, id: CRM_RECORD_SCREENS[kind], title: RECORD_TITLES[kind], load: recordScreen(kind) })
  }
  registerMobileTab({
    pluginId: PLUGIN,
    id: CRM_TAB,
    title: 'CRM',
    icon: 'people-outline',
    screen: CRM_HOME_SCREEN,
    order: 20,
  })
  registerMobileDashboardWidget({
    pluginId: PLUGIN,
    id: CRM_OPEN_LEADS_WIDGET,
    title: 'Open leads',
    order: 200,
    size: 'half',
    load: () => import('./crm-open-leads-widget'),
  })
  registerMobileQuickAction({
    pluginId: PLUGIN,
    id: CRM_LEADS_ACTION,
    title: 'Leads',
    icon: 'flash-outline',
    order: 200,
    screen: CRM_LIST_SCREENS.leads,
  })
  registerMobileQuickAction({
    pluginId: PLUGIN,
    id: CRM_DEALS_ACTION,
    title: 'Deals',
    icon: 'cash-outline',
    order: 210,
    screen: CRM_LIST_SCREENS.deals,
  })
  /*
   * The console's CRM addresses (`crmRoutes`: `{hub}/{section}` and
   * `{hub}/{section}/{id}`, the hub at a site or at the workspace), which
   * are also what the CRM's notifications link to — an assignment
   * (`/{hostId}/crm/leads/{id}`, `/{hostId}/crm/contacts/{id}`), a task
   * reminder or assignment (`…/crm/contacts|deals|companies/{id}`), the
   * daily digest (`/{hostId}/crm/leads`). Tasks have no native screen and
   * open in the console.
   */
  registerMobileDeepLink({ pluginId: PLUGIN, id: 'crm.page', path: '/crm', screen: CRM_HOME_SCREEN })
  for (const kind of CRM_LIST_KINDS) {
    registerMobileDeepLink({
      pluginId: PLUGIN,
      id: `crm.${kind}Page`,
      path: `/crm/${kind}`,
      screen: CRM_LIST_SCREENS[kind],
    })
    registerMobileDeepLink({
      pluginId: PLUGIN,
      id: `${CRM_RECORD_SCREENS[kind]}Page`,
      path: `/crm/${kind}/:${RECORD_PARAM}`,
      screen: CRM_RECORD_SCREENS[kind],
    })
  }
}
