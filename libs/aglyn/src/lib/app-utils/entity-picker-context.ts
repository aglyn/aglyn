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
 * attributes (products, collections, categories, datasets, forms). Names are
 * display-only; nodes persist the id, so renames never break references —
 * the same contract as {@link ScreenLinkContext}. Provided by the
 * console's besigner/preview surfaces; absent on the tenant (the tenant
 * only resolves ids, never lists them).
 */
/** The lists a picker can ask for. */
export type EntityPickerKind =
  | 'products'
  | 'collections'
  | 'categories'
  | 'datasets'
  | 'forms'

/**
 * How much an empty list is worth believing.
 *
 * Every one of these renders as a dropdown with no entries, and an author
 * looking at four identical empty dropdowns cannot tell "this site has no
 * forms yet" from "the read failed" from "this editor never lists forms at
 * all". Only the first of those is a fact about their site; the other two
 * are the picker being broken, and a picker that cannot say which it is
 * sends the author looking for a form they already made.
 *
 * - `unavailable` — no provider is mounted, so nothing on this surface can
 *   list entities. The tenant, and any editor outside a host.
 * - `loading` — a read is open or about to be, and no answer has arrived.
 *   Also the state of a list nothing has asked for yet: demand is declared
 *   on the same commit that would display it, so "not asked" and "asked,
 *   unanswered" are the same beat.
 * - `ready` — the read settled. An empty list here IS the site's answer.
 * - `error` — the read failed. Empty means nothing.
 */
export type EntityListState = 'unavailable' | 'loading' | 'ready' | 'error'

export interface EntityPickerContextValue {
  products?: EntityOption[]
  collections?: EntityOption[]
  categories?: EntityOption[]
  datasets?: EntityOption[]
  /** The host's form entities, id-first, feeding FORM_SELECT attributes. */
  forms?: EntityOption[]
  /**
   * Per-dataset model fields (AGL-556), keyed by dataset id, in model
   * order: id = stable model fieldId, label = current display name. Feeds
   * DATASET_FIELD_SELECT attributes (e.g. a form field's "Maps to schema
   * field" picker).
   */
  datasetFields?: Record<string, EntityOption[]>
  /**
   * Declare that a picker of this kind is on screen (AGL-703).
   *
   * The provider reads these lists from Firestore, and it used to read ALL of
   * them the moment the besigner opened — up to 300 products, 200 catalog
   * collections, 200 categories and 200 datasets, on a site with a real
   * catalog, for pickers most editing sessions never open. Nothing about
   * moving a heading needs the product list.
   *
   * So the lists are demand-driven now, and the demand signal is the thing
   * that would DISPLAY one: a selected node whose schema declares a
   * `PRODUCT_SELECT`, a repeat bound to a dataset. Call this when that is
   * true and read the list on the render after; until then the list is
   * absent, exactly as it is for the beat before any listener syncs.
   *
   * Optional, and absent on the tenant — which resolves ids and never lists
   * them, so nothing there has a picker to ask for.
   */
  request?: (kind: EntityPickerKind) => void
  /**
   * Per-kind read state, so a picker can say WHY it has nothing to offer.
   * A kind the provider omits reads as `loading`; see {@link entityListState}.
   */
  status?: Partial<Record<EntityPickerKind, EntityListState>>
}

/**
 * What the picker for `kind` should believe about its own emptiness.
 *
 * `request` is the "a provider is mounted" signal — it is the one member the
 * contract already says is absent wherever nothing lists entities — so a
 * surface with no provider resolves to `unavailable` rather than passing an
 * empty list off as the site's answer.
 */
export function entityListState(
  context: EntityPickerContextValue | undefined,
  kind: EntityPickerKind,
): EntityListState {
  if (!context?.request) return 'unavailable'
  return context.status?.[kind] ?? 'loading'
}

export const EntityPickerContext = createContext<EntityPickerContextValue>({})
EntityPickerContext.displayName = 'EntityPickerContext'
