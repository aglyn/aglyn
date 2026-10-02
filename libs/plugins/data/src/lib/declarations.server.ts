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

// The seam from its own module, not the plugin-manager barrel: boot needs the
// registry and nothing else, and the barrel reaches the client contexts.
import { registerFormRecordTarget } from '@aglyn/aglyn/plugin-manager/submission-record-target'
import { registerRepeatRowReader } from '@aglyn/aglyn/plugin-manager/repeat-rows'
import { registerPluginSiteBundleSection } from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import { registerPluginUsageMeter } from '@aglyn/aglyn/plugin-manager/plugin-usage-meters'
import { registerServerStepExecutor } from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import {
  BUNDLE_ID,
  DATASET_REPEAT_SOURCE_ID,
  DATASET_STEP_TYPES,
  DATASET_STORAGE_METER_ID,
} from './constants/bundle-common'

/**
 * The data plugin's server declarations: the light registrations core reads
 * at boot, before any surface loads.
 *
 * A published page that repeats an element over a dataset asks the platform
 * for the rows, and this is who answers — in every process that composes a
 * page, the tenant's and the console's previews alike. The reader, and the
 * Admin SDK with it, loads on the first page that repeats, not at boot.
 * `plugins.config.json` declares the same source (`repeatSource`), so a boot
 * that skipped this is refused rather than rendered as "no rows".
 *
 * A form can also file every submission as a dataset record, and this is the
 * target that stamps such a form with its signed binding when a page renders
 * and writes the record when the submission comes back. Declared the same way
 * (`formRecordTarget`), and just as light: both halves load on first use.
 *
 * A site's datasets are also its section of the whole-site backup: the
 * console's export and restore ask this plugin for them. Declared too
 * (`siteBundleSections`), so a boot that skipped this fails the export rather
 * than shipping a backup without them; the answers load when a backup is made
 * or restored.
 *
 * And the monthly usage sweep, a core cron, measures what the datasets store
 * through this plugin's meter — declared in `usageAxes`, so the sweep refuses
 * to bill a month without it. Its reads load with the first sweep.
 *
 * An automation that writes a dataset record runs that step through this
 * plugin: the workflows engine reaches it through the platform's server-step
 * seam, in whichever process runs the automation. Declared too (`serverSteps`),
 * so a boot that skipped this fails the step with its reason rather than
 * reporting a record that was never written; the writes load with the first
 * step.
 */
export function registerDataServerDeclarations(): void {
  registerRepeatRowReader(
    DATASET_REPEAT_SOURCE_ID,
    async (request) =>
      (await import('./repeat/dataset-repeat-rows.server')).readPublishedDatasetRows(
        request,
      ),
    { pluginId: BUNDLE_ID },
  )
  registerFormRecordTarget(
    {
      stamp: async (nodes, hostId) =>
        (await import('./form-target/stamp-form-dataset-bindings')).stampFormDatasetBindings(
          nodes,
          hostId,
        ),
      write: async (request) =>
        (await import('./form-target/dataset-form-record-target.server')).writeFormSubmissionRecord(
          request,
        ),
    },
    { pluginId: BUNDLE_ID },
  )
  const datasets = () => import('./site-bundle/datasets-site-bundle.server')
  registerPluginSiteBundleSection(
    'datasets',
    {
      export: async (request) => (await datasets()).exportSiteDatasets(request),
      refusal: async (request) => (await datasets()).siteDatasetsRefusal(request),
      import: async (request) => (await datasets()).importSiteDatasets(request),
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginUsageMeter({
    pluginId: BUNDLE_ID,
    id: DATASET_STORAGE_METER_ID,
    measure: async (context) =>
      (await import('./server/dataset-storage-meter')).measureDatasetStorage(context),
  })
  registerServerStepExecutor(
    DATASET_STEP_TYPES,
    async (request) => (await import('./server/dataset-steps.server')).runDatasetStep(request),
    { pluginId: BUNDLE_ID },
  )
}
