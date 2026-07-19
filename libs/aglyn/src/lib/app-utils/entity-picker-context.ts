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
// Same placement rationale as screen-link-context.ts: lives in
// @aglyn/aglyn without a 'use client' banner so canvas-rendering surfaces
// share one module graph.
import { createContext } from 'react'

export interface EntityOption {
  /** Stable document id — the persisted reference (AGL-343/344). */
  id: string
  /** Current display name, resolved at edit time. */
  label: string
}

/**
 * Edit-time option lists for id-based entity pickers in component
 * attributes (products, collections, categories, datasets). Names are
 * display-only; nodes persist the id, so renames never break references —
 * the same contract as {@link ScreenLinkContext}. Provided by the
 * console's besigner/preview surfaces; absent on the tenant (the tenant
 * only resolves ids, never lists them).
 */
export interface EntityPickerContextValue {
  products?: EntityOption[]
  collections?: EntityOption[]
  categories?: EntityOption[]
  datasets?: EntityOption[]
  /**
   * Per-dataset model fields (AGL-556), keyed by dataset id, in model
   * order: id = stable model fieldId, label = current display name. Feeds
   * DATASET_FIELD_SELECT attributes (e.g. a form field's "Maps to schema
   * field" picker).
   */
  datasetFields?: Record<string, EntityOption[]>
}

export const EntityPickerContext = createContext<EntityPickerContextValue>({})
EntityPickerContext.displayName = 'EntityPickerContext'
