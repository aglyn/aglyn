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

import { getRegisteringPluginId } from '../app-utils/registering-plugin'
import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginServices,
} from './plugin-services'

/**
 * How a plugin's record presents as a card, published by the plugin that owns
 * it (AGL-3080).
 *
 * A surface that is not the record's own sometimes has to DRAW it rather than
 * link to it: a designed email that features a product, a picker that lists
 * what another plugin keeps. Doing that by reading the owner's collection and
 * importing the owner's model is two couplings at once — to where the record
 * is stored and to what its fields mean — and the second is the one that goes
 * wrong quietly, because a price rule that changes in the owner is still
 * computed the old way everywhere it was copied.
 *
 * So the owner answers the fourth question about a record kind. The facts
 * reader says what a member may know about it, the timeline what happened on
 * it, the route where a person reads it; this says what it looks like in one
 * line and one image. It is keyed by the same RECORD KIND as those three, so
 * a plugin that owns `product` registers them together.
 *
 * ## What a card is
 *
 * A title, an optional caption already worded for a reader (a price, a date, a
 * status — the owner decides, and formats it), an optional image, and an
 * optional `path` on the published site. Nothing here is the owner's model:
 * no field a caller could compute on, which is what keeps the rule in one
 * place.
 *
 * ## Server-side, and unauthenticated on purpose
 *
 * A reader runs with the Admin SDK for a caller that has already decided the
 * read is the workspace's to make — a send the merchant started, a job the
 * platform scheduled. That is a different question from `plugin-record-facts`,
 * which answers ONE member and applies their permissions, and the two are
 * separate contracts so neither borrows the other's trust.
 *
 * Both apps load every plugin's server entry before any plugin handler runs
 * (`ensureAll`), so a reader registered from a server registrar is present
 * wherever a handler asks. `null` still has two meanings a caller must treat
 * alike — no plugin publishes the kind, or the record is not there — and both
 * mean the same thing to it: there is nothing to draw.
 *
 * ## One kind, one owner
 *
 * A second plugin publishing a card for a kind another already publishes is
 * refused naming both, and the incumbent keeps serving; the owner registering
 * again replaces its own.
 *
 * Import this module by its own subpath
 * (`@aglyn/aglyn/plugin-manager/plugin-record-cards`); it is not in the barrel.
 */

export interface PluginRecordCardRequest {
  hostId: string
  /** The record's document id. */
  id: string
}

export interface PluginRecordCard {
  title: string
  /** One short line the owner has already worded for a reader. */
  caption?: string
  imageUrl?: string
  /** Where the record is read on the published site, site-relative. */
  path?: string
}

export interface PluginRecordCardReader {
  /** `null` when the record does not exist. */
  read(request: PluginRecordCardRequest): Promise<PluginRecordCard | null>
}

export interface ResolvedPluginRecordCardReader {
  pluginId: string
  reader: PluginRecordCardReader
}

export const PLUGIN_RECORD_CARDS =
  definePluginServiceContract<PluginRecordCardReader>('core.record-cards', {
    multiple: true,
  })

export function registerPluginRecordCardReader(
  kind: string,
  reader: PluginRecordCardReader,
  options?: { pluginId?: string },
): void {
  const key = kind.trim()
  if (!key) throw new Error('a record card reader needs a record kind')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_RECORD_CARDS).find(
    (entry) => entry.key === key,
  )
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `record kind "${key}" already publishes a card from ` +
        `"${incumbent.pluginId}"; refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_RECORD_CARDS, reader, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

/** The reader for a kind with its owner, or `null` when none publishes it. */
export function pluginRecordCardReader(
  kind: string,
): ResolvedPluginRecordCardReader | null {
  const key = kind.trim()
  const entry = resolvePluginServices(PLUGIN_RECORD_CARDS).find(
    (one) => one.key === key,
  )
  return entry ? { pluginId: entry.pluginId, reader: entry.impl } : null
}

/** One record's card; `null` when no plugin publishes the kind or it is gone. */
export async function readPluginRecordCard(
  kind: string,
  request: PluginRecordCardRequest,
): Promise<PluginRecordCard | null> {
  const found = pluginRecordCardReader(kind)
  return found ? found.reader.read(request) : null
}

/** Every published kind with its owner. */
export function listPluginRecordCardKinds(): Array<{
  kind: string
  pluginId: string
}> {
  return resolvePluginServices(PLUGIN_RECORD_CARDS).map((entry) => ({
    kind: entry.key ?? '',
    pluginId: entry.pluginId,
  }))
}
