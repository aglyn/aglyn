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

import type { DocumentData, DocumentReference, Firestore, Query } from 'firebase/firestore'
import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import type { PluginIndexedRecord } from './plugin-record-index'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * A plugin's records, LISTED in the console for another plugin's picker or
 * check (AGL-3080) — the browser's half of `plugin-record-index`.
 *
 * A plugin that offers records it does not own — an automation step picking
 * a dataset, a reference check confirming a workflow still exists, a deal
 * picking a product — used to query the owner's collection from the browser
 * itself: the path, the filter the owner's security rules require, the field
 * a name is in, what a deleted one looks like. Each breaks the day the owner
 * changes one, and none is visible to `check:lib-boundaries`.
 *
 * So the owner publishes a LIST SOURCE for each record kind it keeps: the
 * query the signed-in member's read of a scope is proved by, and how one
 * stored document reads as a record — an id, a name and the facts the owner
 * chooses to share, in the shape its registration documents, the same shape
 * its server index answers. The reader runs the query with its own listener
 * (`pluginRecordListQuery`) and reads the rows back through the owner
 * (`pluginRecordsFromRows`), and never learns where the records are stored.
 *
 * ## Not registered is an answer
 *
 * No source for a kind means no plugin keeps it in this console — the owner is
 * not installed or not loaded. A reader treats that as "none here" and says
 * so, rather than reaching for the collection itself.
 *
 * ## One source per kind
 *
 * A second plugin registering a source for a kind another plugin already
 * keeps is refused, naming both, and the incumbent keeps serving.
 */

/** Which records a reader lists. */
export interface PluginRecordListRequest {
  /** The organization the records belong to, where the kind is org-scoped. */
  orgId?: string | null
  /**
   * The site the records are listed for. An org-scoped kind narrows to what
   * the site may use; `null` lists the organization's own view, which only an
   * organization-wide reader may hold.
   */
  hostId?: string | null
  /** What a person typed, matched the owner's way; absent lists the scope. */
  search?: string | null
  /**
   * The signed-in member's own scope tokens, where they are not
   * organization-wide and no site is named: an org-scoped kind narrows to
   * what they may see, which is the filter the security rules require of
   * them. Absent for an organization-wide reader; a named site's narrowing
   * wins over it, and a site's own kind has no use for it.
   */
  memberScope?: readonly string[] | null
  /**
   * Only the records installed from this listing — the `listingId` of their
   * install stamp (`app-utils/artifact-provenance.ts`), matched wherever the
   * owner keeps it. A kind that is never installed answers none.
   */
  installedFrom?: string | null
  /**
   * The consent group the named site presents as (`app-utils/consent-groups`),
   * for a kind whose records say different things to different groups — a
   * person's name as one brand knows them. Absent reads as the site alone.
   */
  consentGroupId?: string | null
  /**
   * The signed-in member, for a kind some of whose records are one member's
   * own — a saved view kept private: the owner leaves out what this member
   * may not list. Absent reads as nobody's, which lists only what is shared.
   */
  viewerUid?: string | null
  /** The most documents the query may answer — a reader asks one past its window to learn it was cut. */
  limit: number
}

/** Where a reader walks a kind, or opens one record of it. */
export interface PluginRecordListScope {
  /** The organization, where no site is named. */
  orgId?: string | null
  /** The site; named, it wins over the organization. */
  hostId?: string | null
}

export interface PluginRecordListSource {
  /**
   * The query the signed-in member's read of the scope is proved by, at most
   * `limit` documents, or `null` for a scope the kind has none in (a site-only
   * kind asked at the organization, a search with nothing to match).
   */
  query(firestore: Firestore, request: PluginRecordListRequest): Query<DocumentData> | null
  /**
   * One stored document as the owner shares it, or `null` to leave it out
   * (deleted, unnamed, or not the reader's to list). `request` is the one the
   * query was built from, when the reader hands it back: a rule the query
   * cannot state — a site's view of an org-wide row, a member's own view —
   * is applied here.
   */
  record(
    id: string,
    data: Readonly<Record<string, unknown>>,
    request?: PluginRecordListRequest,
  ): PluginIndexedRecord | null
  /**
   * The base a reader WALKS the kind from with the console's paged list query
   * (`useListQuery`), which adds its filters, its order and its pages over the
   * stored fields the owner documents for the kind — or `null` for a scope
   * the kind has none in. For a kind whose reader pages a whole list rather
   * than picking from a window. Where the rules admit a read only narrowed by
   * a field, the owner's registration says which, and the reader adds it.
   */
  walk?(firestore: Firestore, scope: PluginRecordListScope): Query<DocumentData> | null
  /**
   * One record's document, for a reader that opens it whole or changes what
   * the owner documents a reader may change — the security rules hold the
   * rest — or `null` for a scope the kind has none in.
   */
  doc?(
    firestore: Firestore,
    request: PluginRecordListScope & { id: string },
  ): DocumentReference<DocumentData> | null
}

