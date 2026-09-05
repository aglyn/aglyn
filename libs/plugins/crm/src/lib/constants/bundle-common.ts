/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

/**
 * The persisted plugin id (AGL-2595). It was `contacts` while the surface was
 * one list; `backfill-plugin-id-crm.mjs` rewrote the stored lists, and the
 * plugin manager's alias for the old value was retired once that backfill
 * reported nothing left (AGL-2614).
 */
export const BUNDLE_ID = 'crm'
