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

import HostDatasetsCard from './components/host-datasets-card.component'
import * as Aglyn from '@aglyn/aglyn'
import { registerRepeatSource } from '@aglyn/aglyn/app-utils/repeat-sources'
import { mdiDatabaseOutline } from '@aglyn/shared-data-mdi'
import { lazy } from 'react'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerDatasetRecordList } from './model/dataset-record-list'
import { registerPageRecordSource } from '@aglyn/aglyn/app-utils/page-record-sources'
import { registerPluginTransferResourceUi } from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { DATASET_TRANSFER_RESOURCE } from './transfer/dataset-transfer-key'
import { DATASET_REPEAT_SOURCE } from './repeat/dataset-repeat-source'
import { RECORD_PAGE_ADDRESS_FIELD } from './record-pages/record-pages'
import { RECORD_PAGE_SOURCE } from './record-pages/record-page-source'
import RecordTemplateRowChip from './record-pages/record-template-row-chip.component'
import RecordTemplateSection from './record-pages/record-template-section.component'

/** Code-split: the Data console page only loads when opened. */
const DataConsolePage = lazy(() => import('./components/data-console-page'))

/**
 * Data feature plugin (AGL-395). Console-only — datasets are org-shared
 * document collections consumed by repeatable components at render time
 * through binding resolution, not a canvas element of their own, so there
 * is no UI bundle. The console half declares the host Data nav + page
 * through the ConsoleExtension registry, gated by the `dataStore`
 * entitlement. The org Data page (`Route.ORG_DATA`) is an org-scoped app route
 * that imports {@link HostDatasetsCard} directly.
 *
 * Record pages (AGL-3475) add a section to the besigner's Page Properties, a
 * chip to the Pages list's rows, and the page-record source that draws a
 * record template on the canvas for one of its records.
 *
 * It also registers datasets as a repeat source (AGL-3111), which is what puts
 * "Repeat over dataset" on every element's Attributes panel and draws a
 * repeat's copies from the real rows on the besigner canvas. Registered here,
 * inside the function the loader calls by name, and never by a module's own
 * load: this package declares no side effects, so a bundler deletes a module
 * imported only to run one (AGL-3025).
 */
export function registerDataConsole(): void {
  registerRepeatSource(DATASET_REPEAT_SOURCE)
  // The "Page address" field type (AGL-3475), for the schema dialog's type
  // list and the record editor's checks.
  Aglyn.registerCustomFieldType(RECORD_PAGE_ADDRESS_FIELD)
  // A record template draws on the canvas for one of its records (AGL-3475).
  registerPageRecordSource(RECORD_PAGE_SOURCE)
  // The workspace's datasets, for another plugin's picker (AGL-3080).
  registerDatasetRecordList()
  // A dataset's records in the import wizard and the export dialog
  // (AGL-3530); the Data card names the dataset when it opens them.
  registerPluginTransferResourceUi(
    DATASET_TRANSFER_RESOURCE,
    { label: 'Dataset records', icon: { path: mdiDatabaseOutline.path } },
    { pluginId: BUNDLE_ID },
  )
  Aglyn.registerConsoleExtension({
    // Org datasets card (AGL-419): org/data renders it through the
    // 'orgData' widget slot.
    widgets: [
      {
        slot: 'orgData',
        widgetId: 'data-org-datasets',
        Component: HostDatasetsCard,
      },
      // Record pages (AGL-3475): the template's settings in Page Properties,
      // and its chip in the Pages list.
      {
        slot: 'besignerPageProperties',
        widgetId: 'data-record-template',
        Component: RecordTemplateSection,
      },
      {
        slot: 'hostScreenRow',
        widgetId: 'data-record-template-chip',
        Component: RecordTemplateRowChip,
      },
    ],
    pluginId: BUNDLE_ID,
    displayName: 'Data',
    featureFlag: 'dataStore',
    navItems: [
      {
        label: 'Data',
        href: '/data',
        // Reuse the existing release-flag nav-tab so staff-preview gating is
        // unchanged now that the tab comes from the plugin (AGL-395).
        navTabId: 'nav-tab-data',
        icon: { path: mdiDatabaseOutline.path },
        header: {
          title: 'Data',
          icon: { path: mdiDatabaseOutline.path },
          docsTopic: 'datasets',
        },
        Component: DataConsolePage,
      },
    ],
  })
}

export { default as HostDatasetsCard } from './components/host-datasets-card.component'
export type { HostDatasetsCardProps } from './components/host-datasets-card.component'
