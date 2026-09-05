/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

/**
 * The persisted plugin id (AGL-2595). It was `contacts` while the surface was
 * one list; `LEGACY_PLUGIN_IDS` in the plugin manager reads that value as
 * this one, and `backfill-plugin-id-crm.mjs` rewrites the stored lists.
 */
export const BUNDLE_ID = 'crm'
