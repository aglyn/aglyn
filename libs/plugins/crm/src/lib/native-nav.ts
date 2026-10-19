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
  type NativeNavContribution,
  type NativeNavCreateContribution,
  type NativeNavRow,
  nativeNavHubSection,
  nativeNavIcon,
  nativeNavRef,
} from '@aglyn/aglyn/app-utils/native-nav'

/**
 * The CRM in the native apps' navigation (AGL-3943): the rows this plugin
 * adds to the manifest the shells draw, placed into the core's lists by
 * `order` (`assembleNativeNav`, `generate:native-contracts`). Labels are the
 * console's words, held by `apps/console/specs/native-nav-manifest.spec.ts`.
 *
 * Imports only the core's plain nav module, so the native contracts read it.
 */

/**
 * The row at either scope. The workspace's opens the console's org page
 * (`orgNavItems`, `/[orgSlug]/crm`), the site's the site's hub; both list
 * the same sections under the same ids.
 */
function row(scope: 'org' | 'host', order: number): NativeNavRow {
  return {
    id: 'crm',
    label: 'CRM',
    icon: nativeNavIcon('person.text.rectangle', 'contact_mail'),
    screen: 'crm.contacts',
    pluginId: 'crm',
    order,
    keywords: ['contacts', 'people', 'deals', 'tasks'],
    sections: [
      nativeNavHubSection(scope, '/crm', 'contacts', 'Contacts', 'crm.contacts'),
      nativeNavHubSection(scope, '/crm', 'leads', 'Leads', 'crm.leads'),
      nativeNavHubSection(scope, '/crm', 'companies', 'Companies', 'crm.companies'),
      nativeNavHubSection(scope, '/crm', 'deals', 'Deals', 'crm.deals'),
      nativeNavHubSection(scope, '/crm', 'tasks', 'Tasks', 'crm.tasks'),
      nativeNavHubSection(scope, '/crm', 'reports', 'Reports', 'crm.reports'),
      nativeNavHubSection(scope, '/crm', 'fields', 'Fields', 'crm.fields'),
      nativeNavHubSection(scope, '/crm', 'settings', 'Settings', 'crm.settings'),
    ],
    docs: scope === 'org' ? '/content-and-data/crm/overview#at-the-organization-level' : '/content-and-data/crm/overview',
    console: nativeNavRef(scope === 'org' ? 'orgPluginTab' : 'hostPluginTab', '/crm'),
  }
}

export const NATIVE_NAV_ROWS: readonly NativeNavContribution[] = [
  { list: 'workspace', group: 'workspace', row: row('org', 20) },
  { list: 'site', group: 'customers', row: row('host', 20) },
]

/** A contact, at either scope: the console's "New contact" on the CRM's Contacts. */
function contact(scope: 'org' | 'host', order: number): NativeNavCreateContribution['item'] {
  return {
    id: 'contact',
    label: 'Contact',
    icon: nativeNavIcon('person.badge.plus', 'person_add'),
    screen: 'crm.contacts',
    params: { new: '1' },
    pluginId: 'crm',
    permission: 'data.manage',
    planFeature: 'crm',
    order,
    console: nativeNavRef(scope === 'org' ? 'orgPluginSection' : 'hostPluginSection', '/crm/contacts'),
  }
}

export const NATIVE_NAV_CREATE: readonly NativeNavCreateContribution[] = [
  { scope: 'workspace', item: contact('org', 20) },
  { scope: 'site', item: contact('host', 70) },
]
