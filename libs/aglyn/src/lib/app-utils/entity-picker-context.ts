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

/**
 * How many documents a picker BROWSES.
 *
 * A picker is not a catalog viewer. It is a dropdown on a besigner surface
 * where the author is placing one element, and no table in the console offers
 * a page past `TABLE_PAGE_SIZE_OPTIONS` — a dropdown is the smaller surface of
 * the two, not the larger.
 *
 * The middle of that range rather than its floor: a table has a pager under it
 * and a dropdown does not, so the page a reader cannot advance is worth more
 * rows than the one they can.
 *
 * What makes this size SAFE is that browsing is the only job it does. A stored
 * value is named by {@link EntityPickerContextValue.resolve} — one keyed read
 * for the one document, exact at any catalog size — so nothing here has to be
 * wide enough to contain whatever an author picked last month. A window that
 * carried both jobs would have to be, and would still render a bound element
 * as unbound past its own width; widening this cannot fix that, only make it
 * rarer and more expensive.
 */
export const ENTITY_PICKER_BROWSE_LIMIT = 25

/**
 * How many documents a server-side name search may return.
 *
 * The same size as the browse window, for the same reason: a reader who has
 * typed a query and still faces 25 rows narrows it further rather than
 * scrolling. Only the kinds in {@link EntityPickerContextValue.searchable}
 * spend this at all.
 */
export const ENTITY_PICKER_SEARCH_LIMIT = 25

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
  /**
   * The browse window came back FULL for this kind, so the list above is a
   * page of the site's catalog and not the whole of it.
   *
   * Measured with a probe — the read asks for one document past
   * {@link ENTITY_PICKER_BROWSE_LIMIT} and the extra one is never offered —
   * so this is a fact about the collection rather than a guess from the
   * window being exactly full.
   *
   * A picker owes the reader this sentence for the same reason the inbox's
   * form filter does: "not in the picker" and "does not exist" are the same
   * empty dropdown, and only one of them is a fact about their site.
   */
  truncated?: Partial<Record<EntityPickerKind, boolean>>
  /**
   * This kind's documents carry the name-search keys, so a typed query
   * reaches the WHOLE collection rather than only the browse window.
   *
   * True for products alone today: `nameTokens`/`nameLower` are stamped by
   * the catalog's own write path, and `hosts/{host}/resources` deliberately
   * does not stamp them on the other four kinds. A picker for a kind that is
   * absent here must say its search covers the window only — claiming
   * otherwise would let an unfound entity read as a nonexistent one.
   */
  searchable?: Partial<Record<EntityPickerKind, boolean>>
  /**
   * Narrow this kind's offered list to what somebody typed.
   *
   * Matching is the provider's, not the dropdown's: it is the only side that
   * can merge the window's own matches with the ones a server query found
   * past it, and it uses `scoreMatch` so a query matches a word ANYWHERE in a
   * name — the same rule the switchers and global search follow.
   *
   * Passing an empty string restores the browse window.
   */
  search?: (kind: EntityPickerKind, text: string) => void
  /**
   * Resolve ONE stored id to its current name, whatever the browse window
   * holds.
   *
   * Deliberately NOT a job for the browse list, though a bulk read could do
   * both. Sharing one read makes the list's width the limit on which stored
   * values can be named, and past that width a picker renders a bound element
   * as UNBOUND rather than as its label — an empty control on an element that
   * is set, which an author repairs by picking again. That is how a correct
   * reference gets replaced with a different one.
   *
   * One keyed `getDoc` for one document instead: exact at any catalog size,
   * and asked for only when a node actually carries a value. Results land in
   * {@link resolved} and are never re-read.
   */
  resolve?: (kind: EntityPickerKind, id: string) => void
  /**
   * What {@link resolve} found, keyed by kind and then by id.
   *
   * Three states, and the picker renders a different label for each: an
   * `EntityOption` is the resolved name, `null` is a settled read that found
   * NO such document, and an absent key is a resolution still in flight.
   * Absent must never render as missing — a picker that flashed "unavailable"
   * over every live reference for the beat before its read landed would teach
   * authors to ignore the one warning that matters.
   */
  resolved?: Partial<
    Record<EntityPickerKind, Readonly<Record<string, EntityOption | null>>>
  >
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

/**
 * The id whose label a picker still needs a keyed read to learn, if any.
 *
 * Part of the contract rather than of one screen, because two surfaces ask
 * it — the attributes panel about a node's picker value, and the insert-token
 * menu about the dataset a repeat is bound to — and an answer that differed
 * between them would be a second keyed read for a document one of them
 * already had.
 *
 * Four cases resolve to "ask nobody", and each is a read not spent: there is
 * no value; the browse window already carries it, which is the common case on
 * a small site; a resolution has already answered, including the answer that
 * the document is gone; or the browse read has not settled, so the window may
 * be about to supply it for free.
 *
 * The last is the one worth stating. Asking while the listener is still
 * loading would spend a keyed read on nearly every picker on every site,
 * which is the cost splitting these two jobs exists to remove rather than to
 * move.
 */
export function entityValueNeedsResolution(
  context: EntityPickerContextValue | undefined,
  kind: EntityPickerKind,
  value: unknown,
): string | undefined {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !context?.resolve) return undefined
  if ((context[kind] ?? []).some((entity) => entity.id === id)) return undefined
  if (id in (context.resolved?.[kind] ?? {})) return undefined
  if (entityListState(context, kind) !== 'ready') return undefined
  return id
}

export const EntityPickerContext = createContext<EntityPickerContextValue>({})
EntityPickerContext.displayName = 'EntityPickerContext'
