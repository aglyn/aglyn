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
 * Facts one plugin reads about a record another plugin owns (AGL-2917).
 *
 * A record belongs to the plugin that models it: where it is stored, who may
 * read it, which of its fields a site may see and which belong to another
 * site. A different plugin that reasons over such a record — an assistant
 * summarizing it, an automation deciding on it, a report joining it — must
 * not read the documents itself, because it would restate the owner's read
 * rules and drift from them the day the owner changes one. Nor may it import
 * the owner, which the package map forbids.
 *
 * So the owner registers a READER for the record from its server surfaces,
 * and a caller asks for one by resource name. Every rule stays the owner's:
 *
 *  - which member may read the record, on which site or at the organization
 *    level, and what the plan allows;
 *  - which of the record's facts leave the owner at all. A reader reports the
 *    facts it documents and nothing else, so what a caller can pass on is
 *    decided where the data is modeled, and a field the owner leaves out
 *    cannot be read through the seam by accident.
 *
 * `read` never writes. A resource whose "record" is a catalog rather than a
 * document — the fields an import may fill, say — is read the same way, with
 * the catalog's name as its id.
 *
 * Built on the typed service registry (`plugin-services`): one contract, every
 * reader registered under its resource name as the service's key.
 *
 * ## The caller proves who is asking
 *
 * Like `plugin-resource-drafts`, the registry authenticates nobody. A caller
 * establishes, in its own terms and before it asks, who the member is and that
 * they belong to the org; the reader then applies the owner's read rules to
 * that member. A caller that could not name a member has nothing to ask with.
 *
 * ## One reader per resource
 *
 * A resource has one owner. A second plugin registering a reader for a
 * resource another plugin already reads is refused, naming both, and the
 * incumbent keeps serving; the same plugin registering again — from a second
 * server surface, or on a hot reload — replaces its own.
 */

/** Whose view of which record, and when. */
export interface PluginRecordFactsRequest {
  orgId: string
  /**
   * The site the record is read on, or `null` for the organization's own view
   * of it. An owner whose records belong to sites reads a site's share of the
   * record for a site, and the organization-wide record for `null`.
   */
  hostId: string | null
  /** The record's id, in the owner's terms. */
  id: string
  /** The member the facts are read for: the owner applies its read rules to them. */
  uid: string
  /** A verified staff caller, where the owner lets staff read; absent is not staff. */
  staff?: boolean
  /** The org document the caller already read, for the owner's entitlement reads. */
  org: Readonly<Record<string, unknown>> | null
  now: Date
}

/** Why the facts cannot be read. */
export interface PluginRecordFactsRefusal {
  status: 400 | 403 | 404
  /** Customer-safe: a caller shows it as it stands. */
  error: string
}

export type PluginRecordFactsRead =
  | {
      ok: true
      /** The record's facts, in the shape the owner's reader documents. */
      facts: Readonly<Record<string, unknown>>
    }
  | (PluginRecordFactsRefusal & { ok: false })

export interface PluginRecordFactsReader {
  /** The facts of one record for one member; a refusal is returned, never thrown. */
  read(request: PluginRecordFactsRequest): Promise<PluginRecordFactsRead>
}

export const PLUGIN_RECORD_FACTS = definePluginServiceContract<PluginRecordFactsReader>(
  'core.record-facts',
  { multiple: true },
)

/**
 * Registers the reader for a resource. The owner is the loader's marker when a
 * register fn is running, else `options.pluginId`; with neither the
 * registration throws. A reader for a resource another plugin reads throws
 * naming both.
 */
export function registerPluginRecordFactsReader(
  resource: string,
  reader: PluginRecordFactsReader,
  options?: { pluginId?: string },
): void {
  const key = resource.trim()
  if (!key) throw new Error('a record facts reader needs a resource name')
  const pluginId = (getRegisteringPluginId() ?? options?.pluginId ?? '').trim()
  const incumbent = resolvePluginServices(PLUGIN_RECORD_FACTS).find((entry) => entry.key === key)
  if (incumbent && pluginId && incumbent.pluginId !== pluginId) {
    throw new Error(
      `resource "${key}" already has a facts reader from "${incumbent.pluginId}"; ` +
        `refused "${pluginId}"`,
    )
  }
  registerPluginService(PLUGIN_RECORD_FACTS, reader, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
    key,
  })
}

export interface ResolvedPluginRecordFactsReader {
  /** The plugin that owns the resource. */
  pluginId: string
  reader: PluginRecordFactsReader
}

/** The reader for a resource, with its owner, or `null` when no plugin reads it. */
export function pluginRecordFactsReader(resource: string): ResolvedPluginRecordFactsReader | null {
  const key = resource.trim()
  const entry = resolvePluginServices(PLUGIN_RECORD_FACTS).find((one) => one.key === key)
  return entry ? { pluginId: entry.pluginId, reader: entry.impl } : null
}