export const PLUGIN_RECORD_LISTS = definePluginServiceContract<PluginRecordListSource>(
  'core.record-lists',
  { multiple: true },
)

/**
 * Publishes the list source for one record kind. The owner is the loader's
 * marker when a register fn is running, else `options.pluginId`; with neither
 * the registration throws. A kind another plugin lists throws naming both.
 */
export function registerPluginRecordListSource(
  kind: string,
  source: PluginRecordListSource,
  options?: { pluginId?: string },
): void {
  const key = kind.trim()
  if (!key) throw new Error('a record list source needs a record kind')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  if (!pluginId) {
    throw new Error(`the record list source for "${key}" was registered with no owner`)
  }
  const incumbent = resolvePluginServices(PLUGIN_RECORD_LISTS).find((entry) => entry.key === key)
  if (incumbent && incumbent.pluginId !== pluginId) {
    throw new Error(
      `record kind "${key}" is already listed by "${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_RECORD_LISTS, source, { pluginId, key })
}

/** The list source for a kind, with the plugin that keeps it, or `null` when none does here. */
export function pluginRecordListSource(
  kind: string,
): { pluginId: string; source: PluginRecordListSource } | null {
  const key = kind.trim()
  const entry = resolvePluginServices(PLUGIN_RECORD_LISTS).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, source: entry.impl } : null
}

/**
 * The query a reader listens to for a kind's records — with the console's own
 * collection listener, so it is bounded, retried and reported like every
 * other list — or `null` when no plugin keeps the kind here or the scope has
 * none.
 */
export function pluginRecordListQuery(
  kind: string,
  firestore: Firestore,
  request: PluginRecordListRequest,
): Query<DocumentData> | null {
  return pluginRecordListSource(kind)?.source.query(firestore, request) ?? null
}

/**
 * The base a reader walks `kind` from in a scope, or `null` — no plugin keeps
 * the kind here, it offers no walk, or the scope has none.
 */
export function pluginRecordListWalk(
  kind: string,
  firestore: Firestore,
  scope: PluginRecordListScope,
): Query<DocumentData> | null {
  return pluginRecordListSource(kind)?.source.walk?.(firestore, scope) ?? null
}

/**
 * One record of `kind`'s document, or `null` — no plugin keeps the kind here,
 * it offers no document, or the scope has none.
 */
export function pluginRecordListDoc(
  kind: string,
  firestore: Firestore,
  request: PluginRecordListScope & { id: string },
): DocumentReference<DocumentData> | null {
  return pluginRecordListSource(kind)?.source.doc?.(firestore, request) ?? null
}

/**
 * The documents a reader's listener answered for `kind`, as their owner
 * shares them: each row's id is read from `idField` (the listener's), and a
 * row the owner leaves out (deleted, unnamed, not this reader's) is not
 * answered. None where no plugin keeps the kind here. `request` is the one
 * the query was built from: hand it back, so the owner can apply what the
 * query could not state.
 */
export function pluginRecordsFromRows(
  kind: string,
  rows: ReadonlyArray<Readonly<Record<string, unknown>>> | null | undefined,
  idField = '$id',
  request?: PluginRecordListRequest,
): PluginIndexedRecord[] {
  const source = pluginRecordListSource(kind)?.source
  if (!source) return []
  return (rows ?? [])
    .map((row) => source.record(String(row[idField] ?? ''), row, request))
    .filter((record): record is PluginIndexedRecord => record !== null)
}
