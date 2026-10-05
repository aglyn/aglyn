/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

export const BUNDLE_ID = 'data'

/**
 * The id datasets are a repeat source under — the editor's source
 * (`repeat-sources.ts`) and the published page's reader (`repeat-rows.ts`)
 * alike, and the `repeatSource` this plugin declares in `plugins.config.json`.
 */
export const DATASET_REPEAT_SOURCE_ID = 'dataset'

/** The dataset storage meter in the monthly usage sweep (`server/dataset-storage-meter.ts`). */
export const DATASET_STORAGE_METER_ID = 'dataset-storage'

/**
 * The installable artifact type a dataset's schema is published and installed
 * as: the `artifactTypes` this plugin declares in `plugins.config.json`, and
 * the key a listing's version stores the schema under.
 */
export const DATASET_SCHEMA_ARTIFACT_TYPE = 'datasetSchema'

/**
 * The automation steps this plugin runs for the workflows engine
 * (`server/dataset-steps.server.ts`), as `plugins.config.json` declares them
 * under `serverSteps`.
 */
export const DATASET_STEP_TYPES = ['datasetAppend', 'updateDataset'] as const
